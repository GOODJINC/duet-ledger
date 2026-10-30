package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"
)

func (c *testClient) offlineWrite(method, path string, payload any, key, generation, owner string, status int) []byte {
	c.t.Helper()
	raw, _ := json.Marshal(payload)
	req, _ := http.NewRequest(method, c.server.URL+"/api"+path, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-CSRF-Token", c.csrf)
	req.Header.Set("Origin", c.server.URL)
	req.Header.Set("Idempotency-Key", key)
	req.Header.Set("X-Duet-Data-Generation", generation)
	req.Header.Set("X-Duet-User", owner)
	res, err := c.http.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer res.Body.Close()
	var value json.RawMessage
	if err = json.NewDecoder(res.Body).Decode(&value); err != nil {
		c.t.Fatal(err)
	}
	if res.StatusCode != status {
		c.t.Fatalf("offline %s: %d want %d %s", path, res.StatusCode, status, value)
	}
	return value
}
func TestOfflineUpdateReplayAndConflict(t *testing.T) {
	a, _, c := newTestApp(t)
	account := c.account(c.personalLedger(), "offline", "bank", "KRW", "0")
	id := c.create(txInput(account, "expense", "100"))
	p := txInput(account, "expense", "200")
	p.Version = 1
	c.offlineWrite("PUT", "/transactions/"+id, p, "edit-1", c.user.DataGeneration, c.user.ID, 200)
	c.offlineWrite("PUT", "/transactions/"+id, p, "edit-1", c.user.DataGeneration, c.user.ID, 200)
	var version int
	a.DB.QueryRow("SELECT e.version FROM events e JOIN postings p ON e.id=p.event_id WHERE p.id=?", id).Scan(&version)
	if version != 2 {
		t.Fatal("replayed edit was applied twice", version)
	}
	p.Amount = "300"
	c.offlineWrite("PUT", "/transactions/"+id, p, "edit-1", c.user.DataGeneration, c.user.ID, 409)
	p.Amount = "200"
	c.offlineWrite("PUT", "/transactions/"+id, p, "edit-2", c.user.DataGeneration, c.user.ID, 409)
	if balance := c.balance(account); balance != "-200" {
		t.Fatal(balance)
	}
}
func TestOfflineIdentityAndGenerationGuards(t *testing.T) {
	a, _, c := newTestApp(t)
	account := c.account(c.personalLedger(), "offline", "bank", "KRW", "0")
	p := txInput(account, "income", "100")
	c.offlineWrite("POST", "/transactions", p, "one", "old-generation", c.user.ID, 409)
	c.offlineWrite("POST", "/transactions", p, "one", c.user.DataGeneration, "another-user", 409)
	if countRows(t, a, "events") != 0 {
		t.Fatal("rejected write changed data")
	}
	c.offlineWrite("POST", "/transactions", p, "one", c.user.DataGeneration, c.user.ID, 201)
	c.offlineWrite("POST", "/transactions", p, "one", c.user.DataGeneration, c.user.ID, 200)
	if countRows(t, a, "events") != 1 {
		t.Fatal("creation duplicated")
	}
}
func TestOfflineReplayStillChecksRevokedAccess(t *testing.T) {
	_, _, c := newTestApp(t)
	account := c.account(c.personalLedger(), "shared", "bank", "KRW", "0")
	id := c.create(txInput(account, "expense", "100"))
	inv, token := c.invite("account", account, "editor")
	other := c.joinUser("offline-viewer", token)
	c.send("POST", "/invitations/"+inv+"/approve", map[string]any{}, 200, nil)
	p := txInput(account, "expense", "200")
	p.Version = 1
	other.offlineWrite("PUT", "/transactions/"+id, p, "edit", other.user.DataGeneration, other.user.ID, 200)
	c.send("DELETE", "/sharing/account/"+account+"/"+other.user.ID, nil, 200, nil)
	other.offlineWrite("PUT", "/transactions/"+id, p, "edit", other.user.DataGeneration, other.user.ID, 404)
}
func TestRestoreRotatesOfflineGeneration(t *testing.T) {
	a, _, c := newTestApp(t)
	old := c.user.DataGeneration
	if old == "" {
		t.Fatal("missing generation")
	}
	name := makeBackup(c)
	plan := previewBackup(t, c, name, nil, nil, 200)
	c.send("POST", "/backups/restore/confirm", restoreConfirmation(plan.Token), 200, nil)
	actual, err := dataGeneration(a.DB)
	if err != nil || actual == old || actual == "" {
		t.Fatal("restore did not invalidate old queued writes", err)
	}
}
func TestOfflineSyncIDsAreBrowserOnly(t *testing.T) {
	_, _, c := newTestApp(t)
	account := c.account(c.personalLedger(), "allowed", "bank", "KRW", "0")
	c.create(txInput(account, "income", "100"))
	report := c.report("")
	if report.Items[0].SyncID == "" {
		t.Fatal("missing browser sync identity")
	}
	c.send("PATCH", "/admin/api-settings", map[string]bool{"enabled": true}, 200, nil)
	_, key := c.appPassword([]string{account}, []string{"read"}, "never")
	var external TransactionPage
	c.external(key, "GET", "/transactions?from=1900-01-01&to=2100-12-31", nil, 200, &external)
	if external.Items[0].SyncID != "" {
		t.Fatal("external scope exposes shared synchronization identity")
	}
}

func TestOfflineMovedEntryReplay(t *testing.T) {
	a, _, c := newTestApp(t)
	one := c.account(c.personalLedger(), "one", "bank", "KRW", "0")
	two := c.account(c.personalLedger(), "two", "bank", "KRW", "0")
	id := c.create(txInput(one, "expense", "100"))
	p := txInput(two, "expense", "200")
	p.Version = 1
	c.offlineWrite("PUT", "/transactions/"+id, p, "move", c.user.DataGeneration, c.user.ID, 200)
	c.offlineWrite("PUT", "/transactions/"+id, p, "move", c.user.DataGeneration, c.user.ID, 200)
	if c.balance(one) != "0" || c.balance(two) != "-200" || countRows(t, a, "events") != 1 {
		t.Fatal("moved-entry replay changed balances")
	}
}
