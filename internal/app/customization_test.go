package app

import (
	"bytes"
	"encoding/json"
	"image"
	"image/png"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"
)

func TestAccountTrashPreservesTransferAndRevokesReceipts(t *testing.T) {
	_, server, c := newTestApp(t)
	ledger := c.personalLedger()
	source := c.account(ledger, "삭제할 통장", "bank", "KRW", "100000")
	target := c.account(ledger, "받는 통장", "bank", "KRW", "0")
	transfer := txInput(source, "transfer", "30000")
	transfer.ToID = target
	c.create(transfer)
	pid := c.create(txInput(source, "expense", "10000"))
	inv, token := c.invite("account", source, "editor")
	other := c.joinUser("guest", token)
	c.send("POST", "/invitations/"+inv+"/approve", map[string]any{}, 200, nil)
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, _ := writer.CreateFormFile("file", "receipt.png")
	png.Encode(part, image.NewRGBA(image.Rect(0, 0, 4, 4)))
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
		t.Fatal("upload failed")
	}
	other.send("GET", "/receipts/"+ref.ID, nil, 200, nil)
	other.send("DELETE", "/accounts/"+source, map[string]any{"confirm_name": "삭제할 통장", "version": 1}, 403, nil)
	c.send("DELETE", "/accounts/"+source, map[string]any{"confirm_name": "wrong", "version": 1}, 400, nil)
	c.send("DELETE", "/accounts/"+source, map[string]any{"confirm_name": "삭제할 통장", "version": 99}, 409, nil)
	c.send("DELETE", "/accounts/"+source, map[string]any{"confirm_name": "삭제할 통장", "version": 1}, 200, nil)
	if other.report("").Count != 0 {
		t.Fatal("deleted account still visible")
	}
	other.send("GET", "/receipts/"+ref.ID, nil, 404, nil)
	c.send("GET", "/receipts/"+ref.ID, nil, 404, nil)
	report := c.report("")
	if len(report.Items) != 1 || report.Items[0].Kind != "transfer" || len(report.Items[0].Legs) != 1 || report.Items[0].CanEdit {
		t.Fatal("transfer counterpart lost or can overwrite hidden deleted side")
	}
	if c.balance(target) != "30000" {
		t.Fatal("deletion changed counterpart balance")
	}
	raw := other.send("GET", "/accounts/trash", nil, 200, nil)
	if string(bytes.TrimSpace(raw)) != "[]" {
		t.Fatal("non-owner sees account trash")
	}
	c.send("POST", "/transactions", txInput(source, "income", "1"), 404, nil)
	other.send("POST", "/accounts/"+source+"/restore", map[string]any{}, 404, nil)
	c.send("POST", "/accounts/"+source+"/restore", map[string]any{}, 200, nil)
	if c.balance(source) != "60000" || c.balance(target) != "30000" || other.report("").Count != 2 {
		t.Fatal("restore changed financial records or grants")
	}
	other.send("GET", "/receipts/"+ref.ID, nil, 200, nil)
}
func TestPersonalLedgerOrderAndTagline(t *testing.T) {
	_, _, c := newTestApp(t)
	one := c.personalLedger()
	two := c.ledger("공동", "shared")
	inv, token := c.invite("ledger", two, "editor")
	other := c.joinUser("orderguest", token)
	c.send("POST", "/invitations/"+inv+"/approve", map[string]any{}, 200, nil)
	c.send("PUT", "/ledgers/order", map[string]any{"ids": []string{two, one}}, 200, nil)
	var list []Ledger
	c.send("GET", "/ledgers", nil, 200, &list)
	if list[0].ID != two {
		t.Fatal("ledger order not saved")
	}
	other.send("PUT", "/ledgers/order", map[string]any{"ids": []string{one}}, 404, nil)
	other.send("PUT", "/ledgers/order", map[string]any{"ids": []string{two}}, 200, nil)
	c.send("GET", "/ledgers", nil, 200, &list)
	if list[0].ID != two {
		t.Fatal("other user's preference overwrote order")
	}
	c.send("PUT", "/ledgers/order", map[string]any{"ids": []string{one, one}}, 400, nil)
	other.send("PATCH", "/ledgers/"+two, map[string]string{"name": "공동", "timezone": "Asia/Seoul", "tagline": "no"}, 403, nil)
	c.send("PATCH", "/ledgers/"+two, map[string]string{"name": "공동", "timezone": "Asia/Seoul", "tagline": "우리 가족의 기록"}, 200, nil)
	c.send("GET", "/ledgers", nil, 200, &list)
	if list[0].Tagline != "우리 가족의 기록" {
		t.Fatal("tagline not saved")
	}
	c.send("PATCH", "/ledgers/"+two, map[string]string{"name": "공동", "timezone": "Asia/Seoul", "tagline": strings.Repeat("가", 121)}, 400, nil)
}
func TestCategoryOrderAndCancelledInviteVisibility(t *testing.T) {
	_, _, c := newTestApp(t)
	ledger := c.personalLedger()
	var list []Category
	c.send("GET", "/categories?ledger="+ledger+"&kind=expense&include_hidden=true", nil, 200, &list)
	codes := []string{}
	for i := len(list) - 1; i >= 0; i-- {
		codes = append(codes, list[i].Code)
	}
	c.send("PUT", "/ledgers/"+ledger+"/categories/order", map[string]any{"kind": "expense", "codes": codes}, 200, nil)
	c.send("GET", "/categories?ledger="+ledger+"&kind=expense", nil, 200, &list)
	if list[0].Code != codes[0] {
		t.Fatal("category order lost")
	}
	c.send("GET", "/categories?ledger="+ledger+"&kind=income", nil, 200, &list)
	if list[0].Code != "salary" {
		t.Fatal("income order was modified")
	}
	var invite map[string]any
	c.send("POST", "/admin/invitations", map[string]any{}, 201, &invite)
	c.send("POST", "/admin/invitations/"+invite["id"].(string)+"/cancel", map[string]any{}, 200, nil)
	raw := c.send("GET", "/admin/invitations", nil, 200, nil)
	if bytes.Contains(raw, []byte(invite["id"].(string))) {
		t.Fatal("cancelled invitation still visible")
	}
}
func TestRetiredKindsCannotBeCreatedButExistingDataSurvives(t *testing.T) {
	a, _, c := newTestApp(t)
	account := c.account(c.personalLedger(), "통장", "bank", "KRW", "1000")
	for _, kind := range []string{"refund", "adjustment"} {
		c.send("POST", "/transactions", txInput(account, kind, "100"), 400, nil)
	}
	tx, err := a.DB.Begin()
	if err != nil {
		t.Fatal(err)
	}
	pid, err := a.writeEvent(tx, &c.user, txInput(account, "refund", "100"), newID(), true)
	if err != nil {
		tx.Rollback()
		t.Fatal(err)
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	if c.balance(account) != "1100" {
		t.Fatal("legacy refund changed")
	}
	input := txInput(account, "refund", "150")
	input.Version = 1
	c.send("PUT", "/transactions/"+pid, input, 200, nil)
	if c.balance(account) != "1150" {
		t.Fatal("legacy refund edit changed semantics")
	}
	ordinary := c.create(txInput(account, "expense", "10"))
	input.Kind = "adjustment"
	c.send("PUT", "/transactions/"+ordinary, input, 400, nil)
}
