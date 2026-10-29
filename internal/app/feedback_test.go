package app

import (
	"database/sql"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEightCharacterPasswordsAndReauthentication(t *testing.T) {
	_, _, c := newTestApp(t)
	c.send("POST", "/security/password", map[string]string{"current": "wrong", "password": "newpass8"}, 401, nil)
	c.send("POST", "/security/password", map[string]string{"current": testPassword, "password": "seven77"}, 400, nil)
	var updated User
	c.send("POST", "/security/password", map[string]string{"current": testPassword, "password": "newpass8"}, 200, &updated)
	c.csrf = updated.CSRF
	c.send("POST", "/login", credentials{Username: c.user.Username, Password: testPassword}, 401, nil)
	c.send("POST", "/security/totp/start", map[string]string{"password": "newpass8"}, 200, nil)
	c.send("PATCH", "/me", map[string]any{"name": c.user.Name, "locale": "ko", "timezone": "Asia/Seoul", "show_sidebar_message": false}, 200, &updated)
	if updated.ShowSidebar {
		t.Fatal("sidebar preference was not saved")
	}
}

func TestLedgerTrashPreservesDataAndRevokesAccess(t *testing.T) {
	_, _, c := newTestApp(t)
	ledger := c.ledger("가족", "shared")
	account := c.account(ledger, "생활비", "bank", "KRW", "100000")
	pid := c.create(txInput(account, "expense", "12000"))
	inv, token := c.invite("ledger", ledger, "editor")
	other := c.joinUser("family", token)
	c.send("POST", "/invitations/"+inv+"/approve", map[string]any{}, 200, nil)
	c.send("PATCH", "/ledgers/"+ledger, map[string]string{"name": "우리 가족", "timezone": "Asia/Seoul"}, 200, nil)
	other.send("DELETE", "/ledgers/"+ledger, map[string]string{"confirm_name": "우리 가족"}, 403, nil)
	c.send("DELETE", "/ledgers/"+ledger, map[string]string{"confirm_name": "wrong"}, 400, nil)
	c.send("DELETE", "/ledgers/"+ledger, map[string]string{"confirm_name": "우리 가족"}, 200, nil)
	if other.report("").Count != 0 || c.report("&ledger="+ledger).Count != 0 {
		t.Fatal("trashed ledger remains visible")
	}
	other.send("POST", "/transactions", txInput(account, "expense", "1"), 404, nil)
	var trash []Ledger
	c.send("GET", "/ledgers?trash=true", nil, 200, &trash)
	if len(trash) != 1 || trash[0].ID != ledger || trash[0].Role != "owner" {
		t.Fatal("owner trash mismatch")
	}
	other.send("GET", "/ledgers?trash=true", nil, 200, &trash)
	if len(trash) != 0 {
		t.Fatal("non-owner can enumerate trash")
	}
	other.send("POST", "/ledgers/"+ledger+"/restore", map[string]any{}, 404, nil)
	c.send("POST", "/ledgers/"+ledger+"/restore", map[string]any{}, 200, nil)
	if c.balance(account) != "88000" || transactionByID(t, other.report(""), pid).ID != pid {
		t.Fatal("restore lost original data or memberships")
	}
}

func TestScopedEntryClockAndCategorySearch(t *testing.T) {
	_, _, c := newTestApp(t)
	personal := c.personalLedger()
	family := c.ledger("가족", "shared")
	private := c.account(personal, "개인", "bank", "KRW", "100000")
	shared := c.account(family, "가족 통장", "bank", "KRW", "100000")
	bad := txInput(private, "expense", "1000")
	bad.LedgerID = family
	c.send("POST", "/transactions", bad, 400, nil)
	input := txInput(shared, "expense", "12000")
	input.LedgerID = family
	input.Time = "12:34"
	input.Timezone = "Asia/Seoul"
	c.create(input)
	if c.report("&search="+url.QueryEscape("식비")).Count != 1 || c.report("&search="+c.user.Username).Count != 3 {
		t.Fatal("translated category or author search failed")
	}
	item := c.report("&ledger=" + family + "&type=expense").Items[0]
	if item.Time != "12:34" || item.Timezone != "Asia/Seoul" {
		t.Fatal("time was not preserved")
	}
	input.Time = "25:00"
	c.send("POST", "/transactions", input, 400, nil)
	var income []Category
	c.send("GET", "/categories?account="+shared+"&kind=income", nil, 200, &income)
	if len(income) != 7 || income[0].Code != "salary" {
		t.Fatal("income categories mismatch")
	}
	var custom Category
	c.send("POST", "/ledgers/"+family+"/categories", Category{Name: "아이 교육비", Kind: "expense"}, 200, &custom)
	input.Time = "14:00"
	input.Category = custom.Code
	c.create(input)
	custom.Name = "자녀 교육비"
	c.send("POST", "/ledgers/"+family+"/categories", custom, 200, nil)
	if c.report("&search="+url.QueryEscape("자녀 교육비")).Count != 1 {
		t.Fatal("renamed category search failed")
	}
	c.send("DELETE", "/ledgers/"+family+"/categories/"+custom.Code+"?kind=expense", map[string]any{}, 200, nil)
	var categories []Category
	c.send("GET", "/categories?account="+shared+"&kind=expense", nil, 200, &categories)
	for _, v := range categories {
		if v.Code == custom.Code {
			t.Fatal("removed category remains selectable")
		}
	}
	if c.report("&search="+url.QueryEscape("자녀 교육비")).Count != 1 {
		t.Fatal("removing category erased history")
	}
	var data Export
	c.send("GET", "/export?format=json&ledger="+family, nil, 200, &data)
	c.send("POST", "/import/json", map[string]any{"data": data}, 201, nil)
	if c.report("&search="+url.QueryEscape("자녀 교육비")).Count != 2 {
		t.Fatal("custom category labels lost during JSON import")
	}
	csv := string(c.send("GET", "/export?format=csv&ledger="+family+"&from=1900-01-01&to=2100-12-31", nil, 200, nil))
	if !strings.Contains(csv, "12:34") || !strings.Contains(csv, "Asia/Seoul") {
		t.Fatal("CSV lost clock/timezone")
	}
}

func TestCategoryMetadataDoesNotLeakAcrossPrivateAccounts(t *testing.T) {
	_, _, c := newTestApp(t)
	ledger := c.personalLedger()
	private := c.account(ledger, "개인", "bank", "KRW", "0")
	shared := c.account(ledger, "공유", "bank", "KRW", "0")
	c.send("POST", "/ledgers/"+ledger+"/categories", Category{Code: "food", Name: "SECRET_CLASSIFICATION", Kind: "expense"}, 200, nil)
	c.create(txInput(private, "expense", "100"))
	inv, token := c.invite("account", shared, "editor")
	other := c.joinUser("categoryguest", token)
	c.send("POST", "/invitations/"+inv+"/approve", map[string]any{}, 200, nil)
	raw := other.send("GET", "/categories?account="+shared+"&kind=expense", nil, 200, nil)
	if strings.Contains(string(raw), "SECRET_CLASSIFICATION") || strings.Contains(string(raw), ledger) {
		t.Fatal("private category metadata leaked")
	}
	if other.report("&search=SECRET_CLASSIFICATION").Count != 0 {
		t.Fatal("private category search leaked")
	}
	other.send("POST", "/ledgers/"+ledger+"/categories", Category{Name: "new", Kind: "expense"}, 404, nil)
}

func TestAdministratorRegistrationAndAccountOnlyInvites(t *testing.T) {
	_, server, c := newTestApp(t)
	c.account(c.personalLedger(), "SECRET_ADMIN_ACCOUNT", "bank", "KRW", "5000")
	guest := newTestClient(t, server)
	guest.send("POST", "/join", credentials{Username: "blocked", Name: "blocked", Password: "password8"}, 400, nil)
	c.send("PATCH", "/admin/settings", map[string]bool{"registration_open": true}, 200, nil)
	guest.send("POST", "/join", credentials{Username: "newguest", Name: "새 회원", Password: "password8"}, 201, &guest.user)
	guest.csrf = guest.user.CSRF
	if guest.user.Admin {
		t.Fatal("public signup became administrator")
	}
	guest.send("PATCH", "/admin/settings", map[string]bool{"registration_open": false}, 403, nil)
	c.send("PATCH", "/admin/settings", map[string]bool{"registration_open": false}, 200, nil)
	newTestClient(t, server).send("POST", "/join", credentials{Username: "closedagain", Name: "closed", Password: "password8"}, 400, nil)
	var invite map[string]any
	c.send("POST", "/admin/invitations", map[string]any{}, 201, &invite)
	invited := c.joinUser("invitedguest", invite["token"].(string))
	if invited.user.Admin || invited.user.SharingPending {
		t.Fatal("account invitation has unintended privileges or pending sharing")
	}
	var accounts []Account
	invited.send("GET", "/accounts", nil, 200, &accounts)
	if len(accounts) != 0 {
		t.Fatal("account invite exposed another user's accounts")
	}
	newTestClient(t, server).send("POST", "/join", credentials{Username: "reused", Name: "reused", Password: "password8", Token: invite["token"].(string)}, 400, nil)
	c.send("POST", "/admin/invitations", map[string]any{}, 201, &invite)
	c.send("POST", "/admin/invitations/"+invite["id"].(string)+"/cancel", map[string]any{}, 200, nil)
	newTestClient(t, server).send("POST", "/join", credentials{Username: "cancelled", Name: "cancelled", Password: "password8", Token: invite["token"].(string)}, 400, nil)
}

func TestVersionOneDataUpgrade(t *testing.T) {
	dir := t.TempDir()
	db, err := sql.Open("sqlite", filepath.Join(dir, "duet.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(schema); err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec("INSERT INTO users(id,username,name,password,admin,created_at) VALUES('old','olduser','이전 사용자',?,1,'2026-10-21'); INSERT INTO ledgers VALUES('oldledger','기존 가계부','personal','old','Asia/Seoul','2026-10-21'); INSERT INTO accounts(id,ledger_id,name,kind,currency,scale,opening,created_at) VALUES('oldaccount','oldledger','기존 통장','bank','KRW',0,123456,'2026-10-21');", passwordHash(testPassword)); err != nil {
		t.Fatal(err)
	}
	db.Close()
	key := random(32)
	if err = os.WriteFile(filepath.Join(dir, "master.key"), key, 0600); err != nil {
		t.Fatal(err)
	}
	a, err := New(Config{DataDir: dir})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	var balance int64
	if err = a.DB.QueryRow("SELECT opening+COALESCE((SELECT SUM(amount) FROM postings WHERE account_id='oldaccount'),0) FROM accounts WHERE id='oldaccount'").Scan(&balance); err != nil || balance != 123456 {
		t.Fatal("upgrade changed old account data")
	}
	user, err := a.user("old")
	if err != nil || !user.Admin || !user.ShowSidebar {
		t.Fatal("upgrade changed user permissions or preference defaults")
	}
	var hash string
	a.DB.QueryRow("SELECT password FROM users WHERE id='old'").Scan(&hash)
	if !verifyPassword(testPassword, hash) {
		t.Fatal("upgrade changed password")
	}
	if !secureEqual(string(key), string(a.master)) {
		t.Fatal("upgrade changed encryption key")
	}
	if a.registrationOpen() {
		t.Fatal("upgrade unexpectedly opened registration")
	}
}
