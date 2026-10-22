package app

import "fmt"

// Each upgrade is atomic; version 1 data remains valid until commit.
func (a *App) migrate() error {
	var version int
	if err := a.DB.QueryRow("SELECT MAX(version) FROM schema_version").Scan(&version); err != nil {
		return err
	}
	if version > 4 {
		return fmt.Errorf("unsupported database version: %d", version)
	}
	if version == 4 {
		return nil
	}
	if version == 3 {
		tx, err := a.DB.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()
		if _, err = tx.Exec(`ALTER TABLE users ADD COLUMN default_currency TEXT NOT NULL DEFAULT 'KRW';
 ALTER TABLE postings ADD COLUMN category_label TEXT NOT NULL DEFAULT '';
 CREATE TABLE removed_categories(ledger_id TEXT NOT NULL REFERENCES ledgers(id),kind TEXT NOT NULL,code TEXT NOT NULL,PRIMARY KEY(ledger_id,kind,code));`); err != nil {
			return err
		}
		rows, err := tx.Query("SELECT ledger_id,kind,code FROM categories WHERE hidden=1")
		if err != nil {
			return err
		}
		var old [][3]string
		for rows.Next() {
			var v [3]string
			if err = rows.Scan(&v[0], &v[1], &v[2]); err != nil {
				rows.Close()
				return err
			}
			old = append(old, v)
		}
		if err = rows.Err(); err != nil {
			rows.Close()
			return err
		}
		rows.Close()
		for _, v := range old {
			if err = a.removeCategory(tx, v[0], v[1], v[2]); err != nil {
				return err
			}
		}
		if _, err = tx.Exec("INSERT INTO schema_version VALUES(4)"); err != nil {
			return err
		}
		return tx.Commit()
	}
	if version == 2 {
		tx, err := a.DB.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()
		if _, err = tx.Exec(`ALTER TABLE accounts ADD COLUMN deleted_at TEXT;
ALTER TABLE ledgers ADD COLUMN tagline TEXT NOT NULL DEFAULT '';
CREATE TABLE ledger_order(user_id TEXT NOT NULL REFERENCES users(id),ledger_id TEXT NOT NULL REFERENCES ledgers(id),position INTEGER NOT NULL,PRIMARY KEY(user_id,ledger_id));
CREATE TABLE category_order(ledger_id TEXT NOT NULL REFERENCES ledgers(id),kind TEXT NOT NULL,code TEXT NOT NULL,position INTEGER NOT NULL,PRIMARY KEY(ledger_id,kind,code));
INSERT INTO schema_version VALUES(3);`); err != nil {
			return err
		}
		if err = tx.Commit(); err != nil {
			return err
		}
		return a.migrate()
	}
	tx, err := a.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	_, err = tx.Exec(`
 ALTER TABLE ledgers ADD COLUMN deleted_at TEXT;
 ALTER TABLE users ADD COLUMN show_sidebar_message INTEGER NOT NULL DEFAULT 1;
 ALTER TABLE events ADD COLUMN time TEXT NOT NULL DEFAULT '';
 ALTER TABLE events ADD COLUMN timezone TEXT NOT NULL DEFAULT '';
 CREATE TABLE categories(ledger_id TEXT NOT NULL REFERENCES ledgers(id),kind TEXT NOT NULL CHECK(kind IN('income','expense')),code TEXT NOT NULL,name TEXT NOT NULL,hidden INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(ledger_id,kind,code));
 CREATE TABLE server_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 INSERT INTO server_settings VALUES('registration_open','false');
 CREATE TABLE account_invitations(id TEXT PRIMARY KEY,token_hash TEXT NOT NULL UNIQUE,creator_id TEXT NOT NULL REFERENCES users(id),expires_at INTEGER NOT NULL,claimant_id TEXT REFERENCES users(id),cancelled INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL);
 INSERT INTO schema_version VALUES(2);`)
	if err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	return a.migrate()
}
