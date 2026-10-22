package app

import (
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
)

type Export struct {
	Format       string        `json:"format"`
	Version      int           `json:"version"`
	Exported     string        `json:"exported_at"`
	Accounts     []Account     `json:"accounts"`
	Transactions []Transaction `json:"transactions"`
}

func decimalString(minor string, scale int) string {
	n := minor
	sign := ""
	if strings.HasPrefix(n, "-") {
		sign = "-"
		n = n[1:]
	}
	for len(n) <= scale {
		n = "0" + n
	}
	if scale == 0 {
		return sign + n
	}
	return sign + n[:len(n)-scale] + "." + n[len(n)-scale:]
}
func minorString(decimal string, scale int) (string, error) {
	s := strings.TrimSpace(decimal)
	sign := ""
	if strings.HasPrefix(s, "-") {
		sign = "-"
		s = s[1:]
	} else if strings.HasPrefix(s, "+") {
		s = s[1:]
	}
	parts := strings.Split(s, ".")
	if len(parts) > 2 || len(parts[0]) == 0 {
		return "", bad("금액 형식이 올바르지 않아요.")
	}
	fraction := ""
	if len(parts) == 2 {
		fraction = parts[1]
	}
	if len(fraction) > scale {
		return "", bad("통화의 소수 자릿수를 초과했어요.")
	}
	s = parts[0] + fraction + strings.Repeat("0", scale-len(fraction))
	n, err := amountValue(sign+s, true, 9000000000000)
	if err != nil {
		return "", err
	}
	return strconv.FormatInt(n, 10), nil
}
func csvSafe(s string) string {
	if len(s) > 0 && strings.ContainsRune("=+-@\t\r", rune(s[0])) {
		return "'" + s
	}
	return s
}
func csvUnescape(s string) string {
	if len(s) > 1 && s[0] == '\'' && strings.ContainsRune("=+-@\t\r", rune(s[1])) {
		return s[1:]
	}
	return s
}
func (a *App) exportData(w http.ResponseWriter, r *http.Request, u *User) error {
	params := r.URL.Query()
	format := params.Get("format")
	if format != "" && format != "csv" && format != "json" {
		return bad("CSV 또는 JSON 형식을 선택해 주세요.")
	}
	if format == "csv" {
		items, err := a.readTransactions(a.DB, u, params)
		if err != nil {
			return err
		}
		all, err := a.accounts(a.DB, u)
		if err != nil {
			return err
		}
		names := map[string]string{}
		for _, ac := range all {
			names[ac.ID] = ac.Name
		}
		w.Header().Set("Content-Type", "text/csv; charset=utf-8")
		w.Header().Set("Content-Disposition", `attachment; filename="duet-ledger-transactions.csv"`)
		_, _ = w.Write([]byte("\xef\xbb\xbf"))
		writer := csv.NewWriter(w)
		_ = writer.Write([]string{"date", "kind", "title", "amount", "category", "note", "account", "currency", "scale", "time", "timezone"})
		for _, v := range items {
			for _, l := range v.Legs {
				row := []string{v.Date, v.Kind, csvSafe(l.Title), decimalString(l.Amount, v.Scale), csvSafe(l.CategoryName), csvSafe(l.Note), csvSafe(names[l.AccountID]), v.Currency, strconv.Itoa(v.Scale), v.Time, v.Timezone}
				if err = writer.Write(row); err != nil {
					return err
				}
			}
		}
		writer.Flush()
		return writer.Error()
	}
	// JSON is a full, permission-filtered migration snapshot, rather than a partial
	// report whose opening balances would fail to reproduce the current accounts.
	params.Set("from", "1900-01-01")
	params.Set("to", "2100-12-31")
	params.Del("search")
	params.Del("type")
	params.Del("trash")
	items, err := a.readTransactions(a.DB, u, params)
	if err != nil {
		return err
	}
	all, err := a.accounts(a.DB, u)
	if err != nil {
		return err
	}
	filtered := []Account{}
	for _, ac := range all {
		if params.Get("scope") == "private" && ac.Shared || params.Get("scope") == "shared" && !ac.Shared || params.Get("ledger") != "" && params.Get("ledger") != ac.LedgerID || params.Get("account") != "" && params.Get("account") != ac.ID || params.Get("currency") != "" && params.Get("currency") != ac.Currency {
			continue
		}
		filtered = append(filtered, ac)
	}
	if len(filtered) == 0 {
		return bad("내보낼 계좌가 없어요.")
	}
	if len(filtered) > 100 || len(items) > 20000 {
		return bad("JSON 자료 이동은 계좌 100개·거래 2만 건까지예요. 계좌를 나누어 내보내거나 전체 운영 백업을 사용해 주세요.")
	}
	data, err := json.Marshal(Export{"duet-ledger", 1, now(), filtered, items})
	if err != nil {
		return err
	}
	if len(data) > 20<<20 {
		return bad("JSON 자료 이동은 20MB까지예요. 계좌를 나누어 내보내거나 전체 운영 백업을 사용해 주세요.")
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="duet-ledger-data.json"`)
	_, err = w.Write(data)
	return err
}
func (a *App) importCSV(w http.ResponseWriter, r *http.Request, u *User) error {
	var v struct {
		AccountID string `json:"account_id"`
		Content   string `json:"content"`
		DryRun    bool   `json:"dry_run"`
	}
	if err := decode(r, &v); err != nil {
		return err
	}
	if len(v.Content) > 5<<20 {
		return bad("CSV는 5MB까지 가져올 수 있어요.")
	}
	account, err := a.account(a.DB, u, v.AccountID)
	if err != nil {
		return err
	}
	if account.Role == "viewer" {
		return forbidden()
	}
	reader := csv.NewReader(strings.NewReader(strings.TrimPrefix(v.Content, "\ufeff")))
	reader.FieldsPerRecord = -1
	header, err := reader.Read()
	if err != nil {
		return bad("CSV 첫 줄에 열 이름이 필요해요.")
	}
	columns := map[string]int{}
	for i, h := range header {
		columns[strings.TrimSpace(h)] = i
	}
	for _, k := range []string{"date", "kind", "title", "amount"} {
		if _, ok := columns[k]; !ok {
			return bad("필수 열: date, kind, title, amount. 분류와 메모는 category, note 열을 사용해 주세요.")
		}
	}
	inputs := []TxInput{}
	sourceAccounts := map[string]bool{}
	digest := tokenHash(v.AccountID + "\n" + v.Content)
	for rownum := 2; ; rownum++ {
		row, e := reader.Read()
		if e == io.EOF {
			break
		}
		if e != nil {
			return bad(fmt.Sprintf("CSV %d행을 읽지 못했어요.", rownum))
		}
		if len(inputs) >= 10000 {
			return bad("한 번에 1만 행까지 가져올 수 있어요.")
		}
		get := func(k string) string {
			i, ok := columns[k]
			if !ok || i >= len(row) {
				return ""
			}
			return strings.TrimSpace(row[i])
		}
		currency := get("currency")
		if currency != "" && currency != account.Currency {
			return bad(fmt.Sprintf("%d행의 통화가 대상 계좌와 달라요.", rownum))
		}
		if name := get("account"); name != "" {
			sourceAccounts[name] = true
		}
		if len(sourceAccounts) > 1 {
			return bad("여러 계좌의 CSV는 계좌별로 나누거나 JSON으로 가져와 주세요.")
		}
		n, e := minorString(get("amount"), account.Scale)
		if e != nil {
			return bad(fmt.Sprintf("%d행: %s", rownum, e.Error()))
		}
		kind := get("kind")
		if kind == "expense" {
			n = strings.TrimPrefix(n, "-")
		}
		category := get("category")
		if category == "" {
			category = "other"
		}
		input := TxInput{Kind: kind, Date: get("date"), Time: get("time"), Timezone: get("timezone"), Amount: n, AccountID: account.ID, Title: csvUnescape(get("title")), Category: csvUnescape(category), Note: csvUnescape(get("note"))}
		check := input
		if check.Kind == "transfer" {
			check.Kind = "adjustment"
		}
		if _, _, e = a.validateTx(a.DB, u, &check); e != nil {
			return bad(fmt.Sprintf("%d행: %s", rownum, e.Error()))
		}
		inputs = append(inputs, input)
	}
	duplicates := 0
	for i := range inputs {
		var n int
		if err = a.DB.QueryRow("SELECT COUNT(*) FROM request_keys WHERE user_id=? AND key=?", u.ID, fmt.Sprintf("csv:%s:%d", digest, i)).Scan(&n); err != nil {
			return err
		}
		duplicates += n
	}
	if v.DryRun {
		preview := inputs
		if len(preview) > 5 {
			preview = preview[:5]
		}
		writeJSON(w, 200, map[string]any{"rows": len(inputs), "duplicates": duplicates, "preview": preview})
		return nil
	}
	tx, err := a.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	inserted := 0
	for i, input := range inputs {
		key := fmt.Sprintf("csv:%s:%d", digest, i)
		var n int
		if err = tx.QueryRow("SELECT COUNT(*) FROM request_keys WHERE user_id=? AND key=?", u.ID, key).Scan(&n); err != nil {
			return err
		}
		if n > 0 {
			continue
		}
		kind := input.Kind
		if kind == "transfer" {
			input.Kind = "adjustment"
		}
		event := newID()
		if _, err = a.writeEvent(tx, u, input, event, true); err != nil {
			return err
		}
		if kind == "transfer" {
			if _, err = tx.Exec("UPDATE events SET kind='transfer' WHERE id=?", event); err != nil {
				return err
			}
		}
		if _, err = tx.Exec("INSERT INTO request_keys VALUES(?,?,?,?)", u.ID, key, digest, event); err != nil {
			return err
		}
		inserted++
	}
	if err = audit(tx, u, "csv_imported", "account", account.ID); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	writeJSON(w, 201, map[string]int{"rows": len(inputs), "inserted": inserted, "duplicates": len(inputs) - inserted})
	return nil
}
func (a *App) importJSON(w http.ResponseWriter, r *http.Request, u *User) error {
	var v struct {
		Data   Export `json:"data"`
		DryRun bool   `json:"dry_run"`
	}
	if err := decode(r, &v); err != nil {
		return err
	}
	d := v.Data
	if d.Format != "duet-ledger" || d.Version != 1 {
		return bad("지원하는 듀엣 가계부 JSON 자료가 아니에요.")
	}
	if len(d.Accounts) == 0 || len(d.Accounts) > 100 || len(d.Transactions) > 20000 {
		return bad("자료의 계좌·거래 수 범위를 확인해 주세요.")
	}
	source := map[string]Account{}
	for _, ac := range d.Accounts {
		if ac.ID == "" || !validName(ac.Name, 60) || !currencyPattern.MatchString(ac.Currency) || ac.Scale < 0 || ac.Scale > 8 {
			return bad("계좌 자료 형식이 올바르지 않아요.")
		}
		if _, ok := source[ac.ID]; ok {
			return bad("중복된 계좌 식별자가 있어요.")
		}
		if ac.Kind != "cash" && ac.Kind != "bank" && ac.Kind != "card" && ac.Kind != "loan" {
			return bad("계좌 종류가 올바르지 않아요.")
		}
		if _, err := amountValue(ac.Opening, true, 9000000000000000); err != nil {
			return err
		}
		if scale, ok := currencyScales[ac.Currency]; !ok || scale != ac.Scale {
			return bad("지원하는 통화와 소수 자릿수를 확인해 주세요.")
		}
		source[ac.ID] = ac
	}
	for _, item := range d.Transactions {
		if err := validClock(item.Time, item.Timezone); err != nil {
			return err
		}
		if err := parseDate(item.Date); err != nil {
			return err
		}
		if item.Deleted {
			return bad("휴지통 자료를 이 방식으로 가져올 수 없어요.")
		}
		if len(item.Legs) < 1 || len(item.Legs) > 2 || item.Kind != "transfer" && len(item.Legs) != 1 {
			return bad("거래 연결 구조를 확인해 주세요.")
		}
		if item.Kind != "expense" && item.Kind != "income" && item.Kind != "refund" && item.Kind != "adjustment" && item.Kind != "transfer" {
			return bad("지원하지 않는 거래 유형이에요.")
		}
		var total int64
		seen := map[string]bool{}
		for _, leg := range item.Legs {
			ac, ok := source[leg.AccountID]
			if !ok || seen[leg.AccountID] || ac.Currency != item.Currency || ac.Scale != item.Scale {
				return bad("거래가 참조하는 계좌·통화가 맞지 않아요.")
			}
			seen[leg.AccountID] = true
			n, err := amountValue(leg.Amount, true, 9000000000000)
			if err != nil || n == 0 {
				return bad("거래 금액을 확인해 주세요.")
			}
			if item.Kind == "expense" && n >= 0 || (item.Kind == "income" || item.Kind == "refund") && n <= 0 {
				return bad("거래 종류와 금액 부호가 맞지 않아요.")
			}
			total += n
			if leg.CategoryName != "" && !validName(leg.CategoryName, 60) {
				return bad("분류 이름 길이를 확인해 주세요.")
			}
			if !validName(leg.Title, 100) || !validName(leg.Category, 60) || !validNote(leg.Note) {
				return bad("거래 내용 길이를 확인해 주세요.")
			}
		}
		if item.Kind == "transfer" && len(item.Legs) == 2 && total != 0 {
			return bad("이체 양쪽 금액이 맞지 않아요.")
		}
	}
	balances := map[string]int64{}
	for _, ac := range d.Accounts {
		balances[ac.ID], _ = strconv.ParseInt(ac.Opening, 10, 64)
	}
	for _, event := range d.Transactions {
		for _, leg := range event.Legs {
			n, _ := strconv.ParseInt(leg.Amount, 10, 64)
			balances[leg.AccountID] += n
		}
	}
	for _, n := range balances {
		if n > 9000000000000000 || n < -9000000000000000 {
			return bad("가져올 계좌의 잔액 범위를 초과해요.")
		}
	}
	digestData := d
	digestData.Exported = ""
	raw, _ := json.Marshal(digestData)
	digest := tokenHash(string(raw))
	var exists int
	if err := a.DB.QueryRow("SELECT COUNT(*) FROM imports WHERE user_id=? AND digest=?", u.ID, digest).Scan(&exists); err != nil {
		return err
	}
	if exists > 0 {
		return conflict("이미 가져온 JSON 자료예요.")
	}
	if v.DryRun {
		writeJSON(w, 200, map[string]int{"accounts": len(d.Accounts), "transactions": len(d.Transactions)})
		return nil
	}
	tx, err := a.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	ledgerID := newID()
	if _, err = tx.Exec("INSERT INTO ledgers(id,name,kind,owner_id,timezone,created_at) VALUES(?,?,'personal',?,?,?)", ledgerID, "가져온 가계부", u.ID, u.Timezone, now()); err != nil {
		return err
	}
	mapping := map[string]string{}
	for _, ac := range d.Accounts {
		id := newID()
		mapping[ac.ID] = id
		opening, _ := strconv.ParseInt(ac.Opening, 10, 64)
		if _, err = tx.Exec("INSERT INTO accounts(id,ledger_id,name,kind,currency,scale,opening,archived,created_at) VALUES(?,?,?,?,?,?,?,?,?)", id, ledgerID, ac.Name, ac.Kind, ac.Currency, ac.Scale, opening, ac.Archived, now()); err != nil {
			return err
		}
	}
	for _, item := range d.Transactions {
		event := newID()
		if _, err = tx.Exec("INSERT INTO events(id,kind,date,time,timezone,currency,scale,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)", event, item.Kind, item.Date, item.Time, item.Timezone, item.Currency, item.Scale, u.ID, now(), now()); err != nil {
			return err
		}
		for _, leg := range item.Legs {
			category := leg.Category
			if leg.CategoryName != "" && leg.CategoryName != baseCategoryName(leg.Category) {
				category = "c_" + tokenHash(item.Kind + "|" + leg.Category + "|" + leg.CategoryName)[:20]
				categoryKind := "expense"
				if item.Kind == "income" {
					categoryKind = "income"
				}
				if _, err = tx.Exec("INSERT OR IGNORE INTO categories(ledger_id,kind,code,name) VALUES(?,?,?,?)", ledgerID, categoryKind, category, leg.CategoryName); err != nil {
					return err
				}
			}
			n, _ := strconv.ParseInt(leg.Amount, 10, 64)
			if _, err = tx.Exec("INSERT INTO postings(id,event_id,account_id,amount,title,category,note) VALUES(?,?,?,?,?,?,?)", newID(), event, mapping[leg.AccountID], n, leg.Title, category, leg.Note); err != nil {
				return err
			}
		}
	}
	if _, err = tx.Exec("INSERT INTO imports VALUES(?,?,?,?)", u.ID, digest, ledgerID, now()); err != nil {
		return err
	}
	if err = audit(tx, u, "json_imported", "ledger", ledgerID); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	writeJSON(w, 201, map[string]any{"ledger_id": ledgerID, "accounts": len(d.Accounts), "transactions": len(d.Transactions), "message": "새 개인 가계부로 가져왔어요. 기존 공유 권한·첨부 사진은 자동으로 복원하지 않아요."})
	return nil
}
