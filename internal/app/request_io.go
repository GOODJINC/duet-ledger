package app

import (
	"bytes"
	"errors"
	"io"
	"net/http"
	"os"
	"strings"
	"sync"
)

const publicBodyLimit = 64 << 10

// Ordinary request/response files share a bounded part of the default 64MiB
// tmpfs. Administrator assets keep their separate, serialized upload policy.
const spoolLimit = 32 << 20

type spoolBudget struct {
	mu   sync.Mutex
	used int64
}

func (s *spoolBudget) reserve(n int64) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if n > spoolLimit-s.used {
		return false
	}
	s.used += n
	return true
}
func (s *spoolBudget) release(n int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.used -= n
}

// Keep small requests/responses in memory; spill larger ones to a private temp
// file. Neither slow clients nor socket writes may hold the database mutex.
type requestBuffer struct {
	memory   bytes.Buffer
	file     *os.File
	budget   *spoolBudget
	reserved int64
}

func (b *requestBuffer) Write(p []byte) (int, error) {
	if b.budget != nil && (b.file != nil || b.memory.Len()+len(p) > 128<<10) {
		n := int64(len(p))
		if b.file == nil {
			n += int64(b.memory.Len())
		}
		if !b.budget.reserve(n) {
			return 0, &apiError{503, "busy", "잠시 후 다시 시도해 주세요."}
		}
		b.reserved += n
	}
	if b.file == nil && b.memory.Len()+len(p) > 128<<10 {
		f, err := os.CreateTemp("", "duet-http-*")
		if err != nil {
			return 0, err
		}
		b.file = f
		if _, err = b.memory.WriteTo(f); err != nil {
			return 0, err
		}
	}
	if b.file != nil {
		return b.file.Write(p)
	}
	return b.memory.Write(p)
}
func (b *requestBuffer) reader() (io.Reader, error) {
	if b.file != nil {
		_, err := b.file.Seek(0, io.SeekStart)
		return b.file, err
	}
	return bytes.NewReader(b.memory.Bytes()), nil
}
func (b *requestBuffer) Close() error {
	if b.reserved != 0 {
		defer func() {
			b.budget.release(b.reserved)
			b.reserved = 0
		}()
	}
	if b.file != nil {
		name := b.file.Name()
		err := b.file.Close()
		_ = os.Remove(name)
		b.file = nil
		return err
	}
	return nil
}

type bufferedResponse struct {
	header http.Header
	status int
	body   requestBuffer
	stream io.ReadCloser
	err    error
}

func newBufferedResponse(header http.Header, budget *spoolBudget) *bufferedResponse {
	return &bufferedResponse{header: header.Clone(), body: requestBuffer{budget: budget}}
}
func (b *bufferedResponse) Header() http.Header { return b.header }
func (b *bufferedResponse) WriteHeader(status int) {
	if b.status == 0 {
		b.status = status
	}
}
func (b *bufferedResponse) Write(p []byte) (int, error) {
	b.WriteHeader(http.StatusOK)
	n, err := b.body.Write(p)
	if err != nil {
		b.err = err
	}
	return n, err
}
func (b *bufferedResponse) responseStatus() int {
	if b.err != nil {
		var problem *apiError
		if errors.As(b.err, &problem) {
			return problem.Status
		}
		return http.StatusInternalServerError
	}
	if b.status == 0 {
		return http.StatusOK
	}
	return b.status
}
func (b *bufferedResponse) send(w http.ResponseWriter, r *http.Request) {
	defer b.body.Close()
	if b.stream != nil {
		defer b.stream.Close()
	}
	if b.err != nil {
		writeRequestError(w, r, nil, b.err, false)
		return
	}
	var reader io.Reader = b.stream
	if reader == nil {
		var err error
		reader, err = b.body.reader()
		if err != nil {
			writeRequestError(w, r, nil, err, false)
			return
		}
	}
	for key, values := range b.header {
		w.Header()[key] = values
	}
	w.WriteHeader(b.responseStatus())
	_, _ = io.Copy(w, reader)
}

