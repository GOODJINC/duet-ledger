package app

import (
	"encoding/json"
	"io"
	"math/big"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

type ExchangeRate struct {
	From string `json:"from"`
	To   string `json:"to"`
	Rate string `json:"rate"`
}

func parseRate(value string) (*big.Rat, error) {
	if !regexp.MustCompile(`^[0-9]{1,13}(\.[0-9]{1,12})?$`).MatchString(value) {
		return nil, bad("환율은 양수로, 소수점 12자리까지 입력해 주세요.")
	}
	r, ok := new(big.Rat).SetString(value)
	if !ok || r.Sign() <= 0 || r.Cmp(big.NewRat(1000000000000, 1)) > 0 {
		return nil, bad("환율 범위를 확인해 주세요.")
	}
	return r, nil
}
func roundMinor(amount string, fromScale, toScale int, rate *big.Rat) (string, error) {
	n, ok := new(big.Int).SetString(amount, 10)
	if !ok {
		return "", bad("금액을 확인해 주세요.")
	}
	negative := n.Sign() < 0
	n.Abs(n)
	num := new(big.Int).Mul(n, rate.Num())
	num.Mul(num, new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(toScale)), nil))
	den := new(big.Int).Mul(rate.Denom(), new(big.Int).Exp(big.NewInt(10), big.NewInt(int64(fromScale)), nil))
	q, rem := new(big.Int), new(big.Int)
	q.QuoRem(num, den, rem)
	if rem.Mul(rem, big.NewInt(2)).Cmp(den) >= 0 {
		q.Add(q, big.NewInt(1))
	}
	if negative {
		q.Neg(q)
	}
	if !q.IsInt64() || q.Cmp(big.NewInt(9000000000000000)) > 0 || q.Cmp(big.NewInt(-9000000000000000)) < 0 {
		return "", bad("환산 금액 범위를 초과해요.")
	}
	return q.String(), nil
}
func rateFactor(rates []ExchangeRate, from, to, base string) (*big.Rat, bool) {
	if from == to {
		return big.NewRat(1, 1), true
	}
	direct := func(f, t string) (*big.Rat, bool) {
		for _, v := range rates {
			if v.From == f && v.To == t {
				r, e := parseRate(v.Rate)
				return r, e == nil
			}
		}
		for _, v := range rates {
			if v.From == t && v.To == f {
				r, e := parseRate(v.Rate)
				if e == nil {
					return new(big.Rat).Inv(r), true
				}
			}
		}
		return nil, false
	}
	if r, ok := direct(from, to); ok {
		return r, true
	}
	for _, mid := range []string{base, "KRW", "USD", "EUR", "JPY", "GBP", "CNY", "TWD", "VND", "KWD"} {
		if mid == from || mid == to {
			continue
		}
		a, ok := direct(from, mid)
		b, ok2 := direct(mid, to)
		if ok && ok2 {
			return new(big.Rat).Mul(a, b), true
		}
	}
	return nil, false
}
func (a *App) exchangeRates(id string) ([]ExchangeRate, error) {
	rows, err := a.DB.Query("SELECT from_currency,to_currency,rate FROM exchange_rates WHERE user_id=? ORDER BY from_currency,to_currency", id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ExchangeRate{}
	for rows.Next() {
		var r ExchangeRate
		if err = rows.Scan(&r.From, &r.To, &r.Rate); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
func (a *App) saveExchangeRate(w http.ResponseWriter, r *http.Request, u *User) error {
	var v ExchangeRate
	if err := decode(r, &v); err != nil {
		return err
	}
	if _, ok := currencyScales[v.From]; !ok {
		return bad("보조 통화를 확인해 주세요.")
	}
	if _, ok := currencyScales[v.To]; !ok || v.From == v.To {
		return bad("서로 다른 통화를 선택해 주세요.")
	}
	if r.Method != "DELETE" {
		if _, err := parseRate(v.Rate); err != nil {
			return err
		}
	}
	tx, err := a.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec("DELETE FROM exchange_rates WHERE user_id=? AND ((from_currency=? AND to_currency=?) OR (from_currency=? AND to_currency=?))", u.ID, v.From, v.To, v.To, v.From); err != nil {
		return err
	}
	if r.Method != "DELETE" {
		if _, err = tx.Exec("INSERT INTO exchange_rates VALUES(?,?,?,?)", u.ID, v.From, v.To, v.Rate); err != nil {
			return err
		}
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}
func checkForeign(kind, currency, amount, foreign, original, rate string) error {
	if foreign == "" {
		if original != "" || rate != "" {
			return bad("외화 정보를 함께 입력해 주세요.")
		}
		return nil
	}
	scale, ok := currencyScales[foreign]
	if !ok || foreign == currency || kind == "transfer" || kind == "adjustment" {
		return bad("이 거래에는 해당 외화 금액을 사용할 수 없어요.")
	}
	if _, err := amountValue(original, false, 9000000000000); err != nil {
		return err
	}
	factor, err := parseRate(rate)
	if err != nil {
		return err
	}
	converted, err := roundMinor(original, scale, currencyScales[currency], factor)
	if err != nil {
		return err
	}
	n, err := amountValue(amount, true, 9000000000000)
	if err != nil {
		return err
	}
	if n < 0 {
		n = -n
	}
	if converted != strconv.FormatInt(n, 10) || n == 0 {
		return bad("원금액·환율과 계좌 반영 금액이 일치하지 않아요.")
	}
	return nil
}
func (a *App) convertReport(items []Transaction, u *User, target string) (TransactionPage, error) {
	scale, ok := currencyScales[target]
	if !ok {
		return TransactionPage{}, bad("조회 통화를 확인해 주세요.")
	}
	rates, err := a.exchangeRates(u.ID)
	if err != nil {
		return TransactionPage{}, err
	}
	projected := []Transaction{}
	absoluteTotal := new(big.Int)
	missing := map[string]bool{}
	for i := range items {
		v := items[i]
		v.Legs = append([]Leg(nil), v.Legs...)
		factor, found := rateFactor(rates, v.Currency, target, u.DefaultCurrency)
		if v.OriginalCurrency == target {
			factor = big.NewRat(1, 1)
			found = true
		}
		if !found {
			missing[v.Currency] = true
			continue
		}
		for j := range v.Legs {
			amount := v.Legs[j].Amount
			fromScale := v.Scale
			if v.OriginalCurrency == target {
				amount = v.OriginalAmount
				fromScale = scale
				if len(amount) > 0 && v.Legs[j].Amount[0] == '-' {
					amount = "-" + amount
				}
			}
			converted, e := roundMinor(amount, fromScale, scale, factor)
			if e != nil {
				return TransactionPage{}, e
			}
			n, _ := new(big.Int).SetString(converted, 10)
			absoluteTotal.Add(absoluteTotal, new(big.Int).Abs(n))
			if !absoluteTotal.IsInt64() {
				return TransactionPage{}, bad("환산 합계가 커요. 조회 기간을 좁혀 주세요.")
			}
			v.Legs[j].Amount = converted
			items[i].Legs[j].DisplayAmount = converted
		}
		v.Currency = target
		v.Scale = scale
		items[i].DisplayCurrency = target
		items[i].DisplayScale = &scale
		projected = append(projected, v)
	}
	out := summarize(projected)
	out.Count = len(items)
	out.Items = items
	out.MissingCurrencies = []string{}
	for c := range missing {
		out.MissingCurrencies = append(out.MissingCurrencies, c)
	}
	return out, nil
}

// Quotes contain only a currency pair. Never forward account or transaction data.
var quoteCache = struct {
	sync.Mutex
	values map[string]cachedQuote
}{values: make(map[string]cachedQuote)}

type cachedQuote struct {
	Value marketQuote
	Until time.Time
}
type marketQuote struct {
	Date  string      `json:"date"`
	Base  string      `json:"base"`
	Quote string      `json:"quote"`
	Rate  json.Number `json:"rate"`
}

var quoteClient = &http.Client{Timeout: 8 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }}

func (a *App) exchangeQuote(w http.ResponseWriter, r *http.Request, u *User) error {
	from, to := r.URL.Query().Get("from"), r.URL.Query().Get("to")
	if _, ok := currencyScales[from]; !ok {
		return bad("통화를 확인해 주세요.")
	}
	if _, ok := currencyScales[to]; !ok || from == to {
		return bad("서로 다른 통화를 선택해 주세요.")
	}
	key := from + to
	quoteCache.Lock()
	defer quoteCache.Unlock()
	if c, ok := quoteCache.values[key]; ok && time.Now().Before(c.Until) {
		writeMarketQuote(w, c.Value)
		return nil
	}
	req, err := http.NewRequestWithContext(r.Context(), "GET", "https://api.frankfurter.dev/v2/rate/"+strings.ToLower(from)+"/"+strings.ToLower(to), nil)
	if err != nil {
		return err
	}
	resp, err := quoteClient.Do(req)
	if err != nil {
		return bad("환율을 불러오지 못했어요. 직접 입력해 주세요.")
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return bad("제공되는 환율이 없어요. 직접 입력해 주세요.")
	}
	var v marketQuote
	decoder := json.NewDecoder(io.LimitReader(resp.Body, 4096))
	decoder.UseNumber()
	if err = decoder.Decode(&v); err != nil {
		return bad("환율 응답을 확인할 수 없어요.")
	}
	if strings.ToUpper(v.Base) != from || strings.ToUpper(v.Quote) != to {
		return bad("환율 통화가 일치하지 않아요.")
	}
	if _, err = time.Parse("2006-01-02", v.Date); err != nil {
		return bad("환율 기준일을 확인할 수 없어요.")
	}
	if _, err = parseRate(v.Rate.String()); err != nil {
		return bad("지원하는 환율 범위를 벗어나요. 직접 입력해 주세요.")
	}
	quoteCache.values[key] = cachedQuote{v, time.Now().Add(time.Hour)}
	writeMarketQuote(w, v)
	return nil
}

func writeMarketQuote(w http.ResponseWriter, v marketQuote) {
	writeJSON(w, 200, map[string]string{"date": v.Date, "base": v.Base, "quote": v.Quote, "rate": v.Rate.String(), "provider": "Frankfurter"})
}
