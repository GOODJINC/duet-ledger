package app

import (
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"sort"
	"strings"
)

type apiStatusWriter struct {
	http.ResponseWriter
	status int
}

func (w *apiStatusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }
func (w *apiStatusWriter) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
		w.ResponseWriter.WriteHeader(status)
	}
}
func (w *apiStatusWriter) Write(data []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(200)
	}
	return w.ResponseWriter.Write(data)
}
func (a *App) addExternalAPI(m *http.ServeMux) {
	add := func(pattern, scope string, h handler) { m.HandleFunc(pattern, a.externalAPI(scope, h)) }
	add("GET /api/v1/me", "", func(w http.ResponseWriter, r *http.Request, u *User) error {
		permissions := []string{}
		ids := []string{}
		for p := range u.API.Permissions {
			permissions = append(permissions, p)
		}
		for id := range u.API.Accounts {
			ids = append(ids, id)
		}
		sort.Strings(permissions)
		sort.Strings(ids)
		writeJSON(w, 200, map[string]any{"id": u.ID, "name": u.Name, "timezone": u.Timezone, "default_currency": u.DefaultCurrency, "app_password_id": u.API.ID, "app_password_name": u.API.Name, "expires_at": u.API.ExpiresAt, "permissions": permissions, "account_ids": ids})
		return nil
	})
	add("GET /api/v1/accounts", "read", a.listAccounts)
	add("GET /api/v1/categories", "read", func(w http.ResponseWriter, r *http.Request, u *User) error {
		if r.URL.Query().Get("account") == "" {
			return bad("분류를 조회할 계좌를 지정해 주세요.")
		}
		return a.listCategories(w, r, u)
	})
	add("GET /api/v1/transactions", "read", a.listTransactions)
	add("GET /api/v1/transactions/{id}", "read", a.getAPITransaction)
	add("GET /api/v1/statistics", "read", a.apiStatistics)
	add("POST /api/v1/transactions", "create", func(w http.ResponseWriter, r *http.Request, u *User) error {
		if r.Header.Get("Idempotency-Key") == "" {
			return bad("중복 입력 방지를 위한 Idempotency-Key가 필요해요.")
		}
		return a.createTransaction(w, r, u)
	})
	add("PUT /api/v1/transactions/{id}", "update", a.updateTransaction)
	add("DELETE /api/v1/transactions/{id}", "delete", a.trashTransaction)
	add("POST /api/v1/transactions/{id}/restore", "delete", a.restoreTransaction)
	add("POST /api/v1/transactions/{id}/receipts", "receipts", a.uploadReceipt)
	add("GET /api/v1/receipts/{id}", "read", a.getReceipt)
	add("DELETE /api/v1/receipts/{id}", "delete", func(w http.ResponseWriter, r *http.Request, u *User) error {
		if !u.API.Permissions["receipts"] {
			return forbidden()
		}
		return a.deleteReceipt(w, r, u)
	})
	// Unknown paths and methods remain inside bearer authentication, never the SPA or cookie API.
	m.HandleFunc("/api/v1/", a.externalAPI("", func(w http.ResponseWriter, r *http.Request, u *User) error { return missing() }))
}
func (a *App) externalAPI(permission string, h handler) http.HandlerFunc {
	return func(original http.ResponseWriter, r *http.Request) {
		original.Header().Set("Cache-Control", "no-store")
		original.Header().Set("X-Content-Type-Options", "nosniff")
		original.Header().Set("Referrer-Policy", "no-referrer")
		if !a.sameOrigin(r) {
			writeRequestError(original, r, nil, forbidden(), true)
			return
		}
		response := newBufferedResponse(original.Header(), &a.spool)
		defer response.send(original, r)
		w := &apiStatusWriter{ResponseWriter: response}
		// Reserve exactly one call before receiving or decoding any body. Invalid
		// uploads consume the same budget as successful calls, including concurrency.
		a.mu.Lock()
		u, err := a.authenticateApp(r)
		if err == nil {
			if !a.apiRate("api-key:"+u.API.ID, 120) {
				w.Header().Set("Retry-After", "60")
				err = &apiError{429, "rate_limit", "앱 비밀번호당 1분에 120회까지 요청할 수 있어요."}
			} else if permission != "" && !u.API.Permissions[permission] {
				err = &apiError{403, "insufficient_permission", "이 앱 비밀번호에 허용되지 않은 기능이에요."}
			}
		}
		a.mu.Unlock()
		if u != nil {
			defer func() { a.recordAPIRequest(r, u, response.responseStatus()) }()
		}
		if err != nil {
			writeRequestError(w, r, u, err, true)
			return
		}
		cleanup, err := a.receiveRequest(w, r, a.authenticateApp)
		if err != nil {
			writeRequestError(w, r, u, err, true)
			return
		}
		defer cleanup()
		a.mu.Lock()
		defer a.mu.Unlock()
		// Revocation and permission changes during reception must still take effect.
		var current *User
		if !a.sameOrigin(r) {
			err = forbidden()
		} else {
			current, err = a.authenticateApp(r)
		}
		if err == nil {
			if permission != "" && !current.API.Permissions[permission] {
				err = &apiError{403, "insufficient_permission", "이 앱 비밀번호에 허용되지 않은 기능이에요."}
			} else {
				err = h(w, r, current)
			}
		}
		if err != nil {
			writeRequestError(w, r, u, err, true)
		}
	}
}

