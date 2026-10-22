package app

import (
	"fmt"
	"os"
	"testing"
	"time"
)

func TestLargeDatasetPagination(t *testing.T) {
	if os.Getenv("DUET_LEDGER_LARGE_TEST") != "1" {
		t.Skip("set DUET_LEDGER_LARGE_TEST=1 to run the 100,000-record measurement")
	}
	a, _, c := newTestApp(t)
	account := c.account(c.personalLedger(), "대량 검증", "bank", "KRW", "100000000")
	tx, err := a.DB.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback()
	events, err := tx.Prepare("INSERT INTO events(id,kind,date,currency,scale,creator_id,created_at,updated_at) VALUES(?,'expense',?,'KRW',0,?,'2026-01-01','2026-01-01')")
	if err != nil {
		t.Fatal(err)
	}
	defer events.Close()
	postings, err := tx.Prepare("INSERT INTO postings VALUES(?,?,?,-100,'예시 지출','food','')")
	if err != nil {
		t.Fatal(err)
	}
	defer postings.Close()
	expected := 0
	for i := 0; i < 100000; i++ {
		id := fmt.Sprintf("bulk-%06d", i)
		month := i%12 + 1
		if month == 10 {
			expected++
		}
		date := fmt.Sprintf("2026-%02d-%02d", month, (i/12)%28+1)
		if _, err = events.Exec(id, date, c.user.ID); err != nil {
			t.Fatal(err)
		}
		if _, err = postings.Exec("p-"+id, id, account); err != nil {
			t.Fatal(err)
		}
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	start := time.Now()
	var result TransactionPage
	c.send("GET", "/transactions?from=2026-10-01&to=2026-10-31&page=2&page_size=50", nil, 200, &result)
	duration := time.Since(start)
	if result.Count != expected || len(result.Items) != 50 || result.Page != 2 || result.Totals[0].Expense != fmt.Sprint(expected*100) {
		t.Fatalf("large report totals/page mismatch: count=%d expected=%d", result.Count, expected)
	}
	if c.balance(account) != "90000000" {
		t.Fatal("large account balance mismatch")
	}
	t.Logf("100,000 stored records; October %d records; complete totals + page 2 HTTP response: %s", expected, duration)
}
