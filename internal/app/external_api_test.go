package app

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"
	"time"
)

func (c *testClient) appPassword(ids []string, scopes []string, lifetime string) (string, string) {
	c.t.Helper()
	var result map[string]any
	c.send("POST", "/me/app-passwords", map[string]any{"name": "테스트 연결", "account_ids": ids, "permissions": scopes, "lifetime": lifetime, "password": testPassword}, 201, &result)
	return result["id"].(string), result["app_password"].(string)
}
func (c *testClient) external(secret, method, path string, body any, status int, result any, idem ...string) []byte {
	c.t.Helper()
	var raw []byte
	if body != nil {
		raw, _ = json.Marshal(body)
	}
	req, _ := http.NewRequest(method, c.server.URL+"/api/v1"+path, bytes.NewReader(raw))
	if secret != "" {
		req.Header.Set("Authorization", "Bearer "+secret)
	}
	req.Header.Set("Content-Type", "application/json")
	if len(idem) > 0 {
		req.Header.Set("Idempotency-Key", idem[0])
	}
	resp, err := c.http.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != status {
		c.t.Fatalf("%s %s got %d want %d: %s", method, path, resp.StatusCode, status, data)
	}
	if result != nil {
		if err = json.Unmarshal(data, result); err != nil {
			c.t.Fatal(err)
		}
	}
	return data
}
func TestAppPasswordAdminGateAndLifecycle(t *testing.T) {
	a, _, c := newTestApp(t)
	id := c.account(c.personalLedger(), "통장", "bank", "KRW", "0")
	c.send("POST", "/me/app-passwords", map[string]any{}, 403, nil)
	c.send("PATCH", "/admin/api-settings", map[string]bool{"enabled": true}, 200, nil)
	c.send("PATCH", "/admin/settings", map[string]bool{"registration_open": true}, 200, nil)
	other := c.joinUser("guest", "")
	other.send("PATCH", "/admin/api-settings", map[string]bool{"enabled": false}, 403, nil)
	key, secret := c.appPassword([]string{id}, []string{"read"}, "30d")
	if !strings.HasPrefix(secret, "dl_app_") || len(secret) != 50 {
		t.Fatal("unexpected app password")
	}
	var hash string
	if err := a.DB.QueryRow("SELECT secret_hash FROM api_credentials WHERE id=?", key).Scan(&hash); err != nil || hash != tokenHash(secret) || hash == secret {
		t.Fatal("secret stored unsafely")
	}
	list := c.send("GET", "/me/app-passwords", nil, 200, nil)
	if bytes.Contains(list, []byte(secret)) || bytes.Contains(list, []byte("secret_hash")) {
		t.Fatal("secret redisplayed")
	}
	other.send("DELETE", "/me/app-passwords/"+key, nil, 404, nil)
	c.external("", "GET", "/accounts", nil, 401, nil) // Browser cookie cannot authenticate external API.
	c.external(secret, "GET", "/accounts", nil, 200, nil)
	c.send("PATCH", "/admin/api-settings", map[string]bool{"enabled": false}, 200, nil)
	c.external(secret, "GET", "/accounts", nil, 403, nil)
	c.send("PATCH", "/admin/api-settings", map[string]bool{"enabled": true}, 200, nil)
	c.external(secret, "GET", "/accounts", nil, 200, nil)
	c.send("DELETE", "/me/app-passwords/"+key, nil, 200, nil)
	c.external(secret, "GET", "/accounts", nil, 401, nil)
	for _, period := range []string{"30d", "90d", "1y", "never"} {
		id, key := c.appPassword([]string{id}, []string{"read"}, period)
		var expires int64
		a.DB.QueryRow("SELECT expires_at FROM api_credentials WHERE id=?", id).Scan(&expires)
		if period == "never" {
			if expires != 0 {
				t.Fatal("never expires")
			}
		} else if expires <= time.Now().Unix() {
			t.Fatal("bad expiry")
		}
		if period == "30d" {
			a.DB.Exec("UPDATE api_credentials SET expires_at=? WHERE id=?", time.Now().Add(-time.Second).Unix(), id)
			c.external(key, "GET", "/accounts", nil, 401, nil)
		}
	}
}
func TestExternalAccountIsolationAndReadOnly(t *testing.T) {
	_, _, c := newTestApp(t)
	l := c.personalLedger()
	one := c.account(l, "공개 통장", "bank", "KRW", "10000")
	hidden := c.account(l, "비밀 통장", "bank", "KRW", "0")
	own := c.create(txInput(one, "expense", "100"))
	private := c.create(txInput(hidden, "expense", "999"))
	in := txInput(one, "transfer", "200")
	in.ToID = hidden
	transfer := c.create(in)
	c.send("PATCH", "/admin/api-settings", map[string]bool{"enabled": true}, 200, nil)
	_, key := c.appPassword([]string{one}, []string{"read"}, "never")
	var accounts []Account
	raw := c.external(key, "GET", "/accounts", nil, 200, &accounts)
	if len(accounts) != 1 || accounts[0].ID != one || bytes.Contains(raw, []byte("비밀")) {
		t.Fatal("account scope leak")
	}
	later := c.account(l, "새 통장", "cash", "KRW", "100")
	_ = later
	c.external(key, "GET", "/accounts", nil, 200, &accounts)
	if len(accounts) != 1 {
		t.Fatal("new account automatically included")
	}
	var report TransactionPage
	c.external(key, "GET", "/transactions?from=1900-01-01&to=2100-12-31", nil, 200, &report)
	if report.Count != 3 || report.Totals[0].Expense != "100" || report.Totals[0].Income != "10000" {
		t.Fatal("unselected totals leaked", report.Count, report.Totals)
	}
	for _, tx := range report.Items {
		if tx.CanEdit || len(tx.Legs) != 1 || tx.Legs[0].AccountID != one {
			t.Fatal("hidden transfer side/edit capability leaked")
		}
	}
	c.external(key, "GET", "/transactions/"+private, nil, 404, nil)
	c.external(key, "GET", "/transactions/"+own, nil, 200, nil)
	c.external(key, "GET", "/transactions?account="+hidden, nil, 200, &report)
	if report.Count != 0 {
		t.Fatal("query account escaped scope")
	}
	c.external(key, "GET", "/categories?ledger="+l, nil, 400, nil)
	c.external(key, "GET", "/categories?kind=expense&account="+hidden, nil, 404, nil)
	c.external(key, "GET", "/categories?kind=expense&account="+one, nil, 200, nil)
	c.external(key, "GET", "/statistics?from=1900-01-01&to=2100-12-31", nil, 200, nil)
	c.external(key, "POST", "/transactions", txInput(one, "expense", "1"), 403, nil, "readonly")
	c.external(key, "PUT", "/transactions/"+own, txInput(one, "expense", "1"), 403, nil)
	c.external(key, "DELETE", "/transactions/"+transfer, map[string]int{"version": 1}, 403, nil)
	c.external(key, "GET", "/backups", nil, 404, nil)
	// A bearer token never unlocks web-only endpoints, even with a valid browser cookie.
	req, _ := http.NewRequest("GET", c.server.URL+"/api/accounts", nil)
	req.Header.Set("Authorization", "Bearer "+key)
	resp, err := c.http.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 403 {
		t.Fatal("web cookie fallback accepted token")
	}
}
func TestExternalWritesIdempotencyVersionsAndDeletePermissions(t *testing.T) {
	_, _, c := newTestApp(t)
	l := c.personalLedger()
	one := c.account(l, "통장", "bank", "KRW", "10000")
	hidden := c.account(l, "다른 통장", "bank", "KRW", "0")
	c.send("PATCH", "/admin/api-settings", map[string]bool{"enabled": true}, 200, nil)
	_, key := c.appPassword([]string{one}, []string{"read", "create", "update"}, "90d")
	input := txInput(one, "expense", "100")
	var result map[string]string
	c.external(key, "POST", "/transactions", input, 400, nil)
	c.external(key, "POST", "/transactions", input, 201, &result, "same-request")
	pid := result["id"]
	if c.balance(one) != "9900" {
		t.Fatal("API did not save immediately")
	}
	c.external(key, "POST", "/transactions", input, 200, &result, "same-request")
	if result["id"] != pid || c.balance(one) != "9900" {
		t.Fatal("duplicate applied")
	}
	input.Amount = "101"
	c.external(key, "POST", "/transactions", input, 409, nil, "same-request")
	input = txInput(hidden, "expense", "5")
	c.external(key, "POST", "/transactions", input, 404, nil, "hidden")
	input = txInput(one, "expense", "150")
	input.Version = 1
	c.external(key, "PUT", "/transactions/"+pid, input, 200, nil)
	c.external(key, "PUT", "/transactions/"+pid, input, 409, nil)
	c.external(key, "DELETE", "/transactions/"+pid, map[string]int{"version": 2}, 403, nil)
	_, del := c.appPassword([]string{one}, []string{"delete"}, "never")
	c.external(del, "GET", "/accounts", nil, 403, nil)
	c.external(del, "DELETE", "/transactions/"+pid, map[string]int{"version": 2}, 200, nil)
	if c.balance(one) != "10000" {
		t.Fatal("trash did not restore balance")
	}
	c.external(del, "POST", "/transactions/"+pid+"/restore", map[string]int{"version": 3}, 200, nil)
	if c.balance(one) != "9850" {
		t.Fatal("restore failed")
	}
	transferInput := txInput(one, "transfer", "10")
	transferInput.ToID = hidden
	transfer := c.create(transferInput)
	c.external(del, "DELETE", "/transactions/"+transfer, map[string]int{"version": 1}, 403, nil)
	transferInput.Version = 1
	c.external(key, "PUT", "/transactions/"+transfer, transferInput, 403, nil)
	c.external(key, "POST", "/transactions", transferInput, 404, nil, "hidden-transfer")
	_, key2 := c.appPassword([]string{one}, []string{"create"}, "30d")
	c.external(key2, "POST", "/transactions", txInput(one, "expense", "100"), 201, nil, "same-request")
	logs := c.send("GET", "/me/api-requests", nil, 200, nil)
	if bytes.Contains(logs, []byte(key)) || bytes.Contains(logs, []byte("same-request")) {
		t.Fatal("API secret/body in log")
	}
}
func TestExternalSharedRevocationAndRateLimit(t *testing.T) {
	a, _, owner := newTestApp(t)
	account := owner.account(owner.personalLedger(), "함께", "bank", "KRW", "1000")
	inv, invite := owner.invite("account", account, "editor")
	other := owner.joinUser("sharedguest", invite)
	owner.send("POST", "/invitations/"+inv+"/approve", map[string]any{}, 200, nil)
	owner.send("PATCH", "/admin/api-settings", map[string]bool{"enabled": true}, 200, nil)
	_, key := other.appPassword([]string{account}, []string{"read", "create"}, "never")
	other.external(key, "POST", "/transactions", txInput(account, "expense", "10"), 201, nil, "shared-create")
	owner.send("DELETE", "/sharing/account/"+account+"/"+other.user.ID, nil, 200, nil)
	other.external(key, "POST", "/transactions", txInput(account, "expense", "10"), 404, nil, "revoked")
	var ac []Account
	other.external(key, "GET", "/accounts", nil, 200, &ac)
	if len(ac) != 0 {
		t.Fatal("revoked sharing still visible")
	}
	// Key-bound limit cannot be bypassed by valid browser sessions.
	var keyID string
	a.DB.QueryRow("SELECT id FROM api_credentials WHERE secret_hash=?", tokenHash(key)).Scan(&keyID)
	a.mu.Lock()
	a.attempts["api-key:"+keyID] = attempt{Count: 120, Since: time.Now()}
	a.mu.Unlock()
	other.external(key, "GET", "/accounts", nil, 429, nil)
}
func TestExternalReceiptScopeAndPermissions(t *testing.T) {
	_, _, c := newTestApp(t)
	l := c.personalLedger()
	one := c.account(l, "선택", "bank", "KRW", "0")
	two := c.account(l, "비선택", "bank", "KRW", "0")
	pid := c.create(txInput(one, "expense", "1"))
	hidden := c.create(txInput(two, "expense", "1"))
	c.send("PATCH", "/admin/api-settings", map[string]bool{"enabled": true}, 200, nil)
	_, key := c.appPassword([]string{one}, []string{"read", "receipts"}, "30d")
	upload := func(pid string, status int) ReceiptRef {
		var buf bytes.Buffer
		mw := multipart.NewWriter(&buf)
		part, _ := mw.CreateFormFile("file", "receipt.png")
		png.Encode(part, image.NewRGBA(image.Rect(0, 0, 2, 2)))
		mw.Close()
		req, _ := http.NewRequest("POST", c.server.URL+"/api/v1/transactions/"+pid+"/receipts", &buf)
		req.Header.Set("Authorization", "Bearer "+key)
		req.Header.Set("Content-Type", mw.FormDataContentType())
		resp, err := c.http.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		if resp.StatusCode != status {
			t.Fatalf("receipt status %d want %d", resp.StatusCode, status)
		}
		var ref ReceiptRef
		if status == 201 {
			json.NewDecoder(resp.Body).Decode(&ref)
		}
		return ref
	}
	ref := upload(pid, 201)
	upload(hidden, 404)
	c.external(key, "GET", "/receipts/"+ref.ID, nil, 200, nil)
	c.external(key, "DELETE", "/receipts/"+ref.ID, nil, 403, nil)
	_, deleter := c.appPassword([]string{one}, []string{"delete"}, "never")
	c.external(deleter, "DELETE", "/receipts/"+ref.ID, nil, 403, nil)
	_, both := c.appPassword([]string{one}, []string{"delete", "receipts"}, "never")
	c.external(both, "DELETE", "/receipts/"+ref.ID, nil, 200, nil)
	c.external(key, "GET", "/receipts/"+ref.ID, nil, 404, nil)
}
func TestAppPasswordSecurityResetRevokes(t *testing.T) {
	a, _, c := newTestApp(t)
	one := c.account(c.personalLedger(), "통장", "bank", "KRW", "0")
	c.send("PATCH", "/admin/api-settings", map[string]bool{"enabled": true}, 200, nil)
	_, key := c.appPassword([]string{one}, []string{"read"}, "never")
	if err := a.ResetPassword("minsu", "a-new-long-password", false); err != nil {
		t.Fatal(err)
	}
	c.external(key, "GET", "/accounts", nil, 401, nil)
}

