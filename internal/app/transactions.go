package app

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

type ReceiptRef struct {
	ID    string `json:"id"`
	Size  int64  `json:"size"`
	Media string `json:"media_type"`
}
type Leg struct {
	DisplayAmount string       `json:"display_amount,omitempty"`
	ID            string       `json:"id"`
	AccountID     string       `json:"account_id"`
	Amount        string       `json:"amount"`
	Title         string       `json:"title"`
	Category      string       `json:"category"`
	CategoryName  string       `json:"category_name"`
	Note          string       `json:"note"`
	Receipts      []ReceiptRef `json:"receipts"`
}
type Transaction struct {
	OriginalCurrency string `json:"original_currency,omitempty"`
	OriginalAmount   string `json:"original_amount,omitempty"`
	ExchangeRate     string `json:"exchange_rate,omitempty"`
	DisplayCurrency  string `json:"display_currency,omitempty"`
	DisplayScale     *int   `json:"display_scale,omitempty"`
	ID               string `json:"id"`
	Kind             string `json:"kind"`
	Date             string `json:"date"`
	Time             string `json:"time"`
	Timezone         string `json:"timezone"`
	CreatorUsername  string `json:"creator_username"`
	Currency         string `json:"currency"`
	Scale            int    `json:"scale"`
	Version          int    `json:"version"`
	Creator          string `json:"creator"`
	CanEdit          bool   `json:"can_edit"`
	Deleted          bool   `json:"deleted"`
	Legs             []Leg  `json:"legs"`
	eventID          string
}
type TxInput struct {
	OriginalCurrency string `json:"original_currency,omitempty"`
	OriginalAmount   string `json:"original_amount,omitempty"`
	ExchangeRate     string `json:"exchange_rate,omitempty"`
	allowRemoved     bool
	LedgerID         string `json:"ledger_id"`
	Kind             string `json:"kind"`
	Date             string `json:"date"`
	Time             string `json:"time"`
	Timezone         string `json:"timezone"`
	Amount           string `json:"amount"`
	AccountID        string `json:"account_id"`
	ToID             string `json:"to_id"`
	Title            string `json:"title"`
	Category         string `json:"category"`
	Note             string `json:"note"`
	TargetNote       string `json:"target_note"`
	Version          int    `json:"version"`
}
type CurrencyTotal struct {
	Currency string `json:"currency"`
	Scale    int    `json:"scale"`
	Income   string `json:"income"`
	Expense  string `json:"expense"`
}
type CategoryTotal struct {
	Name     string `json:"name"`
	Currency string `json:"currency"`
	Scale    int    `json:"scale"`
	Category string `json:"category"`
	Amount   string `json:"amount"`
}
type DayTotal struct {
	Currency string `json:"currency"`
	Scale    int    `json:"scale"`
	Date     string `json:"date"`
	Income   string `json:"income"`
	Expense  string `json:"expense"`
}
type TransactionPage struct {
	MissingCurrencies []string        `json:"missing_currencies,omitempty"`
	Items             []Transaction   `json:"items"`
	Count             int             `json:"count"`
	Page              int             `json:"page"`
	PageSize          int             `json:"page_size"`
	Totals            []CurrencyTotal `json:"totals"`
	Categories        []CategoryTotal `json:"categories"`
	Daily             []DayTotal      `json:"daily"`
}

