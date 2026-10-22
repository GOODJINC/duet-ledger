package app

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/png"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"
)

const testPassword = "correct-horse-private-ledger-42"

type testClient struct {
	t      *testing.T
	server *httptest.Server
	http   *http.Client
	csrf   string
	user   User
}

func newTestApp(t *testing.T) (*App, *httptest.Server, *testClient) {
	t.Helper()
	a, err := New(Config{DataDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(a.Routes())
	t.Cleanup(func() { server.Close(); a.Close() })
	c := newTestClient(t, server)
	c.send("POST", "/setup", credentials{Username: "minsu", Name: "민수", Password: testPassword}, 201, &c.user)
	c.csrf = c.user.CSRF
	return a, server, c
}
func newTestClient(t *testing.T, s *httptest.Server) *testClient {
	jar, _ := cookiejar.New(nil)
	return &testClient{t: t, server: s, http: &http.Client{Jar: jar}}
}
func (c *testClient) send(method, path string, body any, status int, result any) []byte {
	c.t.Helper()
	var data []byte
	if body != nil {
		data, _ = json.Marshal(body)
	}
	req, _ := http.NewRequest(method, c.server.URL+"/api"+path, bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", c.server.URL)
	req.Header.Set("X-CSRF-Token", c.csrf)
	response, err := c.http.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		c.t.Fatal(err)
	}
	if response.StatusCode != status {
		c.t.Fatalf("%s %s: status %d, want %d: %s", method, path, response.StatusCode, status, raw)
	}
	if result != nil {
		if err = json.Unmarshal(raw, result); err != nil {
			c.t.Fatalf("decode %s: %v", path, err)
		}
	}
	return raw
}
func (c *testClient) personalLedger() string {
	var ledgers []Ledger
	c.send("GET", "/ledgers", nil, 200, &ledgers)
	for _, l := range ledgers {
		if l.Kind == "personal" && l.Role == "owner" {
			return l.ID
		}
	}
	c.t.Fatal("missing personal ledger")
	return ""
}
func (c *testClient) account(ledger, name, kind, currency, opening string) string {
	var result map[string]string
	c.send("POST", "/accounts", map[string]any{"ledger_id": ledger, "name": name, "kind": kind, "currency": currency, "scale": currencyScales[currency], "opening": opening}, 201, &result)
	return result["id"]
}
func (c *testClient) ledger(name, kind string) string {
	var result map[string]string
	c.send("POST", "/ledgers", map[string]string{"name": name, "kind": kind, "timezone": "Asia/Seoul"}, 201, &result)
	return result["id"]
}
func (c *testClient) create(input TxInput) string {
	var result map[string]string
	c.send("POST", "/transactions", input, 201, &result)
	return result["id"]
}
func txInput(account, kind, amount string) TxInput {
	return TxInput{Kind: kind, Date: "2026-10-21", Amount: amount, AccountID: account, Title: "기록", Category: "food"}
}
func (c *testClient) report(query string) TransactionPage {
	var result TransactionPage
	c.send("GET", "/transactions?from=1900-01-01&to=2100-12-31"+query, nil, 200, &result)
	return result
}
func (c *testClient) balance(id string) string {
	var accounts []Account
	c.send("GET", "/accounts", nil, 200, &accounts)
	for _, a := range accounts {
		if a.ID == id {
			return a.Balance
		}
	}
	c.t.Fatal("account not found")
	return ""
}
func (c *testClient) invite(typ, id, role string) (string, string) {
	var result map[string]any
	c.send("POST", "/invitations", map[string]string{"target_type": typ, "target_id": id, "role": role}, 201, &result)
	return result["id"].(string), result["token"].(string)
}
func (c *testClient) joinUser(username, token string) *testClient {
	other := newTestClient(c.t, c.server)
	other.send("POST", "/join", credentials{Username: username, Name: username, Password: testPassword, Token: token}, 201, &other.user)
	other.csrf = other.user.CSRF
	return other
}

func TestPrivateSharingAndTransferIsolation(t *testing.T) {
	_, _, owner := newTestApp(t)
	ledger := owner.personalLedger()
	private := owner.account(ledger, "SECRET_PRIVATE_ACCOUNT", "bank", "KRW", "1000000")
	shared := owner.account(ledger, "생활비", "bank", "KRW", "10000")
	invite, token := owner.invite("account", shared, "editor")
	other := owner.joinUser("jiyeon", token)
	if n := len(other.report("").Items); n != 0 {
		t.Fatal("unapproved user sees records")
	}
	var before []Account
	other.send("GET", "/accounts", nil, 200, &before)
	if len(before) != 0 {
		t.Fatal("unapproved user sees account")
	}
	owner.send("POST", "/invitations/"+invite+"/approve", map[string]any{}, 200, nil)
	input := txInput(private, "transfer", "300000")
	input.ToID = shared
	input.Note = "SECRET_SOURCE_NOTE"
	input.TargetNote = "공개 메모"
	pid := owner.create(input)
	raw := other.send("GET", "/transactions?from=1900-01-01&to=2100-12-31", nil, 200, nil)
	for _, secret := range []string{private, "SECRET_PRIVATE_ACCOUNT", "SECRET_SOURCE_NOTE", ledger} {
		if bytes.Contains(raw, []byte(secret)) {
			t.Fatalf("hidden metadata leaked: %s", secret)
		}
	}
	report := other.report("")
	if len(report.Items) != 1 || len(report.Items[0].Legs) != 1 || report.Items[0].CanEdit || report.Items[0].Legs[0].Amount != "300000" {
		t.Fatalf("invalid partial transfer projection: %+v", report.Items)
	}
	if report.Totals[0].Income != "0" || report.Totals[0].Expense != "0" {
		t.Fatal("transfer counted as income/expense")
	}
	if owner.balance(private) != "700000" || other.balance(shared) != "310000" {
		t.Fatal("transfer balances mismatch")
	}
	altered := txInput(shared, "expense", "1")
	altered.Version = 1
	other.send("PUT", "/transactions/"+report.Items[0].ID, altered, 403, nil)
	other.send("POST", "/transactions/"+report.Items[0].ID+"/trash", map[string]int{"version": 1}, 403, nil)
	other.send("PUT", "/transactions/"+pid, altered, 404, nil)
	owner.send("PUT", "/sharing/account/"+shared+"/"+other.user.ID, map[string]string{"role": "viewer"}, 200, nil)
	other.send("POST", "/transactions", txInput(shared, "expense", "10"), 403, nil)
	owner.send("DELETE", "/sharing/account/"+shared+"/"+other.user.ID, nil, 200, nil)
	if other.report("").Count != 0 {
		t.Fatal("revocation did not remove data")
	}
	other.send("PUT", "/transactions/"+report.Items[0].ID, altered, 404, nil)
	if owner.balance(shared) != "310000" {
		t.Fatal("revocation removed financial data")
	}
	other.send("GET", "/backups", nil, 403, nil)
}
func TestWholeLedgerInheritanceAndUnionPermissions(t *testing.T) {
	_, _, owner := newTestApp(t)
	family := owner.ledger("가족", "shared")
	card := owner.account(family, "카드", "card", "KRW", "-10000")
	invite, token := owner.invite("ledger", family, "viewer")
	other := owner.joinUser("partner", token)
	owner.send("POST", "/invitations/"+invite+"/approve", map[string]any{}, 200, nil)
	future := owner.account(family, "나중에 만든 현금", "cash", "KRW", "2000")
	if other.balance(future) != "2000" {
		t.Fatal("new accounts not inherited")
	}
	inv2, tok2 := owner.invite("account", card, "editor")
	other.send("POST", "/invitations/accept", map[string]string{"token": tok2}, 200, nil)
	owner.send("POST", "/invitations/"+inv2+"/approve", map[string]any{}, 200, nil)
	other.create(txInput(card, "expense", "1000"))
	if other.balance(card) != "-11000" {
		t.Fatal("grant union not effective")
	}
	if len(other.report("").Items) != 1 {
		t.Fatal("overlapping paths duplicated transaction")
	}
	owner.send("DELETE", "/sharing/account/"+card+"/"+other.user.ID, nil, 200, nil)
	other.send("POST", "/transactions", txInput(card, "expense", "1"), 403, nil)
	if other.balance(card) != "-11000" {
		t.Fatal("remaining ledger access was removed")
	}
	owner.send("POST", "/invitations", map[string]string{"target_type": "ledger", "target_id": owner.personalLedger(), "role": "viewer"}, 400, nil)
	var ledgers []Ledger
	other.send("GET", "/ledgers", nil, 200, &ledgers)
	if len(ledgers) != 2 {
		t.Fatal("account-only sharing exposed extra ledgers")
	}
}
func TestBalancesVersionsTrashAndCurrency(t *testing.T) {
	_, _, c := newTestApp(t)
	ledger := c.personalLedger()
	bank := c.account(ledger, "통장", "bank", "KRW", "1000000")
	card := c.account(ledger, "신용카드", "card", "KRW", "-50000")
	usd := c.account(ledger, "달러", "bank", "USD", "1250")
	p := c.create(txInput(card, "expense", "100000"))
	pay := txInput(bank, "transfer", "100000")
	pay.ToID = card
	c.create(pay)
	report := c.report("")
	if report.Totals[0].Expense != "100000" {
		t.Fatal("card repayment double counted")
	}
	if c.balance(card) != "-50000" || c.balance(bank) != "900000" {
		t.Fatal("card balances incorrect")
	}
	badTransfer := txInput(bank, "transfer", "100")
	badTransfer.ToID = usd
	c.send("POST", "/transactions", badTransfer, 400, nil)
	same := txInput(bank, "transfer", "100")
	same.ToID = bank
	c.send("POST", "/transactions", same, 400, nil)
	edited := txInput(card, "expense", "90000")
	edited.Version = 1
	c.send("PUT", "/transactions/"+p, edited, 200, nil)
	c.send("PUT", "/transactions/"+p, edited, 409, nil)
	c.send("POST", "/transactions/"+p+"/trash", map[string]int{"version": 2}, 200, nil)
	if c.balance(card) != "50000" {
		t.Fatal("trash did not remove delta")
	}
	if c.report("&trash=true").Count != 1 {
		t.Fatal("trash view missing")
	}
	c.send("POST", "/transactions/"+p+"/restore", map[string]int{"version": 3}, 200, nil)
	if c.balance(card) != "-40000" {
		t.Fatal("restore delta incorrect")
	}
	c.create(txInput(usd, "expense", "1"))
	usdReport := c.report("&currency=USD")
	if len(usdReport.Totals) != 1 || usdReport.Totals[0].Currency != "USD" || usdReport.Totals[0].Expense != "1" {
		t.Fatal("currency aggregation incorrect")
	}
	for _, amount := range []string{"0", "-1", "1.2", "999999999999999999999", "NaN"} {
		bad := txInput(bank, "expense", amount)
		c.send("POST", "/transactions", bad, 400, nil)
	}
}
func TestIdempotencyAndAtomicConcurrentWrites(t *testing.T) {
	a, _, c := newTestApp(t)
	account := c.account(c.personalLedger(), "통장", "bank", "KRW", "100000")
	input := txInput(account, "expense", "100")
	request := func(input TxInput) int {
		b, _ := json.Marshal(input)
		r, _ := http.NewRequest("POST", c.server.URL+"/api/transactions", bytes.NewReader(b))
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("X-CSRF-Token", c.csrf)
		r.Header.Set("Idempotency-Key", "test-retry-unique-key")
		response, err := c.http.Do(r)
		if err != nil {
			t.Error(err)
			return 0
		}
		io.Copy(io.Discard, response.Body)
		response.Body.Close()
		return response.StatusCode
	}
	var wg sync.WaitGroup
	statuses := make(chan int, 6)
	for range 6 {
		wg.Add(1)
		go func() { defer wg.Done(); statuses <- request(input) }()
	}
	wg.Wait()
	close(statuses)
	created := 0
	for status := range statuses {
		if status == 201 {
			created++
		} else if status != 200 {
			t.Errorf("unexpected duplicate status: %d", status)
		}
	}
	if created != 1 || c.report("").Count != 1 || c.balance(account) != "99900" {
		t.Fatal("duplicate write")
	}
	input.Amount = "200"
	if request(input) != 409 {
		t.Fatal("changed payload reused idempotency key")
	}
	var count int
	if err := a.DB.QueryRow("SELECT COUNT(*) FROM postings").Scan(&count); err != nil || count != 1 {
		t.Fatal("unexpected postings")
	}
}
func TestOriginCSRFAndInviteSecurity(t *testing.T) {
	a, _, c := newTestApp(t)
	r, _ := http.NewRequest("POST", c.server.URL+"/api/ledgers", strings.NewReader(`{"name":"wrong","kind":"personal","timezone":"UTC"}`))
	r.Header.Set("Content-Type", "application/json")
	response, _ := c.http.Do(r)
	response.Body.Close()
	if response.StatusCode != 403 {
		t.Fatal("missing csrf accepted")
	}
	r, _ = http.NewRequest("POST", c.server.URL+"/api/ledgers", strings.NewReader(`{}`))
	r.Header.Set("Origin", "https://attacker.invalid")
	r.Header.Set("X-CSRF-Token", c.csrf)
	response, _ = c.http.Do(r)
	response.Body.Close()
	if response.StatusCode != 403 {
		t.Fatal("cross origin accepted")
	}
	c.send("POST", "/setup", credentials{Username: "another", Name: "someone", Password: testPassword}, 409, nil)
	account := c.account(c.personalLedger(), "shared", "bank", "KRW", "0")
	inv, token := c.invite("account", account, "viewer")
	other := c.joinUser("guest", token)
	other.send("POST", "/invitations/accept", map[string]string{"token": token}, 400, nil)
	c.send("POST", "/invitations/"+inv+"/cancel", map[string]any{}, 200, nil)
	c.send("POST", "/invitations/"+inv+"/approve", map[string]any{}, 409, nil)
	inv2, tok2 := c.invite("account", account, "viewer")
	if _, err := a.DB.Exec("UPDATE invitations SET expires_at=? WHERE id=?", time.Now().Add(-time.Hour).Unix(), inv2); err != nil {
		t.Fatal(err)
	}
	other.send("POST", "/invitations/accept", map[string]string{"token": tok2}, 400, nil)
	raw := c.send("GET", "/export?format=json", nil, 200, nil)
	for _, forbidden := range []string{"password", "token_hash", "csrf", "totp_pending", token} {
		if bytes.Contains(raw, []byte(forbidden)) {
			t.Fatalf("secret exported: %s", forbidden)
		}
	}
}
func TestCSVAndJSONImports(t *testing.T) {
	_, _, c := newTestApp(t)
	account := c.account(c.personalLedger(), "현금", "cash", "KRW", "100000")
	content := "date,kind,title,amount,category,note\n2026-10-21,expense,점심,12000,food,기록\n2026-10-20,income,수입,50000,salary,\n"
	payload := map[string]any{"account_id": account, "content": content, "dry_run": true}
	var preview map[string]any
	c.send("POST", "/import/csv", payload, 200, &preview)
	if preview["rows"] != float64(2) || c.report("").Count != 0 {
		t.Fatal("preview mutated records")
	}
	payload["dry_run"] = false
	c.send("POST", "/import/csv", payload, 201, nil)
	var repeated map[string]int
	c.send("POST", "/import/csv", payload, 201, &repeated)
	if repeated["inserted"] != 0 || repeated["duplicates"] != 2 || c.report("").Count != 2 {
		t.Fatal("csv duplicate detection failed")
	}
	bad := map[string]any{"account_id": account, "content": content + "2026-02-31,expense,bad,100,food,\n", "dry_run": false}
	c.send("POST", "/import/csv", bad, 400, nil)
	if c.report("").Count != 2 {
		t.Fatal("failed CSV partially inserted")
	}
	var exported Export
	c.send("GET", "/export?format=json", nil, 200, &exported)
	c.send("POST", "/import/json", map[string]any{"data": exported, "dry_run": true}, 200, nil)
	var imported map[string]any
	c.send("POST", "/import/json", map[string]any{"data": exported, "dry_run": false}, 201, &imported)
	c.send("POST", "/import/json", map[string]any{"data": exported, "dry_run": false}, 409, nil)
	exported.Exported = "2099-01-01T00:00:00Z"
	c.send("POST", "/import/json", map[string]any{"data": exported, "dry_run": false}, 409, nil)
	if c.report("").Count != 4 {
		t.Fatal("JSON records mismatch")
	}
	if c.balance(account) != "138000" {
		t.Fatal("original data modified by import")
	}
	var acs []Account
	c.send("GET", "/accounts", nil, 200, &acs)
	for _, ac := range acs {
		if ac.ID != account && ac.Balance != "138000" {
			t.Fatal("imported balance mismatch")
		}
	}
}
func TestLedgerExportAndPartialTransferRoundTrip(t *testing.T) {
	_, _, c := newTestApp(t)
	selected := c.personalLedger()
	other := c.ledger("별도 개인 가계부", "personal")
	source := c.account(selected, "선택한 통장", "bank", "KRW", "100000")
	target := c.account(other, "다른 통장", "bank", "KRW", "200000")
	input := txInput(source, "transfer", "30000")
	input.ToID = target
	c.create(input)
	var exported Export
	c.send("GET", "/export?format=json&ledger="+selected, nil, 200, &exported)
	if len(exported.Accounts) != 1 || exported.Accounts[0].ID != source || len(exported.Transactions) != 1 || len(exported.Transactions[0].Legs) != 1 {
		t.Fatal("ledger export included another ledger or lost its transfer")
	}
	c.send("POST", "/import/json", map[string]any{"data": exported, "dry_run": false}, 201, nil)
	var accounts []Account
	c.send("GET", "/accounts", nil, 200, &accounts)
	for _, ac := range accounts {
		if ac.ID != source && ac.ID != target && ac.Balance != "70000" {
			t.Fatal("partial transfer import changed the balance")
		}
	}
}
func TestReceiptRevocationAndOperationalRestore(t *testing.T) {
	a, server, c := newTestApp(t)
	account := c.account(c.personalLedger(), "기록", "bank", "KRW", "90000")
	pid := c.create(txInput(account, "expense", "10000"))
	inv, token := c.invite("account", account, "viewer")
	other := c.joinUser("viewer", token)
	c.send("POST", "/invitations/"+inv+"/approve", map[string]any{}, 200, nil)
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, _ := writer.CreateFormFile("file", "private-receipt.png")
	img := image.NewRGBA(image.Rect(0, 0, 4, 4))
	img.Set(1, 1, color.RGBA{R: 255, A: 255})
	png.Encode(part, img)
	writer.Close()
	req, _ := http.NewRequest("POST", server.URL+"/api/transactions/"+pid+"/receipts", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("X-CSRF-Token", c.csrf)
	response, err := c.http.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var ref ReceiptRef
	json.NewDecoder(response.Body).Decode(&ref)
	response.Body.Close()
	if response.StatusCode != 201 {
		t.Fatal("receipt upload failed")
	}
	other.send("GET", "/receipts/"+ref.ID, nil, 200, nil)
	c.send("DELETE", "/sharing/account/"+account+"/"+other.user.ID, nil, 200, nil)
	other.send("GET", "/receipts/"+ref.ID, nil, 404, nil)
	var created map[string]string
	c.send("POST", "/backups", map[string]any{}, 201, &created)
	archive := filepath.Join(a.Config.DataDir, "backups", created["name"])
	z, err := zip.OpenReader(archive)
	if err != nil {
		t.Fatal(err)
	}
	hasPhoto := false
	for _, f := range z.File {
		if f.Name == "master.key" {
			t.Fatal("master key embedded in backup")
		}
		if strings.HasPrefix(f.Name, "receipts/") {
			hasPhoto = true
		}
	}
	z.Close()
	if !hasPhoto {
		t.Fatal("backup missed attachment")
	}
	destination := filepath.Join(t.TempDir(), "restored")
	if err = Restore(archive, destination, filepath.Join(a.Config.DataDir, "master.key")); err != nil {
		t.Fatal(err)
	}
	restored, err := New(Config{DataDir: destination})
	if err != nil {
		t.Fatal(err)
	}
	restoredServer := httptest.NewServer(restored.Routes())
	defer restoredServer.Close()
	defer restored.Close()
	recovered := newTestClient(t, restoredServer)
	recovered.send("POST", "/login", credentials{Username: "minsu", Password: testPassword}, 200, &recovered.user)
	recovered.csrf = recovered.user.CSRF
	if recovered.balance(account) != "80000" {
		t.Fatal("restored balance mismatch")
	}
	recovered.send("GET", "/receipts/"+ref.ID, nil, 200, nil)
	oldURL, _ := url.Parse(c.server.URL)
	newURL, _ := url.Parse(restoredServer.URL)
	recovered.http.Jar.SetCookies(newURL, c.http.Jar.Cookies(oldURL))
	recovered.send("GET", "/me", nil, 401, nil)
	sentinel := filepath.Join(destination, "do-not-touch")
	os.WriteFile(sentinel, []byte("keep"), 0600)
	if err = Restore(archive, destination, filepath.Join(a.Config.DataDir, "master.key")); err == nil {
		t.Fatal("restore overwrote existing data")
	}
	b, _ := os.ReadFile(sentinel)
	if string(b) != "keep" {
		t.Fatal("restore changed existing data")
	}
}
func TestTOTPRecoveryAndReplayProtection(t *testing.T) {
	_, server, c := newTestApp(t)
	var start map[string]string
	c.send("POST", "/security/totp/start", map[string]string{"password": testPassword}, 200, &start)
	counter := time.Now().Unix() / 30
	var confirmed struct {
		Codes []string `json:"recovery_codes"`
		CSRF  string   `json:"csrf"`
	}
	c.send("POST", "/security/totp/confirm", map[string]string{"code": totpCode(start["secret"], counter)}, 200, &confirmed)
	if len(confirmed.Codes) != 8 {
		t.Fatal("missing recovery codes")
	}
	c.csrf = confirmed.CSRF
	unauth := newTestClient(t, server)
	unauth.send("POST", "/login", credentials{Username: "minsu", Password: testPassword}, 401, nil)
	unauth.send("POST", "/login", credentials{Username: "minsu", Password: testPassword, Code: totpCode(start["secret"], counter)}, 401, nil)
	unauth.send("POST", "/login", credentials{Username: "minsu", Password: testPassword, Code: confirmed.Codes[0]}, 200, &unauth.user)
	unauth.csrf = unauth.user.CSRF
	again := newTestClient(t, server)
	again.send("POST", "/login", credentials{Username: "minsu", Password: testPassword, Code: confirmed.Codes[0]}, 401, nil)
	c.send("GET", "/me", nil, 200, nil)
}

func TestOwnerTransferAndSafeDeparture(t *testing.T) {
	_, _, owner := newTestApp(t)
	ledger := owner.ledger("함께", "shared")
	account := owner.account(ledger, "공동", "bank", "KRW", "10000")
	owner.send("DELETE", "/ledgers/"+ledger+"/membership", nil, 409, nil)
	invitation, token := owner.invite("ledger", ledger, "editor")
	other := owner.joinUser("nextowner", token)
	owner.send("POST", "/invitations/"+invitation+"/approve", map[string]any{}, 200, nil)
	owner.send("POST", "/ledgers/"+ledger+"/transfer-owner", map[string]string{"user_id": other.user.ID, "password": "wrong"}, 401, nil)
	owner.send("POST", "/ledgers/"+ledger+"/transfer-owner", map[string]string{"user_id": other.user.ID, "password": testPassword}, 200, nil)
	owner.send("POST", "/invitations", map[string]string{"target_type": "account", "target_id": account, "role": "viewer"}, 404, nil)
	other.account(ledger, "추가 계좌", "cash", "KRW", "0")
	owner.create(txInput(account, "expense", "1000"))
	owner.send("DELETE", "/ledgers/"+ledger+"/membership", nil, 200, nil)
	if owner.report("").Count != 0 || other.balance(account) != "9000" {
		t.Fatal("departure lost shared data or retained access")
	}
	other.send("DELETE", "/ledgers/"+ledger+"/membership", nil, 409, nil)
}

func TestBalanceBoundsAndImportValidation(t *testing.T) {
	_, _, c := newTestApp(t)
	account := c.account(c.personalLedger(), "경계", "bank", "KRW", "9000000000000000")
	c.send("POST", "/transactions", txInput(account, "income", "1"), 400, nil)
	if c.balance(account) != "9000000000000000" {
		t.Fatal("failed write changed balance")
	}
	c.send("POST", "/accounts", map[string]any{"ledger_id": c.personalLedger(), "name": "다른 자릿수", "kind": "bank", "currency": "USD", "scale": 0, "opening": "0"}, 400, nil)
	var exported Export
	c.send("GET", "/export?format=json", nil, 200, &exported)
	exported.Accounts[0].Scale = 2
	c.send("POST", "/import/json", map[string]any{"data": exported, "dry_run": false}, 400, nil)
}

func TestWebAndAPIRoutesTogether(t *testing.T) {
	a, _, _ := newTestApp(t)
	a.Config.Assets = fstest.MapFS{"index.html": &fstest.MapFile{Data: []byte("<html>Duet Ledger</html>")}, "assets/app.js": &fstest.MapFile{Data: []byte("void 0")}}
	routes := a.Routes()
	for _, item := range []struct {
		method, path string
		status       int
		contains     string
	}{
		{"GET", "/", 200, "Duet Ledger"},
		{"GET", "/settings", 200, "Duet Ledger"},
		{"HEAD", "/assets/app.js", 200, ""},
		{"POST", "/", 405, "Method not allowed"},
		{"GET", "/api/unknown", 404, "not_found"},
		{"POST", "/api/unknown", 404, "not_found"},
		{"GET", "/api/status", 200, "initialized"},
		{"GET", "/missing.js", 404, "404"},
	} {
		response := httptest.NewRecorder()
		routes.ServeHTTP(response, httptest.NewRequest(item.method, item.path, nil))
		if response.Code != item.status || !strings.Contains(response.Body.String(), item.contains) {
			t.Fatalf("%s %s: %d %s", item.method, item.path, response.Code, response.Body.String())
		}
	}
}

func TestFirstAccountBecomesOnlyAdministrator(t *testing.T) {
	dataDir := t.TempDir()
	a, err := New(Config{DataDir: dataDir})
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(a.Routes())
	t.Cleanup(func() { server.Close(); a.Close() })
	c := newTestClient(t, server)
	c.send("POST", "/setup", credentials{Username: "firstuser", Name: "첫 사용자", Password: "short"}, 400, nil)
	var state struct {
		Initialized bool `json:"initialized"`
	}
	c.send("GET", "/status", nil, 200, &state)
	if state.Initialized {
		t.Fatal("invalid registration claimed the installation")
	}
	req, _ := http.NewRequest("POST", server.URL+"/api/setup", strings.NewReader(`{"username":"outside","name":"outside","password":"`+testPassword+`"}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "https://attacker.invalid")
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != 403 {
		t.Fatal("cross-origin initial signup accepted")
	}
	type outcome struct {
		status int
		user   User
		err    error
	}
	results := make(chan outcome, 4)
	start := make(chan struct{})
	for _, username := range []string{"candidate1", "candidate2", "candidate3", "candidate4"} {
		go func(username string) {
			<-start
			data, err := json.Marshal(credentials{Username: username, Name: username, Password: testPassword})
			if err != nil {
				results <- outcome{err: err}
				return
			}
			req, err := http.NewRequest("POST", server.URL+"/api/setup", bytes.NewReader(data))
			if err != nil {
				results <- outcome{err: err}
				return
			}
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Origin", server.URL)
			res, err := http.DefaultClient.Do(req)
			if err != nil {
				results <- outcome{err: err}
				return
			}
			defer res.Body.Close()
			var user User
			err = json.NewDecoder(res.Body).Decode(&user)
			results <- outcome{status: res.StatusCode, user: user, err: err}
		}(username)
	}
	close(start)
	created, rejected := 0, 0
	for i := 0; i < 4; i++ {
		result := <-results
		if result.err != nil {
			t.Fatal(result.err)
		}
		switch result.status {
		case 201:
			created++
			if !result.user.Admin || result.user.CSRF == "" {
				t.Fatal("first account is not an authenticated administrator")
			}
		case 409:
			rejected++
		default:
			t.Fatalf("unexpected registration status: %d", result.status)
		}
	}
	if created != 1 || rejected != 3 {
		t.Fatalf("concurrent signup: created=%d rejected=%d", created, rejected)
	}
	for _, query := range []string{"SELECT COUNT(*) FROM users", "SELECT COUNT(*) FROM users WHERE admin=1", "SELECT COUNT(*) FROM ledgers WHERE kind='personal'", "SELECT COUNT(*) FROM sessions"} {
		var count int
		if err := a.DB.QueryRow(query).Scan(&count); err != nil || count != 1 {
			t.Fatalf("initial signup left inconsistent data: count=%d err=%v", count, err)
		}
	}
	c.send("POST", "/setup", credentials{Username: "lateuser", Name: "later", Password: testPassword}, 409, nil)
	c.send("POST", "/join", credentials{Username: "uninvited", Name: "uninvited", Password: testPassword}, 400, nil)
	if _, err := os.Stat(filepath.Join(dataDir, "setup-token")); !os.IsNotExist(err) {
		t.Fatal("initial signup still creates a setup token file")
	}
}
