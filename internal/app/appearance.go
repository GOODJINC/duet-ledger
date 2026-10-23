package app

import (
	"crypto/sha256"
	"database/sql"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"regexp"
	"strings"
	"unicode/utf8"
)

type AppearanceAsset struct {
	Name     string `json:"name"`
	Revision string `json:"revision"`
}
type ServerAppearance struct {
	CSS  AppearanceAsset `json:"css"`
	Font AppearanceAsset `json:"font"`
}

func (a *App) appearanceSetting(key string) (string, error) {
	var v string
	err := a.DB.QueryRow("SELECT value FROM server_settings WHERE key=?", key).Scan(&v)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return v, err
}
func (a *App) serverAppearance(w http.ResponseWriter, r *http.Request, u *User) error {
	var out ServerAppearance
	for kind, asset := range map[string]*AppearanceAsset{"css": &out.CSS, "font": &out.Font} {
		var err error
		asset.Name, err = a.appearanceSetting("appearance_" + kind + "_name")
		if err != nil {
			return err
		}
		asset.Revision, err = a.appearanceSetting("appearance_" + kind + "_revision")
		if err != nil {
			return err
		}
	}
	writeJSON(w, 200, out)
	return nil
}
func (a *App) appearanceAsset(w http.ResponseWriter, r *http.Request, u *User) error {
	kind := r.PathValue("kind")
	if kind != "css" && kind != "font" {
		return missing()
	}
	var data []byte
	err := a.DB.QueryRow("SELECT value FROM server_settings WHERE key=?", "appearance_"+kind+"_data").Scan(&data)
	if err == sql.ErrNoRows {
		return missing()
	}
	if err != nil {
		return err
	}
	mime := "text/css; charset=utf-8"
	if kind == "font" {
		mime = "font/woff2"
	}
	w.Header().Set("Content-Type", mime)
	w.Header().Set("Content-Security-Policy", "default-src 'none'; sandbox")
	w.WriteHeader(200)
	_, err = w.Write(data)
	return err
}

var cssComments = regexp.MustCompile(`/\*[\s\S]*?\*/`)
var blockedCSS = regexp.MustCompile(`(?i)[\\<>\x00]|url\s*\(|@import|@namespace|@document|@font-face|image\s*\(|image-set\s*\(|expression\s*\(|-moz-binding|behavior\s*:`)

func validateServerCSS(data []byte) error {
	if !utf8.Valid(data) || blockedCSS.MatchString(cssComments.ReplaceAllString(string(data), "")) {
		return bad("CSS에 외부 주소·글꼴 선언·이스케이프 문자를 사용할 수 없어요.")
	}
	return nil
}
func validateServerFont(data []byte) error {
	if len(data) < 48 || string(data[:4]) != "wOF2" || uint64(binary.BigEndian.Uint32(data[8:12])) != uint64(len(data)) {
		return bad("올바른 WOFF2 글꼴을 선택해 주세요.")
	}
	return nil
}
func (a *App) updateAppearanceAsset(w http.ResponseWriter, r *http.Request, u *User) error {
	if !u.Admin {
		return forbidden()
	}
	kind := r.PathValue("kind")
	if kind != "css" && kind != "font" {
		return missing()
	}
	var data []byte
	name := ""
	if r.Method != "DELETE" {
		reader, err := r.MultipartReader()
		if err != nil {
			return bad("파일 첨부 형식을 확인해 주세요.")
		}
		part, err := reader.NextPart()
		if err != nil {
			return bad("파일을 선택해 주세요.")
		}
		defer part.Close()
		if part.FormName() != "file" || part.FileName() == "" {
			return bad("파일을 선택해 주세요.")
		}
		name = filepath.Base(strings.ReplaceAll(part.FileName(), "\\", "/"))
		if len(name) > 255 {
			return bad("파일 이름을 짧게 해 주세요.")
		}
		data, err = io.ReadAll(part)
		if err != nil {
			return bad("파일을 끝까지 읽지 못했어요.")
		}
		if kind == "css" {
			err = validateServerCSS(data)
		} else {
			err = validateServerFont(data)
		}
		if err != nil {
			return err
		}
		if extra, e := reader.NextPart(); e != io.EOF {
			if extra != nil {
				extra.Close()
			}
			return bad("파일을 하나씩 첨부해 주세요.")
		}
	}
	tx, err := a.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec("DELETE FROM server_settings WHERE key IN (?,?,?)", "appearance_"+kind+"_data", "appearance_"+kind+"_name", "appearance_"+kind+"_revision"); err != nil {
		return err
	}
	if r.Method != "DELETE" {
		hash := sha256.Sum256(data)
		for key, value := range map[string]any{"data": data, "name": name, "revision": hex.EncodeToString(hash[:])} {
			if _, err = tx.Exec("INSERT INTO server_settings(key,value) VALUES(?,?)", "appearance_"+kind+"_"+key, value); err != nil {
				return err
			}
		}
	}
	if err = audit(tx, u, "appearance."+strings.ToLower(r.Method), "server", kind); err != nil {
		return fmt.Errorf("appearance audit: %w", err)
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}
