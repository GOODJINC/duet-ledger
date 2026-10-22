package app

import "fmt"

// Each upgrade is atomic; version 1 data remains valid until commit.
func (a *App) migrate() error {
	var version int
	if err := a.DB.QueryRow("SELECT MAX(version) FROM schema_version").Scan(&version); err != nil {
		return err
	}
	if version > 2 {
		return fmt.Errorf("unsupported database version: %d", version)
	}
	if version == 2 {
		return nil
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
	return tx.Commit()
}
