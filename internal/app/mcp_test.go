package app

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/png"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type mcpBearerTransport struct{ secret string }

func (t mcpBearerTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Set("Authorization", "Bearer "+t.secret)
	return http.DefaultTransport.RoundTrip(r)
}
func connectTestMCP(t *testing.T, c *testClient, secret string) *mcp.ClientSession {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	session, err := mcp.NewClient(&mcp.Implementation{Name: "interop-test", Version: "1"}, nil).Connect(ctx, &mcp.StreamableClientTransport{Endpoint: c.server.URL + "/mcp", HTTPClient: &http.Client{Transport: mcpBearerTransport{secret}, Timeout: 10 * time.Second}, DisableStandaloneSSE: true, MaxRetries: -1}, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = session.Close() })
	return session
}
func mcpCall(t *testing.T, s *mcp.ClientSession, name string, args any, fail bool) *mcp.CallToolResult {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	result, err := s.CallTool(ctx, &mcp.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		if fail {
			return nil
		}
		t.Fatal(name, err)
	}
	if result.IsError != fail {
		t.Fatalf("%s: error=%v want %v: %+v", name, result.IsError, fail, result.Content)
	}
	return result
}
func mcpData(t *testing.T, result *mcp.CallToolResult, target any) {
	t.Helper()
	raw, _ := json.Marshal(result.StructuredContent)
	if err := json.Unmarshal(raw, target); err != nil {
		t.Fatal(err)
	}
}
func TestMCPHTTPInteropScopedCRUDAndReceipts(t *testing.T) {
	_, _, c := newTestApp(t)
	ledger := c.personalLedger()
	account := c.account(ledger, "대상", "bank", "KRW", "10000")
	hidden := c.account(ledger, "비밀", "cash", "KRW", "0")
	c.create(txInput(hidden, "expense", "999"))
	c.send("PATCH", "/admin/api-settings", map[string]bool{"enabled": true}, 200, nil)
	_, secret := c.appPassword([]string{account}, []string{"read", "create", "update", "delete", "receipts"}, "90d")
	session := connectTestMCP(t, c, secret)
	var contextData map[string]any
	mcpData(t, mcpCall(t, session, "get_context", mcpEmpty{}, false), &contextData)
	if contextData["current_datetime"] == nil || contextData["timezone"] != "Asia/Seoul" {
		t.Fatal("missing clock", contextData)
	}
	var accounts struct{ Items []Account }
	mcpData(t, mcpCall(t, session, "list_accounts", mcpEmpty{}, false), &accounts)
	if len(accounts.Items) != 1 || accounts.Items[0].ID != account {
		t.Fatal("scope leak")
	}
	input := mcpCreate{RequestID: "mcp-once", Transaction: mcpTransactionInput{Kind: "expense", Date: "2026-10-22", Time: "12:30", Amount: "500", AccountID: account, Title: "MCP 점심", Category: "food"}}
	var created map[string]any
	mcpData(t, mcpCall(t, session, "create_transaction", input, false), &created)
	id := created["id"].(string)
	var repeated map[string]any
	mcpData(t, mcpCall(t, session, "create_transaction", input, false), &repeated)
	if repeated["id"] != id {
		t.Fatal("duplicate created")
	}
	var tx Transaction
	mcpData(t, mcpCall(t, session, "get_transaction", mcpID{id}, false), &tx)
	input.Transaction.Amount = "600"
	mcpCall(t, session, "update_transaction", mcpUpdate{id, tx.Version, input.Transaction}, false)
	mcpCall(t, session, "update_transaction", mcpUpdate{id, tx.Version, input.Transaction}, true)
	mcpData(t, mcpCall(t, session, "get_transaction", mcpID{id}, false), &tx)
	var imageData bytes.Buffer
	_ = png.Encode(&imageData, image.NewRGBA(image.Rect(0, 0, 2, 2)))
	var receipt ReceiptRef
	mcpData(t, mcpCall(t, session, "attach_receipt", mcpAttachment{id, base64.StdEncoding.EncodeToString(imageData.Bytes())}, false), &receipt)
	picture := mcpCall(t, session, "get_receipt", mcpID{receipt.ID}, false)
	if _, ok := picture.Content[0].(*mcp.ImageContent); !ok {
		t.Fatal("not an image")
	}
	mcpCall(t, session, "delete_receipt", mcpID{receipt.ID}, false)
	mcpCall(t, session, "get_receipt", mcpID{receipt.ID}, true)
	mcpCall(t, session, "delete_transaction", mcpVersion{id, tx.Version}, false)
	mcpData(t, mcpCall(t, session, "get_transaction", mcpID{id}, false), &tx)
	if !tx.Deleted {
		t.Fatal("not in trash")
	}
	mcpCall(t, session, "restore_transaction", mcpVersion{id, tx.Version}, false)
	var report TransactionPage
	mcpData(t, mcpCall(t, session, "list_transactions", mcpQuery{From: "2026-10-22", To: "2026-10-22"}, false), &report)
	if report.Count != 1 || report.Totals[0].Expense != "600" {
		t.Fatal("report scope", report)
	}
	mcpCall(t, session, "get_statistics", mcpQuery{From: "2026-10-22", To: "2026-10-22"}, false)
	mcpCall(t, session, "list_categories", mcpCategory{account, "expense"}, false)
	input.RequestID = "forbidden"
	input.Transaction.AccountID = hidden
	mcpCall(t, session, "create_transaction", input, true)
	mcpCall(t, session, "get_transaction", mcpID{"../me"}, true)
	mcpCall(t, session, "create_transaction", map[string]any{"request_id": "missing-fields", "transaction": map[string]any{"kind": "expense"}}, true)
}
func TestMCPAuthToolIsolationAndRevocation(t *testing.T) {
	_, _, c := newTestApp(t)
	account := c.account(c.personalLedger(), "계좌", "bank", "KRW", "0")
	c.send("PATCH", "/admin/api-settings", map[string]bool{"enabled": true}, 200, nil)
	id, secret := c.appPassword([]string{account}, []string{"read"}, "never")
	read := connectTestMCP(t, c, secret)
	tools, err := read.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	for _, tool := range tools.Tools {
		if !tool.Annotations.ReadOnlyHint || strings.Contains(tool.Name, "create") {
			t.Fatal("write tool leaked")
		}
	}
	mcpCall(t, read, "create_transaction", mcpCreate{}, true)
	_, writeKey := c.appPassword([]string{account}, []string{"create"}, "never")
	write := connectTestMCP(t, c, writeKey)
	writeTools, err := write.ListTools(context.Background(), nil)
	if err != nil || len(writeTools.Tools) != 2 {
		t.Fatal("key toolset isolation", err)
	}
	c.send("PATCH", "/admin/api-settings", map[string]bool{"enabled": false}, 200, nil)
	if _, err = read.ListTools(context.Background(), nil); err == nil {
		t.Fatal("disabled key accepted")
	}
	c.send("PATCH", "/admin/api-settings", map[string]bool{"enabled": true}, 200, nil)
	read = connectTestMCP(t, c, secret)
	mcpCall(t, read, "list_accounts", mcpEmpty{}, false)
	c.send("DELETE", "/me/app-passwords/"+id, nil, 200, nil)
	if _, err = read.ListTools(context.Background(), nil); err == nil {
		t.Fatal("revoked key accepted in existing client")
	}
}
func TestMCPRejectsCookieCrossOriginAndOversizedBody(t *testing.T) {
	_, _, c := newTestApp(t)
	account := c.account(c.personalLedger(), "계좌", "cash", "KRW", "0")
	c.send("PATCH", "/admin/api-settings", map[string]bool{"enabled": true}, 200, nil)
	_, secret := c.appPassword([]string{account}, []string{"read"}, "never")
	for _, tc := range []struct {
		secret, origin, method, body string
		status                       int
	}{
		{"", "", "POST", `{}`, 401},
		{secret, "https://evil.example", "POST", `{}`, 403},
		{secret, "", "GET", "", 405},
		{secret, "", "DELETE", "", 405},
		{secret, "", "POST", strings.Repeat("x", (8<<20)+1), 413},
	} {
		req, _ := http.NewRequest(tc.method, c.server.URL+"/mcp", strings.NewReader(tc.body))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Accept", "application/json, text/event-stream")
		if tc.secret != "" {
			req.Header.Set("Authorization", "Bearer "+tc.secret)
		}
		if tc.origin != "" {
			req.Header.Set("Origin", tc.origin)
		}
		resp, err := c.http.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		data, _ := io.ReadAll(resp.Body)
		resp.Body.Close()
		if resp.StatusCode != tc.status {
			t.Fatalf("status %d want %d: %.100s", resp.StatusCode, tc.status, data)
		}
	}
}

