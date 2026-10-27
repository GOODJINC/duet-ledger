package app

import (
	"database/sql"
	"errors"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"
)

type Ledger struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Kind     string `json:"kind"`
	Role     string `json:"role"`
	Timezone string `json:"timezone"`
	Tagline  string `json:"tagline"`
}
type AccountAccess struct {
	Type string `json:"type"`
	Role string `json:"role"`
}
type Account struct {
	AccessPaths []AccountAccess `json:"access_paths"`
	ID          string          `json:"id"`
	LedgerID    string          `json:"ledger_id,omitempty"`
	LedgerName  string          `json:"ledger_name"`
	Name        string          `json:"name"`
	Kind        string          `json:"kind"`
	Currency    string          `json:"currency"`
	Scale       int             `json:"scale"`
	Opening     string          `json:"opening"`
	Balance     string          `json:"balance"`
	Archived    bool            `json:"archived"`
	Version     int             `json:"version"`
	Role        string          `json:"role"`
	Shared      bool            `json:"shared"`
	OwnerName   string          `json:"owner_name"`
}

func validName(s string, max int) bool {
	n := utf8.RuneCountInString(strings.TrimSpace(s))
	return n > 0 && n <= max
}
func validNote(s string) bool { return utf8.RuneCountInString(s) <= 1000 }
func amountValue(value string, signed bool, max int64) (int64, error) {
	if value == "" {
		return 0, bad("금액을 입력해 주세요.")
	}
	if !regexp.MustCompile(`^-?[0-9]+$`).MatchString(value) {
		return 0, bad("금액은 통화의 최소 단위 정수로 보내 주세요.")
	}
	n, err := strconv.ParseInt(value, 10, 64)
	if err != nil || n > max || n < -max || !signed && n < 1 {
		return 0, bad("금액 범위를 확인해 주세요.")
	}
	return n, nil
}
func (a *App) ledgerRole(q queryer, u *User, id string) (string, error) {
	var owner, kind string
	err := q.QueryRow("SELECT owner_id,kind FROM ledgers WHERE id=? AND deleted_at IS NULL", id).Scan(&owner, &kind)
	if errors.Is(err, sql.ErrNoRows) {
		return "", missing()
	}
	if err != nil {
		return "", err
	}
	if owner == u.ID {
		return "owner", nil
	}
	var role string
	err = q.QueryRow("SELECT role FROM members WHERE ledger_id=? AND user_id=?", id, u.ID).Scan(&role)
	if errors.Is(err, sql.ErrNoRows) || kind != "shared" {
		return "", missing()
	}
	return role, err
}
func (a *App) accountMetadata(q queryer, u *User, id string) ([]Account, error) {
	if id != "" && u.API != nil && !u.API.Accounts[id] {
		return nil, missing()
	}
	query := `SELECT a.id,a.ledger_id,l.name,a.name,a.kind,a.currency,a.scale,a.opening,a.archived,a.version,l.owner_id,l.kind,COALESCE(m.role,''),COALESCE(g.role,''),EXISTS(SELECT 1 FROM grants gg WHERE gg.account_id=a.id),o.name FROM accounts a JOIN ledgers l ON l.id=a.ledger_id JOIN users o ON o.id=l.owner_id LEFT JOIN members m ON m.ledger_id=l.id AND m.user_id=? LEFT JOIN grants g ON g.account_id=a.id AND g.user_id=? WHERE a.deleted_at IS NULL AND l.deleted_at IS NULL AND (l.owner_id=? OR (m.user_id IS NOT NULL AND l.kind='shared') OR g.user_id IS NOT NULL)`
	args := []any{u.ID, u.ID, u.ID}
	if id != "" {
		query += " AND a.id=?"
		args = append(args, id)
	}
	query += " ORDER BY a.archived,a.created_at,a.id"
	rows, err := q.Query(query, args...)
	if err != nil {
		return nil, err
	}
	out := []Account{}
	for rows.Next() {
		var v Account
		var owner, kind, mrole, grole string
		var opening int64
		var direct bool
		if err = rows.Scan(&v.ID, &v.LedgerID, &v.LedgerName, &v.Name, &v.Kind, &v.Currency, &v.Scale, &opening, &v.Archived, &v.Version, &owner, &kind, &mrole, &grole, &direct, &v.OwnerName); err != nil {
			rows.Close()
			return nil, err
		}
		v.Opening = strconv.FormatInt(opening, 10)
		v.Shared = kind == "shared" || direct
		v.AccessPaths = []AccountAccess{}
		v.Role = "viewer"
		if owner == u.ID {
			v.Role = "owner"
			v.AccessPaths = append(v.AccessPaths, AccountAccess{"owner", "owner"})
		} else {
			if kind == "shared" && mrole != "" {
				v.AccessPaths = append(v.AccessPaths, AccountAccess{"ledger", mrole})
			}
			if grole != "" {
				v.AccessPaths = append(v.AccessPaths, AccountAccess{"account", grole})
			}
			if kind == "shared" && mrole == "editor" || grole == "editor" {
				v.Role = "editor"
			}
		}
		if owner != u.ID && (kind != "shared" || mrole == "") {
			v.LedgerID = ""
			v.LedgerName = "공유받은 계좌"
		}
		if u.API == nil || u.API.Accounts[v.ID] {
			out = append(out, v)
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	return out, nil
}
func (a *App) accounts(q queryer, u *User) ([]Account, error) {
	out, err := a.accountMetadata(q, u, "")
	if err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return out, nil
	}
	args := make([]any, 0, len(out))
	for _, ac := range out {
		args = append(args, ac.ID)
	}
	rows, err := q.Query("SELECT p.account_id,SUM(p.amount) FROM postings p JOIN events e ON e.id=p.event_id WHERE e.deleted_at IS NULL AND p.account_id IN ("+placeholders(len(out))+") GROUP BY p.account_id", args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	deltas := map[string]int64{}
	for rows.Next() {
		var id string
		var delta int64
		if err = rows.Scan(&id, &delta); err != nil {
			return nil, err
		}
		deltas[id] = delta
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	for i := range out {
		initial, _ := strconv.ParseInt(out[i].Opening, 10, 64)
		out[i].Balance = strconv.FormatInt(initial+deltas[out[i].ID], 10)
	}
	return out, nil
}

// Mutation authorization does not need balances or unrelated accounts. Keep the
// same role resolution/redaction as the list endpoint through accountMetadata.
func (a *App) account(q queryer, u *User, id string) (Account, error) {
	if id == "" {
		return Account{}, missing()
	}
	items, err := a.accountMetadata(q, u, id)
	if err != nil {
		return Account{}, err
	}
	if len(items) == 0 {
		return Account{}, missing()
	}
	return items[0], nil
}
func (a *App) listAccounts(w http.ResponseWriter, r *http.Request, u *User) error {
	v, err := a.accounts(a.DB, u)
	if err != nil {
		return err
	}
	writeJSON(w, 200, v)
	return nil
}
func (a *App) listLedgers(w http.ResponseWriter, r *http.Request, u *User) error {
	rows, err := a.DB.Query("SELECT l.id,l.name,l.kind,CASE WHEN l.owner_id=? THEN 'owner' ELSE m.role END,l.timezone,l.tagline FROM ledgers l LEFT JOIN members m ON m.ledger_id=l.id AND m.user_id=? WHERE ((l.owner_id=? OR (m.user_id IS NOT NULL AND l.kind='shared')) AND l.deleted_at IS NULL AND ?=false) OR (l.owner_id=? AND l.deleted_at IS NOT NULL AND ?=true) ORDER BY COALESCE((SELECT position FROM ledger_order lo WHERE lo.ledger_id=l.id AND lo.user_id=?),2147483647),l.created_at,l.id", u.ID, u.ID, u.ID, r.URL.Query().Get("trash") == "true", u.ID, r.URL.Query().Get("trash") == "true", u.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	out := []Ledger{}
	for rows.Next() {
		var v Ledger
		if err = rows.Scan(&v.ID, &v.Name, &v.Kind, &v.Role, &v.Timezone, &v.Tagline); err != nil {
			return err
		}
		out = append(out, v)
	}
	if err = rows.Err(); err != nil {
		return err
	}
	writeJSON(w, 200, out)
	return nil
}
func (a *App) createLedger(w http.ResponseWriter, r *http.Request, u *User) error {
	var v struct {
		Name     string `json:"name"`
		Kind     string `json:"kind"`
		Timezone string `json:"timezone"`
		Tagline  string `json:"tagline"`
	}
	if err := decode(r, &v); err != nil {
		return err
	}
	v.Name = strings.TrimSpace(v.Name)
	if len([]rune(v.Tagline)) > 120 {
		return bad("소개 문구는 120자까지 입력해 주세요.")
	}
	v.Tagline = strings.TrimSpace(v.Tagline)
	if !validName(v.Name, 60) || (v.Kind != "personal" && v.Kind != "shared") {
		return bad("가계부 이름과 종류를 확인해 주세요.")
	}
	if v.Timezone == "" {
		v.Timezone = u.Timezone
	}
	if _, err := time.LoadLocation(v.Timezone); err != nil {
		return bad("시간대가 올바르지 않아요.")
	}
	id := newID()
	tx, err := a.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec("INSERT INTO ledgers(id,name,kind,owner_id,timezone,created_at,tagline) VALUES(?,?,?,?,?,?,?)", id, v.Name, v.Kind, u.ID, v.Timezone, now(), v.Tagline); err != nil {
		return err
	}
	if err = audit(tx, u, "created", "ledger", id); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	writeJSON(w, 201, map[string]string{"id": id})
	return nil
}
func (a *App) updateLedger(w http.ResponseWriter, r *http.Request, u *User) error {
	role, err := a.ledgerRole(a.DB, u, r.PathValue("id"))
	if err != nil {
		return err
	}
	if role != "owner" {
		return forbidden()
	}
	var v struct {
		Name     string `json:"name"`
		Timezone string `json:"timezone"`
		Tagline  string `json:"tagline"`
	}
	if err = decode(r, &v); err != nil {
		return err
	}
	if len([]rune(v.Tagline)) > 120 {
		return bad("소개 문구는 120자까지 입력해 주세요.")
	}
	if !validName(v.Name, 60) {
		return bad("가계부 이름을 확인해 주세요.")
	}
	if _, err = time.LoadLocation(v.Timezone); err != nil {
		return bad("시간대를 확인해 주세요.")
	}
	_, err = a.DB.Exec("UPDATE ledgers SET name=?,timezone=?,tagline=? WHERE id=?", strings.TrimSpace(v.Name), v.Timezone, strings.TrimSpace(v.Tagline), r.PathValue("id"))
	if err != nil {
		return err
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}

var currencyPattern = regexp.MustCompile(`^[A-Z][A-Z0-9_]{2,11}$`)
var currencyScales = map[string]int{"KRW": 0, "JPY": 0, "USD": 2, "EUR": 2, "GBP": 2, "CNY": 2, "TWD": 2, "VND": 0, "KWD": 3}

func (a *App) createAccount(w http.ResponseWriter, r *http.Request, u *User) error {
	var v struct {
		LedgerID string `json:"ledger_id"`
		Name     string `json:"name"`
		Kind     string `json:"kind"`
		Currency string `json:"currency"`
		Scale    int    `json:"scale"`
		Opening  string `json:"opening"`
	}
	if err := decode(r, &v); err != nil {
		return err
	}
	role, err := a.ledgerRole(a.DB, u, v.LedgerID)
	if err != nil {
		return err
	}
	if role != "owner" {
		return forbidden()
	}
	if !validName(v.Name, 60) {
		return bad("계좌 이름을 확인해 주세요.")
	}
	if v.Kind != "cash" && v.Kind != "bank" && v.Kind != "card" && v.Kind != "loan" {
		return bad("계좌 종류를 확인해 주세요.")
	}
	if !currencyPattern.MatchString(v.Currency) || v.Scale < 0 || v.Scale > 8 {
		return bad("통화와 소수 자릿수를 확인해 주세요.")
	}
	if s, ok := currencyScales[v.Currency]; !ok || s != v.Scale {
		return bad("이 통화의 소수 자릿수가 맞지 않아요.")
	}
	if v.Opening == "" {
		v.Opening = "0"
	}
	opening, err := amountValue(v.Opening, true, 9000000000000000)
	if err != nil {
		return err
	}
	id := newID()
	tx, err := a.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec("INSERT INTO accounts(id,ledger_id,name,kind,currency,scale,opening,created_at) VALUES(?,?,?,?,?,?,?,?)", id, v.LedgerID, strings.TrimSpace(v.Name), v.Kind, v.Currency, v.Scale, opening, now()); err != nil {
		return err
	}
	if err = audit(tx, u, "created", "account", id); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	writeJSON(w, 201, map[string]string{"id": id})
	return nil
}
func (a *App) updateAccount(w http.ResponseWriter, r *http.Request, u *User) error {
	account, err := a.account(a.DB, u, r.PathValue("id"))
	if err != nil {
		return err
	}
	if account.Role != "owner" {
		return forbidden()
	}
	var v struct {
		Name     string `json:"name"`
		Archived bool   `json:"archived"`
		Version  int    `json:"version"`
	}
	if err = decode(r, &v); err != nil {
		return err
	}
	if !validName(v.Name, 60) {
		return bad("계좌 이름을 확인해 주세요.")
	}
	if v.Version != account.Version {
		return conflict("계좌가 다른 곳에서 수정됐어요. 새로고침해 주세요.")
	}
	result, err := a.DB.Exec("UPDATE accounts SET name=?,archived=?,version=version+1 WHERE id=? AND version=?", strings.TrimSpace(v.Name), v.Archived, account.ID, v.Version)
	if err != nil {
		return err
	}
	count, _ := result.RowsAffected()
	if count != 1 {
		return conflict("계좌가 변경되었어요.")
	}
	if err = audit(a.DB, u, "updated", "account", account.ID); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}
