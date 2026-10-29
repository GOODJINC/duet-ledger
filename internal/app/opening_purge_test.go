package app

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"image"
	"image/png"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestOpeningBalancesBecomeEditableTransactions(t *testing.T) {
	a, _, c := newTestApp(t)
	for _, test := range []struct{ amount, kind string }{{"12345", "income"}, {"-5000", "expense"}, {"0", ""}} {
		id := c.account(c.personalLedger(), "Opening", "bank", "KRW", test.amount)
		page := c.report("&account=" + id)
		if c.balance(id) != test.amount {
			t.Fatal("opening balance changed")
		}
		var base, created string
		if err := a.DB.QueryRow("SELECT opening,created_at FROM accounts WHERE id=?", id).Scan(&base, &created); err != nil || base != "0" {
			t.Fatal(base, err)
		}
		if test.amount == "0" {
			if page.Count != 0 {
				t.Fatal(page)
			}
			continue
		}
		if page.Count != 1 {
			t.Fatal(page)
		}
		item := page.Items[0]
		stamp, _ := time.Parse(time.RFC3339Nano, created)
		loc, _ := time.LoadLocation(c.user.Timezone)
		if item.Kind != test.kind || item.Date != stamp.In(loc).Format("2006-01-02") || item.Time != stamp.In(loc).Format("15:04") || item.Legs[0].Amount != test.amount || item.Legs[0].Category != "opening_balance" {
			t.Fatal(item)
		}
		in := txInput(id, test.kind, "300")
		in.Date, in.Time, in.Timezone, in.Category, in.Version = item.Date, item.Time, item.Timezone, "opening_balance", 1
		c.send("PUT", "/transactions/"+item.ID, in, 200, nil)
		want := "300"
		if test.kind == "expense" {
			want = "-300"
		}
		if c.balance(id) != want {
			t.Fatal("opening edit counted twice")
		}
		c.send("POST", "/transactions/"+item.ID+"/trash", map[string]int{"version": 2}, 200, nil)
		if c.balance(id) != "0" {
			t.Fatal("opening trash did not remove amount")
		}
		c.send("POST", "/transactions/"+item.ID+"/restore", map[string]int{"version": 3}, 200, nil)
		if c.balance(id) != want {
			t.Fatal("opening restore changed amount")
		}
	}
}

func TestOpeningMigrationPreservesBalancesAndRunsOnce(t *testing.T) {
	a, server, c := newTestApp(t)
	positive := c.account(c.personalLedger(), "Large", "bank", "KRW", "0")
	negative := c.account(c.personalLedger(), "Debt", "loan", "KRW", "0")
	created := "2026-10-21T17:20:30Z"
	if _, err := a.DB.Exec("UPDATE accounts SET opening=9000000000000000,created_at=? WHERE id=?", created, positive); err != nil {
		t.Fatal(err)
	}
	if _, err := a.DB.Exec("UPDATE accounts SET opening=-5000,created_at=?,deleted_at=? WHERE id=?", created, created, negative); err != nil {
		t.Fatal(err)
	}
	if _, err := a.DB.Exec("DELETE FROM schema_version WHERE version=8"); err != nil {
		t.Fatal(err)
	}
	dir := a.Config.DataDir
	server.Close()
	a.Close()
	for pass := 0; pass < 2; pass++ {
		upgraded, err := New(Config{DataDir: dir})
		if err != nil {
			t.Fatal(err)
		}
		var count int
		var sum int64
		var base int64
		var date, clock string
		err = upgraded.DB.QueryRow("SELECT COUNT(*),SUM(amount) FROM postings WHERE account_id=?", positive).Scan(&count, &sum)
		if err != nil || count != 1000 || sum != 9000000000000000 {
			t.Fatal("large opening lost or duplicated", count, sum, err)
		}
		if err = upgraded.DB.QueryRow("SELECT opening FROM accounts WHERE id=?", positive).Scan(&base); err != nil || base != 0 {
			t.Fatal(base, err)
		}
		if err = upgraded.DB.QueryRow("SELECT e.date,e.time FROM events e JOIN postings p ON p.event_id=e.id WHERE p.account_id=? LIMIT 1", positive).Scan(&date, &clock); err != nil || date != "2026-10-22" || clock != "02:20" {
			t.Fatal(date, clock, err)
		}
		var debt int64
		if err = upgraded.DB.QueryRow("SELECT SUM(amount) FROM postings WHERE account_id=?", negative).Scan(&debt); err != nil || debt != -5000 {
			t.Fatal("deleted account debt lost", debt, err)
		}
		var sessions int
		if err = upgraded.DB.QueryRow("SELECT COUNT(*) FROM sessions").Scan(&sessions); err != nil || sessions != 1 {
			t.Fatal("migration changed authentication", sessions, err)
		}
		upgraded.Close()
	}
}

