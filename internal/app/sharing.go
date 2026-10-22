package app

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"
)

func (a *App) ownsTarget(q queryer, u *User, kind, id string) error {
	var owner, ledgerKind string
	var err error
	if kind == "account" {
		err = q.QueryRow("SELECT l.owner_id,l.kind FROM accounts a JOIN ledgers l ON l.id=a.ledger_id WHERE a.id=? AND l.deleted_at IS NULL", id).Scan(&owner, &ledgerKind)
	} else if kind == "ledger" {
		err = q.QueryRow("SELECT owner_id,kind FROM ledgers WHERE id=? AND deleted_at IS NULL", id).Scan(&owner, &ledgerKind)
	} else {
		return bad("공유 대상을 확인해 주세요.")
	}
	if errors.Is(err, sql.ErrNoRows) {
		return missing()
	}
	if err != nil {
		return err
	}
	if owner != u.ID {
		return missing()
	}
	if kind == "ledger" && ledgerKind != "shared" {
		return bad("가계부 전체 공유는 공유 가계부에서만 가능해요. 개인 가계부는 특정 계좌만 공유해 주세요.")
	}
	return nil
}

type Invitation struct {
	ID         string `json:"id"`
	Type       string `json:"target_type"`
	Target     string `json:"target_id"`
	TargetName string `json:"target_name"`
	Role       string `json:"role"`
	Status     string `json:"status"`
	Expires    int64  `json:"expires_at"`
	Claimant   string `json:"claimant_id"`
	Name       string `json:"claimant_name"`
	Username   string `json:"claimant_username"`
}