func TestMCPRechecksSharedAccountAfterConnection(t *testing.T) {
	_, _, owner := newTestApp(t)
	account := owner.account(owner.personalLedger(), "공유 계좌", "bank", "KRW", "0")
	pid := owner.create(txInput(account, "expense", "10"))
	inv, token := owner.invite("account", account, "viewer")
	viewer := owner.joinUser("mcpguest", token)
	owner.send("POST", "/invitations/"+inv+"/approve", map[string]any{}, 200, nil)
	owner.send("PATCH", "/admin/api-settings", map[string]bool{"enabled": true}, 200, nil)
	_, secret := viewer.appPassword([]string{account}, []string{"read", "create", "update", "delete"}, "never")
	session := connectTestMCP(t, viewer, secret)
	mcpCall(t, session, "get_transaction", mcpID{pid}, false)
	mcpCall(t, session, "create_transaction", mcpCreate{"viewer-deny", mcpTransactionInput{Kind: "expense", Date: "2026-10-22", Time: "12:30", Amount: "1", AccountID: account, Title: "권한 없음"}}, true)
	owner.send("DELETE", "/sharing/account/"+account+"/"+viewer.user.ID, nil, 200, nil)
	mcpCall(t, session, "get_transaction", mcpID{pid}, true)
	var accounts struct{ Items []Account }
	mcpData(t, mcpCall(t, session, "list_accounts", mcpEmpty{}, false), &accounts)
	if len(accounts.Items) != 0 {
		t.Fatal("revoked account leaked")
	}
}
