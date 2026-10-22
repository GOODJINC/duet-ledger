package app

const schema = `
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY);
INSERT OR IGNORE INTO schema_version VALUES(1);
CREATE TABLE IF NOT EXISTS users(
 id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 name TEXT NOT NULL, password TEXT NOT NULL, admin INTEGER NOT NULL DEFAULT 0,
 locale TEXT NOT NULL DEFAULT 'ko', timezone TEXT NOT NULL DEFAULT 'Asia/Seoul',
 totp TEXT NOT NULL DEFAULT '', totp_pending TEXT NOT NULL DEFAULT '',
 totp_counter INTEGER NOT NULL DEFAULT 0, recovery TEXT NOT NULL DEFAULT '[]',
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions(
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 csrf TEXT NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS ledgers(
 id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN('personal','shared')),
 owner_id TEXT NOT NULL REFERENCES users(id), timezone TEXT NOT NULL DEFAULT 'Asia/Seoul',
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS members(
 ledger_id TEXT NOT NULL REFERENCES ledgers(id), user_id TEXT NOT NULL REFERENCES users(id),
 role TEXT NOT NULL CHECK(role IN('viewer','editor')), PRIMARY KEY(ledger_id,user_id)
);
CREATE TABLE IF NOT EXISTS accounts(
 id TEXT PRIMARY KEY, ledger_id TEXT NOT NULL REFERENCES ledgers(id), name TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN('cash','bank','card','loan')),
 currency TEXT NOT NULL, scale INTEGER NOT NULL CHECK(scale BETWEEN 0 AND 8),
 opening INTEGER NOT NULL DEFAULT 0 CHECK(opening BETWEEN -9000000000000000 AND 9000000000000000),
 archived INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS grants(
 account_id TEXT NOT NULL REFERENCES accounts(id), user_id TEXT NOT NULL REFERENCES users(id),
 role TEXT NOT NULL CHECK(role IN('viewer','editor')), PRIMARY KEY(account_id,user_id)
);
CREATE TABLE IF NOT EXISTS events(
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN('income','expense','transfer','adjustment','refund')),
 date TEXT NOT NULL, currency TEXT NOT NULL, scale INTEGER NOT NULL,
 creator_id TEXT NOT NULL REFERENCES users(id), version INTEGER NOT NULL DEFAULT 1,
 deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_date ON events(date,deleted_at);
CREATE TABLE IF NOT EXISTS postings(
 id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id), account_id TEXT NOT NULL REFERENCES accounts(id),
 amount INTEGER NOT NULL CHECK(amount BETWEEN -9000000000000 AND 9000000000000),
 title TEXT NOT NULL, category TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
 UNIQUE(event_id,account_id)
);
CREATE INDEX IF NOT EXISTS postings_account ON postings(account_id,event_id);
CREATE TABLE IF NOT EXISTS request_keys(
 user_id TEXT NOT NULL REFERENCES users(id), key TEXT NOT NULL, digest TEXT NOT NULL,
 event_id TEXT NOT NULL REFERENCES events(id), PRIMARY KEY(user_id,key)
);
CREATE TABLE IF NOT EXISTS invitations(
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, owner_id TEXT NOT NULL REFERENCES users(id),
 target_type TEXT NOT NULL CHECK(target_type IN('ledger','account')), target_id TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN('viewer','editor')), expires_at INTEGER NOT NULL,
 claimant_id TEXT REFERENCES users(id), status TEXT NOT NULL DEFAULT 'open'
 CHECK(status IN('open','pending','approved','cancelled')), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS receipts(
 id TEXT PRIMARY KEY, posting_id TEXT NOT NULL REFERENCES postings(id), filename TEXT NOT NULL,
 media_type TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL,
 deleted_at TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS receipts_posting ON receipts(posting_id);
CREATE TABLE IF NOT EXISTS audit(
 id TEXT PRIMARY KEY, actor_id TEXT NOT NULL REFERENCES users(id), action TEXT NOT NULL,
 target_type TEXT NOT NULL, target_id TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS imports(
 user_id TEXT NOT NULL REFERENCES users(id), digest TEXT NOT NULL,
 ledger_id TEXT NOT NULL REFERENCES ledgers(id), created_at TEXT NOT NULL,
 PRIMARY KEY(user_id,digest)
);
`
