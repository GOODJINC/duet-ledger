package app

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base32"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"golang.org/x/crypto/argon2"
	"os"
	"strconv"
	"strings"
	"time"
)

func random(n int) []byte {
	b := make([]byte, n)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return b
}
func encode64(b []byte) string     { return base64.RawURLEncoding.EncodeToString(b) }
func newID() string                { return hex.EncodeToString(random(16)) }
func tokenHash(s string) string    { h := sha256.Sum256([]byte(s)); return hex.EncodeToString(h[:]) }
func secureEqual(a, b string) bool { return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1 }
func loadSecret(path string, size int) ([]byte, error) {
	b, err := os.ReadFile(path)
	if err == nil {
		if len(b) != size {
			return nil, fmt.Errorf("invalid secret file: %s", path)
		}
		return b, nil
	}
	if !os.IsNotExist(err) {
		return nil, err
	}
	b = random(size)
	f, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return nil, err
	}
	_, err = f.Write(b)
	if err == nil {
		err = f.Sync()
	}
	closeErr := f.Close()
	if err == nil {
		err = closeErr
	}
	return b, err
}
func passwordHash(password string) string {
	salt := random(16)
	hash := argon2.IDKey([]byte(password), salt, 3, 32*1024, 1, 32)
	return "argon2id$3$32768$" + encode64(salt) + "$" + encode64(hash)
}
func verifyPassword(password, encoded string) bool {
	p := strings.Split(encoded, "$")
	if len(p) != 5 || p[0] != "argon2id" || p[1] != "3" || p[2] != "32768" {
		return false
	}
	salt, e := base64.RawURLEncoding.DecodeString(p[3])
	if e != nil || len(salt) != 16 {
		return false
	}
	want, e := base64.RawURLEncoding.DecodeString(p[4])
	if e != nil || len(want) != 32 {
		return false
	}
	return subtle.ConstantTimeCompare(argon2.IDKey([]byte(password), salt, 3, 32*1024, 1, 32), want) == 1
}
func (a *App) encrypt(s string) string {
	block, _ := aes.NewCipher(a.master)
	gcm, _ := cipher.NewGCM(block)
	nonce := random(gcm.NonceSize())
	return encode64(gcm.Seal(nonce, nonce, []byte(s), []byte("duet-totp-v1")))
}
func (a *App) decrypt(s string) (string, error) {
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return "", err
	}
	block, _ := aes.NewCipher(a.master)
	gcm, _ := cipher.NewGCM(block)
	if len(b) < gcm.NonceSize() {
		return "", fmt.Errorf("invalid ciphertext")
	}
	plain, err := gcm.Open(nil, b[:gcm.NonceSize()], b[gcm.NonceSize():], []byte("duet-totp-v1"))
	return string(plain), err
}
func totpCode(secret string, counter int64) string {
	key, _ := base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(secret)
	var b [8]byte
	binary.BigEndian.PutUint64(b[:], uint64(counter))
	h := hmac.New(sha1.New, key)
	h.Write(b[:])
	sum := h.Sum(nil)
	offset := sum[len(sum)-1] & 15
	n := binary.BigEndian.Uint32(sum[offset:offset+4]) & 0x7fffffff
	return fmt.Sprintf("%06d", n%1000000)
}
func totpMatch(secret, code string, after int64) (int64, bool) {
	if len(code) != 6 {
		return 0, false
	}
	if _, err := strconv.Atoi(code); err != nil {
		return 0, false
	}
	current := time.Now().Unix() / 30
	for _, c := range []int64{current, current - 1, current + 1} {
		if c > after && secureEqual(totpCode(secret, c), code) {
			return c, true
		}
	}
	return 0, false
}
