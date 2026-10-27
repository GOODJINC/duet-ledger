package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func policyRequest(t *testing.T, c *testClient, path string, payload any, wantAge int) map[string]json.RawMessage {
	t.Helper()
	raw, _ := json.Marshal(payload)
	req, _ := http.NewRequest("POST", c.server.URL+"/api"+path, bytes.NewReader(raw))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-CSRF-Token", c.csrf)
	response, err := c.http.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var data map[string]json.RawMessage
	if err = json.NewDecoder(response.Body).Decode(&data); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != 200 {
		t.Fatalf("%s: %d %s", path, response.StatusCode, data)
	}
	var session *http.Cookie
	for _, cookie := range response.Cookies() {
		if cookie.Name == "duet-ledger-session" {
			session = cookie
		}
	}
	if session == nil || session.MaxAge != wantAge {
		t.Fatalf("%s session policy changed: %+v want MaxAge=%d", path, session, wantAge)
	}
	if err = json.Unmarshal(data["csrf"], &c.csrf); err != nil {
		t.Fatal(err)
	}
	return data
}
func TestRememberChoiceSurvivesSecurityChanges(t *testing.T) {
	for _, remember := range []bool{false, true} {
		name := "session"
		if remember {
			name = "remembered"
		}
		t.Run(name, func(t *testing.T) {
			a, _, c := newTestApp(t)
			age := 0
			if remember {
				age = 30 * 86400
			}
			policyRequest(t, c, "/login", credentials{Username: c.user.Username, Password: testPassword, Remember: remember}, age)
			nextPassword := "new-security-password-123"
			policyRequest(t, c, "/security/password", map[string]string{"current": testPassword, "password": nextPassword}, age)
			var start map[string]string
			c.send("POST", "/security/totp/start", map[string]string{"password": nextPassword}, 200, &start)
			codes := policyRequest(t, c, "/security/totp/confirm", map[string]string{"code": totpCode(start["secret"], time.Now().Unix()/30)}, age)
			var recovery []string
			if err := json.Unmarshal(codes["recovery_codes"], &recovery); err != nil || len(recovery) == 0 {
				t.Fatal(err)
			}
			policyRequest(t, c, "/security/totp/disable", map[string]string{"password": nextPassword, "code": recovery[0]}, age)
			var csrf string
			var created, expires int64
			if err := a.DB.QueryRow("SELECT csrf,created_at,expires_at FROM sessions WHERE user_id=?", c.user.ID).Scan(&csrf, &created, &expires); err != nil {
				t.Fatal(err)
			}
			days := int64(7)
			if remember {
				days = 30
			}
			if expires-created != days*86400 {
				t.Fatal("server expiry changed", expires-created)
			}
		})
	}
}
func TestLegacySessionRotationPreservesExistingBehavior(t *testing.T) {
	a, _, c := newTestApp(t)
	// Legacy sessions did not record persistence. Keep their previous rotation
	// policy until a new login can record the user's actual choice.
	legacy := strings.TrimPrefix(c.csrf, "p.")
	if _, err := a.DB.Exec("UPDATE sessions SET csrf=? WHERE user_id=?", legacy, c.user.ID); err != nil {
		t.Fatal(err)
	}
	c.csrf = legacy
	policyRequest(t, c, "/security/password", map[string]string{"current": testPassword, "password": "new-legacy-password-123"}, 7*86400)
}
func TestLoginSuccessAndFailureIsolation(t *testing.T) {
	a, _, c := newTestApp(t)
	c.send("PATCH", "/admin/settings", map[string]bool{"registration_open": true}, 200, nil)
	other := c.joinUser("other_user", "")
	login := func(user, password, peer string) int {
		raw, _ := json.Marshal(credentials{Username: user, Password: password})
		req := httptest.NewRequest("POST", "/api/login", bytes.NewReader(raw))
		req.RemoteAddr = peer
		req.Header.Set("Content-Type", "application/json")
		w := httptest.NewRecorder()
		a.Routes().ServeHTTP(w, req)
		return w.Code
	}
	for i := 0; i < 35; i++ {
		if status := login(c.user.Username, testPassword, "192.0.2.1:1234"); status != 200 {
			t.Fatalf("success %d was throttled: %d", i, status)
		}
	}
	for i := 0; i < 30; i++ {
		if status := login(c.user.Username, "wrong", "192.0.2.1:1234"); status != 401 {
			t.Fatalf("failure %d status %d", i, status)
		}
	}
	if status := login(c.user.Username, testPassword, "192.0.2.2:1234"); status != 429 {
		t.Fatal("account limit bypassed by changing IP", status)
	}
	if status := login(other.user.Username, testPassword, "192.0.2.1:1234"); status != 200 {
		t.Fatal("unrelated account blocked", status)
	}
	// A broad password spray is still bounded even when it changes usernames.
	req := httptest.NewRequest("POST", "/api/login", nil)
	req.RemoteAddr = "192.0.2.3:1234"
	for i := 0; i < 300; i++ {
		a.loginFailed(req, "spray_user")
	}
	if a.loginAllowed(req, "another_user") {
		t.Fatal("aggregate source limit missing")
	}
}
func TestTrustedProxyIPValidation(t *testing.T) {
	proxies, err := parseTrustedProxies([]string{"127.0.0.1", "10.0.0.0/8", "::1/128"})
	if err != nil {
		t.Fatal(err)
	}
	a := &App{trustedProxies: proxies}
	for _, test := range []struct{ peer, forwarded, want string }{
		{"192.0.2.1:1234", "198.51.100.1", "192.0.2.1"},
		{"127.0.0.1:1234", "198.51.100.1", "198.51.100.1"},
		{"127.0.0.1:1234", "203.0.113.9, 198.51.100.1, 10.0.0.2", "198.51.100.1"},
		{"[::1]:1234", "2001:db8::1", "2001:db8::1"},
		{"127.0.0.1:1234", "invalid", "127.0.0.1"},
		{"127.0.0.1:1234", "", "127.0.0.1"},
	} {
		req := httptest.NewRequest("GET", "/", nil)
		req.RemoteAddr = test.peer
		req.Header.Set("X-Forwarded-For", test.forwarded)
		if got := a.clientIP(req); got != test.want {
			t.Fatalf("%+v got %q", test, got)
		}
	}
	duplicate := httptest.NewRequest("GET", "/", nil)
	duplicate.RemoteAddr = "127.0.0.1:1234"
	duplicate.Header.Add("X-Forwarded-For", "203.0.113.99")
	duplicate.Header.Add("X-Forwarded-For", "198.51.100.1")
	if got := a.clientIP(duplicate); got != "198.51.100.1" {
		t.Fatal("duplicate forwarded headers trusted a forged first value", got)
	}
	if _, err = parseTrustedProxies([]string{"not-a-proxy"}); err == nil {
		t.Fatal("invalid proxy accepted")
	}
}
func TestRateLimitsConcurrentAndExpire(t *testing.T) {
	a := &App{attempts: map[string]attempt{}}
	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); a.apiRate("key", 120) }()
	}
	wg.Wait()
	if a.attempts["key"].Count != 100 {
		t.Fatal("lost concurrent rate updates")
	}
	a.attempts["key"] = attempt{Since: time.Now().Add(-time.Minute), Count: 120}
	if !a.apiRate("key", 120) {
		t.Fatal("expired rate window did not reopen")
	}
}