// Files and existing blobs can be sent after unlocking without making a second
// copy. The opened file/blob remains the authorized response snapshot.
func streamResponse(w http.ResponseWriter, content io.ReadCloser) error {
	w.WriteHeader(http.StatusOK)
	target := w
	for {
		if b, ok := target.(*bufferedResponse); ok {
			b.stream = content
			return nil
		}
		if wrapper, ok := target.(interface{ Unwrap() http.ResponseWriter }); ok {
			target = wrapper.Unwrap()
			continue
		}
		defer content.Close()
		_, err := io.Copy(w, content)
		return err
	}
}

func (a *App) browserIdentity(r *http.Request) (*User, error) {
	if r.Header.Get("Authorization") != "" {
		return nil, &apiError{403, "wrong_auth_route", "앱 비밀번호는 /api/v1 경로에서만 사용해 주세요."}
	}
	u, err := a.authenticate(r)
	if err == nil && r.Method != "GET" && r.Method != "HEAD" && !secureEqual(r.Header.Get("X-CSRF-Token"), u.CSRF) {
		err = &apiError{403, "csrf", "화면을 새로고침하고 다시 시도해 주세요."}
	}
	return u, err
}

// Preliminary authentication prevents unauthenticated unlimited uploads. It is
// deliberately repeated under the mutation lock after the body has arrived.
func (a *App) receiveRequest(w http.ResponseWriter, r *http.Request, identity func(*http.Request) (*User, error)) (func(), error) {
	if r.Method == "GET" || r.Method == "HEAD" {
		return func() {}, nil
	}
	receipt := r.Method == "POST" && strings.HasSuffix(r.URL.Path, "/receipts")
	appearance := r.Method == "PUT" && strings.HasPrefix(r.URL.Path, "/api/admin/appearance/")
	if identity != nil {
		a.mu.Lock()
		u, err := identity(r)
		if err == nil && appearance && !u.Admin {
			err = forbidden()
		}
		if err == nil && receipt {
			if u.API != nil && !u.API.Permissions["receipts"] {
				err = &apiError{403, "insufficient_permission", "이 앱 비밀번호에 허용되지 않은 기능이에요."}
			} else {
				_, err = a.receiptPosting(u, r.PathValue("id"), true)
			}
		}
		a.mu.Unlock()
		if err != nil {
			return nil, err
		}
	}
	if appearance {
		// Unlimited assets are prepared one at a time, outside the DB lock.
		a.appearanceMu.Lock()
		upload, err := prepareAppearanceUpload(r)
		if err != nil {
			a.appearanceMu.Unlock()
			return nil, err
		}
		withAppearanceUpload(r, upload)
		return a.appearanceMu.Unlock, nil
	}
	limit := int64(22 << 20)
	if identity == nil {
		limit = publicBodyLimit
		if r.ContentLength > limit {
			return nil, &apiError{413, "request_too_large", "요청이 너무 커요."}
		}
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	body := requestBuffer{budget: &a.spool}
	if _, err := io.Copy(&body, r.Body); err != nil {
		body.Close()
		var tooLarge *http.MaxBytesError
		if identity == nil && errors.As(err, &tooLarge) {
			return nil, &apiError{413, "request_too_large", "요청이 너무 커요."}
		}
		var problem *apiError
		if errors.As(err, &problem) {
			return nil, err
		}
		return nil, bad("입력 형식을 확인해 주세요.")
	}
	reader, err := body.reader()
	if err != nil {
		body.Close()
		return nil, err
	}
	r.Body = io.NopCloser(reader)
	if receipt {
		a.receiptMu.Lock()
		upload, err := prepareReceiptUpload(r)
		a.receiptMu.Unlock()
		if err != nil {
			body.Close()
			return nil, err
		}
		withReceiptUpload(r, upload)
	}
	return func() { _ = body.Close() }, nil
}
