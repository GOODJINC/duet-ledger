package app

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	_ "modernc.org/sqlite"
)

const Version = "0.1.0-alpha.4"

type Config struct {
	DataDir, PublicURL string
	SecureCookie       bool
	Assets             fs.FS
}
type App struct {
	DB       *sql.DB
	Config   Config
	mu       sync.Mutex
	master   []byte
	lockFile *os.File
	attempts map[string]attempt
}
type attempt struct {
	Count int
	Since time.Time
}
type queryer interface {
	Exec(string, ...any) (sql.Result, error)
	Query(string, ...any) (*sql.Rows, error)
	QueryRow(string, ...any) *sql.Row
}
type User struct {
	ID              string `json:"id"`
	Username        string `json:"username"`
	Name            string `json:"name"`
	Admin           bool   `json:"admin"`
	Locale          string `json:"locale"`
	Timezone        string `json:"timezone"`
	TOTP            bool   `json:"totp_enabled"`
	CSRF            string `json:"csrf,omitempty"`
	DefaultCurrency string `json:"default_currency"`
	ShowSidebar     bool   `json:"show_sidebar_message"`
	SharingPending  bool   `json:"sharing_pending,omitempty"`
}
type apiError struct {
	Status        int
	Code, Message string
}

func (e *apiError) Error() string   { return e.Message }
func bad(message string) error      { return &apiError{400, "invalid", message} }
func forbidden() error              { return &apiError{403, "forbidden", "이 작업을 할 권한이 없어요."} }
func missing() error                { return &apiError{404, "not_found", "내용을 찾을 수 없어요."} }
func conflict(message string) error { return &apiError{409, "conflict", message} }
func now() string                   { return time.Now().UTC().Format(time.RFC3339Nano) }
func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func decode(r *http.Request, value any) error {
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		return bad("JSON 형식의 요청이 필요해요.")
	}
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return bad("입력 형식을 확인해 주세요.")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return bad("요청은 하나의 JSON이어야 해요.")
	}
	return nil
}
func New(c Config) (result *App, err error) {
	if c.DataDir == "" {
		c.DataDir = "./data"
	}
	abs, err := filepath.Abs(c.DataDir)
	if err != nil {
		return nil, err
	}
	c.DataDir = abs
	if c.PublicURL != "" {
		u, e := url.Parse(c.PublicURL)
		if e != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") || u.Path != "" && u.Path != "/" || u.RawQuery != "" || u.Fragment != "" {
			return nil, fmt.Errorf("DUET_LEDGER_PUBLIC_URL must be an http(s) origin without a path")
		}
		c.PublicURL = strings.TrimSuffix(c.PublicURL, "/")
		c.SecureCookie = u.Scheme == "https" || c.SecureCookie
	}
	for _, dir := range []string{abs, filepath.Join(abs, "receipts"), filepath.Join(abs, "backups")} {
		if err = os.MkdirAll(dir, 0700); err != nil {
			return nil, err
		}
	}
	lock, err := os.OpenFile(filepath.Join(abs, "duet.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	if err = syscall.Flock(int(lock.Fd()), syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		lock.Close()
		return nil, fmt.Errorf("another Duet Ledger process uses this data directory")
	}
	a := &App{Config: c, lockFile: lock, attempts: map[string]attempt{}}
	defer func() {
		if err != nil {
			a.Close()
		}
	}()
	a.master, err = loadSecret(filepath.Join(abs, "master.key"), 32)
	if err != nil {
		return nil, err
	}
	uri := url.URL{Scheme: "file", Path: filepath.Join(abs, "duet.sqlite")}
	a.DB, err = sql.Open("sqlite", uri.String()+"?_pragma=foreign_keys(1)&_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=synchronous(FULL)")
	if err != nil {
		return nil, err
	}
	a.DB.SetMaxOpenConns(1)
	if _, err = a.DB.Exec(schema); err != nil {
		return nil, err
	}
	if err = a.migrate(); err != nil {
		return nil, err
	}
	_ = os.Chmod(filepath.Join(abs, "duet.sqlite"), 0600)
	return a, nil
}
func (a *App) Close() error {
	if a.DB != nil {
		a.DB.Close()
	}
	if a.lockFile != nil {
		_ = syscall.Flock(int(a.lockFile.Fd()), syscall.LOCK_UN)
		return a.lockFile.Close()
	}
	return nil
}

type handler func(http.ResponseWriter, *http.Request, *User) error