func placeholders(n int) string { return strings.TrimSuffix(strings.Repeat("?,", n), ",") }
func validateBalances(q queryer, ids []string) error {
	for _, id := range ids {
		var balance int64
		if err := q.QueryRow("SELECT a.opening+COALESCE(SUM(CASE WHEN e.deleted_at IS NULL THEN p.amount ELSE 0 END),0) FROM accounts a LEFT JOIN postings p ON p.account_id=a.id LEFT JOIN events e ON e.id=p.event_id WHERE a.id=? GROUP BY a.id", id).Scan(&balance); err != nil {
			return err
		}
		if balance > 9000000000000000 || balance < -9000000000000000 {
			return bad("계좌 잔액 범위를 초과해요.")
		}
	}
	return nil
}
func parseDate(value string) error {
	d, err := time.Parse("2006-01-02", value)
	if err != nil || d.Year() < 1900 || d.Year() > 2100 {
		return bad("날짜는 1900~2100년의 YYYY-MM-DD 형식으로 입력해 주세요.")
	}
	return nil
}
func validClock(clock, zone string) error {
	if clock != "" {
		if len(clock) != 5 {
			return bad("시간은 HH:mm 형식으로 입력해 주세요.")
		}
		if _, err := time.Parse("15:04", clock); err != nil {
			return bad("시간을 확인해 주세요.")
		}
	}
	if zone != "" {
		if _, err := time.LoadLocation(zone); err != nil {
			return bad("시간대를 확인해 주세요.")
		}
	}
	return nil
}
func (a *App) validateTx(q queryer, u *User, v *TxInput) ([]Account, int64, error) {
	if v.Timezone == "" && v.Time != "" {
		v.Timezone = u.Timezone
	}
	if err := validClock(v.Time, v.Timezone); err != nil {
		return nil, 0, err
	}
	if err := parseDate(v.Date); err != nil {
		return nil, 0, err
	}
	if v.Kind != "income" && v.Kind != "expense" && v.Kind != "transfer" && v.Kind != "adjustment" && v.Kind != "refund" {
		return nil, 0, bad("거래 종류를 확인해 주세요.")
	}
	v.Title = strings.TrimSpace(v.Title)
	v.Note = strings.TrimSpace(v.Note)
	v.TargetNote = strings.TrimSpace(v.TargetNote)
	if !validName(v.Title, 100) || !validNote(v.Note) || !validNote(v.TargetNote) || !validName(v.Category, 60) {
		return nil, 0, bad("내용·분류·메모의 길이를 확인해 주세요.")
	}
	n, err := amountValue(v.Amount, v.Kind == "adjustment", 9000000000000)
	if err != nil {
		return nil, 0, err
	}
	if n == 0 {
		return nil, 0, bad("금액은 0이 될 수 없어요.")
	}
	source, err := a.account(q, u, v.AccountID)
	if err != nil {
		return nil, 0, err
	}
	if err = checkForeign(v.Kind, source.Currency, v.Amount, v.OriginalCurrency, v.OriginalAmount, v.ExchangeRate); err != nil {
		return nil, 0, err
	}
	if v.LedgerID != "" && v.LedgerID != source.LedgerID {
		return nil, 0, bad("선택한 가계부의 계좌에만 기록할 수 있어요.")
	}
	if source.Role == "viewer" {
		return nil, 0, forbidden()
	}
	if v.Kind != "transfer" && !v.allowRemoved {
		var ledger string
		if err = q.QueryRow("SELECT ledger_id FROM accounts WHERE id=?", source.ID).Scan(&ledger); err != nil {
			return nil, 0, err
		}
		kind := "expense"
		if v.Kind == "income" {
			kind = "income"
		}
		var removed int
		if err = q.QueryRow("SELECT COUNT(*) FROM removed_categories WHERE ledger_id=? AND kind=? AND code=?", ledger, kind, v.Category).Scan(&removed); err != nil {
			return nil, 0, err
		}
		if removed > 0 {
			return nil, 0, bad("삭제된 분류예요. 다른 분류를 선택해 주세요.")
		}
	}
	if source.Role != "owner" && v.Kind != "transfer" {
		known := false
		for _, category := range []string{"food", "groceries", "coffee", "transport", "home", "shopping", "health", "salary", "side_income", "allowance", "bonus", "financial_income", "other", "transfer"} {
			if category == v.Category {
				known = true
			}
		}
		if !known {
			var count int
			if err = q.QueryRow("SELECT (SELECT COUNT(*) FROM postings WHERE account_id=? AND category=?)+(SELECT COUNT(*) FROM categories WHERE ledger_id=? AND code=? AND hidden=0)", source.ID, v.Category, source.LedgerID, v.Category).Scan(&count); err != nil {
				return nil, 0, err
			}
			if count == 0 {
				return nil, 0, bad("이 계좌에 등록된 분류를 선택해 주세요. 새 분류는 책임자가 먼저 등록할 수 있어요.")
			}
		}
	}
	if source.Archived {
		return nil, 0, bad("보관한 계좌에는 입력할 수 없어요.")
	}
	out := []Account{source}
	if v.Kind == "transfer" {
		if v.ToID == v.AccountID {
			return nil, 0, bad("서로 다른 두 계좌를 선택해 주세요.")
		}
		target, e := a.account(q, u, v.ToID)
		if e != nil {
			return nil, 0, e
		}
		if v.LedgerID != "" && target.LedgerID != v.LedgerID {
			return nil, 0, bad("선택한 가계부의 받는 계좌를 선택해 주세요.")
		}
		if target.Role == "viewer" {
			return nil, 0, forbidden()
		}
		if target.Archived {
			return nil, 0, bad("보관한 계좌에는 입력할 수 없어요.")
		}
		if target.Currency != source.Currency || target.Scale != source.Scale {
			return nil, 0, bad("현재는 같은 통화의 계좌 사이에서 이체할 수 있어요.")
		}
		out = append(out, target)
	} else if v.ToID != "" {
		return nil, 0, bad("이체가 아니면 받는 계좌를 지정할 수 없어요.")
	}
	return out, n, nil
}
func (a *App) writeEvent(tx *sql.Tx, u *User, v TxInput, id string, create bool) (string, error) {
	accounts, n, err := a.validateTx(tx, u, &v)
	if err != nil {
		return "", err
	}
	firstID := ""
	if create {
		if _, err = tx.Exec("INSERT INTO events(id,kind,date,time,timezone,currency,scale,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)", id, v.Kind, v.Date, v.Time, v.Timezone, accounts[0].Currency, accounts[0].Scale, u.ID, now(), now()); err != nil {
			return "", err
		}
	} else {
		if _, err = tx.Exec("UPDATE events SET kind=?,date=?,time=?,timezone=?,currency=?,scale=?,version=version+1,updated_at=? WHERE id=?", v.Kind, v.Date, v.Time, v.Timezone, accounts[0].Currency, accounts[0].Scale, now(), id); err != nil {
			return "", err
		}
	}
	if _, err = tx.Exec("UPDATE events SET original_currency=?,original_amount=?,exchange_rate=? WHERE id=?", v.OriginalCurrency, v.OriginalAmount, v.ExchangeRate, id); err != nil {
		return "", err
	}
	// Preserve a posting ID when its account remains in the event. Receipts are tied
	// to that leg; moving a transaction away from an attached leg is rejected.
	existing := map[string]string{}
	touched := []string{}
	for _, account := range accounts {
		touched = append(touched, account.ID)
	}
	if !create {
		rows, e := tx.Query("SELECT id,account_id FROM postings WHERE event_id=?", id)
		if e != nil {
			return "", e
		}
		for rows.Next() {
			var p, ac string
			if e = rows.Scan(&p, &ac); e != nil {
				rows.Close()
				return "", e
			}
			existing[ac] = p
			touched = append(touched, ac)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return "", e
		}
	}
	for i, ac := range accounts {
		delta := n
		if v.Kind == "expense" || v.Kind == "transfer" && i == 0 {
			delta = -n
		}
		note := v.Note
		if i == 1 {
			note = v.TargetNote
		}
		category := v.Category
		if v.Kind == "transfer" {
			category = "transfer"
		}
		pid, exists := existing[ac.ID]
		if !exists {
			pid = newID()
		}
		if i == 0 {
			firstID = pid
		}
		if _, err = tx.Exec("INSERT INTO postings(id,event_id,account_id,amount,title,category,note) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET amount=excluded.amount,title=excluded.title,category_label=CASE WHEN postings.category=excluded.category THEN postings.category_label ELSE '' END,category=excluded.category,note=excluded.note", pid, id, ac.ID, delta, v.Title, category, note); err != nil {
			return "", err
		}
		delete(existing, ac.ID)
	}
	for _, pid := range existing {
		var count int
		if err = tx.QueryRow("SELECT COUNT(*) FROM receipts WHERE posting_id=?", pid).Scan(&count); err != nil {
			return "", err
		}
		if count > 0 {
			return "", bad("영수증이 연결된 계좌를 바꿀 수 없어요. 기존 기록을 보관하고 새 기록을 만들어 주세요.")
		}
		if _, err = tx.Exec("DELETE FROM postings WHERE id=?", pid); err != nil {
			return "", err
		}
	}
	if err = validateBalances(tx, touched); err != nil {
		return "", err
	}
	return firstID, nil
}
func eventPostings(q queryer, event string) (map[string]string, error) {
	rows, err := q.Query("SELECT account_id,id FROM postings WHERE event_id=?", event)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var account, id string
		if err = rows.Scan(&account, &id); err != nil {
			return nil, err
		}
		out[account] = id
	}
	return out, rows.Err()
}
func (a *App) createTransaction(w http.ResponseWriter, r *http.Request, u *User) error {
	var v TxInput
	if err := decode(r, &v); err != nil {
		return err
	}
	if v.Kind != "income" && v.Kind != "expense" && v.Kind != "transfer" {
		return bad("새 기록은 지출·수입·이체만 입력할 수 있어요.")
	}
	if _, _, err := a.validateTx(a.DB, u, &v); err != nil {
		return err
	}
	raw, _ := json.Marshal(v)
	digest := tokenHash(string(raw))
	key := r.Header.Get("Idempotency-Key")
	if len(key) > 128 {
		return bad("요청 식별자가 너무 길어요.")
	}
	if key != "" && u.API != nil {
		key = "api:" + u.API.ID + ":" + key
	}
	tx, err := a.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if key != "" {
		var previousDigest, event string
		e := tx.QueryRow("SELECT digest,event_id FROM request_keys WHERE user_id=? AND key=?", u.ID, key).Scan(&previousDigest, &event)
		if e == nil {
			if previousDigest != digest {
				return conflict("같은 요청 식별자로 다른 기록을 보낼 수 없어요.")
			}
			var pid string
			if e = tx.QueryRow("SELECT id FROM postings WHERE event_id=? AND account_id=?", event, v.AccountID).Scan(&pid); e != nil {
				return e
			}
			writeJSON(w, 200, map[string]string{"id": pid})
			return nil
		}
		if !errors.Is(e, sql.ErrNoRows) {
			return e
		}
	}
	event := newID()
	pid, err := a.writeEvent(tx, u, v, event, true)
	if err != nil {
		return err
	}
	if key != "" {
		if _, err = tx.Exec("INSERT INTO request_keys VALUES(?,?,?,?)", u.ID, key, digest, event); err != nil {
			return err
		}
	}
	if err = audit(tx, u, "created", "transaction", event); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	writeJSON(w, 201, map[string]string{"id": pid})
	return nil
}
func (a *App) editableEvent(q queryer, u *User, pid string) (string, int, bool, error) {
	var event string
	var version int
	var deleted bool
	var account string
	err := q.QueryRow("SELECT e.id,e.version,e.deleted_at IS NOT NULL,p.account_id FROM postings p JOIN events e ON e.id=p.event_id WHERE p.id=?", pid).Scan(&event, &version, &deleted, &account)
	if errors.Is(err, sql.ErrNoRows) {
		return "", 0, false, missing()
	}
	if err != nil {
		return "", 0, false, err
	}
	visible, err := a.accounts(q, u)
	if err != nil {
		return "", 0, false, err
	}
	roles := map[string]string{}
	for _, ac := range visible {
		roles[ac.ID] = ac.Role
	}
	if roles[account] == "" {
		return "", 0, false, missing()
	}
	rows, err := q.Query("SELECT account_id FROM postings WHERE event_id=?", event)
	if err != nil {
		return "", 0, false, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			return "", 0, false, err
		}
		if roles[id] == "" || roles[id] == "viewer" {
			return "", 0, false, forbidden()
		}
	}
	if err = rows.Err(); err != nil {
		return "", 0, false, err
	}
	return event, version, deleted, nil
}
func (a *App) updateTransaction(w http.ResponseWriter, r *http.Request, u *User) error {
	var v TxInput
	if err := decode(r, &v); err != nil {
		return err
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
	if deleted {
		return conflict("휴지통에서 먼저 복구해 주세요.")
	}
	if version != v.Version {
		return conflict("다른 사람이 수정한 기록이에요. 새로고침 후 다시 확인해 주세요.")
	}
	if v.Kind == "refund" || v.Kind == "adjustment" {
		var originalKind string
		if err = tx.QueryRow("SELECT kind FROM events WHERE id=?", event).Scan(&originalKind); err != nil {
			return err
		}
		if originalKind != v.Kind {
			return bad("새 환불·잔액 조정 기록은 만들 수 없어요.")
		}
	}
	var original int
	if err = tx.QueryRow("SELECT COUNT(*) FROM postings p JOIN events e ON e.id=p.event_id WHERE p.event_id=? AND p.account_id=? AND p.category=? AND e.kind=?", event, v.AccountID, v.Category, v.Kind).Scan(&original); err != nil {
		return err
	}
	v.allowRemoved = original > 0
	pid, err := a.writeEvent(tx, u, v, event, false)
	if err != nil {
		return err
	}
	if err = audit(tx, u, "updated", "transaction", event); err != nil {
		return err
	}
	postingIDs, err := eventPostings(tx, event)
	if err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"id": pid, "posting_ids": postingIDs})
	return nil
}
func (a *App) trashTransaction(w http.ResponseWriter, r *http.Request, u *User) error {
	return a.setDeleted(w, r, u, true)
}
func (a *App) restoreTransaction(w http.ResponseWriter, r *http.Request, u *User) error {
	return a.setDeleted(w, r, u, false)
}
func (a *App) setDeleted(w http.ResponseWriter, r *http.Request, u *User, deleted bool) error {
	var v struct {
		Version int `json:"version"`
	}
	if err := decode(r, &v); err != nil {
		return err
	}
	tx, err := a.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	event, version, current, err := a.editableEvent(tx, u, r.PathValue("id"))
	if err != nil {
		return err
	}
	if version != v.Version {
		return conflict("기록이 변경됐어요. 새로고침해 주세요.")
	}
	if current == deleted {
		return conflict("이미 처리된 기록이에요.")
	}
	var date any
	if deleted {
		date = now()
	}
	if _, err = tx.Exec("UPDATE events SET deleted_at=?,version=version+1,updated_at=? WHERE id=?", date, now(), event); err != nil {
		return err
	}
	rows, err := tx.Query("SELECT account_id FROM postings WHERE event_id=?", event)
	if err != nil {
		return err
	}
	ids := []string{}
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	if err = validateBalances(tx, ids); err != nil {
		return err
	}
	action := "restored"
	if deleted {
		action = "trashed"
	}
	if err = audit(tx, u, action, "transaction", event); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}
