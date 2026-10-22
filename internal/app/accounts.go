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
}
type Account struct {
	ID         string `json:"id"`
	LedgerID   string `json:"ledger_id,omitempty"`
	LedgerName string `json:"ledger_name"`
	Name       string `json:"name"`
	Kind       string `json:"kind"`
	Currency   string `json:"currency"`
	Scale      int    `json:"scale"`
	Opening    string `json:"opening"`
	Balance    string `json:"balance"`
	Archived   bool   `json:"archived"`
	Version    int    `json:"version"`
	Role       string `json:"role"`
	Shared     bool   `json:"shared"`
	OwnerName  string `json:"owner_name"`
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
func (a *App) accounts(q queryer, u *User) ([]Account, error) {
	rows, err := q.Query(`SELECT a.id,a.ledger_id,l.name,a.name,a.kind,a.currency,a.scale,a.opening,a.archived,a.version,l.owner_id,l.kind,COALESCE(m.role,''),COALESCE(g.role,''),EXISTS(SELECT 1 FROM grants gg WHERE gg.account_id=a.id),o.name FROM accounts a JOIN ledgers l ON l.id=a.ledger_id JOIN users o ON o.id=l.owner_id LEFT JOIN members m ON m.ledger_id=l.id AND m.user_id=? LEFT JOIN grants g ON g.account_id=a.id AND g.user_id=? WHERE l.deleted_at IS NULL AND (l.owner_id=? OR (m.user_id IS NOT NULL AND l.kind='shared') OR g.user_id IS NOT NULL) ORDER BY a.archived,a.created_at,a.id`, u.ID, u.ID, u.ID)
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
		v.Role = "viewer"
		if owner == u.ID {
			v.Role = "owner"
		} else if mrole == "editor" || grole == "editor" {
			v.Role = "editor"
		}
		if owner != u.ID && mrole == "" {
			v.LedgerID = ""
			v.LedgerName = "공유받은 계좌"
		}
		out = append(out, v)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	for i := range out {
		var delta int64
		if err = q.QueryRow("SELECT COALESCE(SUM(p.amount),0) FROM postings p JOIN events e ON e.id=p.event_id WHERE p.account_id=? AND e.deleted_at IS NULL", out[i].ID).Scan(&delta); err != nil {
			return nil, err
		}
		initial, _ := strconv.ParseInt(out[i].Opening, 10, 64)
		out[i].Balance = strconv.FormatInt(initial+delta, 10)
	}
	return out, nil
}
func (a *App) account(q queryer, u *User, id string) (Account, error) {
	all, err := a.accounts(q, u)
	if err != nil {
		return Account{}, err
	}
	for _, v := range all {
		if v.ID == id {
			return v, nil
		}
	}
	return Account{}, missing()
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
	rows, err := a.DB.Query("SELECT l.id,l.name,l.kind,CASE WHEN l.owner_id=? THEN 'owner' ELSE m.role END,l.timezone FROM ledgers l LEFT JOIN members m ON m.ledger_id=l.id AND m.user_id=? WHERE ((l.owner_id=? OR (m.user_id IS NOT NULL AND l.kind='shared')) AND l.deleted_at IS NULL AND ?=false) OR (l.owner_id=? AND l.deleted_at IS NOT NULL AND ?=true) ORDER BY l.created_at", u.ID, u.ID, u.ID, r.URL.Query().Get("trash") == "true", u.ID, r.URL.Query().Get("trash") == "true")
	if err != nil {
		return err
	}
	defer rows.Close()
	out := []Ledger{}
	for rows.Next() {
		var v Ledger
		if err = rows.Scan(&v.ID, &v.Name, &v.Kind, &v.Role, &v.Timezone); err != nil {
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
	}
	if err := decode(r, &v); err != nil {
		return err
	}
	v.Name = strings.TrimSpace(v.Name)
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
	if _, err = tx.Exec("INSERT INTO ledgers(id,name,kind,owner_id,timezone,created_at) VALUES(?,?,?,?,?,?)", id, v.Name, v.Kind, u.ID, v.Timezone, now()); err != nil {
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
	}
	if err = decode(r, &v); err != nil {
		return err
	}
	if !validName(v.Name, 60) {
		return bad("가계부 이름을 확인해 주세요.")
	}
	if _, err = time.LoadLocation(v.Timezone); err != nil {
		return bad("시간대를 확인해 주세요.")
	}
	_, err = a.DB.Exec("UPDATE ledgers SET name=?,timezone=? WHERE id=?", strings.TrimSpace(v.Name), v.Timezone, r.PathValue("id"))
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
