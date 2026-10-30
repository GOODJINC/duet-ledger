package app

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
)

// A restore starts a new data generation. Pending browser writes from an older
// dataset must be reviewed rather than silently replayed onto restored history.
func dataGeneration(q queryer) (string, error) {
	var value string
	err := q.QueryRow("SELECT value FROM server_settings WHERE key='data_generation'").Scan(&value)
	return value, err
}
func checkOfflineIdentity(r *http.Request, u *User) error {
	if expected := r.Header.Get("X-Duet-User"); expected != "" && expected != u.ID {
		return &apiError{409, "user_changed", "로그인한 계정이 바뀌었어요. 원래 계정에서 대기 기록을 확인해 주세요."}
	}
	if expected := r.Header.Get("X-Duet-Data-Generation"); expected != "" && expected != u.DataGeneration {
		return &apiError{409, "data_changed", "서버 자료가 복원되었어요. 대기 기록을 확인한 뒤 다시 입력해 주세요."}
	}
	return nil
}
func offlineUpdateKey(r *http.Request, u *User, v TxInput) (string, string, error) {
	if u.API != nil || r.Header.Get("X-Duet-Data-Generation") == "" {
		return "", "", nil
	}
	key := r.Header.Get("Idempotency-Key")
	if key == "" || len(key) > 128 {
		return "", "", bad("요청 식별자를 확인해 주세요.")
	}
	raw, err := json.Marshal(struct {
		ID    string
		Input TxInput
	}{r.PathValue("id"), v})
	return "offline-update:" + key, tokenHash(string(raw)), err
}
func replayOfflineUpdate(q queryer, u *User, key, digest, event string) (bool, error) {
	if key == "" {
		return false, nil
	}
	var previous, previousEvent string
	err := q.QueryRow("SELECT digest,event_id FROM request_keys WHERE user_id=? AND key=?", u.ID, key).Scan(&previous, &previousEvent)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if previous != digest || previousEvent != event {
		return false, conflict("같은 요청 식별자로 다른 기록을 보낼 수 없어요.")
	}
	return true, nil
}
