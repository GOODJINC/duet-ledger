package app

import (
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"time"
)

func parseTrustedProxies(values []string) ([]netip.Prefix, error) {
	var out []netip.Prefix
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		prefix, err := netip.ParsePrefix(value)
		if err != nil {
			addr, e := netip.ParseAddr(value)
			if e != nil {
				return nil, fmt.Errorf("invalid trusted proxy address: %q", value)
			}
			addr = addr.Unmap()
			prefix = netip.PrefixFrom(addr, addr.BitLen())
		}
		out = append(out, prefix)
	}
	return out, nil
}
func (a *App) trustedProxy(addr netip.Addr) bool {
	for _, prefix := range a.trustedProxies {
		if prefix.Contains(addr) {
			return true
		}
	}
	return false
}
func (a *App) clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	peer, err := netip.ParseAddr(host)
	if err != nil {
		return host
	}
	peer = peer.Unmap()
	if !a.trustedProxy(peer) {
		return peer.String()
	}
	chain := strings.Split(strings.Join(r.Header.Values("X-Forwarded-For"), ","), ",")
	if len(chain) > 32 {
		return peer.String()
	}
	// Walk from the connection toward the client. A forged left-hand value is
	// ignored as soon as the first untrusted hop is reached.
	current := peer
	for i := len(chain) - 1; i >= 0; i-- {
		if !a.trustedProxy(current) {
			break
		}
		next, err := netip.ParseAddr(strings.TrimSpace(chain[i]))
		if err != nil {
			return peer.String()
		}
		current = next.Unmap()
	}
	return current.String()
}

func (a *App) pruneAttempts(t time.Time) bool {
	if len(a.attempts) <= 10000 {
		return true
	}
	for key, value := range a.attempts {
		if t.Sub(value.Since) >= 10*time.Minute {
			delete(a.attempts, key)
		}
	}
	return len(a.attempts) <= 10000
}

func (a *App) takeRate(key string, limit int, window time.Duration) bool {
	a.rateMu.Lock()
	defer a.rateMu.Unlock()
	t := time.Now()
	if !a.pruneAttempts(t) {
		return false
	}
	v := a.attempts[key]
	if t.Sub(v.Since) >= window {
		v = attempt{Since: t}
	}
	v.Count++
	a.attempts[key] = v
	return v.Count <= limit
}
func (a *App) rateAllowed(r *http.Request, key string, limit int) bool {
	return a.takeRate(key+":"+a.clientIP(r), limit, 10*time.Minute)
}
func (a *App) apiRate(key string, limit int) bool {
	return a.takeRate(key, limit, time.Minute)
}
func (a *App) loginKeys(r *http.Request, username string) []string {
	ip := a.clientIP(r)
	account := tokenHash(strings.ToLower(strings.TrimSpace(username)))
	return []string{"login-client:" + ip + ":" + account, "login-account:" + account, "login-ip:" + ip}
}
func (a *App) loginAllowed(r *http.Request, username string) bool {
	a.rateMu.Lock()
	defer a.rateMu.Unlock()
	t := time.Now()
	if !a.pruneAttempts(t) {
		return false
	}
	limits := []int{30, 30, 300}
	for i, key := range a.loginKeys(r, username) {
		v := a.attempts[key]
		if t.Sub(v.Since) < 10*time.Minute && v.Count >= limits[i] {
			return false
		}
	}
	return true
}
func (a *App) loginFailed(r *http.Request, username string) {
	for _, key := range a.loginKeys(r, username) {
		a.takeRate(key, 300, 10*time.Minute)
	}
}
func (a *App) loginSucceeded(r *http.Request, username string) {
	a.rateMu.Lock()
	defer a.rateMu.Unlock()
	keys := a.loginKeys(r, username)
	delete(a.attempts, keys[0])
	delete(a.attempts, keys[1])
}
