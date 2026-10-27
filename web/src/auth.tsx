import { useState, type FormEvent } from "react";
import { msg, useLocale, setLocale as setLanguage } from "./i18n";
import { post, APIError, type User } from "./api";
import { Brand, Icon, PasswordInput, ErrorText, Busy } from "./ui";

export function Auth({
  initialized: initialConfigured,
  registrationOpen = false,
  invite,
  onLogin,
}: {
  initialized: boolean;
  registrationOpen?: boolean;
  invite: string;
  onLogin: (u: User, joined: boolean) => void;
}) {
  const language = useLocale();
  const [join, setJoin] = useState(false);
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [setupClosed, setSetupClosed] = useState(false);
  const initialized = initialConfigured || setupClosed;
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(false);
  const [needCode, setNeedCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const form = new FormData(e.currentTarget as HTMLFormElement);
    const enteredPassword = String(form.get("auth-password") || "");
    const enteredUsername = String(form.get("auth-username") || "");
    const enteredName = String(form.get("auth-name") || "");
    if (
      (!initialized || join) &&
      enteredPassword !== String(form.get("confirm-password") || "")
    ) {
      setError(msg("두 비밀번호가 같지 않아요."));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const u = await post<User>(
        !initialized ? "/setup" : join ? "/join" : "/login",
        !initialized
          ? {
              username: enteredUsername,
              name: enteredName,
              password: enteredPassword,
            }
          : join
            ? {
                username: enteredUsername,
                name: enteredName,
                password: enteredPassword,
                token: invite,
              }
            : {
                username: enteredUsername,
                password: enteredPassword,
                code,
                remember,
              },
      );
      onLogin(u, join);
    } catch (e) {
      if (!initialized && e instanceof APIError && e.code === "conflict") {
        setSetupClosed(true);
        setJoin(false);
        setError(
          msg(
            "이미 관리자 계정이 만들어졌어요. 기존 계정으로 로그인해 주세요.",
          ),
        );
        return;
      }
      if (e instanceof APIError && e.code === "totp_required")
        setNeedCode(true);
      setError(e instanceof Error ? e.message : msg("로그인하지 못했어요."));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-shell">
      <aside className="auth-story">
        <Brand />
        <div>
          <p className="eyebrow">PERSONAL, TOGETHER.</p>
          <h1>
            {msg("내 기록은 나답게.")}
            <br />
            {msg("우리의 기록은 함께.")}
          </h1>
          <p>
            {msg("혼자 쓰는 가계부부터 함께 쓰는 생활비까지.")}
            <br />
            {msg("일상의 모든 기록을 한곳에 모아보세요.")}
          </p>
          <div className="auth-illustration" aria-hidden="true">
            <div className="illustration-book book-one">
              <Icon name="lock" />
              <i />
              <i />
              <i />
            </div>
            <div className="illustration-book book-two">
              <Icon name="people" />
              <i />
              <i />
              <i />
            </div>
            <span className="illustration-leaf">
              <Icon name="leaf" />
            </span>
          </div>
        </div>
        <small>{msg("나의 서버에, 나의 기록.")}</small>
      </aside>
      <main className="auth-main">
        <div className="auth-mobile-brand">
          <Brand />
        </div>
        <section className="auth-card">
          <label className="auth-language">
            {msg("언어")}
            <select
              aria-label={msg("언어")}
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              <option value="ko">한국어</option>
              <option value="en">English</option>
            </select>
          </label>
          <p className="eyebrow">
            <Icon name="leaf" />
            DUET LEDGER
          </p>
          <h2>
            {!initialized
              ? msg("나만의 기록을 시작해요.")
              : join
                ? invite
                  ? msg("초대를 받아 함께 시작해요.")
                  : msg("새 계정으로 시작해요.")
                : msg("다시 만나 반가워요.")}
          </h2>
          <p className="auth-subtitle">
            {!initialized
              ? msg("첫 관리자 계정과 개인 가계부를 만들어요.")
              : join
                ? invite
                  ? msg("계정을 만들고 초대를 수락해요.")
                  : msg("개인 가계부와 함께 새 계정을 만들어요.")
                : msg("오늘의 작은 기록을 이어가볼까요?")}
          </p>
          {(invite || registrationOpen) && initialized && (
            <div className="entry-types">
              <button
                onClick={() => {
                  setJoin(false);
                  setError("");
                }}
                aria-pressed={!join}
              >
                {msg("기존 계정으로 로그인")}
              </button>
              <button
                onClick={() => {
                  setJoin(true);
                  setError("");
                }}
                aria-pressed={join}
              >
                {msg("회원가입")}
              </button>
            </div>
          )}
          <form onSubmit={submit}>
            {!initialized && (
              <p className="setup-hint">
                {msg("처음 만든 계정이 관리자가 됩니다.")}
                <br />
                {msg("외부에 공개하기 전에 계정을 만들어 주세요.")}
              </p>
            )}
            {(!initialized || join) && (
              <>
                <label className="form-label" htmlFor="auth-name">
                  {msg("표시할 이름")}
                </label>
                <input
                  id="auth-name"
                  name="auth-name"
                  className="field-input"
                  autoComplete="name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={40}
                />
              </>
            )}
            <label className="form-label" htmlFor="auth-username">
              {msg("아이디")}
            </label>
            <input
              id="auth-username"
              name="auth-username"
              className="field-input"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
              maxLength={32}
              placeholder={msg("영문 소문자·숫자 3~32자")}
            />
            <label className="form-label" htmlFor="auth-password">
              {msg("비밀번호")}
              {!initialized || join ? msg(" · 8자 이상") : ""}
            </label>
            <PasswordInput
              id="auth-password"
              type="password"
              className="field-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={!initialized || join ? 8 : 1}
              maxLength={256}
              autoComplete={
                !initialized || join ? "new-password" : "current-password"
              }
            />
            {(!initialized || join) && (
              <>
                <label className="form-label" htmlFor="confirm-password">
                  {msg("비밀번호 다시 입력")}
                </label>
                <PasswordInput
                  id="confirm-password"
                  type="password"
                  className="field-input"
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                  required
                  autoComplete="new-password"
                />
              </>
            )}
            {needCode && (
              <>
                <label className="form-label" htmlFor="auth-code">
                  {msg("인증 앱 코드 또는 복구 코드")}
                </label>
                <input
                  id="auth-code"
                  className="field-input"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoComplete="one-time-code"
                  required
                  autoFocus
                />
              </>
            )}
            {initialized && !join && (
              <label className="remember-login">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                {msg("30일 동안 로그인 유지")}
              </label>
            )}
            <ErrorText error={error} />
            <button className="primary-button entry-submit" disabled={busy}>
              <Busy busy={busy}>
                {!initialized
                  ? msg("내 가계부 시작하기")
                  : join
                    ? invite
                      ? msg("계정 생성·초대 수락")
                      : msg("가입하고 시작하기")
                    : msg("로그인")}
                <Icon name="arrow" />
              </Busy>
            </button>
          </form>
          <div className="auth-footnote">
            <Icon name="shield" />
            {invite
              ? msg(
                  "계정 초대는 가입을 허용하고, 공유 초대는 책임자 승인 후 내역이 보여요.",
                )
              : msg("공유 설정 없이 개인용으로만 사용해도 좋아요.")}
          </div>
        </section>
      </main>
    </div>
  );
}
