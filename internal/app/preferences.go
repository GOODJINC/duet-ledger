package app

import (
	"net/http"
	"sort"
	"strings"
	"time"
)

type Category struct {
	Code   string `json:"code"`
	Name   string `json:"name"`
	Kind   string `json:"kind"`
	Hidden bool   `json:"hidden"`
}

var baseCategories = []Category{
	{"food", "식비", "expense", false}, {"groceries", "장보기", "expense", false}, {"coffee", "카페·간식", "expense", false}, {"transport", "교통", "expense", false}, {"home", "주거·생활", "expense", false}, {"shopping", "쇼핑", "expense", false}, {"health", "건강", "expense", false}, {"other", "기타", "expense", false},
	{"salary", "월급", "income", false}, {"side_income", "부수입", "income", false}, {"allowance", "용돈", "income", false}, {"bonus", "상여", "income", false}, {"financial_income", "금융소득", "income", false}, {"other", "기타", "income", false},
}

func baseCategoryName(code string) string {
	for _, c := range baseCategories {
		if c.Code == code {
			return c.Name
		}
	}
	if code == "transfer" {
		return "이체"
	}
	return code
}
func (a *App) categoryList(q queryer, ledger, kind string) ([]Category, error) {
	out := []Category{}
	index := map[string]int{}
	for _, c := range baseCategories {
		if c.Kind == kind {
			index[c.Code] = len(out)
			out = append(out, c)
		}
	}
	rows, err := q.Query("SELECT code,name,hidden FROM categories WHERE ledger_id=? AND kind=? ORDER BY rowid", ledger, kind)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		c := Category{Kind: kind}
		if err = rows.Scan(&c.Code, &c.Name, &c.Hidden); err != nil {
			return nil, err
		}
		if i, ok := index[c.Code]; ok {
			out[i] = c
		} else {
			index[c.Code] = len(out)
			out = append(out, c)
		}
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	rows.Close()
	legacy, err := q.Query("SELECT DISTINCT p.category FROM postings p JOIN events e ON e.id=p.event_id JOIN accounts ac ON ac.id=p.account_id WHERE ac.ledger_id=? AND (CASE WHEN e.kind='income' THEN 'income' ELSE 'expense' END)=? AND e.kind!='transfer' ORDER BY p.category", ledger, kind)
	if err != nil {
		return nil, err
	}
	defer legacy.Close()
	for legacy.Next() {
		var code string
		if err = legacy.Scan(&code); err != nil {
			return nil, err
		}
		if _, ok := index[code]; !ok {
			index[code] = len(out)
			out = append(out, Category{Code: code, Name: baseCategoryName(code), Kind: kind})
		}
	}
	if err = legacy.Err(); err != nil {
		return nil, err
	}
	legacy.Close()
	positions := map[string]int{}
	ordered, err := q.Query("SELECT code,position FROM category_order WHERE ledger_id=? AND kind=?", ledger, kind)
	if err != nil {
		return nil, err
	}
	defer ordered.Close()
	for ordered.Next() {
		var code string
		var pos int
		if err = ordered.Scan(&code, &pos); err != nil {
			return nil, err
		}
		positions[code] = pos
	}
	if err = ordered.Err(); err != nil {
		return nil, err
	}
	sort.SliceStable(out, func(i, j int) bool {
		pi, ok := positions[out[i].Code]
		if !ok {
			pi = 2147483647
		}
		pj, ok := positions[out[j].Code]
		if !ok {
			pj = 2147483647
		}
		return pi < pj
	})
	return out, nil
}
func (a *App) listCategories(w http.ResponseWriter, r *http.Request, u *User) error {
	kind := r.URL.Query().Get("kind")
	if kind != "income" && kind != "expense" {
		return bad("수입 또는 지출 분류를 선택해 주세요.")
	}
	ledger := r.URL.Query().Get("ledger")
	account := r.URL.Query().Get("account")
	restricted := false
	if account != "" {
		ac, err := a.account(a.DB, u, account)
		if err != nil {
			return err
		}
		restricted = ac.LedgerID == ""
		if err = a.DB.QueryRow("SELECT ledger_id FROM accounts WHERE id=?", account).Scan(&ledger); err != nil {
			return err
		}
	} else {
		if _, err := a.ledgerRole(a.DB, u, ledger); err != nil {
			return err
		}
	}
	list, err := a.categoryList(a.DB, ledger, kind)
	if err != nil {
		return err
	}
	out := []Category{}
	for _, c := range list {
		if c.Hidden && r.URL.Query().Get("include_hidden") != "true" {
			continue
		}
		if restricted {
			var n int
			if err = a.DB.QueryRow("SELECT COUNT(*) FROM postings WHERE account_id=? AND category=?", account, c.Code).Scan(&n); err != nil {
				return err
			}
			if n == 0 {
				known := false
				for _, b := range baseCategories {
					if b.Kind == kind && b.Code == c.Code {
						known = true
						c.Name = b.Name
					}
				}
				if !known {
					continue
				}
			}
		}
		out = append(out, c)
	}
	writeJSON(w, 200, out)
	return nil
}
func (a *App) saveCategory(w http.ResponseWriter, r *http.Request, u *User) error {
	ledger := r.PathValue("id")
	role, err := a.ledgerRole(a.DB, u, ledger)
	if err != nil {
		return err
	}
	if role != "owner" {
		return forbidden()
	}
	var c Category
	if err = decode(r, &c); err != nil {
		return err
	}
	c.Name = strings.TrimSpace(c.Name)
	if (c.Kind != "income" && c.Kind != "expense") || !validName(c.Name, 60) || len(c.Code) > 80 {
		return bad("분류 이름과 종류를 확인해 주세요.")
	}
	if c.Code == "" {
		c.Code = "c_" + newID()
	}
	var n int
	if err = a.DB.QueryRow("SELECT COUNT(*) FROM categories WHERE ledger_id=?", ledger).Scan(&n); err != nil {
		return err
	}
	var existing int
	if err = a.DB.QueryRow("SELECT COUNT(*) FROM categories WHERE ledger_id=? AND kind=? AND code=?", ledger, c.Kind, c.Code).Scan(&existing); err != nil {
		return err
	}
	if n >= 200 && existing == 0 {
		return bad("한 가계부의 분류는 200개까지 관리할 수 있어요.")
	}
	tx, err := a.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec("INSERT INTO categories(ledger_id,kind,code,name,hidden) VALUES(?,?,?,?,?) ON CONFLICT(ledger_id,kind,code) DO UPDATE SET name=excluded.name,hidden=excluded.hidden", ledger, c.Kind, c.Code, c.Name, c.Hidden); err != nil {
		return err
	}
	if err = audit(tx, u, "category_updated", "ledger", ledger); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	writeJSON(w, 200, c)
	return nil
}
func (a *App) registrationOpenTx(q queryer) bool {
	var value string
	var users int
	if q.QueryRow("SELECT value FROM server_settings WHERE key='registration_open'").Scan(&value) != nil || value != "true" {
		return false
	}
	return q.QueryRow("SELECT COUNT(*) FROM users").Scan(&users) == nil && users > 0
}
func (a *App) registrationOpen() bool { return a.registrationOpenTx(a.DB) }
func (a *App) adminSettings(w http.ResponseWriter, r *http.Request, u *User) error {
	if !u.Admin {
		return forbidden()
	}
	writeJSON(w, 200, map[string]bool{"registration_open": a.registrationOpen()})
	return nil
}
func (a *App) updateAdminSettings(w http.ResponseWriter, r *http.Request, u *User) error {
	if !u.Admin {
		return forbidden()
	}
	var v struct {
		Open bool `json:"registration_open"`
	}
	if err := decode(r, &v); err != nil {
		return err
	}
	value := "false"
	if v.Open {
		value = "true"
	}
	if _, err := a.DB.Exec("UPDATE server_settings SET value=? WHERE key='registration_open'", value); err != nil {
		return err
	}
	if err := audit(a.DB, u, "registration_changed", "server", value); err != nil {
		return err
	}
	return a.adminSettings(w, r, u)
}
func (a *App) createAccountInvitation(w http.ResponseWriter, r *http.Request, u *User) error {
	if !u.Admin {
		return forbidden()
	}
	id, token := newID(), encode64(random(32))
	expires := time.Now().Add(48 * time.Hour).Unix()
	if _, err := a.DB.Exec("INSERT INTO account_invitations(id,token_hash,creator_id,expires_at,created_at) VALUES(?,?,?,?,?)", id, tokenHash(token), u.ID, expires, now()); err != nil {
		return err
	}
	writeJSON(w, 201, map[string]any{"id": id, "token": token, "expires_at": expires})
	return nil
}
func (a *App) listAccountInvitations(w http.ResponseWriter, r *http.Request, u *User) error {
	if !u.Admin {
		return forbidden()
	}
	rows, err := a.DB.Query("SELECT i.id,i.expires_at,i.cancelled,i.claimant_id IS NOT NULL,COALESCE(u.name,'') FROM account_invitations i LEFT JOIN users u ON u.id=i.claimant_id WHERE i.cancelled=0 ORDER BY i.created_at DESC LIMIT 100")
	if err != nil {
		return err
	}
	defer rows.Close()
	out := []map[string]any{}
	for rows.Next() {
		var id, name string
		var expiry int64
		var cancelled, used bool
		if err = rows.Scan(&id, &expiry, &cancelled, &used, &name); err != nil {
			return err
		}
		out = append(out, map[string]any{"id": id, "expires_at": expiry, "cancelled": cancelled, "used": used, "name": name})
	}
	if err = rows.Err(); err != nil {
		return err
	}
	writeJSON(w, 200, out)
	return nil
}
func (a *App) cancelAccountInvitation(w http.ResponseWriter, r *http.Request, u *User) error {
	if !u.Admin {
		return forbidden()
	}
	if _, err := a.DB.Exec("UPDATE account_invitations SET cancelled=1 WHERE id=? AND claimant_id IS NULL", r.PathValue("id")); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}
