package app

import (
	"archive/zip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type BackupInfo struct {
	Name    string `json:"name"`
	Size    int64  `json:"size"`
	Created string `json:"created_at"`
}

func (a *App) backup() (string, error) {
	dir := filepath.Join(a.Config.DataDir, "backups")
	name := "duet-ledger-backup-" + time.Now().UTC().Format("20060102-150405") + "-" + newID()[:6] + ".zip"
	snapshot := filepath.Join(dir, newID()+".sqlite")
	defer os.Remove(snapshot)
	if _, err := a.DB.Exec("VACUUM INTO ?", snapshot); err != nil {
		return "", err
	}
	path := filepath.Join(dir, name)
	temp := path + ".partial"
	file, err := os.OpenFile(temp, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return "", err
	}
	complete := false
	defer func() {
		file.Close()
		if !complete {
			os.Remove(temp)
		}
	}()
	writer := zip.NewWriter(file)
	metadata := map[string]any{"format": "duet-operational-backup", "version": 1, "app_version": Version, "created_at": now(), "master_key_sha256": tokenHash(string(a.master)), "master_key_included": false}
	b, _ := json.MarshalIndent(metadata, "", "  ")
	entry, err := writer.Create("manifest.json")
	if err != nil {
		return "", err
	}
	if _, err = entry.Write(b); err != nil {
		return "", err
	}
	add := func(source, name string) error {
		src, e := os.Open(source)
		if e != nil {
			return e
		}
		defer src.Close()
		entry, e := writer.Create(name)
		if e != nil {
			return e
		}
		_, e = io.Copy(entry, src)
		return e
	}
	if err = add(snapshot, "duet.sqlite"); err != nil {
		return "", err
	}
	rows, err := a.DB.Query("SELECT DISTINCT filename FROM receipts")
	if err != nil {
		return "", err
	}
	names := []string{}
	for rows.Next() {
		var n string
		if err = rows.Scan(&n); err != nil {
			rows.Close()
			return "", err
		}
		names = append(names, n)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return "", err
	}
	for _, n := range names {
		if n != filepath.Base(n) {
			return "", fmt.Errorf("invalid receipt path")
		}
		if err = add(filepath.Join(a.Config.DataDir, "receipts", n), "receipts/"+n); err != nil {
			return "", err
		}
	}
	if err = writer.Close(); err != nil {
		return "", err
	}
	if err = file.Sync(); err != nil {
		return "", err
	}
	if err = file.Close(); err != nil {
		return "", err
	}
	// Only validated archives become visible in the backup list.
	check, err := zip.OpenReader(temp)
	if err != nil {
		return "", err
	}
	defer check.Close()
	for _, item := range check.File {
		f, e := item.Open()
		if e != nil {
			return "", e
		}
		_, e = io.Copy(io.Discard, f)
		f.Close()
		if e != nil {
			return "", e
		}
	}
	if err = check.Close(); err != nil {
		return "", err
	}
	if err = os.Rename(temp, path); err != nil {
		return "", err
	}
	complete = true
	return name, nil
}
func (a *App) backupList() ([]BackupInfo, error) {
	entries, err := os.ReadDir(filepath.Join(a.Config.DataDir, "backups"))
	if err != nil {
		return nil, err
	}
	out := []BackupInfo{}
	for _, f := range entries {
		if f.IsDir() || !strings.HasPrefix(f.Name(), "duet-") || !strings.HasSuffix(f.Name(), ".zip") {
			continue
		}
		info, e := f.Info()
		if e != nil {
			return nil, e
		}
		out = append(out, BackupInfo{f.Name(), info.Size(), info.ModTime().UTC().Format(time.RFC3339)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name > out[j].Name })
	return out, nil
}
func (a *App) listBackups(w http.ResponseWriter, r *http.Request, u *User) error {
	if !u.Admin {
		return forbidden()
	}
	list, err := a.backupList()
	if err != nil {
		return err
	}
	writeJSON(w, 200, list)
	return nil
}
func (a *App) createBackup(w http.ResponseWriter, r *http.Request, u *User) error {
	if !u.Admin {
		return forbidden()
	}
	name, err := a.backup()
	if err != nil {
		return err
	}
	if err = audit(a.DB, u, "backup_created", "server", name); err != nil {
		return err
	}
	writeJSON(w, 201, map[string]string{"name": name})
	return nil
}
func (a *App) downloadBackup(w http.ResponseWriter, r *http.Request, u *User) error {
	if !u.Admin {
		return forbidden()
	}
	name := r.PathValue("name")
	if name != filepath.Base(name) || !strings.HasPrefix(name, "duet-") || !strings.HasSuffix(name, ".zip") {
		return missing()
	}
	p := filepath.Join(a.Config.DataDir, "backups", name)
	f, err := os.Open(p)
	if os.IsNotExist(err) {
		return missing()
	}
	if err != nil {
		return err
	}
	defer f.Close()
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="`+name+`"`)
	_, err = io.Copy(w, f)
	return err
}
func (a *App) RunBackups(ctx context.Context) {
	tick := time.NewTicker(time.Minute)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			a.mu.Lock()
			var count int
			err := a.DB.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
			list, e := a.backupList()
			if err == nil && e == nil && count > 0 {
				due := len(list) == 0
				if !due {
					t, _ := time.Parse(time.RFC3339, list[0].Created)
					due = time.Since(t) >= 24*time.Hour
				}
				if due {
					if _, e = a.backup(); e != nil {
						log.Printf("scheduled backup failed: %v", e)
					} else {
						list, _ = a.backupList()
						for i := 7; i < len(list); i++ {
							if e = os.Remove(filepath.Join(a.Config.DataDir, "backups", list[i].Name)); e != nil {
								log.Printf("backup retention: %v", e)
							}
						}
					}
				}
			}
			a.mu.Unlock()
		}
	}
}
