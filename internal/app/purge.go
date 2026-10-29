package app

import (
	"database/sql"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
)

// Purging a transfer always removes the whole event, never just one account's
// leg. Callers must authorize every leg before calling this helper.
func purgeEvents(tx *sql.Tx, events []string) ([]string, error) {
	files := []string{}
	for start := 0; start < len(events); start += 500 {
		end := start + 500
		if end > len(events) {
			end = len(events)
		}
		args := make([]any, 0, end-start)
		for _, id := range events[start:end] {
			args = append(args, id)
		}
		in := placeholders(len(args))
		rows, err := tx.Query("SELECT r.filename FROM receipts r JOIN postings p ON p.id=r.posting_id WHERE p.event_id IN ("+in+")", args...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var name string
			if err = rows.Scan(&name); err != nil {
				rows.Close()
				return nil, err
			}
			files = append(files, name)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
		for _, query := range []string{
			"DELETE FROM receipts WHERE posting_id IN(SELECT id FROM postings WHERE event_id IN (" + in + "))",
			"DELETE FROM postings WHERE event_id IN (" + in + ")",
			"DELETE FROM events WHERE id IN (" + in + ") AND NOT EXISTS(SELECT 1 FROM request_keys k WHERE k.event_id=events.id)",
			// Preserve only a scrubbed idempotency tombstone so old retries cannot recreate
			// a permanently deleted transaction. No amounts, titles or photos remain.
			"UPDATE events SET kind='expense',date='1900-01-01',time='',timezone='',currency='',scale=0,original_currency='',original_amount='',exchange_rate='',created_at=deleted_at,updated_at=deleted_at,version=version+1 WHERE id IN (" + in + ")",
		} {
			if _, err = tx.Exec(query, args...); err != nil {
				return nil, err
			}
		}
	}
	return files, nil
}

// Unlink only after commit: a failed database transaction must never lose photos.
// Remaining files are inaccessible through the app and excluded from new backups.
func (a *App) removePurgedFiles(files []string) int {
	pending := 0
	for _, name := range files {
		if name != filepath.Base(name) {
			pending++
			continue
		}
		if err := os.Remove(filepath.Join(a.Config.DataDir, "receipts", name)); err != nil && !os.IsNotExist(err) {
			pending++
			log.Printf("purged receipt cleanup failed: %v", err)
		}
	}
	return pending
}

func (a *App) purgeTransaction(w http.ResponseWriter, r *http.Request, u *User) error {
	var v struct {
		Confirm bool `json:"confirm"`
		Version int  `json:"version"`
	}
	if err := decode(r, &v); err != nil {
		return err
	}
	if !v.Confirm {
		return bad("영구 삭제를 확인해 주세요.")
	}
	tx, err := a.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	event, version, deleted, err := a.editableEvent(tx, u, r.PathValue("id"))
	if err != nil {
		return err
	}
	if !deleted {
		return conflict("휴지통에 있는 기록만 영구 삭제할 수 있어요.")
	}
	if version != v.Version {
		return conflict("기록이 변경됐어요. 다시 조회해 주세요.")
	}
	var denied int
	if err = tx.QueryRow("SELECT COUNT(*) FROM postings p JOIN accounts a ON a.id=p.account_id JOIN ledgers l ON l.id=a.ledger_id WHERE p.event_id=? AND l.owner_id!=?", event, u.ID).Scan(&denied); err != nil {
		return err
	}
	if u.API != nil || denied != 0 {
		return forbidden()
	}
	files, err := purgeEvents(tx, []string{event})
	if err != nil {
		return err
	}
	if err = audit(tx, u, "purged", "transaction", event); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]int{"deleted": 1, "cleanup_pending": a.removePurgedFiles(files)})
	return nil
}

func (a *App) emptyTransactionTrash(w http.ResponseWriter, r *http.Request, u *User) error {
	var v struct {
		Confirm bool `json:"confirm"`
	}
	if err := decode(r, &v); err != nil {
		return err
	}
	if !v.Confirm {
		return bad("영구 삭제를 확인해 주세요.")
	}
	if u.API != nil {
		return forbidden()
	}
	params := r.URL.Query()
	params.Set("trash", "true")
	tx, err := a.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	items, err := a.readTransactions(tx, u, params)
	if err != nil {
		return err
	}
	events := []string{}
	skipped := 0
	for _, item := range items {
		if item.CanPurge {
			events = append(events, item.eventID)
		} else {
			skipped++
		}
	}
	files, err := purgeEvents(tx, events)
	if err != nil {
		return err
	}
	if err = audit(tx, u, "purged", "transaction-trash", strconv.Itoa(len(events))); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]int{"deleted": len(events), "skipped": skipped, "cleanup_pending": a.removePurgedFiles(files)})
	return nil
}

