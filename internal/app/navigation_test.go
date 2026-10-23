package app

import (
	"io"
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

func TestDefaultCurrencyPersistsAndDoesNotConvertAccounts(t *testing.T) {
	a, _, c := newTestApp(t)
	if c.user.DefaultCurrency != "KRW" {
		t.Fatal("missing default currency")
	}
	account := c.account(c.personalLedger(), "원화 통장", "bank", "KRW", "12345")
	profile := map[string]any{"name": c.user.Name, "locale": "ko", "timezone": "Asia/Seoul", "default_currency": "USD"}
	var u User
	c.send("PATCH", "/me", profile, 200, &u)
	if u.DefaultCurrency != "USD" {
		t.Fatal("currency not returned")
	}
	c.send("PATCH", "/me", map[string]any{"name": c.user.Name, "locale": "ko", "timezone": "Asia/Seoul"}, 200, &u)
	if u.DefaultCurrency != "USD" {
		t.Fatal("old client overwrote preference")
	}
	profile["default_currency"] = "INVALID"
	c.send("PATCH", "/me", profile, 400, nil)
	if c.balance(account) != "12345" {
		t.Fatal("default currency converted balance")
	}
	var accounts []Account
	c.send("GET", "/accounts", nil, 200, &accounts)
	if accounts[0].Currency != "KRW" {
		t.Fatal("account currency changed")
	}
	id, dir := c.user.ID, a.Config.DataDir
	a.Close()
	reopened, err := New(Config{DataDir: dir})
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	restored, err := reopened.user(id)
	if err != nil || restored.DefaultCurrency != "USD" {
		t.Fatal("currency lost after restart")
	}
}
func TestCategoryDeletionIsPermanentButPreservesHistoricalLabels(t *testing.T) {
	a, _, c := newTestApp(t)
	ledger := c.personalLedger()
	account := c.account(ledger, "통장", "bank", "KRW", "10000")
	var custom Category
	c.send("POST", "/ledgers/"+ledger+"/categories", Category{Name: "교육비", Kind: "expense"}, 200, &custom)
	input := txInput(account, "expense", "1000")
	input.Category = custom.Code
	pid := c.create(input)
	c.send("DELETE", "/ledgers/"+ledger+"/categories/"+custom.Code+"?kind=expense", map[string]any{}, 200, nil)
	var n int
	if err := a.DB.QueryRow("SELECT COUNT(*) FROM categories WHERE ledger_id=? AND code=?", ledger, custom.Code).Scan(&n); err != nil || n != 0 {
		t.Fatal("category metadata was not deleted")
	}
	for _, suffix := range []string{"", "&include_hidden=true"} {
		var list []Category
		c.send("GET", "/categories?ledger="+ledger+"&kind=expense"+suffix, nil, 200, &list)
		for _, v := range list {
			if v.Code == custom.Code {
				t.Fatal("deleted custom category reappeared from old postings")
			}
		}
	}
	report := c.report("")
	if report.Items[0].Legs[0].CategoryName != "교육비" || c.balance(account) != "9000" {
		t.Fatal("history label or balance lost")
	}
	c.send("POST", "/transactions", input, 400, nil)
	c.send("POST", "/ledgers/"+ledger+"/categories", custom, 400, nil)
	input.Version = report.Items[0].Version
	input.Title = "수정한 거래"
	c.send("PUT", "/transactions/"+pid, input, 200, nil)
	if c.report("").Items[0].Legs[0].CategoryName != "교육비" {
		t.Fatal("historical edit erased label snapshot")
	}
	// Built-in categories must not reappear either, and income/expense are separate.
	c.send("DELETE", "/ledgers/"+ledger+"/categories/other?kind=expense", map[string]any{}, 200, nil)
	var list []Category
	c.send("GET", "/categories?ledger="+ledger+"&kind=expense", nil, 200, &list)
	for _, v := range list {
		if v.Code == "other" {
			t.Fatal("default category reappeared")
		}
	}
	c.send("GET", "/categories?ledger="+ledger+"&kind=income", nil, 200, &list)
	found := false
	for _, v := range list {
		found = found || v.Code == "other"
	}
	if !found {
		t.Fatal("deleting expense category changed income")
	}
}
func TestVersionThreeHiddenCategoriesUpgradeWithoutLosingHistory(t *testing.T) {
	a, server, c := newTestApp(t)
	ledger := c.personalLedger()
	account := c.account(ledger, "기존 통장", "bank", "KRW", "1000")
	c.create(txInput(account, "expense", "100"))
	// Create a version-3 fixture in the disposable test directory.
	_, err := a.DB.Exec("INSERT INTO categories(ledger_id,kind,code,name,hidden) VALUES(?,'expense','food','이전 식비',1)", ledger)
	if err != nil {
		t.Fatal(err)
	}
	_, err = a.DB.Exec("DROP TABLE api_requests; DROP TABLE api_credential_accounts; DROP TABLE api_credentials; DELETE FROM server_settings WHERE key='api_enabled'; DROP TABLE exchange_rates; ALTER TABLE users DROP COLUMN default_account_id; ALTER TABLE events DROP COLUMN original_currency; ALTER TABLE events DROP COLUMN original_amount; ALTER TABLE events DROP COLUMN exchange_rate; DROP TABLE removed_categories; ALTER TABLE postings DROP COLUMN category_label; ALTER TABLE users DROP COLUMN default_currency; DELETE FROM schema_version WHERE version>=4;")
	if err != nil {
		t.Fatal(err)
	}
	dir := a.Config.DataDir
	server.Close()
	a.Close()
	upgraded, err := New(Config{DataDir: dir})
	if err != nil {
		t.Fatal(err)
	}
	defer upgraded.Close()
	s := httptest.NewServer(upgraded.Routes())
	defer s.Close()
	client := newTestClient(t, s)
	client.send("POST", "/login", credentials{Username: c.user.Username, Password: testPassword}, 200, &client.user)
	client.csrf = client.user.CSRF
	var list []Category
	client.send("GET", "/categories?ledger="+ledger+"&kind=expense&include_hidden=true", nil, 200, &list)
	for _, v := range list {
		if v.Code == "food" {
			t.Fatal("old hidden category was restored")
		}
	}
	if client.report("").Items[0].Legs[0].CategoryName != "이전 식비" || client.balance(account) != "900" || client.user.DefaultCurrency != "KRW" {
		t.Fatal("upgrade changed history, balance or default")
	}
}

func TestBundledManualIndexSurvivesDirectoryRedirect(t *testing.T) {
	a, err := New(Config{DataDir: t.TempDir(), Assets: fstest.MapFS{
		"index.html":           {Data: []byte("application shell")},
		"manual/en/index.html": {Data: []byte("English manual")},
	}})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	server := httptest.NewServer(a.Routes())
	defer server.Close()
	for _, path := range []string{"/manual/en/index.html", "/manual/en/"} {
		response, err := server.Client().Get(server.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(response.Body)
		response.Body.Close()
		if err != nil || response.StatusCode != 200 || string(data) != "English manual" {
			t.Fatalf("%s: %d %q %v", path, response.StatusCode, data, err)
		}
	}
}
