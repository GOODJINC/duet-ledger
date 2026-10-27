package app

import (
	"database/sql"
	"encoding/base32"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

var usernamePattern = regexp.MustCompile(`^[a-z0-9][a-z0-9_.-]{2,31}$`)

type credentials struct {
	Remember bool   `json:"remember"`
	Username string `json:"username"`
	Name     string `json:"name"`
	Password string `json:"password"`
	Token    string `json:"token"`
	Code     string `json:"code"`
}

func validateCredentials(c *credentials) error {
	c.Username = strings.ToLower(strings.TrimSpace(c.Username))
	c.Name = strings.TrimSpace(c.Name)
	if !usernamePattern.MatchString(c.Username) {
		return bad("아이디는 영문 소문자·숫자·._-를 사용해 3~32자로 입력해 주세요.")
	}
	if utf8.RuneCountInString(c.Name) < 1 || utf8.RuneCountInString(c.Name) > 40 {
		return bad("이름을 1~40자로 입력해 주세요.")
	}
	if utf8.RuneCountInString(c.Password) < 8 || len(c.Password) > 256 {
		return bad("비밀번호는 8자 이상, 256바이트 이하로 입력해 주세요.")
	}
	return nil
}
func (a *App) status(w http.ResponseWriter, r *http.Request, u *User) error {
	var n int
	if err := a.DB.QueryRow("SELECT COUNT(*) FROM users").Scan(&n); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"initialized": n > 0, "version": Version, "registration_open": a.registrationOpen()})
	return nil
}
func createPersonal(q queryer, id, locale string) error {
	_, err := q.Exec("INSERT INTO ledgers(id,name,kind,owner_id,created_at) VALUES(?,?,'personal',?,?)", newID(), localizeMessage(locale, "내 가계부"), id, now())
	return err
}
func (a *App) setup(w http.ResponseWriter, r *http.Request, u *User) error {
	if !a.rateAllowed(r, "setup", 10) {
		return &apiError{429, "rate_limit", "잠시 후 다시 시도해 주세요."}
	}
	var c credentials
	if err := decode(r, &c); err != nil {
		return err
	}
	var count int
	if err := a.DB.QueryRow("SELECT COUNT(*) FROM users").Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return conflict("이미 초기 설정을 마쳤어요.")
	}
	if err := validateCredentials(&c); err != nil {
		return err
	}
	tx, err := a.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	id := newID()
	if _, err = tx.Exec("INSERT INTO users(id,username,name,password,locale,admin,created_at) VALUES(?,?,?,?,?,1,?)", id, c.Username, c.Name, passwordHash(c.Password), requestLocale(r, nil), now()); err != nil {
		return err
	}
	if err = createPersonal(tx, id, requestLocale(r, nil)); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	return a.issueSession(w, id, 201)
}
func (a *App) login(w http.ResponseWriter, r *http.Request, u *User) error {
	var c credentials
	if err := decode(r, &c); err != nil {
		return err
	}
	if len(c.Password) > 256 || len(c.Username) > 100 {
		return bad("입력을 확인해 주세요.")
	}
	if !a.loginAllowed(r, c.Username) {
		w.Header().Set("Retry-After", "600")
		return &apiError{429, "rate_limit", "로그인 시도가 많아요. 10분 뒤 다시 시도해 주세요."}
	}
	failed := true
	defer func() {
		if failed {
			a.loginFailed(r, c.Username)
		}
	}()
	var id, hash, secret string
	err := a.DB.QueryRow("SELECT id,password,totp FROM users WHERE username=?", strings.ToLower(strings.TrimSpace(c.Username))).Scan(&id, &hash, &secret)
	if errors.Is(err, sql.ErrNoRows) {
		_ = passwordHash(c.Password)
		return &apiError{401, "credentials", "아이디 또는 비밀번호가 맞지 않아요."}
	}
	if err != nil {
		return err
	}
	if !verifyPassword(c.Password, hash) {
		return &apiError{401, "credentials", "아이디 또는 비밀번호가 맞지 않아요."}
	}
	if secret != "" {
		if c.Code == "" {
			return &apiError{401, "totp_required", "인증 앱의 6자리 코드 또는 복구 코드를 입력해 주세요."}
		}
		if ok, e := a.checkSecondFactor(id, c.Code); e != nil {
			return e
		} else if !ok {
			return &apiError{401, "totp_invalid", "인증 코드가 맞지 않거나 이미 사용되었어요."}
		}
	}
	failed = false
	a.loginSucceeded(r, c.Username)
	duration := 7 * 24 * time.Hour
	if c.Remember {
		duration = 30 * 24 * time.Hour
	}
	return a.issueSessionFor(w, id, 200, duration, c.Remember)
}
func (a *App) user(id string) (*User, error) {
	u := &User{}
	var secret string
	err := a.DB.QueryRow("SELECT id,username,name,admin,locale,timezone,totp,show_sidebar_message,default_currency,default_account_id FROM users WHERE id=?", id).Scan(&u.ID, &u.Username, &u.Name, &u.Admin, &u.Locale, &u.Timezone, &secret, &u.ShowSidebar, &u.DefaultCurrency, &u.DefaultAccountID)
	if err == nil {
		u.ExchangeRates, err = a.exchangeRates(id)
	}
	u.APIEnabled = a.apiEnabled()
	u.TOTP = secret != ""
	return u, err
}
func (a *App) issueSession(w http.ResponseWriter, id string, status int, pending ...bool) error {
	return a.issueSessionFor(w, id, status, 7*24*time.Hour, true, pending...)
}
func (a *App) issueSessionFor(w http.ResponseWriter, id string, status int, duration time.Duration, persistent bool, pending ...bool) error {
	csrf, err := a.createSession(w, id, duration, persistent)
	if err != nil {
		return err
	}
	u, err := a.user(id)
	if err != nil {
		return err
	}
	u.CSRF = csrf
	if len(pending) > 0 {
		u.SharingPending = pending[0]
	}
	writeJSON(w, status, u)
	return nil
}
func (a *App) createSession(w http.ResponseWriter, id string, duration time.Duration, persistent bool) (string, error) {
	token := encode64(random(32))
	marker := "s."
	if persistent {
		marker = "p."
	}
	csrf := marker + encode64(random(32))
	t := time.Now()
	if _, err := a.DB.Exec("DELETE FROM sessions WHERE expires_at < ?", t.Unix()); err != nil {
		return "", err
	}
	if _, err := a.DB.Exec("INSERT INTO sessions VALUES(?,?,?,?,?)", tokenHash(token), id, csrf, t.Add(duration).Unix(), t.Unix()); err != nil {
		return "", err
	}
	maxAge := 0
	if persistent {
		maxAge = int(duration.Seconds())
	}
	a.setCookie(w, token, maxAge)
	return csrf, nil
}
func (a *App) renewSession(w http.ResponseWriter, u *User) error {
	return a.issueSessionFor(w, u.ID, 200, u.sessionDuration, u.sessionPersistent)
}
func (a *App) setCookie(w http.ResponseWriter, value string, maxAge int) {
	http.SetCookie(w, &http.Cookie{Name: "duet-ledger-session", Value: value, Path: "/", HttpOnly: true, Secure: a.Config.SecureCookie, SameSite: http.SameSiteStrictMode, MaxAge: maxAge})
}
func (a *App) authenticate(r *http.Request) (*User, error) {
	cookie, err := r.Cookie("duet-ledger-session")
	if err != nil {
		return nil, &apiError{401, "login_required", "로그인이 필요해요."}
	}
	var id, csrf string
	var expires, created int64
	err = a.DB.QueryRow("SELECT user_id,csrf,expires_at,created_at FROM sessions WHERE token_hash=? AND expires_at>?", tokenHash(cookie.Value), time.Now().Unix()).Scan(&id, &csrf, &expires, &created)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, &apiError{401, "login_required", "다시 로그인해 주세요."}
	}
	if err != nil {
		return nil, err
	}
	u, err := a.user(id)
	if err != nil {
		return nil, err
	}
	u.CSRF = csrf
	u.sessionDuration = time.Duration(expires-created) * time.Second
	// Older sessions did not record the choice. Preserve their existing
	// rotation behavior; a fresh login records the exact policy without a
	// schema change or invalidating any existing session.
	u.sessionPersistent = !strings.HasPrefix(csrf, "s.")
	return u, nil
}
func (a *App) me(w http.ResponseWriter, r *http.Request, u *User) error {
	writeJSON(w, 200, u)
	return nil
}
func (a *App) logout(w http.ResponseWriter, r *http.Request, u *User) error {
	cookie, _ := r.Cookie("duet-ledger-session")
	if _, err := a.DB.Exec("DELETE FROM sessions WHERE token_hash=?", tokenHash(cookie.Value)); err != nil {
		return err
	}
	a.setCookie(w, "", -1)
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}
func (a *App) logoutAll(w http.ResponseWriter, r *http.Request, u *User) error {
	if _, err := a.DB.Exec("DELETE FROM sessions WHERE user_id=?", u.ID); err != nil {
		return err
	}
	a.setCookie(w, "", -1)
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}
func (a *App) updateMe(w http.ResponseWriter, r *http.Request, u *User) error {
	var v struct {
		Name             string  `json:"name"`
		Locale           string  `json:"locale"`
		Timezone         string  `json:"timezone"`
		ShowSidebar      *bool   `json:"show_sidebar_message"`
		DefaultCurrency  *string `json:"default_currency"`
		DefaultAccountID *string `json:"default_account_id"`
	}
	if err := decode(r, &v); err != nil {
		return err
	}
	v.Name = strings.TrimSpace(v.Name)
	if utf8.RuneCountInString(v.Name) < 1 || utf8.RuneCountInString(v.Name) > 40 {
		return bad("이름은 1~40자로 입력해 주세요.")
	}
	if v.Locale != "ko" && v.Locale != "en" {
		return bad("지원하지 않는 언어예요.")
	}
	if _, err := time.LoadLocation(v.Timezone); err != nil {
		return bad("올바른 시간대를 선택해 주세요.")
	}
	currency := u.DefaultCurrency
	if v.DefaultCurrency != nil {
		currency = *v.DefaultCurrency
		if _, ok := currencyScales[currency]; !ok {
			return bad("지원하는 기본 통화를 선택해 주세요.")
		}
	}
	defaultAccount := u.DefaultAccountID
	if v.DefaultAccountID != nil {
		defaultAccount = *v.DefaultAccountID
		if defaultAccount != "" {
			ac, err := a.account(a.DB, u, defaultAccount)
			if err != nil {
				return err
			}
			if ac.Archived || ac.Role == "viewer" {
				return bad("기록할 수 있는 기본 계좌를 선택해 주세요.")
			}
		}
	}
	showSidebar := u.ShowSidebar
	if v.ShowSidebar != nil {
		showSidebar = *v.ShowSidebar
	}
	if _, err := a.DB.Exec("UPDATE users SET name=?,locale=?,timezone=?,show_sidebar_message=?,default_currency=?,default_account_id=? WHERE id=?", v.Name, v.Locale, v.Timezone, showSidebar, currency, defaultAccount, u.ID); err != nil {
		return err
	}
	updated, err := a.user(u.ID)
	if err != nil {
		return err
	}
	updated.CSRF = u.CSRF
	writeJSON(w, 200, updated)
	return nil
}
func (a *App) reauth(u *User, password, code string) error {
	var hash string
	if err := a.DB.QueryRow("SELECT password FROM users WHERE id=?", u.ID).Scan(&hash); err != nil {
		return err
	}
	if len(password) > 256 || !verifyPassword(password, hash) {
		return &apiError{401, "reauth", "현재 비밀번호를 확인해 주세요."}
	}
	if u.TOTP {
		ok, err := a.checkSecondFactor(u.ID, code)
		if err != nil {
			return err
		}
		if !ok {
			return &apiError{401, "totp_invalid", "인증 코드 또는 복구 코드를 입력해 주세요."}
		}
	}
	return nil
}
func (a *App) changePassword(w http.ResponseWriter, r *http.Request, u *User) error {
	if !a.rateAllowed(r, "password:"+u.ID, 10) {
		return &apiError{429, "rate_limit", "잠시 후 다시 시도해 주세요."}
	}
	var v struct {
		Current  string `json:"current"`
		Password string `json:"password"`
		Code     string `json:"code"`
	}
	if err := decode(r, &v); err != nil {
		return err
	}
	if utf8.RuneCountInString(v.Password) < 8 || len(v.Password) > 256 {
		return bad("새 비밀번호는 8자 이상이어야 해요.")
	}
	if err := a.reauth(u, v.Current, v.Code); err != nil {
		return err
	}
	tx, err := a.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec("UPDATE users SET password=? WHERE id=?", passwordHash(v.Password), u.ID); err != nil {
		return err
	}
	if err = revokeAppPasswords(tx, u.ID); err != nil {
		return err
	}
	if _, err = tx.Exec("DELETE FROM sessions WHERE user_id=?", u.ID); err != nil {
		return err
	}
	if err = audit(tx, u, "password_changed", "user", u.ID); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	return a.renewSession(w, u)
}
func (a *App) checkSecondFactor(id, code string) (bool, error) {
	var cipherSecret, recovery string
	var counter int64
	if err := a.DB.QueryRow("SELECT totp,recovery,totp_counter FROM users WHERE id=?", id).Scan(&cipherSecret, &recovery, &counter); err != nil {
		return false, err
	}
	if cipherSecret == "" {
		return false, nil
	}
	secret, err := a.decrypt(cipherSecret)
	if err != nil {
		return false, err
	}
	if c, ok := totpMatch(secret, strings.TrimSpace(code), counter); ok {
		_, err = a.DB.Exec("UPDATE users SET totp_counter=? WHERE id=?", c, id)
		return err == nil, err
	}
	var codes []string
	if err = json.Unmarshal([]byte(recovery), &codes); err != nil {
		return false, err
	}
	for i, h := range codes {
		if secureEqual(tokenHash(strings.ToLower(strings.TrimSpace(code))), h) {
			codes = append(codes[:i], codes[i+1:]...)
			b, _ := json.Marshal(codes)
			_, err = a.DB.Exec("UPDATE users SET recovery=? WHERE id=?", string(b), id)
			return err == nil, err
		}
	}
	return false, nil
}
func (a *App) startTOTP(w http.ResponseWriter, r *http.Request, u *User) error {
	if !a.rateAllowed(r, "totp:"+u.ID, 10) {
		return &apiError{429, "rate_limit", "잠시 후 다시 시도해 주세요."}
	}
	var v struct {
		Password string `json:"password"`
		Code     string `json:"code"`
	}
	if err := decode(r, &v); err != nil {
		return err
	}
	if err := a.reauth(u, v.Password, v.Code); err != nil {
		return err
	}
	if u.TOTP {
		return conflict("이미 2단계 인증을 사용하고 있어요.")
	}
	secret := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(random(20))
	if _, err := a.DB.Exec("UPDATE users SET totp_pending=? WHERE id=?", a.encrypt(secret), u.ID); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]string{"secret": secret, "uri": "otpauth://totp/" + url.PathEscape("Duet Ledger:"+u.Username) + "?secret=" + secret + "&issuer=" + url.QueryEscape("Duet Ledger") + "&algorithm=SHA1&digits=6&period=30"})
	return nil
}
func (a *App) confirmTOTP(w http.ResponseWriter, r *http.Request, u *User) error {
	if !a.rateAllowed(r, "totp-confirm:"+u.ID, 10) {
		return &apiError{429, "rate_limit", "잠시 후 다시 시도해 주세요."}
	}
	var v struct {
		Code string `json:"code"`
	}
	if err := decode(r, &v); err != nil {
		return err
	}
	var encrypted string
	if err := a.DB.QueryRow("SELECT totp_pending FROM users WHERE id=?", u.ID).Scan(&encrypted); err != nil {
		return err
	}
	if encrypted == "" {
		return bad("먼저 인증 앱 등록을 시작해 주세요.")
	}
	secret, err := a.decrypt(encrypted)
	if err != nil {
		return err
	}
	counter, ok := totpMatch(secret, v.Code, 0)
	if !ok {
		return bad("인증 앱의 현재 6자리 코드를 확인해 주세요.")
	}
	codes := make([]string, 8)
	hashes := make([]string, 8)
	for i := range codes {
		codes[i] = hexCode()
		hashes[i] = tokenHash(codes[i])
	}
	b, _ := json.Marshal(hashes)
	tx, err := a.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec("UPDATE users SET totp=totp_pending,totp_pending='',totp_counter=?,recovery=? WHERE id=?", counter, string(b), u.ID); err != nil {
		return err
	}
	if err = revokeAppPasswords(tx, u.ID); err != nil {
		return err
	}
	if _, err = tx.Exec("DELETE FROM sessions WHERE user_id=?", u.ID); err != nil {
		return err
	}
	if err = audit(tx, u, "totp_enabled", "user", u.ID); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	csrf, err := a.createSession(w, u.ID, u.sessionDuration, u.sessionPersistent)
	if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"recovery_codes": codes, "csrf": csrf})
	return nil
}
func hexCode() string { b := newID(); return b[:8] + "-" + b[8:16] + "-" + b[16:24] }
func (a *App) disableTOTP(w http.ResponseWriter, r *http.Request, u *User) error {
	if !a.rateAllowed(r, "totp-disable:"+u.ID, 10) {
		return &apiError{429, "rate_limit", "잠시 후 다시 시도해 주세요."}
	}
	var v struct {
		Password string `json:"password"`
		Code     string `json:"code"`
	}
	if err := decode(r, &v); err != nil {
		return err
	}
	if err := a.reauth(u, v.Password, v.Code); err != nil {
		return err
	}
	tx, err := a.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec("UPDATE users SET totp='',totp_pending='',recovery='[]',totp_counter=0 WHERE id=?", u.ID); err != nil {
		return err
	}
	if err = revokeAppPasswords(tx, u.ID); err != nil {
		return err
	}
	if _, err = tx.Exec("DELETE FROM sessions WHERE user_id=?", u.ID); err != nil {
		return err
	}
	if err = audit(tx, u, "totp_disabled", "user", u.ID); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	return a.renewSession(w, u)
}