func (a *App) purgeAccounts(w http.ResponseWriter, r *http.Request, u *User) error {
	var v struct {
		Confirm bool     `json:"confirm"`
		IDs     []string `json:"ids"`
	}
	if err := decode(r, &v); err != nil {
		return err
	}
	if !v.Confirm {
		return bad("영구 삭제를 확인해 주세요.")
	}
	if u.API != nil {
		return forbidden()
	}
	ids := v.IDs
	if id := r.PathValue("id"); id != "" {
		ids = []string{id}
	}
	if len(ids) == 0 || len(ids) > 500 {
		return bad("삭제할 계좌를 선택해 주세요.")
	}
	tx, err := a.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	seen := map[string]bool{}
	args := make([]any, 0, len(ids))
	for _, id := range ids {
		if seen[id] {
			return bad("중복된 계좌예요.")
		}
		seen[id] = true
		var n int
		if err = tx.QueryRow("SELECT COUNT(*) FROM accounts a JOIN ledgers l ON l.id=a.ledger_id WHERE a.id=? AND a.deleted_at IS NOT NULL AND l.deleted_at IS NULL AND l.owner_id=?", id, u.ID).Scan(&n); err != nil {
			return err
		}
		if n != 1 {
			return missing()
		}
		args = append(args, id)
	}
	in := placeholders(len(ids))
	both := append(append([]any{}, args...), args...)
	var linked int
	if err = tx.QueryRow("SELECT COUNT(*) FROM postings p WHERE p.account_id IN ("+in+") AND EXISTS(SELECT 1 FROM postings other WHERE other.event_id=p.event_id AND other.account_id NOT IN ("+in+"))", both...).Scan(&linked); err != nil {
		return err
	}
	if linked > 0 {
		return conflict("다른 계좌와 연결된 이체가 있어 영구 삭제할 수 없어요. 계좌를 복구해 이체를 정리하거나 연결된 삭제 계좌를 함께 비워 주세요.")
	}
	rows, err := tx.Query("SELECT DISTINCT event_id FROM postings WHERE account_id IN ("+in+")", args...)
	if err != nil {
		return err
	}
	events := []string{}
	for rows.Next() {
		var event string
		if err = rows.Scan(&event); err != nil {
			rows.Close()
			return err
		}
		events = append(events, event)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	// Account trash may contain live events; mark them before scrubbing any retained
	// retry tombstones. Other accounts' postings were explicitly excluded above.
	for start := 0; start < len(events); start += 500 {
		end := start + 500
		if end > len(events) {
			end = len(events)
		}
		values := []any{now()}
		for _, id := range events[start:end] {
			values = append(values, id)
		}
		if _, err = tx.Exec("UPDATE events SET deleted_at=COALESCE(deleted_at,?) WHERE id IN ("+placeholders(end-start)+")", values...); err != nil {
			return err
		}
	}
	files, err := purgeEvents(tx, events)
	if err != nil {
		return err
	}
	if _, err = tx.Exec("DELETE FROM entry_presets WHERE json_extract(payload,'$.account_id') IN ("+in+") OR json_extract(payload,'$.to_id') IN ("+in+")", both...); err != nil {
		return err
	}
	for _, query := range []string{
		"DELETE FROM grants WHERE account_id IN (" + in + ")",
		"DELETE FROM api_credential_accounts WHERE account_id IN (" + in + ")",
		"DELETE FROM invitations WHERE target_type='account' AND target_id IN (" + in + ")",
		"UPDATE users SET default_account_id='' WHERE default_account_id IN (" + in + ")",
		"DELETE FROM accounts WHERE id IN (" + in + ")",
	} {

		if _, err = tx.Exec(query, args...); err != nil {
			return err
		}
	}
	if err = audit(tx, u, "purged", "account-trash", strconv.Itoa(len(ids))); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]int{"deleted": len(ids), "cleanup_pending": a.removePurgedFiles(files)})
	return nil
}
