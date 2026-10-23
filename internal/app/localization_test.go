package app

import (
	"bytes"
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"unicode"
)

func TestEnglishErrorsKeepCodesAndUserData(t *testing.T) {
	_, _, c := newTestApp(t)
	account := c.account(c.personalLedger(), "식비", "bank", "KRW", "0")
	c.send("PATCH", "/me", map[string]any{"name": "개인 이름", "locale": "en", "timezone": "Asia/Seoul"}, 200, &c.user)
	c.csrf = c.user.CSRF
	var result map[string]string
	c.send("POST", "/transactions", map[string]string{"account_id": account, "kind": "expense", "date": "2026-10-23", "title": "식비", "amount": "invalid"}, 400, &result)
	if result["error"] != "invalid" || strings.ContainsAny(result["message"], "금액") {
		t.Fatal(result)
	}
	var accounts []Account
	c.send("GET", "/accounts", nil, 200, &accounts)
	if len(accounts) != 1 || accounts[0].Name != "식비" || c.user.Name != "개인 이름" {
		t.Fatal("user data translated")
	}
	c.send("PATCH", "/admin/api-settings", map[string]bool{"enabled": true}, 200, nil)
	_, secret := c.appPassword([]string{account}, []string{"read"}, "never")
	req, _ := http.NewRequest("POST", c.server.URL+"/api/v1/transactions", bytes.NewBufferString(`{}`))
	req.Header.Set("Authorization", "Bearer "+secret)
	req.Header.Set("Accept-Language", "ko")
	resp, err := c.http.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	_ = json.NewDecoder(resp.Body).Decode(&result)
	if resp.StatusCode != 403 || result["message"] != "이 앱 비밀번호에 허용되지 않은 기능이에요." {
		t.Fatal("language override/status", result)
	}
}
func TestEnglishFirstAccountCreatesLocalizedPersonalLedger(t *testing.T) {
	a, err := New(Config{DataDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	defer a.Close()
	data, _ := json.Marshal(credentials{Username: "firstuser", Name: "나의 이름", Password: testPassword})
	req := httptest.NewRequest("POST", "/api/setup", bytes.NewReader(data))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept-Language", "en-US,en;q=0.9")
	response := httptest.NewRecorder()
	a.Routes().ServeHTTP(response, req)
	if response.Code != 201 {
		t.Fatal(response.Code, response.Body.String())
	}
	var user User
	_ = json.Unmarshal(response.Body.Bytes(), &user)
	if user.Locale != "en" || user.Name != "나의 이름" {
		t.Fatal("locale/user name", user)
	}
	var name string
	_ = a.DB.QueryRow("SELECT name FROM ledgers WHERE owner_id=?", user.ID).Scan(&name)
	if name != "My ledger" {
		t.Fatal(name)
	}
}

// Every Korean system literal must have an English catalog entry. This catches
// untranslated validation and security messages when new code is added.
func TestServerEnglishCatalogCoversSystemMessages(t *testing.T) {
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range files {
		if strings.HasSuffix(file, "_test.go") {
			continue
		}
		source, err := parser.ParseFile(token.NewFileSet(), file, nil, 0)
		if err != nil {
			t.Fatal(err)
		}
		ast.Inspect(source, func(node ast.Node) bool {
			literal, ok := node.(*ast.BasicLit)
			if !ok || literal.Kind != token.STRING {
				return true
			}
			text, err := strconv.Unquote(literal.Value)
			if err != nil {
				t.Fatal(err)
			}
			if strings.ContainsFunc(text, func(char rune) bool { return unicode.Is(unicode.Hangul, char) }) {
				if englishMessages[text] == "" {
					t.Errorf("Missing translation in %s: %s", file, text)
				}
			}
			return true
		})
	}
}
