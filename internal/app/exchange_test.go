package app

import (
	"io"
	"math/big"
	"net/http"
	"strings"
	"testing"
)

func TestExactExchangeRounding(t *testing.T) {
	for _, v := range []struct {
		amount     string
		from, to   int
		rate, want string
	}{{"2099", 2, 0, "1400", "29386"}, {"1", 2, 0, "1325.56", "13"}, {"-1", 0, 0, "0.5", "-1"}, {"1", 0, 2, "0.005", "1"}} {
		r, err := parseRate(v.rate)
		if err != nil {
			t.Fatal(err)
		}
		got, err := roundMinor(v.amount, v.from, v.to, r)
		if err != nil || got != v.want {
			t.Fatalf("conversion %s got %s want %s: %v", v.amount, got, v.want, err)
		}
	}
	for _, rate := range []string{"0", "-1", "1e3", "NaN", "0.0000000000001", "1000000000001"} {
		if _, err := parseRate(rate); err == nil {
			t.Fatalf("invalid rate accepted: %s", rate)
		}
	}
}
func TestForeignChargeAndMixedCurrencyReport(t *testing.T) {
	_, _, c := newTestApp(t)
	ledger := c.personalLedger()
	krw := c.account(ledger, "한국 카드", "card", "KRW", "0")
	usd := c.account(ledger, "달러 통장", "bank", "USD", "10000")
	c.send("PUT", "/me/exchange-rates", ExchangeRate{"USD", "KRW", "1400"}, 200, nil)
	in := txInput(krw, "expense", "28000")
	in.OriginalCurrency = "USD"
	in.OriginalAmount = "2000"
	in.ExchangeRate = "1400"
	pid := c.create(in)
	report := c.report("&display_currency=KRW")
	if report.Totals[0].Expense != "28000" || report.Items[0].OriginalAmount != "2000" || report.Items[0].ExchangeRate != "1400" || c.balance(krw) != "-28000" {
		t.Fatal("foreign snapshot or native balance incorrect")
	}
	in.Amount = "27999"
	c.send("POST", "/transactions", in, 400, nil)
	in.Amount = "28000"
	c.send("PUT", "/me/exchange-rates", ExchangeRate{"USD", "KRW", "1500"}, 200, nil)
	c.create(txInput(usd, "expense", "500"))
	report = c.report("&display_currency=KRW")
	if len(report.Items) != 2 || report.Totals[0].Expense != "35500" || report.Items[0].DisplayScale == nil || *report.Items[0].DisplayScale != 0 {
		t.Fatal("mixed currency report mismatch")
	}
	report = c.report("&display_currency=USD")
	if report.Totals[0].Expense != "2500" {
		t.Fatal("original USD snapshot not preserved in original currency report")
	}
	in.Version = 1
	in.Title = "ChatGPT"
	c.send("PUT", "/transactions/"+pid, in, 200, nil)
	if c.balance(krw) != "-28000" {
		t.Fatal("editing reapplied changed preset rate")
	}
	var data Export
	c.send("GET", "/export?format=json", nil, 200, &data)
	if data.Version != 2 {
		t.Fatal("FX JSON format must be versioned")
	}
	c.send("POST", "/import/json", map[string]any{"data": data}, 201, nil)
	found := 0
	for _, item := range c.report("").Items {
		if item.OriginalCurrency == "USD" {
			found++
			if item.OriginalAmount != "2000" || item.ExchangeRate != "1400" {
				t.Fatal("JSON migration lost FX metadata")
			}
		}
	}
	if found != 2 {
		t.Fatal("JSON did not reproduce foreign charge")
	}
	csv := string(c.send("GET", "/export?format=csv&from=1900-01-01&to=2100-12-31&ledger="+ledger, nil, 200, nil))
	if !strings.Contains(csv, "original_currency") || !strings.Contains(csv, "2000,1400") {
		t.Fatal("CSV omitted FX metadata")
	}
}
func TestMissingExchangeIsExplicitAndCannotRevealPrivateAccounts(t *testing.T) {
	_, _, c := newTestApp(t)
	ledger := c.personalLedger()
	private := c.account(ledger, "秘密", "bank", "EUR", "0")
	shared := c.account(ledger, "共有", "bank", "USD", "0")
	c.create(txInput(private, "expense", "100"))
	c.create(txInput(shared, "expense", "200"))
	inv, token := c.invite("account", shared, "viewer")
	other := c.joinUser("fxguest", token)
	c.send("POST", "/invitations/"+inv+"/approve", map[string]any{}, 200, nil)
	report := other.report("&display_currency=KRW")
	if report.Count != 1 || len(report.MissingCurrencies) != 1 || report.MissingCurrencies[0] != "USD" || len(report.Totals) != 0 {
		t.Fatal("missing rate silently included or private currency revealed")
	}
	other.send("PUT", "/me/exchange-rates", ExchangeRate{"USD", "KRW", "1400"}, 200, nil)
	if other.report("&display_currency=KRW").Totals[0].Expense != "2800" {
		t.Fatal("viewer conversion incorrect")
	}
	if len(c.report("&display_currency=KRW").MissingCurrencies) != 2 {
		t.Fatal("other user changed owner rates")
	}
	profile := map[string]any{"name": other.user.Name, "locale": "ko", "timezone": "Asia/Seoul", "default_account_id": shared}
	other.send("PATCH", "/me", profile, 400, nil)
	c.send("PATCH", "/me", map[string]any{"name": c.user.Name, "locale": "ko", "timezone": "Asia/Seoul", "default_account_id": shared}, 200, nil)
	var me User
	c.send("GET", "/me", nil, 200, &me)
	if me.DefaultAccountID != shared {
		t.Fatal("default account not stored")
	}
}
func TestConvertedTotalsRejectOverflow(t *testing.T) {
	a, _, c := newTestApp(t)
	c.send("PUT", "/me/exchange-rates", ExchangeRate{"USD", "KRW", "1000"}, 200, nil)
	items := []Transaction{}
	for i := 0; i < 2000; i++ {
		items = append(items, Transaction{Kind: "expense", Currency: "USD", Scale: 2, Date: "2026-10-23", Legs: []Leg{{Amount: "-900000000000000"}}})
	}
	if _, err := a.convertReport(items, &c.user, "KRW"); err == nil {
		t.Fatal("aggregate overflow was not rejected")
	}
	if _, err := roundMinor("9000000000000000", 0, 0, big.NewRat(1000000000000, 1)); err == nil {
		t.Fatal("individual conversion overflow accepted")
	}
}

