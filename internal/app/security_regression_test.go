package app

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// A client that has sent headers but has not finished its body.
type pausedBody struct {
	started chan struct{}
	release chan struct{}
	once    sync.Once
	reader  *bytes.Reader
}

func newPausedBody(t *testing.T, data []byte) *pausedBody {
	t.Helper()
	b := &pausedBody{started: make(chan struct{}), release: make(chan struct{}), reader: bytes.NewReader(data)}
	t.Cleanup(func() { b.Close() })
	return b
}
func (b *pausedBody) Read(p []byte) (int, error) {
	b.once.Do(func() { close(b.started) })
	<-b.release
	return b.reader.Read(p)
}
func (b *pausedBody) Close() error {
	select {
	case <-b.release:
	default:
		close(b.release)
	}
	return nil
}
func browserTestRequest(c *testClient, method, path string, body io.Reader) *http.Request {
	req := httptest.NewRequest(method, c.server.URL+path, body)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-CSRF-Token", c.csrf)
	origin, _ := url.Parse(c.server.URL)
	for _, cookie := range c.http.Jar.Cookies(origin) {
		req.AddCookie(cookie)
	}
	return req
}
func assertResponsive(t *testing.T, h http.Handler) {
	t.Helper()
	done := make(chan int, 1)
	go func() {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest("GET", "/api/status", nil))
		done <- w.Code
	}()
	select {
	case status := <-done:
		if status != 200 {
			t.Fatal(status)
		}
	case <-time.After(time.Second):
		t.Fatal("unrelated request blocked by slow client")
	}
}
func TestSlowBodiesDoNotBlockAPI(t *testing.T) {
	for _, path := range []string{"/api/setup", "/api/login", "/api/v1/transactions", "/api/admin/appearance/css"} {
		t.Run(path, func(t *testing.T) {
			a, _, c := newTestApp(t)
			body := newPausedBody(t, []byte(`{}`))
			req := browserTestRequest(c, "POST", path, body)
			if strings.Contains(path, "/v1/") {
				account := c.account(c.personalLedger(), "allowed", "bank", "KRW", "0")
				c.send("PATCH", "/admin/api-settings", map[string]bool{"enabled": true}, 200, nil)
				_, key := c.appPassword([]string{account}, []string{"create"}, "never")
				req.Header.Set("Authorization", "Bearer "+key)
			}
			if strings.Contains(path, "/appearance/") {
				req.Method = "PUT"
				req.Header.Set("Content-Type", "multipart/form-data; boundary=test")
			}
			done := make(chan struct{})
			h := a.Routes()
			go func() { defer close(done); h.ServeHTTP(httptest.NewRecorder(), req) }()
			select {
			case <-body.started:
			case <-time.After(time.Second):
				t.Fatal("body was not read")
			}
			assertResponsive(t, h)
			body.Close()
			select {
			case <-done:
			case <-time.After(time.Second):
				t.Fatal("request did not finish")
			}
		})
	}
}
func TestRevocationWhileReceivingRequest(t *testing.T) {
	for _, bearer := range []bool{false, true} {
		t.Run(map[bool]string{false: "session", true: "app password"}[bearer], func(t *testing.T) {
			a, _, c := newTestApp(t)
			account := c.account(c.personalLedger(), "allowed", "bank", "KRW", "0")
			raw, _ := json.Marshal(txInput(account, "expense", "100"))
			body := newPausedBody(t, raw)
			path := "/api/transactions"
			keyID := ""
			key := ""
			if bearer {
				c.send("PATCH", "/admin/api-settings", map[string]bool{"enabled": true}, 200, nil)
				keyID, key = c.appPassword([]string{account}, []string{"create"}, "never")
				path = "/api/v1/transactions"
			}
			req := browserTestRequest(c, "POST", path, body)
			if bearer {
				req.Header.Set("Authorization", "Bearer "+key)
				req.Header.Set("Idempotency-Key", "paused")
			}
			w := httptest.NewRecorder()
			done := make(chan struct{})
			go func() { defer close(done); a.Routes().ServeHTTP(w, req) }()
			<-body.started
			if bearer {
				c.send("DELETE", "/me/app-passwords/"+keyID, nil, 200, nil)
			} else {
				c.send("POST", "/logout-all", nil, 200, nil)
			}
			body.Close()
			<-done
			if w.Code != 401 {
				t.Fatalf("revoked identity wrote transaction: %d %s", w.Code, w.Body.String())
			}
			var count int
			if err := a.DB.QueryRow("SELECT COUNT(*) FROM events").Scan(&count); err != nil || count != 0 {
				t.Fatal("revoked request changed data", count, err)
			}
		})
	}
}

type pausedWriter struct {
	header  http.Header
	started chan struct{}
	release chan struct{}
	once    sync.Once
}