func (a *App) wrap(h handler, auth bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		r.Body = http.MaxBytesReader(w, r.Body, 22<<20)
		if r.Method != "GET" && r.Method != "HEAD" {
			if !a.sameOrigin(r) {
				writeJSON(w, 403, map[string]string{"error": "origin", "message": "허용되지 않은 접속 주소예요."})
				return
			}
		}
		// A single database owner serializes authorization checks and mutations. Revocation
		// cannot interleave between a permission check and its write.
		a.mu.Lock()
		defer a.mu.Unlock()
		var u *User
		var err error
		if auth {
			u, err = a.authenticate(r)
			if err == nil && r.Method != "GET" && r.Method != "HEAD" && !secureEqual(r.Header.Get("X-CSRF-Token"), u.CSRF) {
				err = &apiError{403, "csrf", "화면을 새로고침하고 다시 시도해 주세요."}
			}
		}
		if err == nil {
			err = h(w, r, u)
		}
		if err != nil {
			var e *apiError
			if errors.As(err, &e) {
				writeJSON(w, e.Status, map[string]string{"error": e.Code, "message": e.Message})
			} else {
				log.Printf("api failure: %T: %v", err, err)
				writeJSON(w, 500, map[string]string{"error": "internal", "message": "처리하지 못했어요. 서버 상태를 확인해 주세요."})
			}
		}
	}
}
func (a *App) sameOrigin(r *http.Request) bool {
	if r.Header.Get("Sec-Fetch-Site") == "cross-site" {
		return false
	}
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	if a.Config.PublicURL != "" {
		return origin == a.Config.PublicURL
	}
	scheme := "http"
	if r.TLS != nil {
		scheme = "https"
	}
	return origin == scheme+"://"+r.Host
}
func (a *App) Routes() http.Handler {
	m := http.NewServeMux()
	add := func(pattern string, h handler, auth bool) { m.HandleFunc(pattern, a.wrap(h, auth)) }
	add("GET /api/status", a.status, false)
	add("POST /api/setup", a.setup, false)
	add("POST /api/login", a.login, false)
	add("POST /api/join", a.join, false)
	add("GET /api/me", a.me, true)
	add("PATCH /api/me", a.updateMe, true)
	add("POST /api/logout", a.logout, true)
	add("POST /api/logout-all", a.logoutAll, true)
	add("POST /api/security/password", a.changePassword, true)
	add("POST /api/security/totp/start", a.startTOTP, true)
	add("POST /api/security/totp/confirm", a.confirmTOTP, true)
	add("POST /api/security/totp/disable", a.disableTOTP, true)
	add("GET /api/ledgers", a.listLedgers, true)
	add("PUT /api/ledgers/order", a.orderLedgers, true)
	add("PUT /api/ledgers/{id}/categories/order", a.orderCategories, true)
	add("POST /api/ledgers", a.createLedger, true)
	add("PATCH /api/ledgers/{id}", a.updateLedger, true)
	add("DELETE /api/ledgers/{id}", a.deleteLedger, true)
	add("POST /api/ledgers/{id}/restore", a.restoreLedger, true)
	add("GET /api/categories", a.listCategories, true)
	add("POST /api/ledgers/{id}/categories", a.saveCategory, true)
	add("DELETE /api/ledgers/{id}/categories/{code}", a.deleteCategory, true)
	add("GET /api/admin/settings", a.adminSettings, true)
	add("PATCH /api/admin/settings", a.updateAdminSettings, true)
	add("GET /api/admin/invitations", a.listAccountInvitations, true)
	add("POST /api/admin/invitations", a.createAccountInvitation, true)
	add("POST /api/admin/invitations/{id}/cancel", a.cancelAccountInvitation, true)
	add("POST /api/ledgers/{id}/transfer-owner", a.transferOwner, true)
	add("DELETE /api/ledgers/{id}/membership", a.leaveLedger, true)
	add("GET /api/accounts", a.listAccounts, true)
	add("POST /api/accounts", a.createAccount, true)
	add("DELETE /api/accounts/{id}", a.deleteAccount, true)
	add("GET /api/accounts/trash", a.trashedAccounts, true)
	add("POST /api/accounts/{id}/restore", a.restoreAccount, true)
	add("PATCH /api/accounts/{id}", a.updateAccount, true)
	add("DELETE /api/accounts/{id}/grant", a.leaveAccount, true)
	add("GET /api/transactions", a.listTransactions, true)
	add("POST /api/transactions", a.createTransaction, true)
	add("PUT /api/transactions/{id}", a.updateTransaction, true)
	add("POST /api/transactions/{id}/trash", a.trashTransaction, true)
	add("POST /api/transactions/{id}/restore", a.restoreTransaction, true)
	add("POST /api/transactions/{id}/receipts", a.uploadReceipt, true)
	add("GET /api/receipts/{id}", a.getReceipt, true)
	add("DELETE /api/receipts/{id}", a.deleteReceipt, true)
	add("GET /api/sharing", a.sharing, true)
	add("POST /api/invitations", a.createInvitation, true)
	add("POST /api/invitations/accept", a.acceptInvitation, true)
	add("POST /api/invitations/{id}/approve", a.approveInvitation, true)
	add("POST /api/invitations/{id}/cancel", a.cancelInvitation, true)
	add("DELETE /api/sharing/{type}/{target}/{user}", a.revokeShare, true)
	add("PUT /api/sharing/{type}/{target}/{user}", a.changeShare, true)
	add("GET /api/export", a.exportData, true)
	add("POST /api/import/csv", a.importCSV, true)
	add("POST /api/import/json", a.importJSON, true)
	add("GET /api/backups", a.listBackups, true)
	add("POST /api/backups", a.createBackup, true)
	add("GET /api/backups/{name}", a.downloadBackup, true)
	add("GET /api/audit", a.listAudit, true)
	m.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		_, _ = w.Write([]byte("ok\n"))
	})
	m.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 404, map[string]string{"error": "not_found", "message": "지원하지 않는 요청이에요."})
	})
	if a.Config.Assets != nil {
		m.Handle("/", a.assets())
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Permissions-Policy", "camera=(self), microphone=(), geolocation=()")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'")
		if a.Config.SecureCookie {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000")
		}
		m.ServeHTTP(w, r)
	})
}
func (a *App) assets() http.Handler {
	server := http.FileServer(http.FS(a.Config.Assets))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		name := strings.TrimPrefix(r.URL.Path, "/")
		if name == "" {
			name = "index.html"
		}
		if _, err := fs.Stat(a.Config.Assets, name); err != nil {
			if strings.Contains(filepath.Base(name), ".") {
				http.NotFound(w, r)
				return
			}
			r.URL.Path = "/"
		}
		server.ServeHTTP(w, r)
	})
}
func audit(q queryer, u *User, action, targetType, target string) error {
	_, err := q.Exec("INSERT INTO audit VALUES(?,?,?,?,?,?)", newID(), u.ID, action, targetType, target, now())
	return err
}