func (a *App) readTransactions(q queryer, u *User, params url.Values) ([]Transaction, error) {
	all, err := a.accounts(q, u)
	if err != nil {
		return nil, err
	}
	ids := []string{}
	roles := map[string]string{}
	for _, ac := range all {
		roles[ac.ID] = ac.Role
		if ledger := params.Get("ledger"); ledger != "" && ac.LedgerID != ledger {
			continue
		}
		if params.Get("scope") == "private" && ac.Shared || params.Get("scope") == "shared" && !ac.Shared {
			continue
		}
		if id := params.Get("account"); id != "" && id != ac.ID {
			continue
		}
		if c := params.Get("currency"); c != "" && c != ac.Currency {
			continue
		}
		ids = append(ids, ac.ID)
	}
	out := []Transaction{}
	if len(ids) == 0 {
		return out, nil
	}
	loc, _ := time.LoadLocation(u.Timezone)
	if loc == nil {
		loc = time.UTC
	}
	t := time.Now().In(loc)
	from, to := params.Get("from"), params.Get("to")
	if from == "" {
		from = fmt.Sprintf("%04d-%02d-01", t.Year(), t.Month())
	}
	if to == "" {
		to = time.Date(t.Year(), t.Month()+1, 0, 0, 0, 0, 0, loc).Format("2006-01-02")
	}
	if err = parseDate(from); err != nil {
		return nil, err
	}
	if err = parseDate(to); err != nil {
		return nil, err
	}
	if from > to {
		return nil, bad("조회 기간을 확인해 주세요.")
	}
	if len(params.Get("search")) > 300 {
		return nil, bad("검색어가 너무 길어요.")
	}
	args := make([]any, 0, len(ids)+2)
	for _, id := range ids {
		args = append(args, id)
	}
	args = append(args, from, to)
	deleted := "IS NULL"
	if params.Get("trash") == "true" {
		deleted = "IS NOT NULL"
	}
	rows, err := q.Query(`SELECT e.id,e.kind,e.date,e.time,e.timezone,e.currency,e.scale,e.version,u.name,u.username,e.deleted_at IS NOT NULL,p.id,p.account_id,p.amount,p.title,p.category,p.note,p.category_label,e.original_currency,e.original_amount,e.exchange_rate FROM events e JOIN postings p ON p.event_id=e.id JOIN users u ON u.id=e.creator_id WHERE p.account_id IN (`+placeholders(len(ids))+`) AND e.date>=? AND e.date<=? AND e.deleted_at `+deleted+` ORDER BY e.date DESC,e.time DESC,e.created_at DESC,e.id,p.amount,p.id LIMIT 40002`, args...)
	if err != nil {
		return nil, err
	}
	indices := map[string]int{}
	postingIndex := map[string][2]int{}
	readCount := 0
	for rows.Next() {
		readCount++
		var item Transaction
		var leg Leg
		var amount int64
		if err = rows.Scan(&item.eventID, &item.Kind, &item.Date, &item.Time, &item.Timezone, &item.Currency, &item.Scale, &item.Version, &item.Creator, &item.CreatorUsername, &item.Deleted, &leg.ID, &leg.AccountID, &amount, &leg.Title, &leg.Category, &leg.Note, &leg.CategoryName, &item.OriginalCurrency, &item.OriginalAmount, &item.ExchangeRate); err != nil {
			rows.Close()
			return nil, err
		}
		leg.Amount = strconv.FormatInt(amount, 10)
		leg.Receipts = []ReceiptRef{}
		idx, ok := indices[item.eventID]
		if !ok {
			idx = len(out)
			item.ID = leg.ID
			item.Legs = []Leg{}
			out = append(out, item)
			indices[item.eventID] = idx
		}
		postingIndex[leg.ID] = [2]int{idx, len(out[idx].Legs)}
		out[idx].Legs = append(out[idx].Legs, leg)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	if readCount > 40000 {
		return nil, bad("조회 범위가 커요. 기간이나 계좌를 좁혀 주세요.")
	}
	// Determine whether all sides of a visible event are editable without returning
	// the IDs or metadata of inaccessible counterparts to the caller.
	eventIDs := make([]string, 0, len(out))
	for _, v := range out {
		eventIDs = append(eventIDs, v.eventID)
	}
	for start := 0; start < len(eventIDs); start += 500 {
		end := start + 500
		if end > len(eventIDs) {
			end = len(eventIDs)
		}
		args = []any{}
		for _, id := range eventIDs[start:end] {
			args = append(args, id)
		}
		rs, e := q.Query("SELECT event_id,account_id FROM postings WHERE event_id IN ("+placeholders(end-start)+")", args...)
		if e != nil {
			return nil, e
		}
		editable := map[string]bool{}
		for rs.Next() {
			var event, account string
			if e = rs.Scan(&event, &account); e != nil {
				rs.Close()
				return nil, e
			}
			value, ok := editable[event]
			if !ok {
				value = true
			}
			editable[event] = value && roles[account] != "" && roles[account] != "viewer"
		}
		e = rs.Err()
		rs.Close()
		if e != nil {
			return nil, e
		}
		for id, value := range editable {
			out[indices[id]].CanEdit = value && (u.API == nil || u.API.Permissions["update"])
		}
	}
	receiptArgs := []any{}
	for _, id := range ids {
		receiptArgs = append(receiptArgs, id)
	}
	rs, err := q.Query("SELECT r.id,r.posting_id,r.size,r.media_type FROM receipts r JOIN postings p ON p.id=r.posting_id WHERE p.account_id IN ("+placeholders(len(ids))+") AND r.deleted_at IS NULL", receiptArgs...)
	if err != nil {
		return nil, err
	}
	for rs.Next() {
		var ref ReceiptRef
		var pid string
		if err = rs.Scan(&ref.ID, &pid, &ref.Size, &ref.Media); err != nil {
			rs.Close()
			return nil, err
		}
		if ix, ok := postingIndex[pid]; ok {
			out[ix[0]].Legs[ix[1]].Receipts = append(out[ix[0]].Legs[ix[1]].Receipts, ref)
		}
	}
	err = rs.Err()
	rs.Close()
	if err != nil {
		return nil, err
	}
	categoryLabels := map[string]string{}
	labelArgs := []any{}
	for _, id := range ids {
		labelArgs = append(labelArgs, id)
	}
	labelRows, err := q.Query("SELECT ac.id,c.code,c.kind,c.name FROM categories c JOIN accounts ac ON ac.ledger_id=c.ledger_id WHERE ac.id IN("+placeholders(len(ids))+")", labelArgs...)
	if err != nil {
		return nil, err
	}
	for labelRows.Next() {
		var account, code, kind, name string
		if err = labelRows.Scan(&account, &code, &kind, &name); err != nil {
			labelRows.Close()
			return nil, err
		}
		categoryLabels[account+"|"+kind+"|"+code] = name
	}
	err = labelRows.Err()
	labelRows.Close()
	if err != nil {
		return nil, err
	}
	for i := range out {
		kind := "expense"
		if out[i].Kind == "income" {
			kind = "income"
		}
		for j := range out[i].Legs {
			leg := &out[i].Legs[j]
			if label := categoryLabels[leg.AccountID+"|"+kind+"|"+leg.Category]; label != "" {
				leg.CategoryName = label
			}
			if leg.CategoryName == "" {
				leg.CategoryName = baseCategoryName(leg.Category)
			}
		}
	}
	search := strings.ToLower(params.Get("search"))
	filtered := []Transaction{}
	for _, v := range out {
		if typ := params.Get("type"); typ != "" && typ != v.Kind {
			continue
		}
		match := search == ""
		for _, l := range v.Legs {
			if strings.Contains(strings.ToLower(l.Title+" "+l.Category+" "+l.CategoryName+" "+l.Note+" "+v.Creator+" "+v.CreatorUsername), search) {
				match = true
			}
		}
		if match {
			filtered = append(filtered, v)
		}
	}
	return filtered, nil
}
func summarize(items []Transaction) TransactionPage {
	page := TransactionPage{Items: items, Count: len(items), Totals: []CurrencyTotal{}, Categories: []CategoryTotal{}, Daily: []DayTotal{}}
	sums := map[string][2]int64{}
	cat := map[string]int64{}
	daily := map[string][2]int64{}
	scales := map[string]int{}
	for _, v := range items {
		scales[v.Currency] = v.Scale
		d := sums[v.Currency]
		dayKey := v.Currency + "|" + v.Date
		day := daily[dayKey]
		for _, l := range v.Legs {
			n, _ := strconv.ParseInt(l.Amount, 10, 64)
			switch v.Kind {
			case "income":
				d[0] += n
				day[0] += n
			case "expense", "refund":
				d[1] -= n
				day[1] -= n
				cat[v.Currency+"|"+l.Category+"|"+l.CategoryName] -= n
			}
		}
		sums[v.Currency] = d
		daily[dayKey] = day
	}
	for c, v := range sums {
		page.Totals = append(page.Totals, CurrencyTotal{c, scales[c], strconv.FormatInt(v[0], 10), strconv.FormatInt(v[1], 10)})
	}
	sort.Slice(page.Totals, func(i, j int) bool { return page.Totals[i].Currency < page.Totals[j].Currency })
	for key, v := range cat {
		p := strings.SplitN(key, "|", 3)
		page.Categories = append(page.Categories, CategoryTotal{Name: p[2], Currency: p[0], Scale: scales[p[0]], Category: p[1], Amount: strconv.FormatInt(v, 10)})
	}
	sort.Slice(page.Categories, func(i, j int) bool {
		a, _ := strconv.ParseInt(page.Categories[i].Amount, 10, 64)
		b, _ := strconv.ParseInt(page.Categories[j].Amount, 10, 64)
		if a == b {
			return page.Categories[i].Category < page.Categories[j].Category
		}
		return a > b
	})
	for key, v := range daily {
		p := strings.SplitN(key, "|", 2)
		page.Daily = append(page.Daily, DayTotal{p[0], scales[p[0]], p[1], strconv.FormatInt(v[0], 10), strconv.FormatInt(v[1], 10)})
	}
	sort.Slice(page.Daily, func(i, j int) bool {
		return page.Daily[i].Date < page.Daily[j].Date || page.Daily[i].Date == page.Daily[j].Date && page.Daily[i].Currency < page.Daily[j].Currency
	})
	return page
}
func (a *App) listTransactions(w http.ResponseWriter, r *http.Request, u *User) error {
	items, err := a.readTransactions(a.DB, u, r.URL.Query())
	if err != nil {
		return err
	}
	page := summarize(items)
	if target := r.URL.Query().Get("display_currency"); target != "" {
		page, err = a.convertReport(items, u, target)
		if err != nil {
			return err
		}
	}
	n, _ := strconv.Atoi(r.URL.Query().Get("page"))
	size, _ := strconv.Atoi(r.URL.Query().Get("page_size"))
	if n < 1 {
		n = 1
	}
	if n > 100000 {
		n = 100000
	}
	if size < 1 || size > 200 {
		size = 50
	}
	page.Page = n
	page.PageSize = size
	start := (n - 1) * size
	if start > len(items) {
		start = len(items)
	}
	end := start + size
	if end > len(items) {
		end = len(items)
	}
	page.Items = items[start:end]
	writeJSON(w, 200, page)
	return nil
}
