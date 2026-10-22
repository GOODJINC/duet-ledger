import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { createRoot } from "react-dom/client";
import {
  api,
  post,
  download,
  setCSRF,
  APIError,
  formatMoney,
  today,
  dateRange,
  categories,
  categoryName,
  kindNames,
  type User,
  type Ledger,
  type Account,
  type Transaction,
  type Report,
} from "./api";
import {
  PasswordInput,
  Brand,
  Icon,
  Privacy,
  Modal,
  Empty,
  ErrorText,
  Busy,
  type IconName,
} from "./ui";
import {
  EntryDialog,
  LedgerDialog,
  AccountDialog,
  DetailDialog,
  type DialogProps,
} from "./dialogs";
import {
  LifecycleDialog,
  SharingDialog,
  AcceptInviteDialog,
  ImportDialog,
  BackupDialog,
  SecurityDialog,
} from "./management";
import { CategoriesDialog, AdminDialog } from "./preferences";
import "./app.css";

type Page = "home" | "ledger" | "stats" | "accounts" | "settings";
type ModalState =
  | { kind: "entry"; tx?: Transaction; account?: string }
  | { kind: "account"; account?: Account }
  | { kind: "ledgers" }
  | { kind: "detail"; tx: Transaction }
  | {
      kind:
        | "sharing"
        | "import"
        | "backup"
        | "security"
        | "lifecycle"
        | "admin"
        | "categories"
        | "ledger-manage";
    }
  | null;
const navigation: {
  id: Page;
  label: string;
  short: string;
  en: string;
  icon: IconName;
}[] = [
  { id: "home", label: "홈", short: "홈", en: "Home", icon: "home" },
  {
    id: "ledger",
    label: "가계부",
    short: "가계부",
    en: "Ledger",
    icon: "book",
  },
  {
    id: "stats",
    label: "통계·분석",
    short: "통계",
    en: "Insights",
    icon: "chart",
  },
  {
    id: "accounts",
    label: "계좌·자산",
    short: "계좌",
    en: "Accounts",
    icon: "wallet",
  },
  {
    id: "settings",
    label: "설정",
    short: "설정",
    en: "Settings",
    icon: "settings",
  },
];
const emptyReport: Report = {
  items: [],
  count: 0,
  page: 1,
  page_size: 50,
  totals: [],
  categories: [],
  daily: [],
};
const initialInvite = location.hash.startsWith("#invite=")
  ? location.hash.slice(8)
  : "";
if (initialInvite) history.replaceState(null, "", location.pathname);

function Root() {
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(true);
  const [registrationOpen, setRegistrationOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState("");
  const [invite, setInvite] = useState(initialInvite);
  const [joined, setJoined] = useState(false);
  const boot = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const s = await api<{ initialized: boolean; registration_open: boolean }>(
        "/status",
      );
      setInitialized(s.initialized);
      setRegistrationOpen(s.registration_open);
      if (s.initialized) {
        try {
          const u = await api<User>("/me");
          setCSRF(u.csrf);
          setUser(u);
        } catch (e) {
          if (!(e instanceof APIError && e.status === 401)) throw e;
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "연결하지 못했어요.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    boot();
    const logout = () => {
      setUser(null);
      setCSRF("");
      api<{ initialized: boolean; registration_open: boolean }>("/status")
        .then((s) => {
          setInitialized(s.initialized);
          setRegistrationOpen(s.registration_open);
        })
        .catch(() => {});
    };
    window.addEventListener("duet-ledger:unauthorized", logout);
    return () => window.removeEventListener("duet-ledger:unauthorized", logout);
  }, []);
  useEffect(() => {
    if ("serviceWorker" in navigator)
      navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, []);
  if (loading)
    return (
      <div className="boot-screen">
        <Brand />
        <Icon name="loader" className="spin" />
        <p>나의 기록을 준비하고 있어요.</p>
      </div>
    );
  if (error)
    return (
      <div className="boot-screen">
        <Brand />
        <ErrorText error={error} />
        <button className="primary-button" onClick={boot}>
          다시 연결
        </button>
      </div>
    );
  if (!user)
    return (
      <Auth
        initialized={initialized}
        registrationOpen={registrationOpen}
        invite={invite}
        onLogin={(u, isJoin) => {
          setCSRF(u.csrf);
          setUser(u);
          setInitialized(true);
          if (isJoin) {
            setInvite("");
            setJoined(!!u.sharing_pending);
          }
        }}
      />
    );
  return (
    <Application
      user={user}
      setUser={setUser}
      invite={invite}
      clearInvite={() => setInvite("")}
      joined={joined}
    />
  );
}
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
  const [join, setJoin] = useState(false);
  const [username, setUsername] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [setupClosed, setSetupClosed] = useState(false);
  const initialized = initialConfigured || setupClosed;
  const [code, setCode] = useState("");
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
      setError("두 비밀번호가 같지 않아요.");
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
            : { username: enteredUsername, password: enteredPassword, code },
      );
      onLogin(u, join);
    } catch (e) {
      if (!initialized && e instanceof APIError && e.code === "conflict") {
        setSetupClosed(true);
        setJoin(false);
        setError(
          "이미 관리자 계정이 만들어졌어요. 기존 계정으로 로그인해 주세요.",
        );
        return;
      }
      if (e instanceof APIError && e.code === "totp_required")
        setNeedCode(true);
      setError(e instanceof Error ? e.message : "로그인하지 못했어요.");
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
            내 기록은 나답게.
            <br />
            우리의 기록은 함께.
          </h1>
          <p>
            혼자 쓰는 가계부부터 함께 쓰는 생활비까지.
            <br />
            일상의 모든 기록을 한곳에 모아보세요.
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
        <small>나의 서버에, 나의 기록.</small>
      </aside>
      <main className="auth-main">
        <div className="auth-mobile-brand">
          <Brand />
        </div>
        <section className="auth-card">
          <p className="eyebrow">
            <Icon name="leaf" />
            DUET LEDGER
          </p>
          <h2>
            {!initialized
              ? "나만의 기록을 시작해요."
              : join
                ? invite
                  ? "초대를 받아 함께 시작해요."
                  : "새 계정으로 시작해요."
                : "다시 만나 반가워요."}
          </h2>
          <p className="auth-subtitle">
            {!initialized
              ? "첫 관리자 계정과 개인 가계부를 만들어요."
              : join
                ? invite
                  ? "계정을 만들고 초대를 수락해요."
                  : "개인 가계부와 함께 새 계정을 만들어요."
                : "오늘의 작은 기록을 이어가볼까요?"}
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
                기존 계정으로 로그인
              </button>
              <button
                onClick={() => {
                  setJoin(true);
                  setError("");
                }}
                aria-pressed={join}
              >
                회원가입
              </button>
            </div>
          )}
          <form onSubmit={submit}>
            {!initialized && (
              <p className="setup-hint">
                처음 만든 계정이 관리자가 됩니다.
                <br />
                외부에 공개하기 전에 계정을 만들어 주세요.
              </p>
            )}
            {(!initialized || join) && (
              <>
                <label className="form-label" htmlFor="auth-name">
                  표시할 이름
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
              아이디
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
              placeholder="영문 소문자·숫자 3~32자"
            />
            <label className="form-label" htmlFor="auth-password">
              비밀번호{!initialized || join ? " · 8자 이상" : ""}
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
                  비밀번호 다시 입력
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
                  인증 앱 코드 또는 복구 코드
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
            <ErrorText error={error} />
            <button className="primary-button entry-submit" disabled={busy}>
              <Busy busy={busy}>
                {!initialized
                  ? "내 가계부 시작하기"
                  : join
                    ? invite
                      ? "계정 생성·초대 수락"
                      : "가입하고 시작하기"
                    : "로그인"}
                <Icon name="arrow" />
              </Busy>
            </button>
          </form>
          <div className="auth-footnote">
            <Icon name="shield" />
            {invite
              ? "계정 초대는 가입을 허용하고, 공유 초대는 책임자 승인 후 내역이 보여요."
              : "공유 설정 없이 개인용으로만 사용해도 좋아요."}
          </div>
        </section>
      </main>
    </div>
  );
}

