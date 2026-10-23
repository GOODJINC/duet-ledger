package app

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net"
	"net/http"
	"strings"
	"time"
)

type APIScope struct {
	Name        string
	ExpiresAt   int64
	ID          string
	Accounts    map[string]bool
	Permissions map[string]bool
}
type AppPassword struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Permissions []string `json:"permissions"`
	AccountIDs  []string `json:"account_ids"`
	ExpiresAt   int64    `json:"expires_at"`
	CreatedAt   string   `json:"created_at"`
	LastUsedAt  string   `json:"last_used_at"`
	RevokedAt   string   `json:"revoked_at"`
}

func (a *App) apiEnabled() bool {
	var v string
	return a.DB.QueryRow("SELECT value FROM server_settings WHERE key='api_enabled'").Scan(&v) == nil && v == "true"
}
func (a *App) apiSettings(w http.ResponseWriter, r *http.Request, u *User) error {
	if !u.Admin {
		return forbidden()
	}
	if r.Method == "PATCH" {
		var v struct {
			Enabled bool `json:"enabled"`
		}
		if err := decode(r, &v); err != nil {
			return err
		}
		value := "false"
		if v.Enabled {
			value = "true"
		}
		if _, err := a.DB.Exec("INSERT INTO server_settings(key,value) VALUES('api_enabled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", value); err != nil {
			return err
		}
		if err := audit(a.DB, u, "api_setting_changed", "server", value); err != nil {
			return err
		}
	}
	writeJSON(w, 200, map[string]bool{"enabled": a.apiEnabled()})
	return nil
}
func (a *App) listAppPasswords(w http.ResponseWriter, r *http.Request, u *User) error {
	rows, err := a.DB.Query("SELECT id,name,permissions,expires_at,created_at,COALESCE(last_used_at,''),COALESCE(revoked_at,'') FROM api_credentials WHERE user_id=? ORDER BY created_at DESC", u.ID)
	if err != nil {
		return err
	}
	out := []AppPassword{}
	for rows.Next() {
		var v AppPassword
		var scopes string
		if err = rows.Scan(&v.ID, &v.Name, &scopes, &v.ExpiresAt, &v.CreatedAt, &v.LastUsedAt, &v.RevokedAt); err != nil {
			rows.Close()
			return err
		}
		if err = json.Unmarshal([]byte(scopes), &v.Permissions); err != nil {
			rows.Close()
			return err
		}
		out = append(out, v)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for i := range out {
		out[i].AccountIDs = []string{}
		rs, e := a.DB.Query("SELECT account_id FROM api_credential_accounts WHERE credential_id=? ORDER BY account_id", out[i].ID)
		if e != nil {
			return e
		}
		for rs.Next() {
			var id string
			if e = rs.Scan(&id); e != nil {
				rs.Close()
				return e
			}
			out[i].AccountIDs = append(out[i].AccountIDs, id)
		}
		e = rs.Err()
		rs.Close()
		if e != nil {
			return e
		}
	}
	writeJSON(w, 200, map[string]any{"enabled": a.apiEnabled(), "items": out})
	return nil
}
func (a *App) createAppPassword(w http.ResponseWriter, r *http.Request, u *User) error {
	if !a.apiEnabled() {
		return &apiError{403, "api_disabled", "관리자가 API 사용을 허용해야 해요."}
	}
	if !a.rateAllowed(r, "app-password-create:"+u.ID, 10) {
		return &apiError{429, "rate_limit", "잠시 후 다시 시도해 주세요."}
	}
	var v struct {
		Name        string   `json:"name"`
		AccountIDs  []string `json:"account_ids"`
		Permissions []string `json:"permissions"`
		Lifetime    string   `json:"lifetime"`
		Password    string   `json:"password"`
		Code        string   `json:"code"`
	}
	if err := decode(r, &v); err != nil {
		return err
	}
	v.Name = strings.TrimSpace(v.Name)
	if !validName(v.Name, 60) || len(v.AccountIDs) == 0 || len(v.AccountIDs) > 500 || len(v.Permissions) == 0 || len(v.Permissions) > 5 {
		return bad("이름·계좌·권한을 확인해 주세요.")
	}
	valid := map[string]bool{"read": true, "create": true, "update": true, "delete": true, "receipts": true}
	seen := map[string]bool{}
	for _, p := range v.Permissions {
		if !valid[p] || seen[p] {
			return bad("권한을 확인해 주세요.")
		}
		seen[p] = true
	}
	var expiry int64
	days := map[string]int{"30d": 30, "90d": 90, "1y": 365, "never": 0}
	n, ok := days[v.Lifetime]
	if !ok {
		return bad("유효기간은 30일·90일·1년·만료 없음 중 선택해 주세요.")
	}
	if n > 0 {
		expiry = time.Now().Add(time.Duration(n) * 24 * time.Hour).Unix()
	}
	available, err := a.accounts(a.DB, u)
	if err != nil {
		return err
	}
	allowed := map[string]bool{}
	for _, ac := range available {
		allowed[ac.ID] = true
	}
	ids := map[string]bool{}
	for _, id := range v.AccountIDs {
		if !allowed[id] || ids[id] {
			return bad("접근 가능한 계좌를 중복 없이 선택해 주세요.")
		}
		ids[id] = true
	}
	var count int
	if err = a.DB.QueryRow("SELECT COUNT(*) FROM api_credentials WHERE user_id=? AND revoked_at IS NULL AND (expires_at=0 OR expires_at>?)", u.ID, time.Now().Unix()).Scan(&count); err != nil {
		return err
	}
	if count >= 100 {
		return bad("사용 중인 앱 비밀번호는 최대 100개예요. 사용하지 않는 키를 폐기해 주세요.")
	}
	if err = a.reauth(u, v.Password, v.Code); err != nil {
		return err
	}
	secret := "dl_app_" + encode64(random(32))
	id := newID()
	scopes, _ := json.Marshal(v.Permissions)
	created := now()
	tx, err := a.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec("INSERT INTO api_credentials(id,user_id,name,secret_hash,permissions,expires_at,created_at) VALUES(?,?,?,?,?,?,?)", id, u.ID, v.Name, tokenHash(secret), string(scopes), expiry, created); err != nil {
		return err
	}
	for _, aid := range v.AccountIDs {
		if _, err = tx.Exec("INSERT INTO api_credential_accounts VALUES(?,?)", id, aid); err != nil {
			return err
		}
	}
	if err = audit(tx, u, "app_password_created", "api_credential", id); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	writeJSON(w, 201, map[string]any{"id": id, "app_password": secret, "expires_at": expiry})
	return nil
}
func (a *App) revokeAppPassword(w http.ResponseWriter, r *http.Request, u *User) error {
	result, err := a.DB.Exec("UPDATE api_credentials SET revoked_at=COALESCE(revoked_at,?) WHERE id=? AND user_id=?", now(), r.PathValue("id"), u.ID)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return missing()
	}
	if err = audit(a.DB, u, "app_password_revoked", "api_credential", r.PathValue("id")); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}