func TestOpeningMigrationFailureRollsBack(t *testing.T) {
	a, server, c := newTestApp(t)
	id := c.account(c.personalLedger(), "Invalid old date", "bank", "KRW", "0")
	if _, err := a.DB.Exec("UPDATE accounts SET opening=500,created_at='invalid' WHERE id=?; DELETE FROM schema_version WHERE version=8", id); err != nil {
		t.Fatal(err)
	}
	dir := a.Config.DataDir
	server.Close()
	a.Close()
	if broken, err := New(Config{DataDir: dir}); err == nil {
		broken.Close()
		t.Fatal("invalid old creation timestamp accepted")
	}
	db, err := sql.Open("sqlite", filepath.Join(dir, "duet.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var opening, version, count int
	db.QueryRow("SELECT opening FROM accounts WHERE id=?", id).Scan(&opening)
	db.QueryRow("SELECT MAX(version) FROM schema_version").Scan(&version)
	db.QueryRow("SELECT COUNT(*) FROM postings").Scan(&count)
	if opening != 500 || version != 7 || count != 0 {
		t.Fatal("failed migration partially changed data", opening, version, count)
	}
}

func TestLegacyJSONOpeningBecomesIncomeWithoutDoubleCounting(t *testing.T) {
	_, _, c := newTestApp(t)
	c.account(c.personalLedger(), "Old JSON", "bank", "KRW", "0")
	var exported Export
	c.send("GET", "/export?format=json", nil, 200, &exported)
	exported.Accounts[0].Opening = "5000"
	c.send("POST", "/import/json", map[string]any{"data": exported}, 201, nil)
	page := c.report("")
	if page.Count != 1 || page.Totals[0].Income != "5000" {
		t.Fatal("import opening duplicated or omitted", page)
	}
	if c.balance(page.Items[0].Legs[0].AccountID) != "5000" {
		t.Fatal("import balance mismatch")
	}
}

func uploadPurgePhoto(t *testing.T, c *testClient, pid string) (ReceiptRef, string) {
	t.Helper()
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	part, _ := form.CreateFormFile("file", "receipt.png")
	png.Encode(part, image.NewRGBA(image.Rect(0, 0, 2, 2)))
	form.Close()
	req, _ := http.NewRequest("POST", c.server.URL+"/api/transactions/"+pid+"/receipts", &body)
	req.Header.Set("Content-Type", form.FormDataContentType())
	req.Header.Set("X-CSRF-Token", c.csrf)
	response, err := c.http.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var ref ReceiptRef
	if response.StatusCode != 201 {
		t.Fatal(response.StatusCode)
	}
	if err = json.NewDecoder(response.Body).Decode(&ref); err != nil {
		t.Fatal(err)
	}
	return ref, ref.ID + ".jpg"
}

func TestPermanentTransactionDeletionKeepsRetryTombstone(t *testing.T) {
	a, _, c := newTestApp(t)
	id := c.account(c.personalLedger(), "Allowed", "bank", "KRW", "0")
	c.send("PATCH", "/admin/api-settings", map[string]bool{"enabled": true}, 200, nil)
	_, key := c.appPassword([]string{id}, []string{"read", "create", "delete"}, "never")
	in := txInput(id, "expense", "100")
	var result map[string]string
	c.external(key, "POST", "/transactions", in, 201, &result, "purge-retry")
	pid := result["id"]
	ref, filename := uploadPurgePhoto(t, c, pid)
	c.send("DELETE", "/transactions/"+pid+"/permanent", map[string]any{"confirm": true, "version": 1}, 409, nil)
	c.send("POST", "/transactions/"+pid+"/trash", map[string]int{"version": 1}, 200, nil)
	item := c.report("&trash=true").Items[0]
	if !item.CanPurge {
		t.Fatal("owner cannot purge")
	}
	c.send("DELETE", "/transactions/"+pid+"/permanent", map[string]any{"confirm": false, "version": 2}, 400, nil)
	c.send("DELETE", "/transactions/"+pid+"/permanent", map[string]any{"confirm": true, "version": 1}, 409, nil)
	c.external(key, "DELETE", "/transactions/"+pid+"/permanent", map[string]any{"confirm": true, "version": 2}, 404, nil)
	c.send("DELETE", "/transactions/"+pid+"/permanent", map[string]any{"confirm": true, "version": 2}, 200, nil)
	c.send("POST", "/transactions/"+pid+"/restore", map[string]int{"version": 2}, 404, nil)
	c.send("GET", "/receipts/"+ref.ID, nil, 404, nil)
	if _, err := os.Stat(filepath.Join(a.Config.DataDir, "receipts", filename)); !os.IsNotExist(err) {
		t.Fatal("photo not removed", err)
	}
	c.external(key, "POST", "/transactions", in, 409, nil, "purge-retry")
	if c.report("&trash=true").Count != 0 || c.report("").Count != 0 || c.balance(id) != "0" {
		t.Fatal("purge changed balance or retry resurrected record")
	}
	var data string
	if err := a.DB.QueryRow("SELECT currency FROM events").Scan(&data); err != nil || data != "" {
		t.Fatal("retry tombstone retains currency", data, err)
	}
}

func TestEmptyTrashFiltersAndOwnership(t *testing.T) {
	_, _, owner := newTestApp(t)
	ledger := owner.ledger("Family", "shared")
	shared := owner.account(ledger, "Shared", "bank", "KRW", "0")
	invite, token := owner.invite("ledger", ledger, "editor")
	member := owner.joinUser("purge_editor", token)
	owner.send("POST", "/invitations/"+invite+"/approve", nil, 200, nil)
	own := member.account(member.personalLedger(), "Own", "bank", "KRW", "0")
	var foreign, local string
	for _, ac := range []string{shared, own} {
		input := txInput(ac, "expense", "100")
		input.Title = "Wanted"
		pid := member.create(input)
		member.send("POST", "/transactions/"+pid+"/trash", map[string]int{"version": 1}, 200, nil)
		if ac == shared {
			foreign = pid
		} else {
			local = pid
		}
	}
	member.send("DELETE", "/transactions/"+foreign+"/permanent", map[string]any{"confirm": true, "version": 2}, 403, nil)
	keepInput := txInput(own, "expense", "20")
	keepInput.Title = "Keep"
	keep := member.create(keepInput)
	member.send("POST", "/transactions/"+keep+"/trash", map[string]int{"version": 1}, 200, nil)

	another := txInput(own, "expense", "10")
	another.Title = "Wanted"
	anotherID := member.create(another)
	member.send("POST", "/transactions/"+anotherID+"/trash", map[string]int{"version": 1}, 200, nil)
	old := txInput(own, "expense", "10")
	old.Title = "Wanted"
	old.Date = "2026-10-20"
	oldID := member.create(old)
	member.send("POST", "/transactions/"+oldID+"/trash", map[string]int{"version": 1}, 200, nil)
	active := member.create(txInput(own, "expense", "30"))
	var result map[string]int
	member.send("DELETE", "/transactions/trash?from=2026-10-21&to=2026-10-21&search=Wanted&page=2&page_size=1", map[string]bool{"confirm": true}, 200, &result)
	if result["deleted"] != 2 || result["skipped"] != 1 {
		t.Fatal(result)
	}
	member.send("POST", "/transactions/"+local+"/restore", map[string]int{"version": 2}, 404, nil)
	if member.report("&trash=true").Count != 3 || transactionByID(t, member.report(""), active).ID != active || member.balance(own) != "-30" {
		t.Fatal("filtered purge removed another record")
	}
	owner.send("POST", "/transactions/"+foreign+"/restore", map[string]int{"version": 2}, 200, nil)
}

func TestPurgeAccountsRemovesReferencesAndPhotos(t *testing.T) {
	a, _, c := newTestApp(t)
	ac := c.account(c.personalLedger(), "Delete", "bank", "KRW", "1000")
	pid := c.create(txInput(ac, "expense", "100"))
	ref, filename := uploadPurgePhoto(t, c, pid)
	invite, token := c.invite("account", ac, "editor")
	member := c.joinUser("purge_guest", token)
	c.send("POST", "/invitations/"+invite+"/approve", nil, 200, nil)
	c.send("PATCH", "/me", map[string]string{"default_account_id": ac, "name": c.user.Name, "locale": c.user.Locale, "timezone": c.user.Timezone}, 200, &c.user)
	c.csrf = c.user.CSRF
	c.send("POST", "/me/entry-presets", txInput(ac, "expense", "1"), 201, nil)
	c.send("PATCH", "/admin/api-settings", map[string]bool{"enabled": true}, 200, nil)
	_, key := c.appPassword([]string{ac}, []string{"read"}, "never")
	c.send("DELETE", "/accounts/"+ac, map[string]any{"confirm": true, "version": 1}, 200, nil)
	member.send("DELETE", "/accounts/"+ac+"/permanent", map[string]bool{"confirm": true}, 404, nil)
	c.send("DELETE", "/accounts/"+ac+"/permanent", map[string]bool{"confirm": false}, 400, nil)
	c.send("DELETE", "/accounts/"+ac+"/permanent", map[string]bool{"confirm": true}, 200, nil)
	c.send("POST", "/accounts/"+ac+"/restore", nil, 404, nil)
	c.send("GET", "/receipts/"+ref.ID, nil, 404, nil)
	if _, err := os.Stat(filepath.Join(a.Config.DataDir, "receipts", filename)); !os.IsNotExist(err) {
		t.Fatal("photo survives", err)
	}
	for _, table := range []string{"accounts", "postings", "events", "receipts", "grants", "api_credential_accounts", "entry_presets"} {
		var count int
		if err := a.DB.QueryRow("SELECT COUNT(*) FROM " + table).Scan(&count); err != nil || count != 0 {
			t.Fatal(table, count, err)
		}
	}
	var user User
	c.send("GET", "/me", nil, 200, &user)
	if user.DefaultAccountID != "" {
		t.Fatal("default account reference survives")
	}
	var accounts []Account
	c.external(key, "GET", "/accounts", nil, 200, &accounts)
	if len(accounts) != 0 {
		t.Fatal("key widened after purge")
	}
	checkForeignKeys(t, a)
}

func TestAccountPurgeProtectsTransferCounterparts(t *testing.T) {
	a, _, c := newTestApp(t)
	ledger := c.personalLedger()
	one := c.account(ledger, "One", "bank", "KRW", "0")
	two := c.account(ledger, "Two", "bank", "KRW", "0")
	input := txInput(one, "transfer", "100")
	input.ToID = two
	c.create(input)
	c.send("DELETE", "/accounts/"+one, map[string]any{"confirm": true, "version": 1}, 200, nil)
	c.send("DELETE", "/accounts/"+one+"/permanent", map[string]bool{"confirm": true}, 409, nil)
	if c.balance(two) != "100" {
		t.Fatal("counterpart balance changed")
	}
	c.send("DELETE", "/accounts/"+two, map[string]any{"confirm": true, "version": 1}, 200, nil)
	c.send("DELETE", "/accounts/trash", map[string]any{"confirm": true, "ids": []string{one, two}}, 200, nil)
	var count int
	if err := a.DB.QueryRow("SELECT COUNT(*) FROM postings").Scan(&count); err != nil || count != 0 {
		t.Fatal(count, err)
	}
	checkForeignKeys(t, a)
}

func checkForeignKeys(t *testing.T, a *App) {
	t.Helper()
	rows, err := a.DB.Query("PRAGMA foreign_key_check")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	if rows.Next() {
		t.Fatal("foreign key violation after purge")
	}
	if err = rows.Err(); err != nil {
		t.Fatal(err)
	}
}
