package app

import (
	"bytes"
	"database/sql"
	"errors"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	_ "image/png"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
)

func (a *App) receiptPosting(u *User, pid string, edit bool) (Account, error) {
	var aid string
	var deleted bool
	err := a.DB.QueryRow("SELECT p.account_id,e.deleted_at IS NOT NULL FROM postings p JOIN events e ON e.id=p.event_id WHERE p.id=?", pid).Scan(&aid, &deleted)
	if errors.Is(err, sql.ErrNoRows) || deleted {
		return Account{}, missing()
	}
	if err != nil {
		return Account{}, err
	}
	ac, err := a.account(a.DB, u, aid)
	if err != nil {
		return Account{}, err
	}
	if edit && ac.Role == "viewer" {
		return Account{}, forbidden()
	}
	return ac, nil
}
func (a *App) uploadReceipt(w http.ResponseWriter, r *http.Request, u *User) error {
	pid := r.PathValue("id")
	if _, err := a.receiptPosting(u, pid, true); err != nil {
		return err
	}
	if err := r.ParseMultipartForm(6 << 20); err != nil {
		return bad("사진을 읽지 못했어요. 5MB 이하의 JPG·PNG 사진을 골라주세요.")
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		return bad("사진 파일이 필요해요.")
	}
	defer file.Close()
	if header.Size > 5<<20 {
		return bad("사진은 5MB까지 첨부할 수 있어요.")
	}
	content, err := io.ReadAll(io.LimitReader(file, 5<<20+1))
	if err != nil {
		return err
	}
	if len(content) > 5<<20 {
		return bad("사진이 너무 커요.")
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(content))
	if err != nil || format != "jpeg" && format != "png" || cfg.Width < 1 || cfg.Height < 1 || cfg.Width > 12000 || cfg.Height > 12000 || int64(cfg.Width)*int64(cfg.Height) > 16000000 {
		return bad("JPG·PNG 사진만 가능하며 해상도는 1,600만 화소까지 지원해요.")
	}
	img, _, err := image.Decode(bytes.NewReader(content))
	if err != nil {
		return bad("사진이 손상되었어요.")
	}
	flat := image.NewRGBA(img.Bounds())
	draw.Draw(flat, flat.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	draw.Draw(flat, flat.Bounds(), img, img.Bounds().Min, draw.Over)
	flat = orientImage(flat, jpegOrientation(content))
	var normalized bytes.Buffer
	if err = jpeg.Encode(&normalized, flat, &jpeg.Options{Quality: 85}); err != nil {
		return err
	}
	digest := tokenHash(normalized.String())
	var existingID string
	var size int64
	err = a.DB.QueryRow("SELECT id,size FROM receipts WHERE posting_id=? AND sha256=? AND deleted_at IS NULL", pid, digest).Scan(&existingID, &size)
	if err == nil {
		writeJSON(w, 201, ReceiptRef{ID: existingID, Size: size, Media: "image/jpeg"})
		return nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	id := newID()
	filename := id + ".jpg"
	path := filepath.Join(a.Config.DataDir, "receipts", filename)
	if err = os.WriteFile(path, normalized.Bytes(), 0600); err != nil {
		return err
	}
	if _, err = a.DB.Exec("INSERT INTO receipts(id,posting_id,filename,media_type,size,sha256,created_at) VALUES(?,?,?,'image/jpeg',?,?,?)", id, pid, filename, normalized.Len(), digest, now()); err != nil {
		_ = os.Remove(path)
		return err
	}
	if err = audit(a.DB, u, "receipt_added", "posting", pid); err != nil {
		return err
	}
	writeJSON(w, 201, ReceiptRef{ID: id, Size: int64(normalized.Len()), Media: "image/jpeg"})
	return nil
}
func (a *App) getReceipt(w http.ResponseWriter, r *http.Request, u *User) error {
	var pid, filename, media string
	var size int64
	err := a.DB.QueryRow("SELECT posting_id,filename,media_type,size FROM receipts WHERE id=? AND deleted_at IS NULL", r.PathValue("id")).Scan(&pid, &filename, &media, &size)
	if errors.Is(err, sql.ErrNoRows) {
		return missing()
	}
	if err != nil {
		return err
	}
	if _, err = a.receiptPosting(u, pid, false); err != nil {
		return err
	}
	f, err := os.Open(filepath.Join(a.Config.DataDir, "receipts", filename))
	if os.IsNotExist(err) {
		return missing()
	}
	if err != nil {
		return err
	}
	defer f.Close()
	w.Header().Set("Content-Type", media)
	w.Header().Set("Content-Disposition", `inline; filename="receipt.jpg"`)
	w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
	_, err = io.Copy(w, f)
	return err
}
func (a *App) deleteReceipt(w http.ResponseWriter, r *http.Request, u *User) error {
	var pid string
	err := a.DB.QueryRow("SELECT posting_id FROM receipts WHERE id=? AND deleted_at IS NULL", r.PathValue("id")).Scan(&pid)
	if errors.Is(err, sql.ErrNoRows) {
		return missing()
	}
	if err != nil {
		return err
	}
	if _, err = a.receiptPosting(u, pid, true); err != nil {
		return err
	}
	if _, err = a.DB.Exec("UPDATE receipts SET deleted_at=? WHERE id=?", now(), r.PathValue("id")); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}
