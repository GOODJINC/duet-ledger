package app

import (
	"bytes"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func previewBackup(t *testing.T, c *testClient, name string, archive, key []byte, status int) restorePlan {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if name != "" {
		writer.WriteField("name", name)
	}
	for field, data := range map[string][]byte{"archive": archive, "key": key} {
		if data != nil {
			p, _ := writer.CreateFormFile(field, field)
			p.Write(data)
		}
	}
	writer.Close()
	req, _ := http.NewRequest("POST", c.server.URL+"/api/backups/restore/preview", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("X-CSRF-Token", c.csrf)
	req.Header.Set("Origin", c.server.URL)
	res, err := c.http.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if res.StatusCode != status {
		t.Fatalf("preview: %d want %d: %s", res.StatusCode, status, raw)
	}
	var plan restorePlan
	if status == 200 {
		if err = json.Unmarshal(raw, &plan); err != nil {
			t.Fatal(err)
		}
	}
	return plan
}
func makeBackup(c *testClient) string {
	var out map[string]string
	c.send("POST", "/backups", map[string]any{}, 201, &out)
	return out["name"]
}
func restoreConfirmation(token string) map[string]any {
	return map[string]any{"token": token, "password": testPassword, "confirm": true}
}
func countRows(t *testing.T, a *App, table string) int {
	t.Helper()
	var n int
	if err := a.DB.QueryRow("SELECT COUNT(*) FROM " + quoteSQLName(table)).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

func TestWebRestoreAtomicAndSessions(t *testing.T) {
	a, _, c := newTestApp(t)
	account := c.account(c.personalLedger(), "wallet", "bank", "KRW", "100")
	c.send("PATCH", "/admin/api-settings", map[string]bool{"enabled": true}, 200, nil)
	_, key := c.appPassword([]string{account}, []string{"read"}, "never")
	name := makeBackup(c)
	before := countRows(t, a, "events")
	c.create(txInput(account, "expense", "10"))
	plan := previewBackup(t, c, name, nil, nil, 200)
	if plan.Transactions != before || plan.Accounts != 1 || plan.Users != 1 {
		t.Fatalf("wrong preview: %+v", plan)
	}
	wrong := restoreConfirmation(plan.Token)
	wrong["password"] = "wrong"
	c.send("POST", "/backups/restore/confirm", wrong, 401, nil)
	if countRows(t, a, "events") != before+1 {
		t.Fatal("preview or failed password changed live data")
	}
	wrong = restoreConfirmation(plan.Token)
	wrong["confirm"] = false
	c.send("POST", "/backups/restore/confirm", wrong, 400, nil)
	var result map[string]string
	c.send("POST", "/backups/restore/confirm", restoreConfirmation(plan.Token), 200, &result)
	if countRows(t, a, "events") != before || countRows(t, a, "sessions") != 0 {
		t.Fatal("restore did not replace records and invalidate sessions")
	}
	if !strings.HasSuffix(result["backup"], "-before-restore.zip") {
		t.Fatal("rescue backup is not identifiable")
	}
	if _, err := os.Stat(filepath.Join(a.Config.DataDir, "backups", result["backup"])); err != nil {
		t.Fatal("missing automatic pre-restore backup", err)
	}
	var stored int
	if err := a.DB.QueryRow("SELECT COUNT(*) FROM api_credentials WHERE revoked_at IS NULL").Scan(&stored); err != nil || stored != 0 {
		t.Fatal("restored API keys remain usable", err)
	}
	c.external(key, "GET", "/accounts", nil, 401, nil)
	c.send("GET", "/me", nil, 401, nil)
	c.send("POST", "/login", credentials{Username: c.user.Username, Password: testPassword}, 200, &c.user)
	c.csrf = c.user.CSRF
	c.send("POST", "/backups/restore/confirm", restoreConfirmation(plan.Token), 409, nil)
	// The rescue archive is independently restorable and contains the later record.
	dir := filepath.Join(t.TempDir(), "rescue")
	if err := Restore(filepath.Join(a.Config.DataDir, "backups", result["backup"]), dir, filepath.Join(a.Config.DataDir, "master.key")); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", filepath.Join(dir, "duet.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var n int
	if err = db.QueryRow("SELECT COUNT(*) FROM events").Scan(&n); err != nil || n != before+1 {
		t.Fatal("rescue archive lost current records", n, err)
	}
}
func TestWebRestoreCrossServerKeyAndPhotos(t *testing.T) {
	source, _, s := newTestApp(t)
	account := s.account(s.personalLedger(), "source", "bank", "KRW", "0")
	event := s.create(txInput(account, "expense", "25"))
	var posting string
	if err := source.DB.QueryRow("SELECT id FROM postings WHERE id=?", event).Scan(&posting); err != nil {
		t.Fatal(err)
	}
	photo := []byte("test JPEG content")
	sum := sha256.Sum256(photo)
	filename := newID() + ".jpg"
	if err := os.WriteFile(filepath.Join(source.Config.DataDir, "receipts", filename), photo, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := source.DB.Exec("INSERT INTO receipts(id,posting_id,filename,media_type,size,sha256,created_at) VALUES(?,?,?,'image/jpeg',?,?,?)", newID(), posting, filename, len(photo), hex.EncodeToString(sum[:]), now()); err != nil {
		t.Fatal(err)
	}
	secret := "JBSWY3DPEHPK3PXP"
	if _, err := source.DB.Exec("UPDATE users SET totp=?,totp_pending=? WHERE id=?", source.encrypt(secret), source.encrypt(secret), s.user.ID); err != nil {
		t.Fatal(err)
	}
	name := makeBackup(s)
	archive, err := os.ReadFile(filepath.Join(source.Config.DataDir, "backups", name))
	if err != nil {
		t.Fatal(err)
	}
	a, _, c := newTestApp(t)
	originalKey := append([]byte(nil), a.master...)
	previewBackup(t, c, "", archive, nil, 400)
	previewBackup(t, c, "", archive, bytes.Repeat([]byte{1}, 32), 400)
	plan := previewBackup(t, c, "", archive, source.master, 200)
	if plan.Receipts != 1 {
		t.Fatal("photo absent from preview")
	}
	c.send("POST", "/backups/restore/confirm", restoreConfirmation(plan.Token), 200, nil)
	diskKey, _ := os.ReadFile(filepath.Join(a.Config.DataDir, "master.key"))
	if !bytes.Equal(diskKey, originalKey) {
		t.Fatal("installed key changed")
	}
	var cipher, pending string
	if err = a.DB.QueryRow("SELECT totp,totp_pending FROM users WHERE id=?", s.user.ID).Scan(&cipher, &pending); err != nil {
		t.Fatal(err)
	}
	for _, value := range []string{cipher, pending} {
		plain, e := a.decrypt(value)
		if e != nil || plain != secret {
			t.Fatal("2FA rewrapping failed", e)
		}
	}
	var restored string
	a.DB.QueryRow("SELECT filename FROM receipts").Scan(&restored)
	content, err := os.ReadFile(filepath.Join(a.Config.DataDir, "receipts", restored))
	if err != nil || !bytes.Equal(content, photo) || restored == filename {
		t.Fatal("photo not safely restored", err)
	}
	// A new backup must use the installed key and work with the CLI as well.
	a.mu.Lock()
	after, e := a.backup()
	a.mu.Unlock()
	if e != nil {
		t.Fatal(e)
	}
	if err = Restore(filepath.Join(a.Config.DataDir, "backups", after), filepath.Join(t.TempDir(), "again"), filepath.Join(a.Config.DataDir, "master.key")); err != nil {
		t.Fatal(err)
	}
}
func TestWebRestoreRollbackAndExpiredPreview(t *testing.T) {
	a, _, c := newTestApp(t)
	account := c.account(c.personalLedger(), "wallet", "cash", "KRW", "0")
	name := makeBackup(c)
	c.create(txInput(account, "income", "7"))
	before := countRows(t, a, "events")
	plan := previewBackup(t, c, name, nil, nil, 200)
	a.restorePlan.until = time.Now().Add(-time.Second)
	c.send("POST", "/backups/restore/confirm", restoreConfirmation(plan.Token), 409, nil)
	plan = previewBackup(t, c, name, nil, nil, 200)
	// Force a late copy failure after DELETE has already run in the transaction.
	db, err := sql.Open("sqlite", filepath.Join(a.restorePlan.dir, "data", "duet.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec("ALTER TABLE users RENAME TO missing_users")
	db.Close()
	if err != nil {
		t.Fatal(err)
	}
	c.send("POST", "/backups/restore/confirm", restoreConfirmation(plan.Token), 500, nil)
	if countRows(t, a, "events") != before || countRows(t, a, "users") != 1 || countRows(t, a, "sessions") != 1 {
		t.Fatal("failed restore did not roll back all live tables")
	}
	c.send("GET", "/accounts", nil, 200, nil)
	a.mu.Lock()
	_, err = a.backup()
	a.mu.Unlock()
	if err != nil {
		t.Fatal("failed restore left database unusable", err)
	}
}
func TestRestoreUploadAuthorizationAndSlowBody(t *testing.T) {
	a, server, c := newTestApp(t)
	req := httptest.NewRequest("POST", server.URL+"/api/backups/restore/preview", strings.NewReader("irrelevant"))
	req.Header.Set("Content-Type", "multipart/form-data; boundary=x")
	w := httptest.NewRecorder()
	a.Routes().ServeHTTP(w, req)
	if w.Code != 401 {
		t.Fatal("anonymous upload accepted", w.Code)
	}
	name := makeBackup(c)
	var valid bytes.Buffer
	writer := multipart.NewWriter(&valid)
	writer.SetBoundary("x")
	writer.WriteField("name", name)
	writer.Close()
	body := newPausedBody(t, valid.Bytes())
	req = browserTestRequest(c, "POST", "/api/backups/restore/preview", body)
	req.Header.Set("Content-Type", "multipart/form-data; boundary=x")
	done := make(chan struct{})
	response := httptest.NewRecorder()
	go func() { defer close(done); a.Routes().ServeHTTP(response, req) }()
	select {
	case <-body.started:
	case <-time.After(time.Second):
		t.Fatal("upload not started")
	}
	assertResponsive(t, a.Routes())
	a.mu.Lock()
	a.DB.Exec("DELETE FROM sessions")
	a.mu.Unlock()
	body.Close()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("upload did not stop")
	}
	if response.Code != 401 {
		t.Fatalf("revoked upload session was not rejected: %d %s", response.Code, response.Body.String())
	}
	if a.restorePlan != nil {
		t.Fatal("revoked session created a preview")
	}
	files, _ := filepath.Glob(filepath.Join(a.Config.DataDir, ".duet-restore-upload-*"))
	if len(files) != 0 {
		t.Fatal("upload staging not removed")
	}
}
func TestMasterKeyRequiresReauthentication(t *testing.T) {
	a, _, c := newTestApp(t)
	c.send("POST", "/backups/key", map[string]string{"password": "wrong"}, 401, nil)
	var result map[string]string
	c.send("POST", "/backups/key", map[string]string{"password": testPassword}, 200, &result)
	if result["key"] == "" || countRows(t, a, "audit") == 0 {
		t.Fatal("key download or audit missing")
	}
}

func TestWebRestoreRejectsNonAdminAndCSRF(t *testing.T) {
	a, _, c := newTestApp(t)
	account := c.account(c.personalLedger(), "wallet", "cash", "KRW", "0")
	_, token := c.invite("account", account, "viewer")
	viewer := c.joinUser("viewer", token)
	previewBackup(t, viewer, "duet-test.zip", nil, nil, 403)
	viewer.send("POST", "/backups/key", map[string]string{"password": testPassword}, 403, nil)
	viewer.send("POST", "/backups/restore/confirm", restoreConfirmation("unknown"), 403, nil)
	for _, path := range []string{"/api/backups/key", "/api/backups/restore/preview", "/api/backups/restore/confirm"} {
		r := browserTestRequest(c, "POST", path, strings.NewReader(`{}`))
		r.Header.Set("X-CSRF-Token", "wrong")
		w := httptest.NewRecorder()
		a.Routes().ServeHTTP(w, r)
		if w.Code != 403 {
			t.Fatal("CSRF not rejected", path, w.Code)
		}
	}
	a.mu.Lock()
	files, _ := filepath.Glob(filepath.Join(a.Config.DataDir, ".duet-restore-*-*"))
	a.mu.Unlock()
	if len(files) != 0 {
		t.Fatal("unauthorized requests used staging space")
	}
}
func TestWebRestoreRejectsCorruptPhotosAndExecutableSchema(t *testing.T) {
	for _, kind := range []string{"photo", "trigger"} {
		t.Run(kind, func(t *testing.T) {
			a, _, c := newTestApp(t)
			account := c.account(c.personalLedger(), "wallet", "cash", "KRW", "0")
			posting := c.create(txInput(account, "income", "3"))
			if kind == "trigger" {
				if _, err := a.DB.Exec("CREATE TRIGGER unexpected AFTER DELETE ON sessions BEGIN UPDATE users SET name='changed'; END"); err != nil {
					t.Fatal(err)
				}
			} else {
				filename := newID() + ".jpg"
				if err := os.WriteFile(filepath.Join(a.Config.DataDir, "receipts", filename), []byte("wrong"), 0600); err != nil {
					t.Fatal(err)
				}
				if _, err := a.DB.Exec("INSERT INTO receipts(id,posting_id,filename,media_type,size,sha256,created_at) VALUES(?,?,?,'image/jpeg',5,'bad-hash',?)", newID(), posting, filename, now()); err != nil {
					t.Fatal(err)
				}
			}
			name := makeBackup(c)
			previewBackup(t, c, name, nil, nil, 400)
			if countRows(t, a, "events") != 1 || a.restorePlan != nil {
				t.Fatal("invalid backup modified live data")
			}
		})
	}
}
func TestRestorePreviewBoundToSessionAndKeyRequiresTOTP(t *testing.T) {
	a, server, c := newTestApp(t)
	name := makeBackup(c)
	plan := previewBackup(t, c, name, nil, nil, 200)
	other := newTestClient(t, server)
	other.send("POST", "/login", credentials{Username: c.user.Username, Password: testPassword}, 200, &other.user)
	other.csrf = other.user.CSRF
	other.send("POST", "/backups/restore/confirm", restoreConfirmation(plan.Token), 409, nil)
	secret := "JBSWY3DPEHPK3PXP"
	if _, err := a.DB.Exec("UPDATE users SET totp=? WHERE id=?", a.encrypt(secret), c.user.ID); err != nil {
		t.Fatal(err)
	}
	c.send("POST", "/backups/key", map[string]string{"password": testPassword}, 401, nil)
	c.send("POST", "/backups/key", map[string]string{"password": testPassword, "code": totpCode(secret, time.Now().Unix()/30)}, 200, nil)
}

func TestWebRestoreRequiresSuccessfulRescueBackup(t *testing.T) {
	a, _, c := newTestApp(t)
	account := c.account(c.personalLedger(), "wallet", "bank", "KRW", "0")
	name := makeBackup(c)
	c.create(txInput(account, "income", "7"))
	plan := previewBackup(t, c, name, nil, nil, 200)
	backupDir := filepath.Join(a.Config.DataDir, "backups")
	if err := os.Rename(backupDir, backupDir+"-saved"); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(backupDir, []byte("simulate unavailable backup storage"), 0600); err != nil {
		t.Fatal(err)
	}
	c.send("POST", "/backups/restore/confirm", restoreConfirmation(plan.Token), 500, nil)
	if countRows(t, a, "events") != 1 || countRows(t, a, "sessions") != 1 {
		t.Fatal("restore ran despite failed rescue backup")
	}
	c.send("GET", "/accounts", nil, 200, nil)
}
