package app

import (
	_ "embed"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
)

//go:embed i18n/en.json
var englishJSON []byte
var englishMessages = func() map[string]string {
	var messages map[string]string
	if err := json.Unmarshal(englishJSON, &messages); err != nil {
		panic(err)
	}
	return messages
}()

// Locale changes presentation only. Never translate user data or identifiers.
func requestLocale(r *http.Request, u *User) string {
	for _, preference := range strings.Split(r.Header.Get("Accept-Language"), ",") {
		language := strings.ToLower(strings.TrimSpace(strings.SplitN(preference, ";", 2)[0]))
		if language == "en" || strings.HasPrefix(language, "en-") {
			return "en"
		}
		if language == "ko" || strings.HasPrefix(language, "ko-") {
			return "ko"
		}
	}
	if u != nil && u.Locale == "en" {
		return "en"
	}
	return "ko"
}
func localizeMessage(locale, message string) string {
	if locale == "en" {
		if translated, ok := englishMessages[message]; ok {
			return translated
		}
	}
	return message
}

// Shared formatting keeps API/MCP error codes and HTTP statuses identical.
func writeRequestError(w http.ResponseWriter, r *http.Request, u *User, err error, bearer bool) {
	var problem *apiError
	if !errors.As(err, &problem) {
		log.Printf("api failure: %T: %v", err, err)
		problem = &apiError{500, "internal", "처리하지 못했어요. 서버 상태를 확인해 주세요."}
	}
	if bearer && problem.Status == 401 {
		w.Header().Set("WWW-Authenticate", `Bearer realm="duet-ledger", error="invalid_token"`)
	}
	if bearer && problem.Status == 429 && w.Header().Get("Retry-After") == "" {
		w.Header().Set("Retry-After", "60")
	}
	writeJSON(w, problem.Status, map[string]string{"error": problem.Code, "message": localizeMessage(requestLocale(r, u), problem.Message)})
}
