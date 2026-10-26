package app

import (
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

type presetPage struct {
	Favorites []EntryPreset `json:"favorites"`
	Recent    []EntryPreset `json:"recent"`
}

func TestPresetPrivacyScopeAndRevocation(t *testing.T) {
	_, _, owner := newTestApp(t)
	private := owner.account(owner.personalLedger(), "PRIVATE", "bank", "KRW", "10000")
	family := owner.ledger("Family", "shared")
	shared := owner.account(family, "Shared", "bank", "KRW", "10000")
	invite, token := owner.invite("ledger", family, "viewer")
	member := owner.joinUser("familymember", token)
	owner.send("POST", "/invitations/"+invite+"/approve", nil, 200, nil)
	input := txInput(private, "expense", "100")
	input.Title = "SECRET FAVORITE"
	var saved map[string]string
	owner.send("POST", "/me/entry-presets", input, 201, &saved)
	var duplicate map[string]string
	owner.send("POST", "/me/entry-presets", input, 200, &duplicate)
	if duplicate["id"] != saved["id"] {
		t.Fatal("identical favorite duplicated")
	}
	member.send("DELETE", "/me/entry-presets/"+saved["id"], nil, 404, nil)
	member.send("POST", "/me/entry-presets", input, 404, nil)
	member.send("POST", "/me/entry-presets", txInput(shared, "expense", "100"), 403, nil)
	var page presetPage
	raw := member.send("GET", "/me/entry-presets", nil, 200, &page)
	if len(page.Favorites) != 0 || len(page.Recent) != 0 || strings.Contains(string(raw), "SECRET") {
		t.Fatal("private presets leaked")
	}
	owner.send("GET", "/me/entry-presets?ledger="+family, nil, 200, &page)
	if len(page.Favorites) != 0 {
		t.Fatal("preset escaped selected ledger")
	}
	// An additional direct grant elevates the effective role and is visible as a separate path.
	i, tok := owner.invite("account", shared, "editor")
	member.send("POST", "/invitations/accept", map[string]string{"token": tok}, 200, nil)
	owner.send("POST", "/invitations/"+i+"/approve", nil, 200, nil)
	var accounts []Account
	member.send("GET", "/accounts", nil, 200, &accounts)
	var found bool
	for _, ac := range accounts {
		if ac.ID == shared {
			found = true
			if ac.Role != "editor" || len(ac.AccessPaths) != 2 {
				t.Fatal("effective paths incorrect", ac)
			}
		}
	}
	if !found {
		t.Fatal("shared account missing")
	}
	member.send("POST", "/me/entry-presets", txInput(shared, "expense", "123"), 201, &saved)
	member.create(txInput(shared, "expense", "123"))
	member.send("GET", "/me/entry-presets", nil, 200, &page)
	if len(page.Favorites) != 1 || len(page.Recent) != 1 || page.Recent[0].Input.Date != "" {
		t.Fatal("missing independent reusable input", page)
	}
	owner.send("DELETE", "/sharing/account/"+shared+"/"+member.user.ID, nil, 200, nil)
	member.send("GET", "/accounts", nil, 200, &accounts)
	for _, ac := range accounts {
		if ac.ID == shared && (ac.Role != "viewer" || len(ac.AccessPaths) != 1 || ac.AccessPaths[0].Type != "ledger") {
			t.Fatal("remaining viewer path incorrect", ac)
		}
	}
	member.send("GET", "/me/entry-presets", nil, 200, &page)
	if len(page.Favorites) != 0 || len(page.Recent) != 0 {
		t.Fatal("revoked write permission still offered presets")
	}
	member.send("POST", "/transactions", txInput(shared, "expense", "123"), 403, nil)
	// Revocation does not prevent the user from removing their own saved preset.
	member.send("DELETE", "/me/entry-presets/"+saved["id"], nil, 200, nil)
	if owner.balance(private) != "10000" || owner.balance(shared) != "9877" {
		t.Fatal("saving a preset changed balances")
	}
}

func TestRecentTransferRequiresBothCurrentAccountsAndExcludesTrash(t *testing.T) {
	_, _, owner := newTestApp(t)
	ledger := owner.personalLedger()
	source := owner.account(ledger, "Source", "bank", "KRW", "10000")
	target := owner.account(ledger, "SECRET TARGET", "bank", "KRW", "0")
	i, token := owner.invite("account", source, "editor")
	member := owner.joinUser("editor", token)
	owner.send("POST", "/invitations/"+i+"/approve", nil, 200, nil)
	i, token = owner.invite("account", target, "editor")
	member.send("POST", "/invitations/accept", map[string]string{"token": token}, 200, nil)
	owner.send("POST", "/invitations/"+i+"/approve", nil, 200, nil)
	input := txInput(source, "transfer", "1200")
	input.ToID, input.Category, input.TargetNote = target, "transfer", "SECRET TARGET NOTE"
	pid := member.create(input)
	var page presetPage
	member.send("GET", "/me/entry-presets", nil, 200, &page)
	if len(page.Recent) != 1 || page.Recent[0].Input.ToID != target || page.Recent[0].Input.Amount != "1200" || page.Recent[0].Input.TargetNote != input.TargetNote {
		t.Fatal(page)
	}
	owner.send("DELETE", "/sharing/account/"+target+"/"+member.user.ID, nil, 200, nil)
	raw := member.send("GET", "/me/entry-presets", nil, 200, &page)
	if len(page.Recent) != 0 || strings.Contains(string(raw), target) || strings.Contains(string(raw), "SECRET") {
		t.Fatal("hidden transfer counterpart leaked")
	}
	owner.send("POST", "/transactions/"+pid+"/trash", map[string]int{"version": 1}, 200, nil)
	owner.send("GET", "/me/entry-presets", nil, 200, &page)
	if len(page.Recent) != 0 {
		t.Fatal("trash offered as recent input")
	}
}

func TestPresetMigrationFromVersionSixPreservesDataAndSessions(t *testing.T) {
	a, server, c := newTestApp(t)
	account := c.account(c.personalLedger(), "Existing", "bank", "KRW", "12345")
	c.create(txInput(account, "expense", "345"))
	if _, err := a.DB.Exec("DROP TABLE entry_presets; DROP INDEX events_creator_recent; DELETE FROM schema_version WHERE version=7"); err != nil {
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
	var version int
	if err = upgraded.DB.QueryRow("SELECT MAX(version) FROM schema_version").Scan(&version); err != nil || version != 7 {
		t.Fatal(version, err)
	}
	s := httptest.NewServer(upgraded.Routes())
	defer s.Close()
	oldURL := c.server.URL
	oldOrigin, _ := url.Parse(oldURL)
	cookies := c.http.Jar.Cookies(oldOrigin)
	c.server = s
	newOrigin, _ := url.Parse(s.URL)
	c.http.Jar.SetCookies(newOrigin, cookies)
	c.send("GET", "/me", nil, 200, &c.user)
	if c.balance(account) != "12000" {
		t.Fatal("migration altered existing balance")
	}
	var saved map[string]string
	c.send("POST", "/me/entry-presets", txInput(account, "expense", "100"), 201, &saved)
	var page presetPage
	c.send("GET", "/me/entry-presets", nil, 200, &page)
	if len(page.Favorites) != 1 {
		t.Fatal(page)
	}
	data, _ := json.Marshal(page.Favorites[0].Input)
	if strings.Contains(string(data), "receipts") {
		t.Fatal("preset includes receipt state")
	}
}

func TestPersonalLedgerMembershipCannotElevateOrExposeDirectShare(t *testing.T) {
	a, _, owner := newTestApp(t)
	ledger := owner.personalLedger()
	account := owner.account(ledger, "Only shared account", "bank", "KRW", "1000")
	i, token := owner.invite("account", account, "viewer")
	member := owner.joinUser("viewerprivate", token)
	owner.send("POST", "/invitations/"+i+"/approve", nil, 200, nil)
	// Personal ledgers never confer access through a stale membership record.
	if _, err := a.DB.Exec("INSERT INTO members VALUES(?,?,?)", ledger, member.user.ID, "editor"); err != nil {
		t.Fatal(err)
	}
	var accounts []Account
	member.send("GET", "/accounts", nil, 200, &accounts)
	var ac Account
	for _, v := range accounts {
		if v.ID == account {
			ac = v
		}
	}
	if ac.Role != "viewer" || ac.LedgerID != "" || ac.LedgerName != "공유받은 계좌" || len(ac.AccessPaths) != 1 || ac.AccessPaths[0].Type != "account" {
		t.Fatal("personal ledger scope leaked or elevated", ac)
	}
	member.send("POST", "/transactions", txInput(account, "expense", "1"), 403, nil)
}