// External requests are stubbed: these tests never contact a public API.
type quoteRoundTripper func(*http.Request) (*http.Response, error)

func (f quoteRoundTripper) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestMarketQuoteValidationCacheAndIsolation(t *testing.T) {
	_, server, c := newTestApp(t)
	old := quoteClient
	quoteCache.Lock()
	quoteCache.values = make(map[string]cachedQuote)
	quoteCache.Unlock()
	t.Cleanup(func() {
		quoteClient = old
		quoteCache.Lock()
		quoteCache.values = make(map[string]cachedQuote)
		quoteCache.Unlock()
	})
	calls := 0
	quoteClient = &http.Client{Transport: quoteRoundTripper(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.String() != "https://api.frankfurter.dev/v2/rate/usd/krw" || r.Header.Get("Cookie") != "" || r.Header.Get("Authorization") != "" {
			t.Errorf("unexpected quote request: %s", r.URL)
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"date":"2026-10-23","base":"USD","quote":"KRW","rate":1324.760000001}`))}, nil
	})}
	newTestClient(t, server).send("GET", "/me/exchange-quote?from=USD&to=KRW", nil, 401, nil)
	c.send("GET", "/me/exchange-quote?from=https://example.com&to=KRW", nil, 400, nil)
	c.send("GET", "/me/exchange-quote?from=USD&to=USD", nil, 400, nil)
	var result map[string]string
	c.send("GET", "/me/exchange-quote?from=USD&to=KRW", nil, 200, &result)
	c.send("GET", "/me/exchange-quote?from=USD&to=KRW", nil, 200, nil)
	if calls != 1 || result["rate"] != "1324.760000001" || result["date"] != "2026-10-23" {
		t.Fatal("quote decimal/cache mismatch", calls, result)
	}
	var me User
	c.send("GET", "/me", nil, 200, &me)
	if len(me.ExchangeRates) != 0 {
		t.Fatal("quote must not save automatically")
	}
}
func TestMarketQuoteRejectsBadProviderResponses(t *testing.T) {
	_, _, c := newTestApp(t)
	old := quoteClient
	t.Cleanup(func() { quoteClient = old })
	for _, body := range []string{`{"base":"USD","quote":"EUR","date":"2026-10-23","rate":1400}`, `{"base":"USD","quote":"KRW","date":"invalid","rate":1400}`, `{"base":"USD","quote":"KRW","date":"2026-10-23","rate":-1}`, `garbage`} {
		quoteCache.Lock()
		quoteCache.values = make(map[string]cachedQuote)
		quoteCache.Unlock()
		quoteClient = &http.Client{Transport: quoteRoundTripper(func(*http.Request) (*http.Response, error) {
			return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(body))}, nil
		})}
		c.send("GET", "/me/exchange-quote?from=USD&to=KRW", nil, 400, nil)
	}
}
