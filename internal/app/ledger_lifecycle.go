package app

import "net/http"

func (a *App) deleteLedger(w http.ResponseWriter, r *http.Request, u *User) error {
	id := r.PathValue("id")
	role, err := a.ledgerRole(a.DB, u, id)
	if err != nil {
		return err
	}
	if role != "owner" {
		return forbidden()
	}
	var v struct {
		Confirm string `json:"confirm_name"`
	}
	if err = decode(r, &v); err != nil {
		return err
	}
	var name string
	if err = a.DB.QueryRow("SELECT name FROM ledgers WHERE id=?", id).Scan(&name); err != nil {
		return err
	}
	if v.Confirm != name {
		return bad("삭제할 가계부 이름을 정확히 입력해 주세요.")
	}
	tx, err := a.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec("UPDATE ledgers SET deleted_at=? WHERE id=?", now(), id); err != nil {
		return err
	}
	if _, err = tx.Exec("UPDATE invitations SET status='cancelled' WHERE status IN('open','pending') AND ((target_type='ledger' AND target_id=?) OR (target_type='account' AND target_id IN(SELECT id FROM accounts WHERE ledger_id=?)))", id, id); err != nil {
		return err
	}
	if err = audit(tx, u, "trashed", "ledger", id); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}
func (a *App) restoreLedger(w http.ResponseWriter, r *http.Request, u *User) error {
	var n int
	id := r.PathValue("id")
	if err := a.DB.QueryRow("SELECT COUNT(*) FROM ledgers WHERE id=? AND owner_id=? AND deleted_at IS NOT NULL", id, u.ID).Scan(&n); err != nil {
		return err
	}
	if n == 0 {
		return missing()
	}
	if _, err := a.DB.Exec("UPDATE ledgers SET deleted_at=NULL WHERE id=?", id); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}
