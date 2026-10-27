package app

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
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

type receiptUploadKey struct{}
type preparedReceipt struct {
	data   []byte
	digest string
}

// Decode and normalize images before taking the mutation lock. The handler
// repeats account authorization before attaching the resulting bytes.
func prepareReceiptUpload(r *http.Request) (preparedReceipt, error) {
	if err := r.ParseMultipartForm(6 << 20); err != nil {
		return preparedReceipt{}, bad("사진을 읽지 못했어요. 5MB 이하의 JPG·PNG 사진을 골라주세요.")
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		return preparedReceipt{}, bad("사진 파일이 필요해요.")
	}
	defer file.Close()
	if header.Size > 5<<20 {
		return preparedReceipt{}, bad("사진은 5MB까지 첨부할 수 있어요.")
	}
	content, err := io.ReadAll(io.LimitReader(file, 5<<20+1))
	if err != nil {
		return preparedReceipt{}, err
	}
	if len(content) > 5<<20 {
		return preparedReceipt{}, bad("사진이 너무 커요.")
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(content))
	if err != nil || format != "jpeg" && format != "png" || cfg.Width < 1 || cfg.Height < 1 || cfg.Width > 12000 || cfg.Height > 12000 || int64(cfg.Width)*int64(cfg.Height) > 16000000 {
		return preparedReceipt{}, bad("JPG·PNG 사진만 가능하며 해상도는 1,600만 화소까지 지원해요.")
	}
	img, _, err := image.Decode(bytes.NewReader(content))
	if err != nil {
		return preparedReceipt{}, bad("사진이 손상되었어요.")
	}
	flat := image.NewRGBA(img.Bounds())
	draw.Draw(flat, flat.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	draw.Draw(flat, flat.Bounds(), img, img.Bounds().Min, draw.Over)
	flat = orientImage(flat, jpegOrientation(content))
	var normalized bytes.Buffer
	if err = jpeg.Encode(&normalized, flat, &jpeg.Options{Quality: 85}); err != nil {
		return preparedReceipt{}, err
	}
	digest := sha256.Sum256(normalized.Bytes())
	return preparedReceipt{data: normalized.Bytes(), digest: hex.EncodeToString(digest[:])}, nil
}
func withReceiptUpload(r *http.Request, upload preparedReceipt) {
	*r = *r.WithContext(context.WithValue(r.Context(), receiptUploadKey{}, upload))
}
func (a *App) uploadReceipt(w http.ResponseWriter, r *http.Request, u *User) error {
	pid := r.PathValue("id")
	if _, err := a.receiptPosting(u, pid, true); err != nil {
		return err
	}
	upload, ok := r.Context().Value(receiptUploadKey{}).(preparedReceipt)
	if !ok {
		return bad("사진 파일이 필요해요.")
	}
	normalized, digest := upload.data, upload.digest
	var existingID string
	var size int64
	err := a.DB.QueryRow("SELECT id,size FROM receipts WHERE posting_id=? AND sha256=? AND deleted_at IS NULL", pid, digest).Scan(&existingID, &size)
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
	if err = os.WriteFile(path, normalized, 0600); err != nil {
		return err
	}
	if _, err = a.DB.Exec("INSERT INTO receipts(id,posting_id,filename,media_type,size,sha256,created_at) VALUES(?,?,?,'image/jpeg',?,?,?)", id, pid, filename, len(normalized), digest, now()); err != nil {
		_ = os.Remove(path)
		return err
	}
	if err = audit(a.DB, u, "receipt_added", "posting", pid); err != nil {
		return err
	}
	writeJSON(w, 201, ReceiptRef{ID: id, Size: int64(len(normalized)), Media: "image/jpeg"})
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
	w.Header().Set("Content-Type", media)
	w.Header().Set("Content-Disposition", `inline; filename="receipt.jpg"`)
	w.Header().Set("Content-Length", strconv.FormatInt(size, 10))
	return streamResponse(w, f)
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
	tx, err := a.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec("UPDATE receipts SET deleted_at=? WHERE id=?", now(), r.PathValue("id")); err != nil {
		return err
	}
	if err = audit(tx, u, "receipt_removed", "posting", pid); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}
