package app

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestPublicBodiesNeverUseTempFiles(t *testing.T) {
	a, _, c := newTestApp(t)
	dir := t.TempDir()
	t.Setenv("TMPDIR", dir)
	large := strings.Repeat("x", 21<<20)
	for _, path := range []string{"/api/setup", "/api/login", "/api/join"} {
		for _, unknownLength := range []bool{false, true} {
			source := strings.NewReader(large)
			req := httptest.NewRequest("POST", path, source)
			req.Header.Set("Content-Type", "application/json")
			if unknownLength {
				req.ContentLength = -1
			}
			w := httptest.NewRecorder()
			a.Routes().ServeHTTP(w, req)
			if w.Code != 413 {
				t.Fatalf("%s unknownLength=%v: got %d", path, unknownLength, w.Code)
			}
			consumed := len(large) - source.Len()
			if consumed > publicBodyLimit+1 || !unknownLength && consumed != 0 {
				t.Fatalf("public body consumed too much input: %d", consumed)
			}
			files, err := os.ReadDir(dir)
			if err != nil || len(files) != 0 {
				t.Fatal("public request created a temp file", files, err)
			}
		}
	}
	// Unknown-length requests still accept legitimate login payloads.
	req := httptest.NewRequest("POST", "/api/login", strings.NewReader(`{"username":"minsu","password":"`+testPassword+`"}`))
	req.ContentLength = -1
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	a.Routes().ServeHTTP(w, req)
	if w.Code != 200 {
		t.Fatal("normal login rejected", w.Code, w.Body.String())
	}
	appearanceUpload(t, c, "css", "normal.css", []byte("/*"+strings.Repeat("a", 2<<20)+"*/body{color:red}"), 200, true)
}

func TestOversizedPublicBodyRejectedBeforeRead(t *testing.T) {
	a, _, _ := newTestApp(t)
	body := newPausedBody(t, nil)
	req := httptest.NewRequest("POST", "/api/login", body)
	req.ContentLength = 22 << 20
	w := httptest.NewRecorder()
	done := make(chan struct{})
	go func() { defer close(done); a.Routes().ServeHTTP(w, req) }()
	select {
	case <-done:
		if w.Code != 413 {
			t.Fatal(w.Code)
		}
	case <-body.started:
		body.Close()
		<-done
		t.Fatal("oversized public request waited for its body")
	case <-time.After(time.Second):
		t.Fatal("oversized public request stalled")
	}
}

func TestConcurrentSpoolsAreBoundedAndReleased(t *testing.T) {
	a, _, c := newTestApp(t)
	dir := t.TempDir()
	t.Setenv("TMPDIR", dir)
	tail := newPausedBody(t, nil)
	req := browserTestRequest(c, "POST", "/api/transactions", io.MultiReader(strings.NewReader(strings.Repeat("x", 20<<20)), tail))
	first := httptest.NewRecorder()
	done := make(chan struct{})
	go func() { defer close(done); a.Routes().ServeHTTP(first, req) }()
	defer func() { tail.Close(); <-done }()
	select {
	case <-tail.started:
	case <-time.After(2 * time.Second):
		t.Fatal("first request did not reach the pause")
	}
	assertResponsive(t, a.Routes())
	second := httptest.NewRecorder()
	a.Routes().ServeHTTP(second, browserTestRequest(c, "POST", "/api/transactions", strings.NewReader(strings.Repeat("x", 20<<20))))
	if second.Code != 503 {
		t.Fatal("concurrent request exceeded shared spool budget", second.Code)
	}
	a.spool.mu.Lock()
	used := a.spool.used
	a.spool.mu.Unlock()
	if used != 20<<20 {
		t.Fatal("rejected request leaked a reservation", used)
	}
	// Responses share the same budget and release partial files on send failure.
	response := newBufferedResponse(make(http.Header), &a.spool)
	_, _ = response.Write(bytes.Repeat([]byte("x"), 16<<20))
	output := httptest.NewRecorder()
	response.send(output, httptest.NewRequest("GET", "/api/export", nil))
	if output.Code != 503 {
		t.Fatal("response ignored shared spool budget", output.Code)
	}
	appearanceUpload(t, c, "css", "normal.css", []byte("/*"+strings.Repeat("a", 2<<20)+"*/body{color:red}"), 200, true)
	tail.Close()
	<-done
	if first.Code != 400 {
		t.Fatal(first.Code)
	}
	if a.spool.used != 0 {
		t.Fatal("completed request leaked a reservation", a.spool.used)
	}
	files, err := os.ReadDir(dir)
	if err != nil || len(files) != 0 {
		t.Fatal("spool files leaked", files, err)
	}
}

