package app

import (
	"database/sql"
	"fmt"
	"time"
)

// Opening money becomes ordinary editable postings; accounts.opening is then
// zero so the balance is never counted twice. Keep the existing posting limit.
func recordOpeningBalance(q queryer, account, currency string, scale int, amount int64, created, owner, locale, zone string) error {
	if amount == 0 {
		return nil
	}
	loc, err := time.LoadLocation(zone)
	if err != nil {
		loc = time.UTC
		zone = "UTC"
	}
	stamp, err := time.Parse(time.RFC3339Nano, created)
	if err != nil {
		stamp, err = time.ParseInLocation("2006-01-02", created, loc)
	}
	if err != nil {
		return fmt.Errorf("opening account creation time: %w", err)
	}
	date, clock := stamp.In(loc).Format("2006-01-02"), stamp.In(loc).Format("15:04")
	kind := "income"
	if amount < 0 {
		kind = "expense"
	}
	label := localizeMessage(locale, "시작 잔액")
	for amount != 0 {
		delta := amount
		if delta > 9000000000000 {
			delta = 9000000000000
		}
		if delta < -9000000000000 {
			delta = -9000000000000
		}
		event := newID()
		if _, err = q.Exec("INSERT INTO events(id,kind,date,time,timezone,currency,scale,creator_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)", event, kind, date, clock, zone, currency, scale, owner, created, created); err != nil {
			return err
		}
		if _, err = q.Exec("INSERT INTO postings(id,event_id,account_id,amount,title,category,category_label,note) VALUES(?,?,?,?,?,'opening_balance',?,'')", newID(), event, account, delta, label, label); err != nil {
			return err
		}
		amount -= delta
	}
	return nil
}

func migrateOpeningBalances(tx *sql.Tx) error {
	rows, err := tx.Query("SELECT a.id,a.currency,a.scale,a.opening,a.created_at,l.owner_id,u.locale,u.timezone FROM accounts a JOIN ledgers l ON l.id=a.ledger_id JOIN users u ON u.id=l.owner_id WHERE a.opening!=0")
	if err != nil {
		return err
	}
	type opening struct {
		id, currency, created, owner, locale, zone string
		scale                                      int
		amount                                     int64
	}
	items := []opening{}
	for rows.Next() {
		var v opening
		if err = rows.Scan(&v.id, &v.currency, &v.scale, &v.amount, &v.created, &v.owner, &v.locale, &v.zone); err != nil {
			rows.Close()
			return err
		}
		items = append(items, v)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, v := range items {
		if err = recordOpeningBalance(tx, v.id, v.currency, v.scale, v.amount, v.created, v.owner, v.locale, v.zone); err != nil {
			return err
		}
		if _, err = tx.Exec("UPDATE accounts SET opening=0 WHERE id=?", v.id); err != nil {
			return err
		}
	}
	return nil
}
