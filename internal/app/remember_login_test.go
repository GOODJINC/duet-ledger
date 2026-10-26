package app

import (
	"bytes"
	"encoding/json"
	"net/http"
	"testing"
	"time"
)

func TestRememberLoginExpiryAndRevocation(t *testing.T) {
	a, server, c := newTestApp(t)
	for _, remember := range []bool{false, true} {
		payload, _ := json.Marshal(credentials{Username: c.user.Username, Password: testPassword, Remember: remember})
		req, _ := http.NewRequest("POST", server.URL+"/api/login", bytes.NewReader(payload))
		req.Header.Set("Origin", server.URL)
		req.Header.Set("Content-Type", "application/json")
		response, err := c.http.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		var user User
		if err = json.NewDecoder(response.Body).Decode(&user); err != nil {
			t.Fatal(err)
		}
		response.Body.Close()
		if response.StatusCode != 200 {
			t.Fatal(response.StatusCode)
		}
		var session *http.Cookie
		for _, cookie := range response.Cookies() {
			if cookie.Name == "duet-ledger-session" {
				session = cookie
			}
		}
		if session == nil || !session.HttpOnly || session.SameSite != http.SameSiteStrictMode {
			t.Fatal("missing protected session cookie")
		}
		days, maxAge := 7, 0
		if remember {
			days, maxAge = 30, 30*24*60*60
		}
		if session.MaxAge != maxAge {
			t.Fatalf("remember=%v cookie age=%d", remember, session.MaxAge)
		}
		var expires int64
		if err = a.DB.QueryRow("SELECT expires_at FROM sessions WHERE token_hash=?", tokenHash(session.Value)).Scan(&expires); err != nil {
			t.Fatal(err)
		}
		remaining := expires - time.Now().Unix()
		if remaining < int64(days*86400-2) || remaining > int64(days*86400) {
			t.Fatal("server lifetime does not match choice", remember, remaining)
		}
		c.csrf = user.CSRF
		c.send("GET", "/me", nil, 200, nil)
		if remember {
			c.send("POST", "/logout-all", nil, 200, nil)
		} else {
			if _, err = a.DB.Exec("UPDATE sessions SET expires_at=? WHERE token_hash=?", time.Now().Unix()-1, tokenHash(session.Value)); err != nil {
				t.Fatal(err)
			}
		}
		c.send("GET", "/me", nil, 401, nil)
	}
}