// Called after releasing the handler lock, before sending the buffered response.
// Only authenticated identity and the route pattern are retained, never input.
func (a *App) recordAPIRequest(r *http.Request, u *User, status int) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if status == 0 {
		status = 200
	}
	path := strings.TrimPrefix(r.Pattern, r.Method+" ")
	if path == "" {
		path = "/api/v1/"
	}
	_, _ = a.DB.Exec("INSERT INTO api_requests VALUES(?,?,?,?,?,?,?)", newID(), u.API.ID, u.ID, r.Method, path, status, now())
	_, _ = a.DB.Exec("UPDATE api_credentials SET last_used_at=? WHERE id=?", now(), u.API.ID)
	_, _ = a.DB.Exec("DELETE FROM api_requests WHERE user_id=? AND id NOT IN (SELECT id FROM api_requests WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 1000)", u.ID, u.ID)
}
func (a *App) getAPITransaction(w http.ResponseWriter, r *http.Request, u *User) error {
	var aid, date, event string
	var deleted bool
	err := a.DB.QueryRow("SELECT p.account_id,e.date,e.id,e.deleted_at IS NOT NULL FROM postings p JOIN events e ON e.id=p.event_id WHERE p.id=?", r.PathValue("id")).Scan(&aid, &date, &event, &deleted)
	if errors.Is(err, sql.ErrNoRows) {
		return missing()
	}
	if err != nil {
		return err
	}
	if _, err = a.account(a.DB, u, aid); err != nil {
		return err
	}
	params := url.Values{}
	params.Set("from", date)
	params.Set("to", date)
	if deleted {
		params.Set("trash", "true")
	}
	items, err := a.readTransactions(a.DB, u, params)
	if err != nil {
		return err
	}
	for _, v := range items {
		if v.eventID == event {
			writeJSON(w, 200, v)
			return nil
		}
	}
	return missing()
}
func (a *App) apiStatistics(w http.ResponseWriter, r *http.Request, u *User) error {
	items, err := a.readTransactions(a.DB, u, r.URL.Query())
	if err != nil {
		return err
	}
	page := summarize(items)
	if target := r.URL.Query().Get("display_currency"); target != "" {
		page, err = a.convertReport(items, u, target)
		if err != nil {
			return err
		}
	}
	writeJSON(w, 200, map[string]any{"count": page.Count, "totals": page.Totals, "categories": page.Categories, "daily": page.Daily, "missing_currencies": page.MissingCurrencies})
	return nil
}