func TestAppPasswordValidationAndViewerIntersection(t *testing.T) {
	a, _, owner := newTestApp(t)
	one := owner.account(owner.personalLedger(), "공유 조회", "bank", "KRW", "0")
	hidden := owner.account(owner.personalLedger(), "소유자만", "bank", "KRW", "0")
	pid := owner.create(txInput(one, "expense", "10"))
	inv, token := owner.invite("account", one, "viewer")
	viewer := owner.joinUser("readonlyguest", token)
	owner.send("POST", "/invitations/"+inv+"/approve", map[string]any{}, 200, nil)
	owner.send("PATCH", "/admin/api-settings", map[string]bool{"enabled": true}, 200, nil)
	input := map[string]any{"name": "연결", "account_ids": []string{one}, "permissions": []string{"read"}, "lifetime": "30d", "password": "wrong-password"}
	viewer.send("POST", "/me/app-passwords", input, 401, nil)
	input["password"] = testPassword
	input["account_ids"] = []string{hidden}
	viewer.send("POST", "/me/app-passwords", input, 400, nil)
	input["account_ids"] = []string{one}
	input["permissions"] = []string{"admin"}
	viewer.send("POST", "/me/app-passwords", input, 400, nil)
	input["permissions"] = []string{"read"}
	input["lifetime"] = "custom"
	viewer.send("POST", "/me/app-passwords", input, 400, nil)
	_, secret := viewer.appPassword([]string{one}, []string{"read", "create", "update", "delete", "receipts"}, "90d")
	viewer.external(secret, "POST", "/transactions", txInput(one, "expense", "10"), 403, nil, "viewer")
	in := txInput(one, "expense", "11")
	in.Version = 1
	viewer.external(secret, "PUT", "/transactions/"+pid, in, 403, nil)
	viewer.external(secret, "DELETE", "/transactions/"+pid, map[string]int{"version": 1}, 403, nil)
	var count int
	if err := a.DB.QueryRow("SELECT COUNT(*) FROM api_credentials WHERE user_id=?", viewer.user.ID).Scan(&count); err != nil || count != 1 {
		t.Fatal("invalid issuance stored credentials")
	}
	// Cookie-authenticated token issuance still requires CSRF.
	raw, _ := json.Marshal(map[string]any{"name": "csrf", "account_ids": []string{one}, "permissions": []string{"read"}, "lifetime": "30d", "password": testPassword})
	req, _ := http.NewRequest("POST", viewer.server.URL+"/api/me/app-passwords", bytes.NewReader(raw))
	req.Header.Set("Origin", viewer.server.URL)
	req.Header.Set("Content-Type", "application/json")
	resp, err := viewer.http.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 403 {
		t.Fatal("token issue accepted without CSRF")
	}
}
func TestPasswordChangeRevokesKeysButLogoutAllOnlyEndsSessions(t *testing.T) {
	_, server, c := newTestApp(t)
	one := c.account(c.personalLedger(), "통장", "bank", "KRW", "0")
	c.send("PATCH", "/admin/api-settings", map[string]bool{"enabled": true}, 200, nil)
	_, key := c.appPassword([]string{one}, []string{"read"}, "never")
	c.send("POST", "/security/password", map[string]string{"current": testPassword, "password": "new-account-password"}, 200, &c.user)
	c.csrf = c.user.CSRF
	c.external(key, "GET", "/accounts", nil, 401, nil)
	var result map[string]any
	c.send("POST", "/me/app-passwords", map[string]any{"name": "new", "account_ids": []string{one}, "permissions": []string{"read"}, "lifetime": "never", "password": "new-account-password"}, 201, &result)
	otherDevice := newTestClient(t, server)
	otherDevice.send("POST", "/login", credentials{Username: c.user.Username, Password: "new-account-password", Remember: true}, 200, &otherDevice.user)
	otherDevice.csrf = otherDevice.user.CSRF
	c.send("POST", "/logout-all", nil, 200, nil)
	c.send("GET", "/me", nil, 401, nil)
	otherDevice.send("GET", "/me", nil, 401, nil)
	c.external(result["app_password"].(string), "GET", "/accounts", nil, 200, nil)
	otherDevice.send("POST", "/login", credentials{Username: c.user.Username, Password: "new-account-password"}, 200, &otherDevice.user)
	otherDevice.csrf = otherDevice.user.CSRF
	otherDevice.send("DELETE", "/me/app-passwords/"+result["id"].(string), nil, 200, nil)
	c.external(result["app_password"].(string), "GET", "/accounts", nil, 401, nil)
	otherDevice.send("GET", "/me", nil, 200, nil)
}
