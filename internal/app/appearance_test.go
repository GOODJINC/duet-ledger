package app

import (
	"bytes"
	"io"
	"mime/multipart"
	"net/http"
	"strings"
	"testing"
)

func appearanceUpload(t *testing.T, c *testClient, kind, name string, data []byte, status int, csrf bool) {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", name)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = part.Write(data); err != nil {
		t.Fatal(err)
	}
	writer.Close()
	req, _ := http.NewRequest("PUT", c.server.URL+"/api/admin/appearance/"+kind, &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Origin", c.server.URL)
	if csrf {
		req.Header.Set("X-CSRF-Token", c.csrf)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != status {
		raw, _ := io.ReadAll(resp.Body)
		t.Fatalf("upload status %d want %d: %s", resp.StatusCode, status, raw)
	}
}
func TestGlobalAppearancePermissionsAndLargeFiles(t *testing.T) {
	_, server, admin := newTestApp(t)
	admin.send("PATCH", "/admin/settings", map[string]bool{"registration_open": true}, 200, nil)
	viewer := admin.joinUser("viewer", "")
	var initial ServerAppearance
	viewer.send("GET", "/appearance", nil, 200, &initial)
	if initial.CSS.Revision != "" {
		t.Fatal("unexpected default CSS")
	}
	anonymous := newTestClient(t, server)
	appearanceUpload(t, anonymous, "css", "test.css", []byte("body{color:red}"), 401, true)
	appearanceUpload(t, viewer, "css", "test.css", []byte("body{color:red}"), 403, true)
	appearanceUpload(t, admin, "css", "test.css", []byte("body{color:red}"), 403, false)
	// Exceeds the former CSS limit and the normal API request-body cap.
	css := []byte("/*" + strings.Repeat("a", 23<<20) + "*/\n.panel{border-radius:20px}")
	appearanceUpload(t, admin, "css", "shared.css", css, 200, true)
	var meta ServerAppearance
	viewer.send("GET", "/appearance", nil, 200, &meta)
	if meta.CSS.Name != "shared.css" || len(meta.CSS.Revision) != 64 {
		t.Fatal("global metadata unavailable")
	}
	req, _ := http.NewRequest("GET", server.URL+"/api/appearance/css", nil)
	resp, err := viewer.http.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 || !bytes.Equal(raw, css) || !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/css") {
		t.Fatal("global CSS content mismatch")
	}
	anonymous.send("GET", "/appearance/css", nil, 401, nil)
	appearanceUpload(t, admin, "css", "unsafe.css", []byte(`@import "https://example.com";`), 400, true)
	appearanceUpload(t, admin, "font", "bad.woff2", []byte("not a font"), 400, true)
	viewer.send("DELETE", "/admin/appearance/css", nil, 403, nil)
	var after ServerAppearance
	admin.send("GET", "/appearance", nil, 200, &after)
	if after.CSS.Revision != meta.CSS.Revision {
		t.Fatal("invalid update replaced shared CSS")
	}
	admin.send("DELETE", "/admin/appearance/css", nil, 200, nil)
	viewer.send("GET", "/appearance", nil, 200, &after)
	if after.CSS.Name != "" || after.CSS.Revision != "" {
		t.Fatal("global reset not visible")
	}
	viewer.send("GET", "/appearance/css", nil, 404, nil)
}