func TestSpoolBudgetConcurrentReservations(t *testing.T) {
	budget := &spoolBudget{}
	data := bytes.Repeat([]byte("x"), 2<<20)
	buffers := make([]requestBuffer, 40)
	var writers sync.WaitGroup
	for i := range buffers {
		buffers[i].budget = budget
		writers.Add(1)
		go func(b *requestBuffer) { defer writers.Done(); _, _ = b.Write(data) }(&buffers[i])
	}
	writers.Wait()
	if budget.used != spoolLimit {
		t.Fatal("concurrent reservations did not enforce the shared limit", budget.used)
	}
	for i := range buffers {
		if err := buffers[i].Close(); err != nil {
			t.Fatal(err)
		}
		_ = buffers[i].Close()
	}
	if budget.used != 0 {
		t.Fatal("spool reservation leaked or released twice", budget.used)
	}
}

func TestMalformedReceiptsConsumeAPIBudgetAndAreLogged(t *testing.T) {
	a, _, c := newTestApp(t)
	account := c.account(c.personalLedger(), "allowed", "bank", "KRW", "0")
	posting := c.create(txInput(account, "expense", "100"))
	c.send("PATCH", "/admin/api-settings", map[string]bool{"enabled": true}, 200, nil)
	id, key := c.appPassword([]string{account}, []string{"receipts"}, "never")
	for i := 0; i < 130; i++ {
		req := httptest.NewRequest("POST", "/api/v1/transactions/"+posting+"/receipts", strings.NewReader("invalid multipart"))
		req.Header.Set("Authorization", "Bearer "+key)
		req.Header.Set("Content-Type", "multipart/form-data; boundary=test")
		w := httptest.NewRecorder()
		a.Routes().ServeHTTP(w, req)
		want := 400
		if i >= 120 {
			want = 429
		}
		if w.Code != want {
			t.Fatalf("request %d: got %d want %d", i+1, w.Code, want)
		}
	}
	for status, want := range map[int]int{400: 120, 429: 10} {
		var count int
		err := a.DB.QueryRow("SELECT COUNT(*) FROM api_requests WHERE credential_id=? AND status=? AND path='/api/v1/transactions/{id}/receipts'", id, status).Scan(&count)
		if err != nil || count != want {
			t.Fatal("failed request audit missing", status, count, err)
		}
	}
	var count int
	if err := a.DB.QueryRow("SELECT COUNT(*) FROM receipts").Scan(&count); err != nil || count != 0 {
		t.Fatal("invalid requests changed receipts", count, err)
	}
}

type notifyingBody struct {
	io.ReadCloser
	once sync.Once
	read chan<- struct{}
}

func (b *notifyingBody) Read(p []byte) (int, error) {
	b.once.Do(func() { b.read <- struct{}{} })
	return b.ReadCloser.Read(p)
}

func TestConcurrentAPIRequestsReserveBeforeReading(t *testing.T) {
	a, _, c := newTestApp(t)
	account := c.account(c.personalLedger(), "allowed", "bank", "KRW", "0")
	c.send("PATCH", "/admin/api-settings", map[string]bool{"enabled": true}, 200, nil)
	id, key := c.appPassword([]string{account}, []string{"create"}, "never")
	a.attempts["api-key:"+id] = attempt{Count: 119, Since: time.Now()}
	read, done := make(chan struct{}, 10), make(chan int, 10)
	bodies := make([]*pausedBody, 10)
	for i := range bodies {
		body := newPausedBody(t, []byte(`{}`))
		bodies[i] = body
		req := httptest.NewRequest("POST", "/api/v1/transactions", &notifyingBody{ReadCloser: body, read: read})
		req.Header.Set("Authorization", "Bearer "+key)
		req.Header.Set("Content-Type", "application/json")
		go func() {
			w := httptest.NewRecorder()
			a.Routes().ServeHTTP(w, req)
			done <- w.Code
		}()
	}
	defer func() {
		for _, body := range bodies {
			body.Close()
		}
	}()
	reads, rejected := 0, 0
	timeout := time.After(2 * time.Second)
	for reads != 1 || rejected != 9 {
		select {
		case <-read:
			reads++
			if reads > 1 {
				t.Fatal("multiple requests consumed the final slot")
			}
		case status := <-done:
			if status != 429 {
				t.Fatal("unexpected status before body read", status)
			}
			rejected++
		case <-timeout:
			t.Fatal("API admission stalled", reads, rejected)
		}
	}
	for _, body := range bodies {
		body.Close()
	}
	select {
	case status := <-done:
		if status != 400 {
			t.Fatal("admitted request was charged twice", status)
		}
	case <-time.After(time.Second):
		t.Fatal("admitted request did not finish")
	}
}