func (w *pausedWriter) Header() http.Header { return w.header }
func (w *pausedWriter) WriteHeader(int)     {}
func (w *pausedWriter) Write(p []byte) (int, error) {
	w.once.Do(func() { close(w.started) })
	<-w.release
	return len(p), nil
}
func TestSlowResponseDoesNotBlockAPI(t *testing.T) {
	a, _, c := newTestApp(t)
	w := &pausedWriter{header: make(http.Header), started: make(chan struct{}), release: make(chan struct{})}
	done := make(chan struct{})
	go func() { defer close(done); a.Routes().ServeHTTP(w, browserTestRequest(c, "GET", "/api/me", nil)) }()
	defer func() { close(w.release); <-done }()
	<-w.started
	assertResponsive(t, a.Routes())
}
func TestRequestSpoolCleanupAndLimit(t *testing.T) {
	a, _, _ := newTestApp(t)
	dir := t.TempDir()
	t.Setenv("TMPDIR", dir)
	for _, size := range []int{256 << 10, 23 << 20} {
		source := strings.NewReader(strings.Repeat("x", size))
		req := httptest.NewRequest("POST", "/api/login", source)
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		a.Routes().ServeHTTP(w, req)
		want := 400
		if size > 22<<20 && source.Len() == 0 {
			t.Fatal("body limit did not stop reading")
		}
		if w.Code != want {
			t.Fatalf("size=%d status=%d", size, w.Code)
		}
		files, err := os.ReadDir(dir)
		if err != nil || len(files) != 0 {
			t.Fatal("request temp files leaked", files, err)
		}
	}
}
func TestScopedCategoriesThroughAPIAndMCP(t *testing.T) {
	_, _, c := newTestApp(t)
	ledger := c.personalLedger()
	allowed := c.account(ledger, "allowed", "bank", "KRW", "0")
	hidden := c.account(ledger, "hidden", "bank", "KRW", "0")
	for _, test := range []struct{ account, category string }{{allowed, "VISIBLE_LEGACY"}, {hidden, "PRIVATE_LEGACY"}} {
		input := txInput(test.account, "expense", "100")
		input.Category = test.category
		c.create(input)
	}
	c.send("POST", "/ledgers/"+ledger+"/categories", Category{Code: "common", Name: "Common setting", Kind: "expense"}, 200, nil)
	c.send("PATCH", "/admin/api-settings", map[string]bool{"enabled": true}, 200, nil)
	_, key := c.appPassword([]string{allowed}, []string{"read", "create", "update"}, "never")
	var categories []Category
	c.external(key, "GET", "/categories?account="+allowed+"&kind=expense", nil, 200, &categories)
	check := func(items []Category) {
		t.Helper()
		seen := map[string]bool{}
		for _, item := range items {
			seen[item.Code] = true
		}
		if seen["PRIVATE_LEGACY"] || !seen["VISIBLE_LEGACY"] || !seen["common"] || !seen["food"] {
			t.Fatal("incorrect category boundary", items)
		}
	}
	check(categories)
	session := connectTestMCP(t, c, key)
	var result struct{ Items []Category }
	mcpData(t, mcpCall(t, session, "list_categories", mcpCategory{Account: allowed, Kind: "expense"}, false), &result)
	check(result.Items)
	// Schema validation rejects the same incomplete input before the API call.
	tools, err := session.ListTools(context.Background(), &mcp.ListToolsParams{})
	if err != nil {
		t.Fatal(err)
	}
	for _, tool := range tools.Tools {
		if tool.Name != "create_transaction" && tool.Name != "update_transaction" {
			continue
		}
		raw, _ := json.Marshal(tool.InputSchema)
		var schema struct {
			Properties map[string]struct{ Required []string }
		}
		if err = json.Unmarshal(raw, &schema); err != nil {
			t.Fatal(err)
		}
		found := false
		for _, name := range schema.Properties["transaction"].Required {
			if name == "category" {
				found = true
			}
		}
		if !found {
			t.Fatal("MCP category is not required", string(raw))
		}
	}
	mcpCall(t, session, "create_transaction", map[string]any{"request_id": "missing-category", "transaction": map[string]string{"kind": "expense", "date": "2026-10-27", "time": "12:00", "amount": "100", "account_id": allowed, "title": "test"}}, true)
}
func TestCategoryAggregationDoesNotUseDelimitedKeys(t *testing.T) {
	_, _, c := newTestApp(t)
	ledger := c.personalLedger()
	account := c.account(ledger, "allowed", "bank", "KRW", "0")
	for _, item := range []struct{ code, name, amount string }{{"a|b", "c", "100"}, {"a", "b|c", "200"}} {
		c.send("POST", "/ledgers/"+ledger+"/categories", Category{Code: item.code, Name: item.name, Kind: "expense"}, 200, nil)
		input := txInput(account, "expense", item.amount)
		input.Category = item.code
		c.create(input)
	}
	report := c.report("")
	if len(report.Categories) != 2 || report.Totals[0].Expense != "300" {
		t.Fatal("categories merged", report.Categories)
	}
	for _, cat := range report.Categories {
		if cat.Category == "a|b" && (cat.Name != "c" || cat.Amount != "100") || cat.Category == "a" && (cat.Name != "b|c" || cat.Amount != "200") {
			t.Fatal(cat)
		}
	}
}