function Application({
  user,
  setUser,
  invite,
  clearInvite,
  joined,
}: {
  user: User;
  setUser: (u: User | null) => void;
  invite: string;
  clearInvite: () => void;
  joined: boolean;
}) {
  const [page, setPage] = useState<Page>("home");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [report, setReport] = useState<Report>(emptyReport);
  const [scope, setScope] = useState("all");
  const [ledger, setLedger] = useState("");
  const [currency, setCurrency] = useState("KRW");
  const [date, setDate] = useState(today(user.timezone));
  const [period, setPeriod] = useState("month");
  const [search, setSearch] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [trash, setTrash] = useState(false);
  const [view, setView] = useState("list");
  const [day, setDay] = useState("");
  const [pageNumber, setPageNumber] = useState(1);
  const [modal, setModal] = useState<ModalState>(null);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(navigator.onLine);
  const [theme, setTheme] = useState(
    () => localStorage.getItem("duet-ledger-theme") || "light",
  );
  const en = user.locale === "en";
  const requestVersion = useRef(0);
  const [from, to] = dateRange(date, page === "ledger" ? period : "month");
  const params = useMemo(
    () =>
      new URLSearchParams({
        from,
        to,
        scope: ledger ? "all" : scope,
        currency,
        search: page === "ledger" ? searchTerm : "",
        account: page === "ledger" ? accountFilter : "",
        type: page === "ledger" ? typeFilter : "",
        trash: String(page === "ledger" && trash),
        ledger,
        page: String(pageNumber),
        page_size: page === "ledger" && view === "calendar" ? "200" : "50",
      }),
    [
      from,
      to,
      scope,
      currency,
      searchTerm,
      accountFilter,
      typeFilter,
      trash,
      ledger,
      page,
      pageNumber,
      view,
    ],
  );
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const [a, l, t, u] = await Promise.all([
        api<Account[]>("/accounts"),
        api<Ledger[]>("/ledgers"),
        api<Report>("/transactions?" + params.toString()),
        api<User>("/me"),
      ]);
      if (version !== requestVersion.current) return;
      setAccounts(a);
      setLedgers(l);
      if (ledger && !l.some((item) => item.id === ledger)) setLedger("");
      if (accountFilter && !a.some((item) => item.id === accountFilter))
        setAccountFilter("");
      setReport(t);
      setCSRF(u.csrf);
      setUser(u);
      setError("");
    } catch (e) {
      if (version === requestVersion.current)
        setError(e instanceof Error ? e.message : "불러오지 못했어요.");
      throw e;
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [params.toString()]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    refresh().catch(() => {});
    const timer = setInterval(() => {
      if (active && document.visibilityState === "visible")
        refresh().catch(() => {});
    }, 15000);
    const focus = () => {
      if (active) refresh().catch(() => {});
    };
    window.addEventListener("focus", focus);
    return () => {
      active = false;
      requestVersion.current++;
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [refresh]);
  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 5000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    document.body.dataset.theme = theme;
    localStorage.setItem("duet-ledger-theme", theme);
  }, [theme]);
  useEffect(() => {
    const on = () => setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", on);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", on);
    };
  }, []);
  useEffect(() => {
    const contextual = accounts.filter(
      (a) =>
        (!ledger || a.ledger_id === ledger) &&
        (!!ledger || scope === "all" || a.shared === (scope === "shared")),
    );
    const currencies = [...new Set(contextual.map((a) => a.currency))];
    if (currencies.length && !currencies.includes(currency))
      setCurrency(currencies[0]);
  }, [accounts, ledger, scope]);
  function navigate(p: Page) {
    setPage(p);
    setPageNumber(1);
    setTrash(false);
    setDay("");
    window.scrollTo(0, 0);
  }
  const visibleAccounts = accounts.filter(
    (a) =>
      (!!ledger || scope === "all" || a.shared === (scope === "shared")) &&
      (!ledger || a.ledger_id === ledger),
  );
  const moneyAccounts = visibleAccounts.filter((a) => a.currency === currency);
  const scale = accounts.find((a) => a.currency === currency)?.scale || 0;
  const selectedLedger = ledgers.find((l) => l.id === ledger);
  const totals = report.totals.find((t) => t.currency === currency);
  const balance = moneyAccounts.reduce((s, a) => s + BigInt(a.balance), 0n);
  const dialogProps: DialogProps = {
    selectedLedger: ledger,
    user,
    accounts,
    ledgers,
    refresh,
    close: () => setModal(null),
    notify: setToast,
  };
  function openEntry(account?: string) {
    if (!visibleAccounts.some((a) => !a.archived && a.role !== "viewer")) {
      if (ledger && selectedLedger?.role !== "owner") {
        setToast("이 가계부의 책임자에게 계좌 생성을 요청해 주세요.");
        return;
      }
      setModal({ kind: "account" });
      return;
    }
    setModal({ kind: "entry", account });
  }
  function moveMonth(delta: number) {
    const [y, m, d] = date.split("-").map(Number);
    const next = new Date(y, m - 1 + delta, 1);
    const day = Math.min(
      d,
      new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate(),
    );
    setDate(
      `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    );
    setPageNumber(1);
    setDay("");
  }
  function scopeChange(v: string) {
    setScope(v);
    setAccountFilter("");
    setPageNumber(1);
    setDay("");
  }
  function exportFile(format: string) {
    download(
      "/export?" +
        new URLSearchParams({
          ...Object.fromEntries(params),
          format,
        }).toString(),
      format === "csv"
        ? "duet-ledger-transactions.csv"
        : "duet-ledger-data.json",
    ).catch((e) => setToast(e.message));
  }
  const headingTitles: Record<Page, [string, string]> = {
    home: en
      ? [
          "Your day, at a glance.",
          "Personal records and shared expenses, together.",
        ]
      : [
          "돈의 흐름을 한눈에.",
          "나의 기록도, 함께 쓰는 생활비도. 한곳에서 편하게.",
        ],
    ledger: en
      ? ["One day at a time.", "Find, review and record your transactions."]
      : ["하루하루, 차곡차곡.", "작은 기록이 모여 우리 일상의 흐름이 돼요."],
    stats: en
      ? [
          "Patterns in your everyday.",
          "A closer look at what you earn and spend.",
        ]
      : [
          "기록 속에서 찾는 패턴.",
          "어디에 쓰고, 얼마나 모았는지. 숫자를 조금 더 가까이.",
        ],
    accounts: en
      ? [
          "Your money, your space.",
          "Keep accounts private or share only what you choose.",
        ]
      : [
          "나의 자산, 우리의 생활.",
          "계좌는 한 번만 등록하고, 필요한 계좌만 함께 볼 수 있어요.",
        ],
    settings: en
      ? ["Make yourself at home.", "Manage your space, sharing and security."]
      : [
          "내게 편한 방식으로.",
          "화면과 공유 범위를 살펴보고, 나의 기록을 안전하게.",
        ],
  };
  function summary() {
    return (
      <section className="summary-grid">
        <article className="summary-card total">
          <div className="card-topline">
            <span>
              {en ? "Selected accounts · net balance" : "기록 기준 순자산"}
            </span>
            <span className="summary-icon">
              <Icon name="wallet" />
            </span>
          </div>
          <div className="amount">
            <span className="won">{currency === "KRW" ? "₩" : currency}</span>
            {formatMoney(balance, scale, currency, false)}
          </div>
          <p className="card-footnote">
            <Icon name="check" />
            {moneyAccounts.length}개 계좌 · 카드·대출 부채 포함
          </p>
          <div className="summary-decoration" />
        </article>
        <article className="summary-card income">
          <div className="card-topline">
            <span>{en ? "Income" : "이번 달 수입"}</span>
            <span className="summary-icon">
              <Icon name="in" />
            </span>
          </div>
          <div className="amount">
            <span className="won">{currency === "KRW" ? "₩" : currency}</span>
            {formatMoney(totals?.income || "0", scale, currency, false)}
          </div>
          <p className="card-footnote">선택한 조회 범위의 수입</p>
        </article>
        <article className="summary-card expense">
          <div className="card-topline">
            <span>{en ? "Expenses" : "이번 달 지출"}</span>
            <span className="summary-icon">
              <Icon name="up" />
            </span>
          </div>
          <div className="amount">
            <span className="won">{currency === "KRW" ? "₩" : currency}</span>
            {formatMoney(totals?.expense || "0", scale, currency, false)}
          </div>
          <p className="card-footnote">이체·잔액 조정 제외, 환불 차감</p>
        </article>
      </section>
    );
  }
  function rows(items: Transaction[]) {
    return (
      <TransactionRows
        items={items}
        accounts={accounts}
        open={(t) => setModal({ kind: "detail", tx: t })}
      />
    );
  }
  function recent() {
    return (
      <section className="panel transaction-panel">
        <div className="panel-heading">
          <h2>
            최근 내역 <span className="subtle-count">{report.count}</span>
          </h2>
          <button className="text-link" onClick={() => navigate("ledger")}>
            전체 보기 <Icon name="arrow" />
          </button>
        </div>
        <TableHeader />
        {rows(report.items.slice(0, 5))}
        <div className="transaction-panel-footer">
          <button onClick={() => navigate("ledger")}>
            이번 달 기록 모두 보기
          </button>
        </div>
      </section>
    );
  }
  function accountsPanel() {
    return (
      <section className="panel panel-pad">
        <div className="panel-heading">
          <h2>
            내 계좌 <span className="subtle-count">{moneyAccounts.length}</span>
          </h2>
          <button className="text-link" onClick={() => navigate("accounts")}>
            전체 <Icon name="arrow" />
          </button>
        </div>
        {moneyAccounts.slice(0, 4).map((a) => (
          <button
            className="account-mini"
            key={a.id}
            onClick={() => setModal({ kind: "account", account: a })}
          >
            <span className={"bank-icon " + (a.shared ? "green" : "blue")}>
              <Icon name={a.kind === "card" ? "card" : "wallet"} />
            </span>
            <span>
              <span className="account-mini-title">{a.name}</span>
              <small>
                {a.shared ? "함께 보기" : "나만 보기"}
                {a.archived ? " · 보관" : ""}
              </small>
            </span>
            <span className="account-mini-amount">
              {formatMoney(a.balance, a.scale, a.currency, false)}
              <small>{a.currency === "KRW" ? "원" : a.currency}</small>
            </span>
          </button>
        ))}
        {!moneyAccounts.length && (
          <Empty
            title="아직 계좌가 없어요."
            description="통장·현금·카드를 등록해보세요."
          >
            <button
              className="secondary-button"
              onClick={() => setModal({ kind: "account" })}
            >
              계좌 만들기
            </button>
          </Empty>
        )}
        <p className="account-list-note">
          <Icon name="shield" />
          공유한 계좌만 함께 볼 수 있어요
        </p>
      </section>
    );
  }
  function sharedNote() {
    return (
      <section className="shared-note">
        <div className="leaf-decoration">
          <Icon name="leaf" />
        </div>
        <h3>함께 쓰고, 따로 지켜요.</h3>
        <p>
          생활비는 함께 보고,
          <br />
          개인 기록은 나만 볼 수 있도록.
        </p>
        <button
          className="text-link"
          onClick={() => setModal({ kind: "sharing" })}
        >
          공유 관리 <Icon name="arrow" />
        </button>
      </section>
    );
  }
  return (
    <div className="app-frame live-app">
      <div className="app-layout">
        <aside className="sidebar">
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              navigate("home");
            }}
            aria-label="듀엣 가계부 홈"
          >
            <Brand />
          </a>
          <button
            className="workspace-button"
            onClick={() => setModal({ kind: "ledgers" })}
          >
            <span className="workspace-icon">
              <Icon name="book" />
            </span>
            <span>
              <small>나의 공간</small>
              <strong>{selectedLedger?.name || "모든 가계부"}</strong>
            </span>
            <Icon name="down" />
          </button>
          <p className="nav-label">WORKSPACE</p>
          <nav>
            {navigation.map((n) => (
              <button
                key={n.id}
                className={"nav-item " + (page === n.id ? "active" : "")}
                aria-current={page === n.id ? "page" : undefined}
                onClick={() => navigate(n.id)}
              >
                <Icon name={n.icon} />
                {en ? n.en : n.label}
              </button>
            ))}
          </nav>
          {user.show_sidebar_message !== false && (
            <div className="sidebar-together">
              <button
                className="icon-button dismiss-sidebar"
                aria-label="소개 문구 숨기기"
                onClick={() =>
                  post(
                    "/me",
                    {
                      name: user.name,
                      locale: user.locale,
                      timezone: user.timezone,
                      show_sidebar_message: false,
                    },
                    "PATCH",
                  )
                    .then(refresh)
                    .catch((e) => setToast(e.message))
                }
              >
                <Icon name="close" />
              </button>
              <div className="together-icon">
                <Icon name="people" />
              </div>
              <strong>혼자서도, 함께여도.</strong>
              <p>
                내 기록은 나답게,
                <br />
                우리의 기록은 함께.
              </p>
              <button
                className="text-link"
                onClick={() => setModal({ kind: "sharing" })}
              >
                공유 공간 살펴보기 <Icon name="arrow" />
              </button>
              <div className="avatar-stack">
                <span className="avatar mint">{user.name.slice(0, 1)}</span>
                <small>{user.name}의 공간</small>
              </div>
            </div>
          )}
          <div className="sidebar-bottom">
            <span className="local-dot" />
            나의 기록, 나의 공간 <Icon name="leaf" />
          </div>
        </aside>
        <div className="main-shell">
          <header className="app-header">
            <div className="header-breadcrumb">
              <span className="mobile-logo">
                <Brand compact />
              </span>
              <span className="desktop-breadcrumb">
                {selectedLedger?.name || "나의 공간"}
                <span>/</span>
                <strong>
                  {navigation.find((n) => n.id === page)?.[en ? "en" : "label"]}
                </strong>
              </span>
            </div>
            <div className="header-right">
              {loading && <Icon name="loader" className="spin loading-mark" />}
              <span className="alpha-tag">초기 개발판</span>
              <button
                className="profile-button"
                onClick={() => navigate("settings")}
                aria-label="내 설정"
              >
                <span className="avatar mint">{user.name.slice(0, 1)}</span>
                <span>{user.name}</span>
                <Icon name="down" />
              </button>
            </div>
          </header>
          <main id="main-content">
            {!online && (
              <div className="inline-warning" role="status">
                인터넷 연결을 확인해 주세요. 오프라인에서는 기록을 저장할 수
                없어요.
              </div>
            )}
            {error && (
              <div className="error-banner" role="alert">
                {error}
                <button onClick={() => refresh().catch(() => {})}>
                  다시 불러오기
                </button>
              </div>
            )}
            {joined && (
              <div className="scope-explanation">
                <Icon name="people" />
                초대를 수락했어요. 책임자가 승인하면 공유 기록이 나타나요.
              </div>
            )}
            <div className="page-heading">
              <div>
                <p className="eyebrow">
                  <Icon name="leaf" />
                  {page === "home"
                    ? `${user.name}님의 일상 기록`
                    : "DUET LEDGER"}
                </p>
                <h1>{headingTitles[page][0]}</h1>
                <p className="page-subtitle">{headingTitles[page][1]}</p>
              </div>
              <div className="heading-actions">
                {page === "accounts" ? (
                  <button
                    className="primary-button"
                    onClick={() => setModal({ kind: "account" })}
                  >
                    <Icon name="plus" />
                    계좌 만들기
                  </button>
                ) : page === "settings" ? null : (
                  <button
                    className="primary-button"
                    onClick={() => openEntry()}
                  >
                    <Icon name="plus" />
                    {en ? "Add record" : "빠른 입력"}
                  </button>
                )}
              </div>
            </div>
            {page !== "settings" && (
              <div className="view-toolbar">
                {!ledger && (
                  <div
                    className="scope-tabs"
                    role="group"
                    aria-label="조회 범위"
                  >
                    {[
                      ["all", "모아 보기", "wallet"],
                      ["private", "개인", "lock"],
                      ["shared", "공유", "people"],
                    ].map(([id, label, icon]) => (
                      <button
                        key={id}
                        aria-pressed={scope === id}
                        onClick={() => scopeChange(id)}
                      >
                        <Icon name={icon as IconName} />
                        {en
                          ? {
                              all: "All",
                              private: "Private",
                              shared: "Shared",
                            }[id]
                          : label}
                      </button>
                    ))}
                  </div>
                )}
                <div className="date-currency-toolbar">
                  <select
                    className="currency-select"
                    value={currency}
                    aria-label="통화 선택"
                    onChange={(e) => {
                      setCurrency(e.target.value);
                      setPageNumber(1);
                    }}
                  >
                    {[
                      ...new Set([
                        currency,
                        ...visibleAccounts.map((a) => a.currency),
                      ]),
                    ].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                  {page !== "accounts" && (
                    <div className="month-nav">
                      <button
                        onClick={() => moveMonth(-1)}
                        aria-label="이전 달"
                      >
                        <Icon name="left" />
                      </button>
                      <span className="month-label">
                        <Icon name="calendar" />
                        {Number(date.slice(0, 4))}년 {Number(date.slice(5, 7))}
                        월
                      </span>
                      <button onClick={() => moveMonth(1)} aria-label="다음 달">
                        <Icon name="right" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
            {page === "home" && (
              <>
                {!accounts.length && (
                  <div className="welcome-card">
                    <div>
                      <strong>나만의 첫 계좌를 만들어보세요.</strong>
                      <p>
                        공유 설정 없이 혼자 시작해도 좋아요. 필요할 때만 함께 쓸
                        수 있어요.
                      </p>
                    </div>
                    <button
                      className="primary-button"
                      onClick={() => setModal({ kind: "account" })}
                    >
                      <Icon name="plus" />
                      계좌 등록
                    </button>
                  </div>
                )}
                {summary()}
                <div className="dashboard-grid">
                  <div className="dashboard-left">
                    <FlowPanel
                      report={report}
                      currency={currency}
                      scale={scale}
                      date={date}
                      onMore={() => navigate("stats")}
                    />
                    {recent()}
                  </div>
                  <aside className="dashboard-right">
                    {accountsPanel()}
                    <DonutPanel
                      report={report}
                      currency={currency}
                      scale={scale}
                    />
                    {sharedNote()}
                  </aside>
                </div>
              </>
            )}
            {page === "ledger" && (
              <>
                <div className="search-filter-bar">
                  <label className="search-field">
                    <Icon name="search" />
                    <span className="visually-hidden">내역 검색</span>
                    <input
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value);
                        setPageNumber(1);
                      }}
                      placeholder="내용·분류·메모·작성자 이름·아이디로 검색"
                    />
                  </label>
                  <div className="filter-buttons">
                    <div
                      className="segment-control"
                      role="group"
                      aria-label="조회 기간"
                    >
                      {[
                        ["day", "일"],
                        ["week", "주"],
                        ["month", "월"],
                        ["year", "연"],
                      ].map(([v, l]) => (
                        <button
                          key={v}
                          aria-pressed={period === v}
                          onClick={() => {
                            setPeriod(v);
                            setPageNumber(1);
                            setDay("");
                            if (v !== "month") setView("list");
                          }}
                        >
                          {l}
                        </button>
                      ))}
                    </div>
                    <div className="segment-control">
                      <button
                        aria-label="목록 보기"
                        aria-pressed={view === "list"}
                        onClick={() => setView("list")}
                      >
                        <Icon name="list" />
                      </button>
                      <button
                        aria-label="달력 보기"
                        aria-pressed={view === "calendar"}
                        onClick={() => {
                          setView("calendar");
                          setPeriod("month");
                          setPageNumber(1);
                        }}
                      >
                        <Icon name="calendar" />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="advanced-filters">
                  <select
                    aria-label="계좌 필터"
                    className="compact-select"
                    value={accountFilter}
                    onChange={(e) => {
                      setAccountFilter(e.target.value);
                      setPageNumber(1);
                    }}
                  >
                    <option value="">모든 계좌</option>
                    {visibleAccounts
                      .filter((a) => a.currency === currency)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                  </select>
                  <select
                    aria-label="거래 종류 필터"
                    className="compact-select"
                    value={typeFilter}
                    onChange={(e) => {
                      setTypeFilter(e.target.value);
                      setPageNumber(1);
                    }}
                  >
                    <option value="">모든 거래</option>
                    {Object.entries(kindNames).map(([id, name]) => (
                      <option key={id} value={id}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <input
                    aria-label="기준 날짜"
                    type="date"
                    value={date}
                    className="compact-date"
                    onChange={(e) => {
                      if (e.target.value) {
                        setDate(e.target.value);
                        setPageNumber(1);
                      }
                    }}
                  />
                  <button
                    className={"secondary-button " + (trash ? "selected" : "")}
                    onClick={() => {
                      setTrash(!trash);
                      setPageNumber(1);
                    }}
                  >
                    <Icon name="trash" />
                    휴지통
                  </button>
                  <button
                    className="secondary-button"
                    onClick={() => exportFile("csv")}
                  >
                    <Icon name="download" />
                    CSV
                  </button>
                </div>
                <div className="scope-explanation">
                  <Icon name="info" />
                  {from} ~ {to} · {report.count}건 ·{" "}
                  {trash
                    ? "휴지통 내역은 현재 잔액·통계에서 제외됩니다."
                    : `수입 ${formatMoney(totals?.income || "0", scale, currency)} / 지출 ${formatMoney(totals?.expense || "0", scale, currency)}`}
                </div>
                {view === "calendar" ? (
                  <CalendarView
                    date={date}
                    report={report}
                    currency={currency}
                    scale={scale}
                    selected={day}
                    select={setDay}
                  >
                    {day && (
                      <div className="calendar-detail">
                        <h3>{day}의 기록</h3>
                        {rows(report.items.filter((t) => t.date === day))}
                      </div>
                    )}
                  </CalendarView>
                ) : (
                  <section className="panel transaction-panel">
                    <TableHeader />
                    {rows(report.items)}
                  </section>
                )}
                {report.count > report.page_size && (
                  <div className="pagination">
                    <button
                      disabled={pageNumber <= 1}
                      onClick={() => setPageNumber(pageNumber - 1)}
                    >
                      <Icon name="left" />
                      이전
                    </button>
                    <span>
                      {pageNumber} /{" "}
                      {Math.ceil(report.count / report.page_size)}
                    </span>
                    <button
                      disabled={pageNumber * report.page_size >= report.count}
                      onClick={() => setPageNumber(pageNumber + 1)}
                    >
                      다음
                      <Icon name="right" />
                    </button>
                  </div>
                )}
                {view === "calendar" && report.count > 200 && (
                  <p className="entry-hint">
                    날짜별 합계는 전체 기록 기준입니다. 선택일 내역은 위
                    페이지에서 나누어 확인할 수 있어요.
                  </p>
                )}
              </>
            )}
            {page === "stats" && (
              <>
                {summary()}
                <div className="stats-layout">
                  <FlowPanel
                    report={report}
                    currency={currency}
                    scale={scale}
                    date={date}
                  />
                  <DonutPanel
                    report={report}
                    currency={currency}
                    scale={scale}
                  />
                </div>
                <section className="panel stats-category-table">
                  <div
                    className="panel-heading"
                    style={{ padding: "22px 23px 0" }}
                  >
                    <h2>분류별로 자세히</h2>
                    <span className="panel-title-small">
                      이체 제외 · 환불 차감
                    </span>
                  </div>
                  {report.categories
                    .filter((c) => c.currency === currency)
                    .map((c) => (
                      <div
                        className="stats-category-line"
                        key={c.category + ":" + c.name}
                      >
                        <span>
                          <i
                            className="legend-dot"
                            style={{
                              background:
                                categories.find((x) => x.id === c.category)
                                  ?.color || "#a9b99b",
                            }}
                          />
                          {c.name || categoryName(c.category, en)}
                        </span>
                        <strong>
                          {formatMoney(c.amount, c.scale, c.currency)}
                        </strong>
                        <small>순지출</small>
                      </div>
                    ))}
                  {!report.categories.length && (
                    <Empty
                      title="아직 지출 기록이 없어요."
                      description="기록을 추가하면 분류별 통계를 볼 수 있어요."
                    />
                  )}
                </section>
              </>
            )}
            {page === "accounts" && (
              <>
                <div className="scope-explanation">
                  <Icon name="info" />
                  선택한 계좌의 잔액을 합산해요. 통화가 다르면 따로 표시합니다.
                </div>
                <div className="accounts-grid">
                  {moneyAccounts.map((a) => (
                    <button
                      className={
                        "panel account-card " + (a.archived ? "archived" : "")
                      }
                      key={a.id}
                      onClick={() => setModal({ kind: "account", account: a })}
                    >
                      <div className="account-card-top">
                        <span
                          className={
                            "bank-icon " + (a.shared ? "green" : "blue")
                          }
                        >
                          <Icon name={a.kind === "card" ? "card" : "wallet"} />
                        </span>
                        <Privacy shared={a.shared} />
                      </div>
                      <div>
                        <h2>{a.name}</h2>
                        <p>
                          {a.ledger_name} ·{" "}
                          {a.archived
                            ? "보관 중"
                            : {
                                bank: "예금",
                                cash: "현금",
                                card: "신용카드",
                                loan: "대출",
                              }[a.kind]}
                          <br />
                          {a.currency} ·{" "}
                          {a.role === "owner"
                            ? "책임자"
                            : a.role === "editor"
                              ? "편집자"
                              : "조회자"}
                        </p>
                      </div>
                      <div className="account-card-bottom">
                        <strong>
                          {formatMoney(a.balance, a.scale, a.currency, false)}
                          <small>
                            {a.currency === "KRW" ? "원" : a.currency}
                          </small>
                        </strong>
                        <span>
                          자세히
                          <Icon name="arrow" />
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
                {!moneyAccounts.length && (
                  <section className="panel">
                    <Empty
                      title="이 범위에 계좌가 없어요."
                      description="계좌를 만들거나 다른 보기 범위를 선택해 주세요."
                    >
                      <button
                        className="primary-button"
                        onClick={() => setModal({ kind: "account" })}
                      >
                        계좌 만들기
                      </button>
                    </Empty>
                  </section>
                )}
                <p className="single-scope-note">
                  개인 가계부는 처음에는 나만 볼 수 있고, 특정 계좌만 따로
                  공유할 수 있어요.
                </p>
              </>
            )}
            {page === "settings" && (
              <SettingsView
                user={user}
                refresh={refresh}
                open={(kind) => setModal({ kind })}
                theme={theme}
                setTheme={setTheme}
                notify={setToast}
                exportJSON={() => exportFile("json")}
              />
            )}
          </main>
          <footer className="app-footer">
            <span>기록이 쌓이면, 일상이 보이니까.</span>
            <span>
              Duet Ledger <span className="footer-dot">·</span> 0.1.0 alpha.2
            </span>
          </footer>
        </div>
      </div>
      <nav className="mobile-nav">
        {navigation.map((n) => (
          <button
            key={n.id}
            className={"nav-item " + (page === n.id ? "active" : "")}
            aria-current={page === n.id ? "page" : undefined}
            onClick={() => navigate(n.id)}
          >
            <Icon name={n.icon} />
            {en ? n.en : n.short}
          </button>
        ))}
      </nav>
      <button
        className="mobile-fab"
        onClick={() => openEntry()}
        aria-label="빠른 입력"
      >
        <Icon name="plus" />
      </button>
      {modal?.kind === "entry" && (
        <EntryDialog
          {...dialogProps}
          transaction={modal.tx}
          accountId={modal.account}
        />
      )}
      {modal?.kind === "account" && (
        <AccountDialog
          {...dialogProps}
          account={modal.account}
          entry={(account) => setModal({ kind: "entry", account })}
          showLedger={(id) => {
            setAccountFilter(id);
            navigate("ledger");
          }}
        />
      )}
      {(modal?.kind === "ledgers" || modal?.kind === "ledger-manage") && (
        <LedgerDialog
          {...dialogProps}
          manage={modal.kind === "ledger-manage"}
          selected={ledger}
          select={(id) => {
            setLedger(id);
            setAccountFilter("");
            setScope("all");
            setPageNumber(1);
          }}
        />
      )}
      {modal?.kind === "detail" && (
        <DetailDialog
          {...dialogProps}
          transaction={modal.tx}
          edit={() => setModal({ kind: "entry", tx: modal.tx })}
        />
      )}
      {modal?.kind === "categories" && <CategoriesDialog {...dialogProps} />}
      {modal?.kind === "admin" && user.admin && (
        <AdminDialog {...dialogProps} />
      )}
      {modal?.kind === "lifecycle" && <LifecycleDialog {...dialogProps} />}
      {modal?.kind === "sharing" && <SharingDialog {...dialogProps} />}
      {modal?.kind === "security" && <SecurityDialog {...dialogProps} />}
      {modal?.kind === "import" && <ImportDialog {...dialogProps} />}
      {modal?.kind === "backup" && <BackupDialog {...dialogProps} />}
      {invite && (
        <AcceptInviteDialog
          {...dialogProps}
          token={invite}
          close={clearInvite}
        />
      )}
      {toast && (
        <div className="toast visible" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

function TableHeader() {
  return (
    <div className="transaction-header">
      <span>내용·분류</span>
      <span>계좌</span>
      <span>공개 범위</span>
      <span>금액</span>
    </div>
  );
}
function TransactionRows({
  items,
  accounts,
  open,
}: {
  items: Transaction[];
  accounts: Account[];
  open: (t: Transaction) => void;
}) {
  if (!items.length)
    return (
      <Empty
        title="아직 기록이 없어요."
        description="다른 범위를 선택하거나 첫 기록을 남겨보세요."
      />
    );
  let last = "";
  return (
    <>
      {items.map((t) => {
        const group = t.date !== last;
        last = t.date;
        const first = t.legs[0];
        const acs = t.legs.map((l) =>
          accounts.find((a) => a.id === l.account_id),
        );
        const partial =
          acs.some((a) => a?.shared) && acs.some((a) => !a?.shared);
        const amount =
          t.kind === "transfer" && t.legs.length === 2
            ? formatMoney(
                BigInt(first.amount) < 0n
                  ? -BigInt(first.amount)
                  : BigInt(first.amount),
                t.scale,
                t.currency,
              )
            : `${BigInt(first.amount) > 0n ? "+" : ""}${formatMoney(first.amount, t.scale, t.currency)}`;
        return (
          <React.Fragment key={t.id}>
            {group && (
              <div className="transaction-day-heading">
                <strong>{t.date}</strong>
              </div>
            )}
            <button className="transaction-row" onClick={() => open(t)}>
              <span className="transaction-main">
                <span className={"category-icon category-" + first.category}>
                  <Icon
                    name={
                      t.kind === "transfer"
                        ? "transfer"
                        : first.category === "food"
                          ? "food"
                          : first.category === "coffee"
                            ? "coffee"
                            : "wallet"
                    }
                  />
                </span>
                <span className="transaction-text">
                  <span className="transaction-title">{first.title}</span>
                  <span className="transaction-meta">
                    {first.category_name || categoryName(first.category)} ·{" "}
                    {t.creator}
                    {t.time ? " · " + t.time : ""}
                    {t.legs.some((l) => l.receipts.length > 0) && (
                      <Icon name="camera" />
                    )}
                  </span>
                </span>
              </span>
              <span className="transaction-account">
                {acs.map((a) => a?.name || "계좌").join(" → ")}
              </span>
              {partial ? (
                <span className="privacy-badge shared">
                  <Icon name="people" />
                  일부만 공유
                </span>
              ) : (
                <Privacy shared={acs.some((a) => a?.shared)} />
              )}
              <span
                className={
                  "transaction-amount " +
                  (t.kind === "transfer"
                    ? "transfer"
                    : BigInt(first.amount) > 0n
                      ? "positive"
                      : "negative")
                }
              >
                {t.kind === "transfer" && t.legs.length === 2 ? "↔ " : ""}
                {amount}
              </span>
            </button>
          </React.Fragment>
        );
      })}
    </>
  );
}
function FlowPanel({
  report,
  currency,
  scale,
  date,
  onMore,
}: {
  report: Report;
  currency: string;
  scale: number;
  date: string;
  onMore?: () => void;
}) {
  const total =
    report.totals.find((t) => t.currency === currency)?.expense || "0";
  const days = new Date(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)),
    0,
  ).getDate();
  let cumulative = 0;
  const values = Array.from({ length: days }, (_, i) => {
    const day = `${date.slice(0, 7)}-${String(i + 1).padStart(2, "0")}`;
    cumulative += Number(
      report.daily.find((d) => d.currency === currency && d.date === day)
        ?.expense || 0,
    );
    return cumulative;
  });
  const max = Math.max(1, ...values),
    min = Math.min(0, ...values);
  const x = (i: number) => 42 + (i / Math.max(1, days - 1)) * 454;
  const y = (v: number) => 140 - ((v - min) / (max - min || 1)) * 110;
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  return (
    <section className="panel panel-pad">
      <div className="panel-heading">
        <div>
          <h2>이번 달의 소비 흐름</h2>
          <p className="panel-subtitle">하루하루 모인 우리의 기록</p>
        </div>
        {onMore && (
          <button className="text-link" onClick={onMore}>
            자세히
            <Icon name="arrow" />
          </button>
        )}
      </div>
      <div className="chart-title-row">
        <div>
          <span className="panel-title-small">누적 순지출</span>
          <p className="chart-total">{formatMoney(total, scale, currency)}</p>
        </div>
        <span className="chart-key">선택한 계좌</span>
      </div>
      <div className="line-chart">
        <svg
          viewBox="0 0 520 173"
          role="img"
          aria-label={`이번 달 지출 ${formatMoney(total, scale, currency)}`}
        >
          <path
            className="chart-gridline"
            d="M42 30H500M42 85H500M42 140H500"
          />
          <text x="0" y="33" className="chart-axis">
            {formatMoney(BigInt(Math.round(max)), scale, currency, false)}
          </text>
          <text x="10" y="143" className="chart-axis">
            {formatMoney(BigInt(Math.round(min)), scale, currency, false)}
          </text>
          <polygon
            points={`${x(0)},${y(0)} ${points} ${x(days - 1)},${y(0)}`}
            fill="#a6bf8c"
            opacity=".12"
          />
          <polyline
            points={points}
            stroke="#86a56e"
            strokeWidth="2.5"
            fill="none"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {[1, 7, 14, 21, days]
            .filter((v, i, a) => v <= days && a.indexOf(v) === i)
            .map((d) => (
              <text
                key={d}
                x={x(d - 1)}
                y="165"
                textAnchor="middle"
                className="chart-axis"
              >
                {d}일
              </text>
            ))}
        </svg>
      </div>
      <div className="chart-note">
        <span>
          <Icon name="info" />
          이체 제외 · 환불은 발생일에 차감
        </span>
        <span>{report.count}건의 기록</span>
      </div>
    </section>
  );
}
function DonutPanel({
  report,
  currency,
  scale,
}: {
  report: Report;
  currency: string;
  scale: number;
}) {
  const data = report.categories.filter((c) => c.currency === currency);
  const positive = data.filter((c) => BigInt(c.amount) > 0n);
  const sum = positive.reduce((s, c) => s + Number(c.amount), 0);
  let offset = 0;
  return (
    <section className="panel panel-pad donut-panel">
      <div className="panel-heading">
        <div>
          <h2>어디에 썼을까요?</h2>
          <p className="panel-subtitle">분류별 순지출 비중 · 양수 항목</p>
        </div>
      </div>
      <div className="donut-layout">
        <div className="donut-content">
          <svg
            viewBox="0 0 136 136"
            role="img"
            aria-label={
              positive
                .map(
                  (c) =>
                    `${c.name || categoryName(c.category)} ${Math.round((Number(c.amount) / (sum || 1)) * 100)}%`,
                )
                .join(", ") || "아직 지출 없음"
            }
          >
            <circle
              cx="68"
              cy="68"
              r="54"
              stroke="var(--mint-soft)"
              strokeWidth="11"
              fill="none"
            />
            {positive.map((c) => {
              const ratio = (Number(c.amount) / (sum || 1)) * 100;
              const previous = offset;
              offset += ratio;
              return (
                <circle
                  key={c.category + ":" + c.name}
                  cx="68"
                  cy="68"
                  r="54"
                  fill="none"
                  stroke={
                    categories.find((v) => v.id === c.category)?.color ||
                    "#b3c4a7"
                  }
                  strokeWidth="11"
                  pathLength="100"
                  strokeDasharray={`${Math.max(0, ratio - 1.7)} ${100 - Math.max(0, ratio - 1.7)}`}
                  strokeDashoffset={-previous}
                />
              );
            })}
          </svg>
          <div className="donut-center">
            <small>가장 많이 쓴 곳</small>
            <strong>
              {positive[0]
                ? positive[0].name || categoryName(positive[0].category)
                : "기록 없음"}
            </strong>
          </div>
        </div>
        <div className="category-legend">
          {data.slice(0, 4).map((c) => (
            <div className="legend-row" key={c.category + ":" + c.name}>
              <span
                className="legend-dot"
                style={{
                  background:
                    categories.find((v) => v.id === c.category)?.color ||
                    "#b3c4a7",
                }}
              />
              <span>{c.name || categoryName(c.category)}</span>
              <strong>{formatMoney(c.amount, scale, currency, false)}</strong>
            </div>
          ))}
          {!data.length && (
            <p className="panel-subtitle">첫 지출을 남겨보세요.</p>
          )}
        </div>
      </div>
    </section>
  );
}
function CalendarView({
  date,
  report,
  currency,
  scale,
  selected,
  select,
  children,
}: {
  date: string;
  report: Report;
  currency: string;
  scale: number;
  selected: string;
  select: (v: string) => void;
  children: React.ReactNode;
}) {
  const y = Number(date.slice(0, 4)),
    m = Number(date.slice(5, 7));
  const first = new Date(y, m - 1, 1).getDay(),
    last = new Date(y, m, 0).getDate();
  return (
    <section className="panel">
      <div className="calendar-grid">
        {"일월화수목금토".split("").map((d) => (
          <div className="calendar-weekday" key={d}>
            {d}
          </div>
        ))}
        {Array.from({ length: Math.ceil((first + last) / 7) * 7 }, (_, i) => {
          const d = i - first + 1;
          if (d < 1 || d > last)
            return <div className="calendar-day outside" key={i} />;
          const day = `${date.slice(0, 7)}-${String(d).padStart(2, "0")}`;
          const total = report.daily.find(
            (t) => t.currency === currency && t.date === day,
          );
          return (
            <button
              key={i}
              className={"calendar-day " + (day === selected ? "selected" : "")}
              onClick={() => select(day === selected ? "" : day)}
              aria-label={`${day} 기록 보기`}
            >
              <span className="calendar-date">{d}</span>
              {total && BigInt(total.income) !== 0n && (
                <span className="calendar-income">
                  +{formatMoney(total.income, scale, currency, false)}
                </span>
              )}
              {total && BigInt(total.expense) !== 0n && (
                <span className="calendar-expense">
                  −{formatMoney(total.expense, scale, currency, false)}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {children}
    </section>
  );
}
function SettingsView({
  user,
  refresh,
  open,
  theme,
  setTheme,
  notify,
  exportJSON,
}: {
  user: User;
  refresh: () => Promise<void>;
  open: (
    k:
      | "sharing"
      | "security"
      | "import"
      | "backup"
      | "ledgers"
      | "lifecycle"
      | "admin"
      | "categories"
      | "ledger-manage",
  ) => void;
  theme: string;
  setTheme: (v: string) => void;
  notify: (s: string) => void;
  exportJSON: () => void;
}) {
  const [name, setName] = useState(user.name);
  const [showSidebar, setShowSidebar] = useState(
    user.show_sidebar_message !== false,
  );
  const [locale, setLocale] = useState(user.locale);
  const [timezone, setTimezone] = useState(user.timezone);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await post(
        "/me",
        { name, locale, timezone, show_sidebar_message: showSidebar },
        "PATCH",
      );
      await refresh();
      notify("내 설정을 저장했어요.");
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="settings-layout">
      <section className="panel">
        <div className="setting-group">
          <h2>나의 공간</h2>
          <form onSubmit={save}>
            <label className="form-label" htmlFor="profile-name-field">
              표시할 이름
            </label>
            <input
              id="profile-name-field"
              className="field-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              maxLength={40}
            />
            <div className="form-two-cols">
              <div>
                <label className="form-label" htmlFor="locale">
                  언어
                </label>
                <select
                  id="locale"
                  className="field-select"
                  value={locale}
                  onChange={(e) => setLocale(e.target.value as User["locale"])}
                >
                  <option value="ko">한국어</option>
                  <option value="en">English · 주요 화면</option>
                </select>
              </div>
              <div>
                <label className="form-label" htmlFor="timezone">
                  시간대
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
            <label className="setting-row">
              <span>왼쪽 소개 문구 표시</span>
              <input
                type="checkbox"
                checked={showSidebar}
                onChange={(e) => setShowSidebar(e.target.checked)}
              />
            </label>
            <ErrorText error={error} />
            <button
              className="secondary-button"
              style={{ marginTop: 16 }}
              disabled={busy}
            >
              설정 저장
            </button>
          </form>
          <div className="setting-row">
            <div>
              <strong>화면 테마</strong>
              <p>편안한 밝기로 기록을 살펴보세요.</p>
            </div>
            <div className="theme-buttons">
              {[
                ["light", "sun", "밝게"],
                ["dark", "moon", "어둡게"],
              ].map(([id, icon, label]) => (
                <button
                  key={id}
                  className={theme === id ? "active" : ""}
                  onClick={() => setTheme(id)}
                >
                  <Icon name={icon as IconName} />
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="setting-group">
          <h2>가계부와 공유</h2>
          <div className="setting-row">
            <div>
              <strong>가계부 분류 관리</strong>
              <p>가계부별 수입·지출 분류 추가·수정·삭제</p>
            </div>
            <button
              className="secondary-button"
              onClick={() => open("categories")}
            >
              분류 관리
            </button>
          </div>
          {user.admin && (
            <div className="setting-row">
              <div>
                <strong>사용자와 가입 관리</strong>
                <p>공개 회원가입 허용·새 사용자 초대</p>
              </div>
              <button
                className="secondary-button"
                onClick={() => open("admin")}
              >
                가입·초대 관리
              </button>
            </div>
          )}
          <div className="setting-row">
            <div>
              <strong>가계부 관리</strong>
              <p>개인·공유 가계부를 여러 개 만들 수 있어요.</p>
            </div>
            <button
              className="secondary-button"
              onClick={() => open("ledger-manage")}
            >
              관리
            </button>
          </div>
          <div className="setting-row">
            <div>
              <strong>공유 관리</strong>
              <p>초대·승인·역할 변경·공유 해제</p>
            </div>
            <button
              className="secondary-button"
              onClick={() => open("sharing")}
            >
              살펴보기
            </button>
          </div>
        </div>
        <div className="setting-group">
          <h2>공유 종료와 책임자</h2>
          <div className="setting-row">
            <div>
              <strong>책임자 이전·공유 나가기</strong>
              <p>금융 기록을 지우지 않고 공유 관계를 정리해요.</p>
            </div>
            <button
              className="secondary-button"
              onClick={() => open("lifecycle")}
            >
              관리
            </button>
          </div>
        </div>
        <div className="setting-group">
          <h2>내 기록과 보안</h2>
          <div className="setting-row">
            <div>
              <strong>로그인 보안</strong>
              <p>
                2단계 인증 {user.totp_enabled ? "사용 중" : "미사용"} ·
                비밀번호·복구 코드
              </p>
            </div>
            <button
              className="secondary-button"
              onClick={() => open("security")}
            >
              관리
            </button>
          </div>
          <div className="setting-row">
            <div>
              <strong>JSON 자료 내보내기</strong>
              <p>현재 선택한 범위의 전체 기간 자료. 사진·공유 권한 제외.</p>
            </div>
            <button className="secondary-button" onClick={exportJSON}>
              <Icon name="json" />
              내보내기
            </button>
          </div>
          <div className="setting-row">
            <div>
              <strong>CSV·JSON 가져오기</strong>
              <p>먼저 미리 보고, 중복을 확인한 후 반영해요.</p>
            </div>
            <button className="secondary-button" onClick={() => open("import")}>
              가져오기
            </button>
          </div>
          {user.admin && (
            <div className="setting-row">
              <div>
                <strong>서버 운영 백업</strong>
                <p>모든 사용자의 자료·사진 포함. 관리자 전용.</p>
              </div>
              <button
                className="secondary-button"
                onClick={() => open("backup")}
              >
                <Icon name="archive" />
                백업
              </button>
            </div>
          )}
        </div>
      </section>
      <aside>
        <section className="panel panel-pad">
          <div className="settings-demo-person">
            <span className="avatar mint">{user.name.slice(0, 1)}</span>
            <div>
              <h3>{user.name}의 공간</h3>
              <p>@{user.username}</p>
            </div>
          </div>
          <p className="settings-demo-note">
            개인적인 기록과 함께 쓰는 기록이
            <br />
            자연스럽게 이어지도록.
          </p>
          <button
            className="text-link"
            style={{ marginTop: 20 }}
            onClick={() =>
              post("/logout")
                .then(() =>
                  window.dispatchEvent(new Event("duet-ledger:unauthorized")),
                )
                .catch((e) => notify(e.message))
            }
          >
            <Icon name="logout" />
            로그아웃
          </button>
        </section>
        <div className="shared-note" style={{ marginTop: 18 }}>
          <h3>내 기록은 나에게만.</h3>
          <p>
            공유는 선택이에요.
            <br />
            공유하지 않으면 개인 가계부로 사용할 수 있어요.
          </p>
        </div>
      </aside>
    </div>
  );
}

const rootElement = document.getElementById("root");
if (rootElement) createRoot(rootElement).render(<Root />);