func (a *App) sharing(w http.ResponseWriter, r *http.Request, u *User) error {
	rows, err := a.DB.Query(`SELECT i.id,i.target_type,i.target_id,COALESCE(CASE WHEN i.target_type='ledger' THEN l.name ELSE ac.name END,''),i.role,i.status,i.expires_at,COALESCE(i.claimant_id,''),COALESCE(c.name,''),COALESCE(c.username,'') FROM invitations i LEFT JOIN ledgers l ON i.target_type='ledger' AND l.id=i.target_id LEFT JOIN accounts ac ON i.target_type='account' AND ac.id=i.target_id LEFT JOIN users c ON c.id=i.claimant_id WHERE i.owner_id=? ORDER BY i.created_at DESC`, u.ID)
	if err != nil {
		return err
	}
	invites := []Invitation{}
	for rows.Next() {
		var v Invitation
		if err = rows.Scan(&v.ID, &v.Type, &v.Target, &v.TargetName, &v.Role, &v.Status, &v.Expires, &v.Claimant, &v.Name, &v.Username); err != nil {
			rows.Close()
			return err
		}
		invites = append(invites, v)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	rows, err = a.DB.Query(`SELECT 'account',g.account_id,a.name,g.user_id,u.name,u.username,g.role FROM grants g JOIN accounts a ON a.id=g.account_id JOIN ledgers l ON l.id=a.ledger_id JOIN users u ON u.id=g.user_id WHERE l.owner_id=? AND l.deleted_at IS NULL UNION ALL SELECT 'ledger',m.ledger_id,l.name,m.user_id,u.name,u.username,m.role FROM members m JOIN ledgers l ON l.id=m.ledger_id JOIN users u ON u.id=m.user_id WHERE l.owner_id=? AND l.deleted_at IS NULL`, u.ID, u.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	shares := []map[string]string{}
	for rows.Next() {
		var typ, id, name, uid, uname, username, role string
		if err = rows.Scan(&typ, &id, &name, &uid, &uname, &username, &role); err != nil {
			return err
		}
		shares = append(shares, map[string]string{"target_type": typ, "target_id": id, "target_name": name, "user_id": uid, "name": uname, "username": username, "role": role})
	}
	if err = rows.Err(); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]any{"invitations": invites, "shares": shares})
	return nil
}
func (a *App) createInvitation(w http.ResponseWriter, r *http.Request, u *User) error {
	var v struct {
		Type string `json:"target_type"`
		ID   string `json:"target_id"`
		Role string `json:"role"`
	}
	if err := decode(r, &v); err != nil {
		return err
	}
	if v.Role != "editor" && v.Role != "viewer" {
		return bad("공유 역할을 확인해 주세요.")
	}
	if err := a.ownsTarget(a.DB, u, v.Type, v.ID); err != nil {
		return err
	}
	id := newID()
	token := encode64(random(32))
	expires := time.Now().Add(48 * time.Hour).Unix()
	if _, err := a.DB.Exec("INSERT INTO invitations(id,token_hash,owner_id,target_type,target_id,role,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?)", id, tokenHash(token), u.ID, v.Type, v.ID, v.Role, expires, now()); err != nil {
		return err
	}
	if err := audit(a.DB, u, "invitation_created", v.Type, v.ID); err != nil {
		return err
	}
	writeJSON(w, 201, map[string]any{"id": id, "token": token, "expires_at": expires})
	return nil
}
func (a *App) claim(q queryer, token, uid string) error {
	var id, owner, status string
	var expires int64
	err := q.QueryRow("SELECT id,owner_id,status,expires_at FROM invitations WHERE token_hash=?", tokenHash(token)).Scan(&id, &owner, &status, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return bad("유효하지 않은 초대예요.")
	}
	if err != nil {
		return err
	}
	if status != "open" || expires < time.Now().Unix() {
		return bad("이미 사용했거나 만료된 초대예요.")
	}
	if owner == uid {
		return bad("본인의 초대는 수락할 수 없어요.")
	}
	res, err := q.Exec("UPDATE invitations SET claimant_id=?,status='pending' WHERE id=? AND status='open'", uid, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		return conflict("이미 처리된 초대예요.")
	}
	return nil
}
func (a *App) acceptInvitation(w http.ResponseWriter, r *http.Request, u *User) error {
	var v struct {
		Token string `json:"token"`
	}
	if err := decode(r, &v); err != nil {
		return err
	}
	if err := a.claim(a.DB, v.Token, u.ID); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]string{"status": "pending"})
	return nil
}
func (a *App) join(w http.ResponseWriter, r *http.Request, u *User) error {
	if !a.rateAllowed(r, "join", 10) {
		return &apiError{429, "rate_limit", "잠시 후 다시 시도해 주세요."}
	}
	var c credentials
	if err := decode(r, &c); err != nil {
		return err
	}
	if err := validateCredentials(&c); err != nil {
		return err
	}
	tx, err := a.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var valid int
	if err = tx.QueryRow("SELECT COUNT(*) FROM invitations WHERE token_hash=? AND status='open' AND expires_at>?", tokenHash(c.Token), time.Now().Unix()).Scan(&valid); err != nil {
		return err
	}
	financialInvite := valid == 1
	accountInvite := false
	if c.Token != "" && !financialInvite {
		var n int
		if err = tx.QueryRow("SELECT COUNT(*) FROM account_invitations WHERE token_hash=? AND claimant_id IS NULL AND cancelled=0 AND expires_at>?", tokenHash(c.Token), time.Now().Unix()).Scan(&n); err != nil {
			return err
		}
		accountInvite = n == 1
	}
	if !financialInvite && !accountInvite && (c.Token != "" || !a.registrationOpenTx(tx)) {
		return bad("현재는 유효한 초대가 있어야 가입할 수 있어요.")
	}
	var duplicate int
	if err = tx.QueryRow("SELECT COUNT(*) FROM users WHERE username=?", c.Username).Scan(&duplicate); err != nil {
		return err
	}
	if duplicate > 0 {
		return conflict("사용할 수 없는 아이디예요. 기존 계정이라면 로그인 후 수락해 주세요.")
	}
	id := newID()
	if _, err = tx.Exec("INSERT INTO users(id,username,name,password,created_at) VALUES(?,?,?,?,?)", id, c.Username, c.Name, passwordHash(c.Password), now()); err != nil {
		return err
	}
	if err = createPersonal(tx, id); err != nil {
		return err
	}
	if financialInvite {
		if err = a.claim(tx, c.Token, id); err != nil {
			return err
		}
	}
	if accountInvite {
		if _, err = tx.Exec("UPDATE account_invitations SET claimant_id=? WHERE token_hash=? AND claimant_id IS NULL AND cancelled=0", id, tokenHash(c.Token)); err != nil {
			return err
		}
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	return a.issueSession(w, id, 201, financialInvite)
}
func (a *App) approveInvitation(w http.ResponseWriter, r *http.Request, u *User) error {
	var typ, target, role, status, claimant string
	var expires int64
	err := a.DB.QueryRow("SELECT target_type,target_id,role,status,COALESCE(claimant_id,''),expires_at FROM invitations WHERE id=? AND owner_id=?", r.PathValue("id"), u.ID).Scan(&typ, &target, &role, &status, &claimant, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return missing()
	}
	if err != nil {
		return err
	}
	if status != "pending" || claimant == "" || expires < time.Now().Unix() {
		return conflict("승인할 수 없는 초대예요.")
	}
	if err = a.ownsTarget(a.DB, u, typ, target); err != nil {
		return err
	}
	tx, err := a.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	table, column := "grants", "account_id"
	if typ == "ledger" {
		table, column = "members", "ledger_id"
	}
	var current string
	err = tx.QueryRow("SELECT role FROM "+table+" WHERE "+column+"=? AND user_id=?", target, claimant).Scan(&current)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if current == "editor" {
		role = "editor"
	}
	if _, err = tx.Exec("INSERT INTO "+table+"("+column+",user_id,role) VALUES(?,?,?) ON CONFLICT("+column+",user_id) DO UPDATE SET role=excluded.role", target, claimant, role); err != nil {
		return err
	}
	if _, err = tx.Exec("UPDATE invitations SET status='approved' WHERE id=?", r.PathValue("id")); err != nil {
		return err
	}
	if err = audit(tx, u, "share_approved", typ, target); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}
func (a *App) cancelInvitation(w http.ResponseWriter, r *http.Request, u *User) error {
	res, err := a.DB.Exec("UPDATE invitations SET status='cancelled' WHERE id=? AND owner_id=? AND status IN('open','pending')", r.PathValue("id"), u.ID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		return missing()
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}
func (a *App) revokeShare(w http.ResponseWriter, r *http.Request, u *User) error {
	typ, target, uid := r.PathValue("type"), r.PathValue("target"), r.PathValue("user")
	if err := a.ownsTarget(a.DB, u, typ, target); err != nil {
		return err
	}
	if uid == u.ID {
		return bad("책임자 권한은 해제할 수 없어요.")
	}
	table, column := "grants", "account_id"
	if typ == "ledger" {
		table, column = "members", "ledger_id"
	}
	tx, err := a.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.Exec("DELETE FROM "+table+" WHERE "+column+"=? AND user_id=?", target, uid)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		return missing()
	}
	if err = audit(tx, u, "share_revoked", typ, target); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]string{"message": "이 공유 경로를 해제했어요. 다른 가계부·계좌 공유 권한이 남아 있으면 접근도 유지돼요."})
	return nil
}
func (a *App) changeShare(w http.ResponseWriter, r *http.Request, u *User) error {
	typ, target, uid := r.PathValue("type"), r.PathValue("target"), r.PathValue("user")
	if err := a.ownsTarget(a.DB, u, typ, target); err != nil {
		return err
	}
	var v struct {
		Role string `json:"role"`
	}
	if err := decode(r, &v); err != nil {
		return err
	}
	if v.Role != "viewer" && v.Role != "editor" {
		return bad("역할을 확인해 주세요.")
	}
	table, column := "grants", "account_id"
	if typ == "ledger" {
		table, column = "members", "ledger_id"
	}
	res, err := a.DB.Exec("UPDATE "+table+" SET role=? WHERE "+column+"=? AND user_id=?", v.Role, target, uid)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		return missing()
	}
	if err = audit(a.DB, u, "share_role_changed", typ, target); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
	return nil
}
func (a *App) listAudit(w http.ResponseWriter, r *http.Request, u *User) error {
	// Only an owner's management events are exposed; hidden transaction metadata is
	// never used as an activity feed for a partially shared account.
	rows, err := a.DB.Query("SELECT action,target_type,created_at FROM audit WHERE actor_id=? ORDER BY created_at DESC LIMIT 100", u.ID)
	if err != nil {
		return err
	}
	defer rows.Close()
	out := []map[string]string{}
	for rows.Next() {
		var action, typ, created string
		if err = rows.Scan(&action, &typ, &created); err != nil {
			return err
		}
		out = append(out, map[string]string{"action": strings.ReplaceAll(action, "_", " "), "target_type": typ, "created_at": created})
	}
	if err = rows.Err(); err != nil {
		return err
	}
	writeJSON(w, 200, out)
	return nil
}

