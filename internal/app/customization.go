package app

import "net/http"

func (a *App) orderLedgers(w http.ResponseWriter, r *http.Request, u *User) error {
	var v struct {
		IDs []string `json:"ids"`
	}
	if err := decode(r, &v); err != nil {
		return err
	}
	if len(v.IDs) > 500 {
		return bad("가계부가 너무 많아요.")
	}
	tx, err := a.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	seen := map[string]bool{}
	for i, id := range v.IDs {
		if seen[id] {
			return bad("중복된 가계부예요.")
		}
		seen[id] = true
		if _, err = a.ledgerRole(tx, u, id); err != nil {
			return err
		}
		if _, err = tx.Exec("INSERT INTO ledger_order(user_id,ledger_id,position) VALUES(?,?,?) ON CONFLICT(user_id,ledger_id) DO UPDATE SET position=excluded.position", u.ID, id, i); err != nil {
			return err
		}
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}
func (a *App) orderCategories(w http.ResponseWriter, r *http.Request, u *User) error {
	ledger := r.PathValue("id")
	role, err := a.ledgerRole(a.DB, u, ledger)
	if err != nil {
		return err
	}
	if role != "owner" {
		return forbidden()
	}
	var v struct {
		Kind  string   `json:"kind"`
		Codes []string `json:"codes"`
	}
	if err = decode(r, &v); err != nil {
		return err
	}
	if (v.Kind != "income" && v.Kind != "expense") || len(v.Codes) > 500 {
		return bad("분류 순서를 확인해 주세요.")
	}
	list, err := a.categoryList(a.DB, ledger, v.Kind)
	if err != nil {
		return err
	}
	allowed := map[string]bool{}
	for _, c := range list {
		allowed[c.Code] = true
	}
	if len(v.Codes) != len(list) {
		return conflict("분류가 바뀌었어요. 다시 열어 주세요.")
	}
	tx, err := a.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for i, code := range v.Codes {
		if !allowed[code] {
			return bad("분류 순서를 확인해 주세요.")
		}
		delete(allowed, code)
		if _, err = tx.Exec("INSERT INTO category_order(ledger_id,kind,code,position) VALUES(?,?,?,?) ON CONFLICT(ledger_id,kind,code) DO UPDATE SET position=excluded.position", ledger, v.Kind, code, i); err != nil {
			return err
		}
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}
func (a *App) deleteAccount(w http.ResponseWriter, r *http.Request, u *User) error {
	ac, err := a.account(a.DB, u, r.PathValue("id"))
	if err != nil {
		return err
	}
	if ac.Role != "owner" {
		return forbidden()
	}
	var v struct {
		Confirm string `json:"confirm_name"`
		Version int    `json:"version"`
	}
	if err = decode(r, &v); err != nil {
		return err
	}
	if v.Confirm != ac.Name {
		return bad("삭제할 계좌 이름을 정확히 입력해 주세요.")
	}
	tx, err := a.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.Exec("UPDATE accounts SET deleted_at=?,version=version+1 WHERE id=? AND version=? AND deleted_at IS NULL", now(), ac.ID, v.Version)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n != 1 {
		return conflict("계좌가 변경됐어요. 다시 열어 주세요.")
	}
	if _, err = tx.Exec("UPDATE invitations SET status='cancelled' WHERE target_type='account' AND target_id=? AND status IN('open','pending')", ac.ID); err != nil {
		return err
	}
	if err = audit(tx, u, "trashed", "account", ac.ID); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}
func (a *App) trashedAccounts(w http.ResponseWriter, r *http.Request, u *User) error {
	rows, err := a.DB.Query("SELECT a.id,a.name,l.name FROM accounts a JOIN ledgers l ON l.id=a.ledger_id WHERE a.deleted_at IS NOT NULL AND l.deleted_at IS NULL AND l.owner_id=? ORDER BY a.deleted_at DESC", u.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	out := []map[string]string{}
	for rows.Next() {
		var id, name, ledger string
		if err = rows.Scan(&id, &name, &ledger); err != nil {
			return err
		}
		out = append(out, map[string]string{"id": id, "name": name, "ledger_name": ledger})
	}
	if err = rows.Err(); err != nil {
		return err
	}
	writeJSON(w, 200, out)
	return nil
}
func (a *App) restoreAccount(w http.ResponseWriter, r *http.Request, u *User) error {
	id := r.PathValue("id")
	tx, err := a.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	result, err := tx.Exec("UPDATE accounts SET deleted_at=NULL,version=version+1 WHERE id=? AND deleted_at IS NOT NULL AND ledger_id IN(SELECT id FROM ledgers WHERE owner_id=? AND deleted_at IS NULL)", id, u.ID)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n != 1 {
		return missing()
	}
	if err = audit(tx, u, "restored", "account", id); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}
