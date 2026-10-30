package app

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const restoreUploadLimit = 512 << 20

type restoreUpload struct{ dir, archive, key, name string }
type restoreUploadKey struct{}
type restorePlan struct {
	Token               string `json:"token"`
	Created             string `json:"created_at"`
	Users               int    `json:"users"`
	Accounts            int    `json:"accounts"`
	Transactions        int    `json:"transactions"`
	Receipts            int    `json:"receipts"`
	Expires             string `json:"expires_at"`
	owner, session, dir string
	until               time.Time
}

// A single bounded disk upload is received before the application lock. Only
// authenticated browser administrators with a valid CSRF token reach this code.
func (a *App) receiveRestore(w http.ResponseWriter, r *http.Request) (func(), error) {
	if r.ContentLength > restoreUploadLimit+65536 {
		return nil, &apiError{413, "request_too_large", "백업 ZIP은 512MB 이하, 키 파일은 32바이트여야 해요."}
	}
	if !a.restoreMu.TryLock() {
		return nil, conflict("다른 백업 작업이 진행 중이에요. 잠시 후 다시 시도해 주세요.")
	}
	dir, err := os.MkdirTemp(a.Config.DataDir, ".duet-restore-upload-")
	if err != nil {
		a.restoreMu.Unlock()
		return nil, err
	}
	cleanup := func() { os.RemoveAll(dir); a.restoreMu.Unlock() }
	fail := func(err error) (func(), error) { cleanup(); return nil, err }
	r.Body = http.MaxBytesReader(w, r.Body, restoreUploadLimit+65536)
	reader, err := r.MultipartReader()
	if err != nil {
		return fail(bad("백업 ZIP과 원래 키 파일을 확인해 주세요."))
	}
	upload := &restoreUpload{dir: dir}
	seen := map[string]bool{}
	for {
		part, e := reader.NextPart()
		if e == io.EOF {
			break
		}
		if e != nil {
			return fail(bad("백업 파일을 받지 못했어요. 웹 복원은 512MB까지 지원해요."))
		}
		name := part.FormName()
		if seen[name] || (name != "archive" && name != "key" && name != "name") {
			part.Close()
			return fail(bad("입력 형식을 확인해 주세요."))
		}
		seen[name] = true
		if name == "name" {
			b, e := io.ReadAll(io.LimitReader(part, 257))
			part.Close()
			if e != nil || len(b) > 256 {
				return fail(bad("입력 형식을 확인해 주세요."))
			}
			upload.name = string(b)
			continue
		}
		limit := int64(restoreUploadLimit)
		if name == "key" {
			limit = 32
		}
		path := filepath.Join(dir, name)
		f, e := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if e != nil {
			part.Close()
			return fail(e)
		}
		n, e := io.Copy(f, io.LimitReader(part, limit+1))
		closeErr := f.Close()
		part.Close()
		if e != nil || closeErr != nil || n > limit || (name == "key" && n != 32) {
			return fail(bad("백업 ZIP은 512MB 이하, 키 파일은 32바이트여야 해요."))
		}
		if name == "archive" {
			upload.archive = path
		} else {
			upload.key = path
		}
	}
	if (upload.archive == "") == (upload.name == "") {
		return fail(bad("복원할 백업을 하나 선택해 주세요."))
	}
	*r = *r.WithContext(context.WithValue(r.Context(), restoreUploadKey{}, upload))
	return cleanup, nil
}