func (a *App) transferOwner(w http.ResponseWriter, r *http.Request, u *User) error {
	if !a.rateAllowed(r, "owner-transfer:"+u.ID, 10) {
		return &apiError{429, "rate_limit", "잠시 후 다시 시도해 주세요."}
	}
	id := r.PathValue("id")
	if err := a.ownsTarget(a.DB, u, "ledger", id); err != nil {
		return err
	}
	var v struct {
		UserID   string `json:"user_id"`
		Password string `json:"password"`
		Code     string `json:"code"`
	}
	if err := decode(r, &v); err != nil {
		return err
	}
	if v.UserID == u.ID {
		return bad("다른 멤버를 선택해 주세요.")
	}
	if err := a.reauth(u, v.Password, v.Code); err != nil {
		return err
	}
	tx, err := a.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var member int
	if err = tx.QueryRow("SELECT COUNT(*) FROM members WHERE ledger_id=? AND user_id=?", id, v.UserID).Scan(&member); err != nil {
		return err
	}
	if member != 1 {
		return bad("이 가계부에 이미 참여한 멤버만 책임자가 될 수 있어요.")
	}
	if _, err = tx.Exec("UPDATE ledgers SET owner_id=? WHERE id=?", v.UserID, id); err != nil {
		return err
	}
	if _, err = tx.Exec("DELETE FROM members WHERE ledger_id=? AND user_id=?", id, v.UserID); err != nil {
		return err
	}
	if _, err = tx.Exec("INSERT INTO members(ledger_id,user_id,role) VALUES(?,?,'editor') ON CONFLICT(ledger_id,user_id) DO UPDATE SET role='editor'", id, u.ID); err != nil {
		return err
	}
	if _, err = tx.Exec("UPDATE invitations SET status='cancelled' WHERE owner_id=? AND status IN('open','pending') AND ((target_type='ledger' AND target_id=?) OR (target_type='account' AND target_id IN(SELECT id FROM accounts WHERE ledger_id=?)))", u.ID, id, id); err != nil {
		return err
	}
	if err = audit(tx, u, "owner_transferred", "ledger", id); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]string{"message": "책임자를 이전했어요. 기존 책임자는 편집자로 남고, 필요하면 가계부에서 나갈 수 있어요."})
	return nil
}
func (a *App) leaveLedger(w http.ResponseWriter, r *http.Request, u *User) error {
	id := r.PathValue("id")
	role, err := a.ledgerRole(a.DB, u, id)
	if err != nil {
		return err
	}
	if role == "owner" {
		return conflict("책임자는 먼저 다른 멤버에게 책임을 이전해야 해요.")
	}
	tx, err := a.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec("DELETE FROM members WHERE ledger_id=? AND user_id=?", id, u.ID); err != nil {
		return err
	}
	if err = audit(tx, u, "left", "ledger", id); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]string{"message": "가계부에서 나왔어요. 원본 기록과 따로 공유받은 계좌 권한은 유지됩니다."})
	return nil
}
func (a *App) leaveAccount(w http.ResponseWriter, r *http.Request, u *User) error {
	id := r.PathValue("id")
	ac, err := a.account(a.DB, u, id)
	if err != nil {
		return err
	}
	if ac.Role == "owner" {
		return bad("본인이 관리하는 계좌의 책임자 권한은 해제할 수 없어요.")
	}
	result, err := a.DB.Exec("DELETE FROM grants WHERE account_id=? AND user_id=?", id, u.ID)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n != 1 {
		return bad("직접 공유받은 권한이 없어요. 가계부 멤버 권한으로 보고 있다면 가계부에서 나가야 해요.")
	}
	if err = audit(a.DB, u, "left", "account", id); err != nil {
		return err
	}
	writeJSON(w, 200, map[string]string{"message": "이 계좌의 직접 공유 권한을 해제했어요. 다른 공유 경로가 남아 있으면 접근도 유지됩니다."})
	return nil
}
