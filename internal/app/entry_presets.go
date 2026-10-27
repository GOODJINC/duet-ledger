package app

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
)

// Presets belong to one user. Every read rechecks current account access;
// a saved preset never grants access to an account on its own.
type EntryPreset struct {
	ID    string  `json:"id"`
	Input TxInput `json:"input"`
}

func presetAvailable(v TxInput, accounts map[string]Account, ledger string) bool {
	if v.Kind != "income" && v.Kind != "expense" && v.Kind != "transfer" {
		return false
	}
	ids := []string{v.AccountID}
	if v.Kind == "transfer" {
		ids = append(ids, v.ToID)
	}
	for _, id := range ids {
		ac, ok := accounts[id]
		if !ok || ac.Archived || ac.Role == "viewer" || ledger != "" && ac.LedgerID != ledger {
			return false
		}
	}
	return true
}

func (a *App) listEntryPresets(w http.ResponseWriter, r *http.Request, u *User) error {
	all, err := a.accountMetadata(a.DB, u, "")
	if err != nil {
		return err
	}
	accounts := map[string]Account{}
	for _, ac := range all {
		accounts[ac.ID] = ac
	}
	ledger := r.URL.Query().Get("ledger")
	favorites := []EntryPreset{}
	rows, err := a.DB.Query("SELECT id,payload FROM entry_presets WHERE user_id=? ORDER BY created_at DESC,id", u.ID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var v EntryPreset
		var payload string
		if err = rows.Scan(&v.ID, &payload); err != nil {
			rows.Close()
			return err
		}
		if err = json.Unmarshal([]byte(payload), &v.Input); err != nil {
			rows.Close()
			return err
		}
		if presetAvailable(v.Input, accounts, ledger) {
			favorites = append(favorites, v)
		}
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	// Filter all legs against the current scope before applying the result limit.
	ids := []string{}
	for _, ac := range all {
		if !ac.Archived && ac.Role != "viewer" && (ledger == "" || ac.LedgerID == ledger) {
			ids = append(ids, ac.ID)
		}
	}
	if len(ids) == 0 {
		writeJSON(w, 200, map[string]any{"favorites": favorites, "recent": []EntryPreset{}})
		return nil
	}
	args := []any{u.ID}
	for i := 0; i < 2; i++ {
		for _, id := range ids {
			args = append(args, id)
		}
	}
	rows, err = a.DB.Query(`SELECT e.id,e.kind,e.original_currency,e.original_amount,e.exchange_rate FROM events e WHERE e.creator_id=? AND e.deleted_at IS NULL AND e.kind IN ('income','expense','transfer') AND EXISTS (SELECT 1 FROM postings p WHERE p.event_id=e.id AND p.account_id IN (`+placeholders(len(ids))+`)) AND NOT EXISTS (SELECT 1 FROM postings p WHERE p.event_id=e.id AND p.account_id NOT IN (`+placeholders(len(ids))+`)) ORDER BY e.created_at DESC,e.id DESC LIMIT 20`, args...)
	if err != nil {
		return err
	}
	candidates := []EntryPreset{}
	for rows.Next() {
		var v EntryPreset
		if err = rows.Scan(&v.ID, &v.Input.Kind, &v.Input.OriginalCurrency, &v.Input.OriginalAmount, &v.Input.ExchangeRate); err != nil {
			rows.Close()
			return err
		}
		candidates = append(candidates, v)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	recent := []EntryPreset{}
	for _, v := range candidates {
		legs, err := a.DB.Query("SELECT account_id,amount,title,category,note FROM postings WHERE event_id=? ORDER BY amount,id", v.ID)
		if err != nil {
			return err
		}
		allowed, count := true, 0
		for legs.Next() {
			var account, title, category, note string
			var amount int64
			if err = legs.Scan(&account, &amount, &title, &category, &note); err != nil {
				legs.Close()
				return err
			}
			count++
			ac, ok := accounts[account]
			if !ok || ac.Archived || ac.Role == "viewer" || ledger != "" && ac.LedgerID != ledger {
				allowed = false
			}
			if v.Input.Kind == "transfer" && amount > 0 {
				v.Input.ToID, v.Input.TargetNote = account, note
			} else {
				if amount < 0 {
					amount = -amount
				}
				v.Input.AccountID, v.Input.Amount = account, strconv.FormatInt(amount, 10)
				v.Input.Title, v.Input.Category, v.Input.Note = title, category, note
			}
		}
		err = legs.Err()
		legs.Close()
		if err != nil {
			return err
		}
		if allowed && (count == 1 && v.Input.Kind != "transfer" || count == 2 && v.Input.Kind == "transfer") && presetAvailable(v.Input, accounts, ledger) {
			recent = append(recent, v)
			if len(recent) == 20 {
				break
			}
		}
	}
	writeJSON(w, 200, map[string]any{"favorites": favorites, "recent": recent})
	return nil
}

func (a *App) saveEntryPreset(w http.ResponseWriter, r *http.Request, u *User) error {
	var v TxInput
	if err := decode(r, &v); err != nil {
		return err
	}
	if v.Kind != "income" && v.Kind != "expense" && v.Kind != "transfer" {
		return bad("거래 종류를 확인해 주세요.")
	}
	// Validate the complete input without creating a transaction. Dates, receipt
	// IDs, request IDs and versions are deliberately not stored in a preset.
	v.Date, v.Time, v.Timezone = "2000-01-01", "", ""
	if _, _, err := a.validateTx(a.DB, u, &v); err != nil {
		return err
	}
	v.Date, v.Time, v.Timezone, v.LedgerID, v.Version = "", "", "", "", 0
	payload, err := json.Marshal(v)
	if err != nil {
		return err
	}
	var existing string
	err = a.DB.QueryRow("SELECT id FROM entry_presets WHERE user_id=? AND payload=?", u.ID, string(payload)).Scan(&existing)
	if err == nil {
		writeJSON(w, 200, map[string]string{"id": existing})
		return nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	var count int
	if err := a.DB.QueryRow("SELECT COUNT(*) FROM entry_presets WHERE user_id=?", u.ID).Scan(&count); err != nil {
		return err
	}
	if count >= 100 {
		return bad("즐겨찾기는 100개까지 저장할 수 있어요.")
	}
	id := encode64(random(18))
	if _, err = a.DB.Exec("INSERT INTO entry_presets VALUES(?,?,?,?)", id, u.ID, string(payload), now()); err != nil {
		return err
	}
	writeJSON(w, 201, map[string]string{"id": id})
	return nil
}

func (a *App) deleteEntryPreset(w http.ResponseWriter, r *http.Request, u *User) error {
	result, err := a.DB.Exec("DELETE FROM entry_presets WHERE id=? AND user_id=?", r.PathValue("id"), u.ID)
	if err != nil {
		return err
	}
	count, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if count == 0 {
		return missing()
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}