func (a *App) clearRestorePlan() {
	if a.restorePlan != nil {
		os.RemoveAll(a.restorePlan.dir)
		a.restorePlan = nil
	}
}
func restoreSession(r *http.Request) string {
	c, err := r.Cookie("duet-ledger-session")
	if err != nil {
		return ""
	}
	return tokenHash(c.Value)
}
func (a *App) previewRestore(w http.ResponseWriter, r *http.Request, u *User) error {
	if !u.Admin {
		return forbidden()
	}
	upload, ok := r.Context().Value(restoreUploadKey{}).(*restoreUpload)
	if !ok {
		return bad("백업 ZIP과 원래 키 파일을 확인해 주세요.")
	}
	if a.restorePlan != nil && time.Now().Before(a.restorePlan.until) && (a.restorePlan.owner != u.ID || a.restorePlan.session != restoreSession(r)) {
		return conflict("다른 백업 작업이 진행 중이에요. 잠시 후 다시 시도해 주세요.")
	}
	a.clearRestorePlan()
	dir, err := os.MkdirTemp(a.Config.DataDir, ".duet-restore-preview-")
	if err != nil {
		return err
	}
	keep := false
	defer func() {
		if !keep {
			os.RemoveAll(dir)
		}
	}()
	archive := upload.archive
	if archive == "" {
		if upload.name != filepath.Base(upload.name) || !strings.HasPrefix(upload.name, "duet-") || !strings.HasSuffix(upload.name, ".zip") {
			return missing()
		}
		archive = filepath.Join(a.Config.DataDir, "backups", upload.name)
	}
	key := upload.key
	if key == "" {
		key = filepath.Join(dir, "source.key")
		if err = os.WriteFile(key, a.master, 0600); err != nil {
			return err
		}
	}
	target := filepath.Join(dir, "data")
	if err = Restore(archive, target, key); err != nil {
		return bad("백업 검증에 실패했어요. 백업 ZIP과 원래 키 파일을 확인해 주세요.")
	}
	staged, err := New(Config{DataDir: target})
	if err != nil {
		return bad("이 서버 버전에서 복원할 수 없는 백업이에요.")
	}
	defer staged.Close()
	tables, err := restoreTables(a.DB)
	if err != nil {
		return err
	}
	for _, table := range tables {
		live, e := restoreColumns(a.DB, table)
		if e != nil {
			return e
		}
		source, e := restoreColumns(staged.DB, table)
		if e != nil || live != source {
			return bad("지원하지 않는 백업 데이터 구조예요.")
		}
	}
	plan := &restorePlan{Token: newID(), owner: u.ID, session: restoreSession(r), dir: dir, until: time.Now().Add(10 * time.Minute)}
	plan.Expires = plan.until.UTC().Format(time.RFC3339)
	for table, dst := range map[string]*int{"users": &plan.Users, "accounts": &plan.Accounts, "events": &plan.Transactions, "receipts": &plan.Receipts} {
		if err = staged.DB.QueryRow("SELECT COUNT(*) FROM " + quoteSQLName(table)).Scan(dst); err != nil {
			return err
		}
	}
	var admins int
	if err = staged.DB.QueryRow("SELECT COUNT(*) FROM users WHERE admin=1").Scan(&admins); err != nil {
		return err
	}
	if admins == 0 {
		return bad("관리자 계정이 없는 백업은 웹에서 복원할 수 없어요.")
	}
	b, err := os.ReadFile(filepath.Join(target, "manifest.json"))
	if err != nil {
		return err
	}
	var manifest struct {
		Created string `json:"created_at"`
	}
	if err = json.Unmarshal(b, &manifest); err != nil {
		return err
	}
	plan.Created = manifest.Created
	// Keep the installed master.key unchanged. Rewrap only the staged TOTP secrets
	// with that key; a backup from another server therefore preserves 2FA as well.
	rows, err := staged.DB.Query("SELECT id,totp,totp_pending FROM users")
	if err != nil {
		return err
	}
	type secret struct{ id, totp, pending string }
	var secrets []secret
	for rows.Next() {
		var s secret
		if err = rows.Scan(&s.id, &s.totp, &s.pending); err != nil {
			rows.Close()
			return err
		}
		secrets = append(secrets, s)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, s := range secrets {
		values := []string{s.totp, s.pending}
		for i, value := range values {
			if value != "" {
				plain, e := staged.decrypt(value)
				if e != nil {
					return bad("백업의 인증 정보를 확인할 수 없어요.")
				}
				values[i] = a.encrypt(plain)
			}
		}
		if _, err = staged.DB.Exec("UPDATE users SET totp=?,totp_pending=? WHERE id=?", values[0], values[1], s.id); err != nil {
			return err
		}
	}
	// Validate every referenced photo and give it a fresh filename. Old and staged
	// photos can coexist until the database transaction commits, including crashes.
	rows, err = staged.DB.Query("SELECT DISTINCT filename,size,sha256 FROM receipts")
	if err != nil {
		return err
	}
	type photo struct {
		name, digest string
		size         int64
	}
	var photos []photo
	for rows.Next() {
		var p photo
		if err = rows.Scan(&p.name, &p.size, &p.digest); err != nil {
			rows.Close()
			return err
		}
		photos = append(photos, p)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, p := range photos {
		if filepath.Base(p.name) != p.name || !strings.HasSuffix(p.name, ".jpg") {
			return bad("백업의 영수증 파일을 확인해 주세요.")
		}
		old := filepath.Join(target, "receipts", p.name)
		f, e := os.Open(old)
		if e != nil {
			return bad("백업의 영수증 파일을 확인해 주세요.")
		}
		hash := sha256.New()
		n, e := io.Copy(hash, f)
		f.Close()
		if e != nil || n != p.size || hex.EncodeToString(hash.Sum(nil)) != p.digest {
			return bad("백업의 영수증 파일을 확인해 주세요.")
		}
		name := newID() + ".jpg"
		if err = os.Rename(old, filepath.Join(target, "receipts", name)); err != nil {
			return err
		}
		if _, err = staged.DB.Exec("UPDATE receipts SET filename=? WHERE filename=?", name, p.name); err != nil {
			return err
		}
	}
	if err = staged.Close(); err != nil {
		return err
	}
	a.restorePlan = plan
	keep = true
	writeJSON(w, 200, plan)
	return nil
}
func quoteSQLName(s string) string { return `"` + strings.ReplaceAll(s, `"`, `""`) + `"` }
func restoreTables(db *sql.DB) ([]string, error) {
	rows, err := db.Query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var names []string
	for rows.Next() {
		var name string
		if err = rows.Scan(&name); err != nil {
			return nil, err
		}
		names = append(names, name)
	}
	return names, rows.Err()
}
func restoreColumns(db *sql.DB, table string) (string, error) {
	rows, err := db.Query("PRAGMA table_info(" + quoteSQLName(table) + ")")
	if err != nil {
		return "", err
	}
	defer rows.Close()
	var names []string
	for rows.Next() {
		var index, notNull, pk int
		var name, typ string
		var def any
		if err = rows.Scan(&index, &name, &typ, &notNull, &def, &pk); err != nil {
			return "", err
		}
		names = append(names, quoteSQLName(name))
	}
	return strings.Join(names, ","), rows.Err()
}
func (a *App) confirmRestore(w http.ResponseWriter, r *http.Request, u *User) error {
	if !u.Admin {
		return forbidden()
	}
	if !a.restoreMu.TryLock() {
		return conflict("다른 백업 작업이 진행 중이에요. 잠시 후 다시 시도해 주세요.")
	}
	defer a.restoreMu.Unlock()
	if !a.rateAllowed(r, "backup-security:"+u.ID, 10) {
		return &apiError{429, "rate_limit", "잠시 후 다시 시도해 주세요."}
	}
	var v struct {
		Token    string `json:"token"`
		Password string `json:"password"`
		Code     string `json:"code"`
		Confirm  bool   `json:"confirm"`
	}
	if err := decode(r, &v); err != nil {
		return err
	}
	plan := a.restorePlan
	if plan == nil || !secureEqual(v.Token, plan.Token) || plan.owner != u.ID || plan.session != restoreSession(r) || time.Now().After(plan.until) {
		return conflict("복원 확인 시간이 지났어요. 백업을 다시 확인해 주세요.")
	}
	if !v.Confirm {
		return bad("모든 사용자 자료가 백업 시점으로 바뀌는지 확인해 주세요.")
	}
	if err := a.reauth(u, v.Password, v.Code); err != nil {
		return err
	}
	backup, err := a.backupArchive(true)
	if err != nil {
		log.Printf("pre-restore backup failed: %v", err)
		return &apiError{500, "backup_failed", "현재 자료 백업에 실패해 복원하지 않았어요. 저장 공간과 권한을 확인해 주세요."}
	}
	if err = a.applyRestore(plan); err != nil {
		return err
	}
	a.clearRestorePlan()
	a.setCookie(w, "", -1)
	writeJSON(w, 200, map[string]string{"backup": backup})
	return nil
}

// The live schema and master key never change. Only data is replaced, inside
// one SQLite transaction; any failure leaves all live rows and photos intact.
func (a *App) applyRestore(plan *restorePlan) error {
	tables, err := restoreTables(a.DB)
	if err != nil {
		return err
	}
	columns := map[string]string{}
	for _, table := range tables {
		columns[table], err = restoreColumns(a.DB, table)
		if err != nil {
			return err
		}
	}
	source := url.URL{Scheme: "file", Path: filepath.Join(plan.dir, "data", "duet.sqlite")}
	if _, err = a.DB.Exec("ATTACH DATABASE ? AS restore_source", source.String()+"?mode=ro"); err != nil {
		return err
	}
	defer a.DB.Exec("DETACH DATABASE restore_source")
	// Only files referenced by the old database are eligible for cleanup.
	oldRows, err := a.DB.Query("SELECT DISTINCT filename FROM receipts")
	if err != nil {
		return err
	}
	var oldFiles []string
	for oldRows.Next() {
		var name string
		if err = oldRows.Scan(&name); err != nil {
			oldRows.Close()
			return err
		}
		if name == filepath.Base(name) {
			oldFiles = append(oldFiles, name)
		}
	}
	err = oldRows.Err()
	oldRows.Close()
	if err != nil {
		return err
	}
	var installed []string
	committed := false
	defer func() {
		if !committed {
			for _, path := range installed {
				os.Remove(path)
			}
		}
	}()
	photos, err := os.ReadDir(filepath.Join(plan.dir, "data", "receipts"))
	if err != nil {
		return err
	}
	for _, photo := range photos {
		src := filepath.Join(plan.dir, "data", "receipts", photo.Name())
		dst := filepath.Join(a.Config.DataDir, "receipts", photo.Name())
		// Hard links are atomic and refuse collisions. Both directories are on the
		// same data volume; fsync the files and directory before committing references.
		if err = os.Link(src, dst); err != nil {
			return err
		}
		installed = append(installed, dst)
		f, e := os.Open(dst)
		if e != nil {
			return e
		}
		e = f.Sync()
		f.Close()
		if e != nil {
			return e
		}
	}
	dir, err := os.Open(filepath.Join(a.Config.DataDir, "receipts"))
	if err != nil {
		return err
	}
	err = dir.Sync()
	dir.Close()
	if err != nil {
		return err
	}
	tx, err := a.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec("PRAGMA defer_foreign_keys=ON"); err != nil {
		return err
	}
	for _, table := range tables {
		if _, err = tx.Exec("DELETE FROM " + quoteSQLName(table)); err != nil {
			return err
		}
	}
	for _, table := range tables {
		q := quoteSQLName(table)
		cols := columns[table]
		if _, err = tx.Exec("INSERT INTO main." + q + " (" + cols + ") SELECT " + cols + " FROM restore_source." + q); err != nil {
			return err
		}
	}
	if _, err = tx.Exec("INSERT INTO server_settings(key,value) VALUES('data_generation',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", newID()); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	committed = true
	// Open downloads keep their file descriptors on Unix even after unlinking.
	// A crash here may leave unreferenced photos, never missing live references.
	for _, name := range oldFiles {
		if e := os.Remove(filepath.Join(a.Config.DataDir, "receipts", name)); e != nil && !os.IsNotExist(e) {
			log.Printf("restore photo cleanup: %v", e)
		}
	}
	return nil
}
func (a *App) downloadMasterKey(w http.ResponseWriter, r *http.Request, u *User) error {
	if !u.Admin {
		return forbidden()
	}
	if !a.rateAllowed(r, "backup-security:"+u.ID, 10) {
		return &apiError{429, "rate_limit", "잠시 후 다시 시도해 주세요."}
	}
	var v struct {
		Password string `json:"password"`
		Code     string `json:"code"`
	}
	if err := decode(r, &v); err != nil {
		return err
	}
	if err := a.reauth(u, v.Password, v.Code); err != nil {
		return err
	}
	if err := audit(a.DB, u, "master_key_downloaded", "server", ""); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]string{"key": base64.StdEncoding.EncodeToString(a.master)})
	return nil
}
