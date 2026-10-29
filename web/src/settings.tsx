import { isWritableAccount } from "./accounts";
import { useEffect, useState, type FormEvent } from "react";
import { msg } from "./i18n";
import { post, currencyScales, type User, type Account } from "./api";
import { Help, Icon, Modal, ErrorText, type IconName } from "./ui";
import { ExchangeSettings } from "./preferences";
import { DisplaySettings } from "./display-settings";
import { AppearanceSettings, ServerAppearanceSettings } from "./appearance";
import { AdminAPISettings } from "./api-settings";
import type { Page } from "./navigation";

function ExchangeModal({
  user,
  refresh,
  notify,
  close,
}: {
  user: User;
  refresh: () => Promise<void>;
  notify: (s: string) => void;
  close: () => void;
}) {
  useEffect(() => {
    history.pushState({ ...history.state, exchange: true }, "", location.href);
    const pop = () => close();
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  return (
    <Modal
      title={msg("보조 통화와 환율")}
      onClose={() => {
        if (history.state?.exchange) history.back();
        else close();
      }}
    >
      <ExchangeSettings user={user} refresh={refresh} notify={notify} />
    </Modal>
  );
}
export function SettingsView({
  accounts = [],
  user,
  refresh,
  open,
  theme,
  setTheme,
  notify,
  exportJSON,
  exportCSV,
  showTrash,
  accent,
  setAccent,
  section,
  navigate,
}: {
  user: User;
  accounts?: Account[];
  refresh: () => Promise<void>;
  open: (
    k:
      | "sharing"
      | "security"
      | "api-keys"
      | "import"
      | "backup"
      | "lifecycle"
      | "admin"
      | "categories"
      | "ledger-manage"
      | "account-trash",
  ) => void;
  theme: string;
  setTheme: (v: string) => void;
  notify: (s: string) => void;
  exportJSON: () => void;
  exportCSV: () => void;
  showTrash: () => void;
  accent: string;
  setAccent: (s: string) => void;
  section: "settings" | "account-settings" | "administration";
  navigate: (p: Page) => void;
}) {
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [defaultAccount, setDefaultAccount] = useState(
    user.default_account_id || "",
  );
  const [name, setName] = useState(user.name);
  const [locale, setLocale] = useState(user.locale);
  const [timezone, setTimezone] = useState(user.timezone);
  const [defaultCurrency, setDefaultCurrency] = useState(
    user.default_currency || "KRW",
  );
  const [showSidebar, setShowSidebar] = useState(
    user.show_sidebar_message !== false,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setName(user.name);
    setLocale(user.locale);
    setTimezone(user.timezone);
    setDefaultCurrency(user.default_currency || "KRW");
    setDefaultAccount(
      accounts.some(
        (a) => a.id === user.default_account_id && isWritableAccount(a),
      )
        ? user.default_account_id || ""
        : "",
    );
    setShowSidebar(user.show_sidebar_message !== false);
    setError("");
  }, [
    section,
    user.name,
    user.locale,
    user.timezone,
    user.default_currency,
    user.default_account_id,
    user.show_sidebar_message,
  ]);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await post(
        "/me",
        {
          name,
          locale,
          timezone,
          default_currency: defaultCurrency,
          default_account_id: defaultAccount,
          show_sidebar_message: showSidebar,
        },
        "PATCH",
      );
      await refresh();
      notify(msg("설정을 저장했어요."));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const row = (
    title: string,
    description: string,
    action: () => void,
    label = msg("관리"),
  ) => (
    <div className="setting-row" key={title}>
      <div>
        <strong>{title}</strong>
        <Help>{description}</Help>
      </div>
      <button className="secondary-button" onClick={action}>
        {label}
      </button>
    </div>
  );
  return (
    <div className="settings-page">
      {exchangeOpen && (
        <ExchangeModal
          user={user}
          refresh={refresh}
          notify={notify}
          close={() => setExchangeOpen(false)}
        />
      )}
      <nav className="settings-tabs" aria-label={msg("설정 구분")}>
        {[
          ["account-settings", msg("계정 설정")],
          ["settings", msg("설정")],
          ...(user.admin ? [["administration", msg("관리")]] : []),
        ].map(([id, label]) => (
          <button
            key={id}
            aria-current={section === id ? "page" : undefined}
            className={section === id ? "active" : ""}
            onClick={() => navigate(id as Page)}
          >
            {label}
          </button>
        ))}
      </nav>
      {section === "account-settings" && (
        <section className="panel">
          <div className="setting-group">
            <h2>{msg("프로필")}</h2>
            <p className="profile-username">@{user.username}</p>
            <form onSubmit={save} className="inline-settings-form">
              <label className="form-label" htmlFor="profile-name-field">
                {msg("표시할 이름")}
              </label>
              <input
                id="profile-name-field"
                className="field-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                required
              />
              <button
                className="secondary-button settings-save"
                disabled={busy}
              >
                {msg("저장")}
              </button>
              <ErrorText error={error} />
            </form>
          </div>
          <div className="setting-group">
            <h2>{msg("로그인과 보안")}</h2>
            {row(
              msg("로그인 보안"),
              msg("비밀번호·복구 코드를 관리해요. 2단계 인증은 {0} 상태예요.", [
                user.totp_enabled ? msg("사용 중") : msg("미사용"),
              ]),
              () => open("security"),
            )}
            {row(
              msg("API 앱 비밀번호"),
              msg(
                "접근 계좌·권한·만료를 설정하고 앱 비밀번호를 발급·폐기해요.",
              ),
              () => open("api-keys"),
            )}
          </div>
        </section>
      )}
      {section === "settings" && (
        <>
          <section className="panel" data-settings-scope="account">
            <div className="setting-group">
              <h2 className="settings-section-title">
                {msg("계정 전체 설정")}
              </h2>
              <p className="settings-section-description">
                {msg("이 계정으로 로그인한 모든 기기에 적용해요.")}
              </p>
              <form onSubmit={save} className="inline-settings-form">
                <div className="form-two-cols">
                  <div>
                    <label className="form-label" htmlFor="locale">
                      {msg("언어")}
                    </label>
                    <select
                      id="locale"
                      className="field-select"
                      value={locale}
                      onChange={(e) =>
                        setLocale(e.target.value as User["locale"])
                      }
                    >
                      <option value="ko">{msg("한국어")}</option>
                      <option value="en">{"English"}</option>
                    </select>
                  </div>
                  <div>
                    <label className="form-label" htmlFor="timezone">
                      {msg("시간대")}
                    </label>
                    <select
                      id="timezone"
                      className="field-select"
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                    >
                      {[
                        ...new Set([
                          user.timezone,
                          "Asia/Seoul",
                          "Asia/Tokyo",
                          "UTC",
                          "America/New_York",
                          "America/Los_Angeles",
                          "Europe/London",
                          "Europe/Berlin",
                        ]),
                      ].map((v) => (
                        <option key={v}>{v}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="form-label">
                  <label htmlFor="default-currency">{msg("기본 통화")}</label>
                  <Help>
                    {msg(
                      "기본 통화로 합계를 봐요. 기존 계좌의 통화와 저장 금액은 그대로이며, 환산에는 등록한 환율을 사용해요.",
                    )}
                  </Help>
                </div>
                <select
                  id="default-currency"
                  className="field-select"
                  value={defaultCurrency}
                  onChange={(e) => setDefaultCurrency(e.target.value)}
                >
                  {Object.keys(currencyScales).map((code) => (
                    <option key={code} value={code}>
                      {
                        {
                          KRW: msg("대한민국 원"),
                          USD: msg("미국 달러"),
                          JPY: msg("일본 엔"),
                          EUR: msg("유로"),
                          GBP: msg("영국 파운드"),
                          CNY: msg("중국 위안"),
                          TWD: msg("대만 달러"),
                          VND: msg("베트남 동"),
                          KWD: msg("쿠웨이트 디나르"),
                        }[code]
                      }{" "}
                      ({code})
                    </option>
                  ))}
                </select>

                <div className="form-label">
                  <label htmlFor="default-account">
                    {msg("빠른 입력 기본 계좌")}
                  </label>
                  <Help>
                    {msg(
                      "특정 가계부를 선택하면 그 안의 계좌만 사용해요. 기본 계좌가 없으면 기본 통화와 같은 계좌를 우선해요.",
                    )}
                  </Help>
                </div>
                <select
                  id="default-account"
                  className="field-select"
                  value={defaultAccount}
                  onChange={(e) => setDefaultAccount(e.target.value)}
                >
                  <option value="">
                    {msg("자동 선택 · 기본 통화 계좌 우선")}
                  </option>
                  {accounts.filter(isWritableAccount).map((a) => (
                    <option value={a.id} key={a.id}>
                      {a.name} · {a.currency}
                    </option>
                  ))}
                </select>

                <label className="setting-row">
                  <span>{msg("소개 카드 표시 (왼쪽 메뉴·홈)")}</span>
                  <input
                    type="checkbox"
                    checked={showSidebar}
                    onChange={(e) => setShowSidebar(e.target.checked)}
                  />
                </label>
                <ErrorText error={error} />
                <button
                  className="secondary-button settings-save"
                  disabled={busy}
                >
                  {msg("설정 저장")}
                </button>
              </form>
              {row(
                msg("보조 통화와 환율"),
                msg("보조 통화를 추가하고 통화별 환율을 설정해요."),
                () => setExchangeOpen(true),
              )}
            </div>
          </section>
          <section className="panel" data-settings-scope="browser">
            <div className="setting-group">
              <h2 className="settings-section-title">
                {msg("브라우저별 화면 설정")}
              </h2>
              <p className="settings-section-description">
                {msg(
                  "밝기·색상·글씨 크기·화면 배치는 현재 브라우저에만 적용해요.",
                )}
              </p>
              <div className="setting-row appearance-row">
                <div>
                  <strong>{msg("화면 밝기")}</strong>
                </div>
                <div className="theme-buttons">
                  {[
                    ["light", msg("밝게"), "sun"],
                    ["dark", msg("어둡게"), "moon"],
                  ].map(([id, label, icon]) => (
                    <button
                      key={id}
                      className={theme === id ? "active" : ""}
                      aria-pressed={theme === id}
                      onClick={() => setTheme(id)}
                    >
                      <Icon name={icon as IconName} />
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="setting-row appearance-row">
                <div>
                  <strong>{msg("테마 색상")}</strong>
                </div>
                <div className="accent-options">
                  {[
                    ["green", msg("그린")],
                    ["rose", msg("로즈")],
                    ["blue", msg("블루")],
                    ["violet", msg("바이올렛")],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      className={`accent-choice ${id}`}
                      aria-pressed={accent === id}
                      onClick={() => setAccent(id)}
                    >
                      <i />
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <DisplaySettings userId={user.id} embedded />
            <AppearanceSettings userId={user.id} embedded />
          </section>
          <section className="panel">
            <div className="setting-group">
              <h2>{msg("가계부와 공유")}</h2>
              {row(
                msg("가계부 관리"),
                msg("가계부 생성·수정·삭제와 소개 문구·표시 순서를 관리해요."),
                () => open("ledger-manage"),
              )}
              {row(
                msg("가계부 분류 관리"),
                msg("수입·지출 분류를 추가·수정·삭제하고 순서를 바꿔요."),
                () => open("categories"),
              )}
              {row(
                msg("공유 관리"),
                msg("공유 초대·승인·역할 변경·공유 해제를 관리해요."),
                () => open("sharing"),
              )}
              {row(
                msg("책임자 이전·공유 나가기"),
                msg("기록을 유지하면서 책임자를 이전하거나 공유에서 나가요."),
                () => open("lifecycle"),
              )}
            </div>
          </section>
          <section className="panel">
            <div className="setting-group">
              <h2>{msg("자료 관리")}</h2>
              {row(
                msg("기록 휴지통"),
                msg("현재 조회 범위의 삭제한 거래를 확인·복구해요."),
                showTrash,
                msg("열기"),
              )}
              {row(
                msg("삭제한 계좌"),
                msg("내가 책임자인 삭제 계좌를 확인·복구해요."),
                () => open("account-trash"),
                msg("열기"),
              )}
              {row(
                msg("CSV 내보내기"),
                msg("조회 조건에 맞는 거래를 원래 통화로 CSV에 내보내요."),
                exportCSV,
                msg("내보내기"),
              )}
              {row(
                msg("JSON 자료 내보내기"),
                msg(
                  "전체 기간의 가계부 자료를 JSON으로 내보내요. 사진·공유 권한은 제외해요.",
                ),
                exportJSON,
                msg("내보내기"),
              )}
              {row(
                msg("CSV·JSON 가져오기"),
                msg("CSV·JSON 자료를 미리 보고 중복을 확인한 뒤 가져와요."),
                () => open("import"),
                msg("가져오기"),
              )}
            </div>
          </section>
        </>
      )}
      {section === "administration" && user.admin && (
        <section className="panel">
          <div className="setting-group">
            <h2>{msg("서버 관리")}</h2>
            {row(
              msg("사용자와 가입 관리"),
              msg("회원가입 허용 여부를 정하고 새 사용자를 초대해요."),
              () => open("admin"),
              msg("가입·초대 관리"),
            )}
            {row(
              msg("백업과 복원"),
              msg(
                "모든 사용자의 자료·사진을 백업·복원해요. 관리자만 사용할 수 있어요.",
              ),
              () => open("backup"),
              msg("관리"),
            )}
          </div>
        </section>
      )}
      {section === "administration" && user.admin && (
        <AdminAPISettings user={user} refresh={refresh} />
      )}
      {section === "administration" && user.admin && (
        <ServerAppearanceSettings />
      )}
    </div>
  );
}