func TestSharingRevokedWhileReceivingWrite(t *testing.T) {
	a, _, owner := newTestApp(t)
	account := owner.account(owner.personalLedger(), "shared", "bank", "KRW", "0")
	invitation, token := owner.invite("account", account, "editor")
	other := owner.joinUser("shared_editor", token)
	owner.send("POST", "/invitations/"+invitation+"/approve", map[string]any{}, 200, nil)
	raw, _ := json.Marshal(txInput(account, "expense", "100"))
	body := newPausedBody(t, raw)
	req := browserTestRequest(other, "POST", "/api/transactions", body)
	w := httptest.NewRecorder()
	done := make(chan struct{})
	go func() { defer close(done); a.Routes().ServeHTTP(w, req) }()
	<-body.started
	owner.send("DELETE", "/sharing/account/"+account+"/"+other.user.ID, nil, 200, nil)
	body.Close()
	<-done
	if w.Code != 404 {
		t.Fatal("revoked sharing allowed a write", w.Code, w.Body.String())
	}
	if owner.balance(account) != "0" {
		t.Fatal("revoked sharing changed balance")
	}
}

type reviewTransport func(*http.Request) (*http.Response, error)

func (f reviewTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestSlowExchangeProviderDoesNotBlockAPI(t *testing.T) {
	a, _, c := newTestApp(t)
	saved := quoteClient
	started, release := make(chan struct{}), make(chan struct{})
	quoteClient = &http.Client{Transport: reviewTransport(func(r *http.Request) (*http.Response, error) {
		close(started)
		<-release
		return &http.Response{StatusCode: 200, Header: make(http.Header), Body: io.NopCloser(strings.NewReader(`{"date":"2026-10-27","base":"JPY","quote":"KWD","rate":0.002}`))}, nil
	})}
	quoteCache.Lock()
	delete(quoteCache.values, "JPYKWD")
	quoteCache.Unlock()
	done := make(chan struct{})
	go func() {
		defer close(done)
		a.Routes().ServeHTTP(httptest.NewRecorder(), browserTestRequest(c, "GET", "/api/me/exchange-quote?from=JPY&to=KWD", nil))
	}()
	defer func() { close(release); <-done; quoteClient = saved }()
	<-started
	assertResponsive(t, a.Routes())
}

// Bound query count independently of the number of accessible accounts.
type countedQueries struct {
	queryer
	reads int
}

func (q *countedQueries) Query(query string, args ...any) (*sql.Rows, error) {
	q.reads++
	return q.queryer.Query(query, args...)
}
func (q *countedQueries) QueryRow(query string, args ...any) *sql.Row {
	q.reads++
	return q.queryer.QueryRow(query, args...)
}
func TestAccountAuthorizationDoesNotCalculateEveryBalance(t *testing.T) {
	a, _, c := newTestApp(t)
	ledger := c.personalLedger()
	last := ""
	for i := 0; i < 12; i++ {
		last = c.account(ledger, "account", "bank", "KRW", "1000")
		c.create(txInput(last, "expense", "100"))
	}
	q := &countedQueries{queryer: a.DB}
	ac, err := a.account(q, &c.user, last)
	if err != nil || ac.ID != last || ac.Role != "owner" {
		t.Fatal(ac, err)
	}
	if q.reads > 1 {
		t.Fatal("single-account authorization scanned balances", q.reads)
	}
	q.reads = 0
	accounts, err := a.accounts(q, &c.user)
	if err != nil || len(accounts) != 12 {
		t.Fatal(accounts, err)
	}
	if q.reads > 2 {
		t.Fatal("account list uses per-account balance queries", q.reads)
	}
	for _, account := range accounts {
		if account.Balance != "900" {
			t.Fatal("aggregate balance changed", account)
		}
	}
}

func TestExhaustedAPIKeyDoesNotReceiveBody(t *testing.T) {
	a, _, c := newTestApp(t)
	account := c.account(c.personalLedger(), "allowed", "bank", "KRW", "0")
	c.send("PATCH", "/admin/api-settings", map[string]bool{"enabled": true}, 200, nil)
	keyID, key := c.appPassword([]string{account}, []string{"create"}, "never")
	a.rateMu.Lock()
	a.attempts["api-key:"+keyID] = attempt{Count: 120, Since: time.Now()}
	a.rateMu.Unlock()
	body := newPausedBody(t, []byte(`{}`))
	req := httptest.NewRequest("POST", "/api/v1/transactions", body)
	req.Header.Set("Authorization", "Bearer "+key)
	w := httptest.NewRecorder()
	done := make(chan struct{})
	go func() { defer close(done); a.Routes().ServeHTTP(w, req) }()
	select {
	case <-done:
		if w.Code != 429 {
			t.Fatal(w.Code, w.Body.String())
		}
	case <-body.started:
		body.Close()
		<-done
		t.Fatal("exhausted key consumed a slow body")
	case <-time.After(time.Second):
		t.Fatal("rate rejection stalled")
	}
}