func revokeAppPasswords(q queryer, userID string) error {
	var exists int
	if err := q.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='api_credentials'").Scan(&exists); err != nil {
		return err
	}
	if exists == 0 {
		return nil
	}
	if userID == "" {
		_, err := q.Exec("UPDATE api_credentials SET revoked_at=COALESCE(revoked_at,?)", now())
		return err
	}
	_, err := q.Exec("UPDATE api_credentials SET revoked_at=COALESCE(revoked_at,?) WHERE user_id=?", now(), userID)
	return err
}
func (a *App) authenticateApp(r *http.Request) (*User, error) {
	deny := func() (*User, error) {
		host, _, _ := net.SplitHostPort(r.RemoteAddr)
		if !a.apiRate("api-invalid:"+host, 30) {
			return nil, &apiError{429, "rate_limit", "잠시 후 다시 시도해 주세요."}
		}
		return nil, &apiError{401, "invalid_app_password", "앱 비밀번호가 잘못되었거나 만료·폐기됐어요."}
	}
	parts := strings.Fields(r.Header.Get("Authorization"))
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || !strings.HasPrefix(parts[1], "dl_app_") || len(parts[1]) != 50 {
		return deny()
	}
	if !a.apiEnabled() {
		return nil, &apiError{403, "api_disabled", "관리자가 API 사용을 중지했어요."}
	}
	var id, uid, raw, name string
	var expires int64
	err := a.DB.QueryRow("SELECT id,user_id,permissions,name,expires_at FROM api_credentials WHERE secret_hash=? AND revoked_at IS NULL AND (expires_at=0 OR expires_at>?)", tokenHash(parts[1]), time.Now().Unix()).Scan(&id, &uid, &raw, &name, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return deny()
	}
	if err != nil {
		return nil, err
	}
	u, err := a.user(uid)
	if err != nil {
		return nil, err
	}
	u.Admin = false
	u.CSRF = ""
	u.API = &APIScope{Name: name, ExpiresAt: expires, ID: id, Accounts: map[string]bool{}, Permissions: map[string]bool{}}
	var scopes []string
	if err = json.Unmarshal([]byte(raw), &scopes); err != nil {
		return nil, err
	}
	for _, p := range scopes {
		u.API.Permissions[p] = true
	}
	rows, err := a.DB.Query("SELECT account_id FROM api_credential_accounts WHERE credential_id=?", id)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var aid string
		if err = rows.Scan(&aid); err != nil {
			rows.Close()
			return nil, err
		}
		u.API.Accounts[aid] = true
	}
	err = rows.Err()
	rows.Close()
	return u, err
}
func (a *App) apiRate(key string, limit int) bool {
	t := time.Now()
	if len(a.attempts) > 10000 {
		for k, v := range a.attempts {
			if t.Sub(v.Since) > 10*time.Minute {
				delete(a.attempts, k)
			}
		}
		if len(a.attempts) > 10000 {
			return false
		}
	}
	v := a.attempts[key]
	if t.Sub(v.Since) >= time.Minute {
		v = attempt{Since: t}
	}
	v.Count++
	a.attempts[key] = v
	return v.Count <= limit
}
func (a *App) listAPIRequests(w http.ResponseWriter, r *http.Request, u *User) error {
	rows, err := a.DB.Query("SELECT r.id,r.credential_id,c.name,r.method,r.path,r.status,r.created_at FROM api_requests r JOIN api_credentials c ON c.id=r.credential_id WHERE r.user_id=? ORDER BY r.created_at DESC,r.id DESC LIMIT 100", u.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, key, name, method, path, created string
		var status int
		if err = rows.Scan(&id, &key, &name, &method, &path, &status, &created); err != nil {
			return err
		}
		out = append(out, map[string]any{"id": id, "credential_id": key, "name": name, "method": method, "path": path, "status": status, "created_at": created})
	}
	if err = rows.Err(); err != nil {
		return err
	}
	writeJSON(w, 200, out)
	return nil
}
