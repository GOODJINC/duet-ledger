package app

import (
	"archive/zip"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

// Restore creates a new installation; it never replaces an existing dataset.
func Restore(archive, dataDir, keyFile string) error {
	abs, err := filepath.Abs(dataDir)
	if err != nil {
		return err
	}
	if entries, e := os.ReadDir(abs); e == nil && len(entries) > 0 {
		return fmt.Errorf("restore requires a new or empty data directory")
	} else if e != nil && !os.IsNotExist(e) {
		return e
	}
	key, err := os.ReadFile(keyFile)
	if err != nil {
		return err
	}
	if len(key) != 32 {
		return fmt.Errorf("master key must be 32 bytes")
	}
	z, err := zip.OpenReader(archive)
	if err != nil {
		return err
	}
	defer z.Close()
	var manifest struct {
		Format  string `json:"format"`
		Version int    `json:"version"`
		KeyHash string `json:"master_key_sha256"`
	}
	foundManifest, foundDB := false, false
	seen := map[string]bool{}
	var size uint64
	for _, f := range z.File {
		if seen[f.Name] || f.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("invalid archive entry")
		}
		seen[f.Name] = true
		allowed := f.Name == "manifest.json" || f.Name == "duet.sqlite" || strings.HasPrefix(f.Name, "receipts/") && strings.Count(f.Name, "/") == 1 && strings.HasSuffix(f.Name, ".jpg")
		if !allowed || strings.Contains(f.Name, "..") || strings.Contains(f.Name, "\\") {
			return fmt.Errorf("unsupported archive entry")
		}
		size += f.UncompressedSize64
		if size > 10<<30 {
			return fmt.Errorf("archive exceeds 10 GB restore limit")
		}
		if f.Name == "manifest.json" {
			if f.UncompressedSize64 > 65536 {
				return fmt.Errorf("invalid manifest")
			}
			r, e := f.Open()
			if e != nil {
				return e
			}
			e = json.NewDecoder(r).Decode(&manifest)
			r.Close()
			if e != nil {
				return e
			}
			foundManifest = true
		}
		if f.Name == "duet.sqlite" {
			foundDB = true
		}
	}
	if !foundManifest || !foundDB || manifest.Format != "duet-operational-backup" || manifest.Version != 1 || manifest.KeyHash != tokenHash(string(key)) {
		return fmt.Errorf("backup format or master key does not match")
	}
	parent := filepath.Dir(abs)
	if err = os.MkdirAll(parent, 0700); err != nil {
		return err
	}
	temp, err := os.MkdirTemp(parent, ".duet-restore-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(temp)
	for _, f := range z.File {
		target := filepath.Join(temp, filepath.FromSlash(f.Name))
		if err = os.MkdirAll(filepath.Dir(target), 0700); err != nil {
			return err
		}
		src, e := f.Open()
		if e != nil {
			return e
		}
		dst, e := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if e != nil {
			src.Close()
			return e
		}
		copied, copyErr := io.Copy(dst, io.LimitReader(src, int64(f.UncompressedSize64)+1))
		e = copyErr
		closeErr := dst.Close()
		src.Close()
		if e != nil {
			return e
		}
		if uint64(copied) != f.UncompressedSize64 {
			return fmt.Errorf("archive entry size mismatch")
		}
		if closeErr != nil {
			return closeErr
		}
	}
	if err = os.WriteFile(filepath.Join(temp, "master.key"), key, 0600); err != nil {
		return err
	}
	db, err := sql.Open("sqlite", filepath.Join(temp, "duet.sqlite"))
	if err != nil {
		return err
	}
	var check string
	err = db.QueryRow("PRAGMA integrity_check").Scan(&check)
	if err != nil || check != "ok" {
		db.Close()
		return fmt.Errorf("backup database integrity check failed")
	}
	rows, e := db.Query("PRAGMA foreign_key_check")
	if e != nil {
		db.Close()
		return e
	}
	invalid := rows.Next()
	rows.Close()
	if invalid {
		db.Close()
		return fmt.Errorf("backup database contains invalid references")
	}
	if _, err = db.Exec("DELETE FROM sessions; UPDATE invitations SET status='cancelled' WHERE status IN('open','pending'); PRAGMA journal_mode=DELETE;"); err != nil {
		db.Close()
		return err
	}
	var inviteTable int
	if err = db.QueryRow("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='account_invitations'").Scan(&inviteTable); err != nil {
		db.Close()
		return err
	}
	if inviteTable > 0 {
		if _, err = db.Exec("UPDATE account_invitations SET cancelled=1 WHERE claimant_id IS NULL"); err != nil {
			db.Close()
			return err
		}
	}
	if err = revokeAppPasswords(db, ""); err != nil {
		db.Close()
		return err
	}
	if err = db.Close(); err != nil {
		return err
	}
	return os.Rename(temp, abs)
}
func (a *App) ResetPassword(username, password string, disableTOTP bool) error {
	if utf8.RuneCountInString(password) < 8 || len(password) > 256 {
		return fmt.Errorf("password must be 8 characters to 256 bytes")
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	var id string
	if err := a.DB.QueryRow("SELECT id FROM users WHERE username=?", strings.ToLower(username)).Scan(&id); err != nil {
		return err
	}
	u, err := a.user(id)
	if err != nil {
		return err
	}
	tx, err := a.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec("UPDATE users SET password=? WHERE id=?", passwordHash(password), id); err != nil {
		return err
	}
	if disableTOTP {
		if _, err = tx.Exec("UPDATE users SET totp='',totp_pending='',recovery='[]',totp_counter=0 WHERE id=?", id); err != nil {
			return err
		}
	}
	if err = revokeAppPasswords(tx, id); err != nil {
		return err
	}
	if _, err = tx.Exec("DELETE FROM sessions WHERE user_id=?", id); err != nil {
		return err
	}
	if err = audit(tx, u, "server_password_reset", "user", id); err != nil {
		return err
	}
	return tx.Commit()
}
