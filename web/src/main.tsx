import {
  DisplaySettings,
  useDisplayPreferences,
  useCompactLayout,
} from "./display-settings";
import {
  msg,
  getLocale,
  useLocale,
  setLocale as setLanguage,
  monthTitle,
  weekdays,
  manualURL,
} from "./i18n";
import { exchangeFactor, convertMinor } from "./exchange";
import { canLeaveEntry } from "./entry-exit";
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
  currencyScales,
  categories,
  displayCategory,
  kindNames,
  type User,
  type Ledger,
  type Account,
  type Transaction,
  type Report,
} from "./api";
import {
  Help,
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
  MonthDialog,
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
import {
  CategoriesDialog,
  ExchangeSettings,
  AdminDialog,
  AccountTrashDialog,
} from "./preferences";
import {
  AppearanceSettings,
  ServerAppearanceSettings,
  useAppearance,
} from "./appearance";
import { AppPasswordsDialog, AdminAPISettings } from "./api-settings";
import "./app.css";

type Page =
  | "home"
  | "ledger"
  | "stats"
  | "accounts"
  | "settings"
  | "account-settings"
  | "administration";
const pagePaths: Record<Page, string> = {
  home: "/home",
  ledger: "/ledger",
  stats: "/stats",
  accounts: "/accounts",
  settings: "/settings",
  "account-settings": "/account",
  administration: "/admin",
};
function pageURL(page: Page): string {
  return (
    pagePaths[page] +
    (new URLSearchParams(location.search).has("safe-theme")
      ? "?safe-theme=1"
      : "")
  );
}
function pathPage(): Page {
  return (
    (Object.entries(pagePaths).find(
      ([, path]) => path === location.pathname.replace(/\/$/, ""),
    )?.[0] as Page) || "home"
  );
}
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
        | "api-keys"
        | "lifecycle"
        | "admin"
        | "categories"
        | "ledger-manage"
        | "account-trash";
    }
  | null;
const navigation: {
  id: Page;
  label: string;
  short: string;
  icon: IconName;
}[] = [
  { id: "home", label: "홈", short: "홈", icon: "home" },
  {
    id: "ledger",
    label: "가계부",
    short: "가계부",
    icon: "book",
  },
  {
    id: "stats",
    label: "통계·분석",
    short: "통계",
    icon: "chart",
  },
  {
    id: "accounts",
    label: "계좌·자산",
    short: "계좌",
    icon: "wallet",
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
  useLocale();
  useEffect(() => setLanguage(getLocale()), []);
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
          setLanguage(u.locale);
          setUser(u);
        } catch (e) {
          if (!(e instanceof APIError && e.status === 401)) throw e;
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : msg("연결하지 못했어요."));
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
        <p>{msg("나의 기록을 준비하고 있어요.")}</p>
      </div>
    );
  if (error)
    return (
      <div className="boot-screen">
        <Brand />
        <ErrorText error={error} />
        <button className="primary-button" onClick={boot}>
          {msg("다시 연결")}
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
          setLanguage(u.locale);
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

export function Application({
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
  useLocale();
  useEffect(() => setLanguage(user.locale), [user.locale]);
  const [page, setPage] = useState<Page>(() => {
    const p = pathPage();
    return p === "administration" && !user.admin ? "settings" : p;
  });
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [report, setReport] = useState<Report>(emptyReport);
  const [scope, setScope] = useState("all");
  const [ledger, setLedger] = useState("");
  const [currency, setCurrency] = useState(user.default_currency || "KRW");
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
  const [monthPicker, setMonthPicker] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);
  const [toast, setToast] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(navigator.onLine);
  const [theme, setTheme] = useState(
    () => localStorage.getItem("duet-ledger-theme") || "light",
  );
  const [userMenu, setUserMenu] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const [categoryLedger, setCategoryLedger] = useState<string | undefined>();
  const [categoryPopup, setCategoryPopup] = useState(false);
  const [categoryVersion, setCategoryVersion] = useState(0);
  const [accent, setAccent] = useState(
    () => localStorage.getItem(`duet-ledger-accent-${user.id}`) || "green",
  );
  const isSettings = [
    "settings",
    "account-settings",
    "administration",
  ].includes(page);
  const routeRef = useRef({ modal, monthPicker, categoryPopup, page, invite });
  routeRef.current = { modal, monthPicker, categoryPopup, page, invite };
  useEffect(() => {
    const initial = routeRef.current.page;
    history.replaceState({ duet: true, overlay: 0 }, "", pageURL(initial));
    const restoration = history.scrollRestoration;
    history.scrollRestoration = "manual";
    const pop = (event: PopStateEvent) => {
      const state = routeRef.current;
      const depth = Number(event.state?.overlay) || 0;
      if (depth === 0 && state.modal?.kind === "entry" && !canLeaveEntry()) {
        history.go(1);
        return;
      }
      let next = pathPage();
      if (next === "administration" && !user.admin) {
        next = "settings";
        history.replaceState(
          { duet: true, overlay: 0 },
          "",
          pageURL("settings"),
        );
      }
      setPage(next);
      setUserMenu(false);
      if (depth < 2 && state.categoryPopup) {
        setCategoryPopup(false);
        setCategoryVersion((v) => v + 1);
      }
      if (depth === 0) {
        setModal(null);
        setMonthPicker(false);
        if (state.invite) clearInvite();
      }
      // Closed dialogs are not reconstructed from stale browser-forward entries.
      if (depth > 0 && !state.modal && !state.monthPicker && !state.invite) {
        history.replaceState({ duet: true, overlay: 0 }, "", pageURL(next));
      }
    };
    window.addEventListener("popstate", pop);
    return () => {
      window.removeEventListener("popstate", pop);
      history.scrollRestoration = restoration;
    };
  }, [user.id, user.admin]);
  useEffect(() => {
    const depth = categoryPopup ? 2 : modal || monthPicker || invite ? 1 : 0;
    const current = Number(history.state?.overlay) || 0;
    if (depth > current)
      history.pushState({ duet: true, overlay: depth }, "", pageURL(page));
    else if (depth < current) history.go(depth - current);
  }, [modal, monthPicker, categoryPopup, invite, page]);
  function closeLayer() {
    if (Number(history.state?.overlay) > 0) {
      history.back();
      return;
    }
    if (categoryPopup) {
      setCategoryPopup(false);
      setCategoryVersion((v) => v + 1);
    } else {
      setModal(null);
      setMonthPicker(false);
    }
  }
  const [display] = useDisplayPreferences(user.id);
  const compactLayout = useCompactLayout();
  useAppearance(user.id);
  useEffect(() => {
    const shortcut = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (
        e.ctrlKey ||
        e.metaKey ||
        e.altKey ||
        e.isComposing ||
        e.repeat ||
        el?.closest("input,textarea,select,[contenteditable=true]") ||
        document.querySelector("dialog[open]")
      )
        return;
      if (e.key === "/") {
        e.preventDefault();
        navigate("ledger");
        requestAnimationFrame(() =>
          document
            .querySelector<HTMLInputElement>("[data-transaction-search]")
            ?.focus(),
        );
      } else if (e.key.toLowerCase() === "q") {
        e.preventDefault();
        openEntry();
      }
    };
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  });
  useEffect(() => {
    document.body.dataset.accent = accent;
    localStorage.setItem(`duet-ledger-accent-${user.id}`, accent);
  }, [accent, user.id]);
  useEffect(() => {
    if (!userMenu) return;
    const close = (e: PointerEvent) => {
      if (!userMenuRef.current?.contains(e.target as Node)) setUserMenu(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setUserMenu(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", escape);
    };
  }, [userMenu]);
  const requestVersion = useRef(0);
  const [from, to] = dateRange(date, page === "ledger" ? period : "month");
  const params = useMemo(
    () =>
      new URLSearchParams({
        from,
        to,
        scope: ledger ? "all" : scope,
        currency: "",
        display_currency: currency,
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
        setError(e instanceof Error ? e.message : msg("불러오지 못했어요."));
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
    setCurrency(user.default_currency || "KRW");
    setAccountFilter("");
    setPageNumber(1);
  }, [user.default_currency]);
  function navigate(p: Page) {
    if (p === "administration" && !user.admin) return;
    setUserMenu(false);
    if (p !== page)
      history.pushState({ duet: true, overlay: 0 }, "", pageURL(p));
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
  const moneyAccounts = visibleAccounts;
  const scale = currencyScales[currency] || 0;
  const selectedLedger = ledgers.find((l) => l.id === ledger);
  const totals = report.totals.find((t) => t.currency === currency);
  const balance = moneyAccounts.reduce((sum, a) => {
    const factor = exchangeFactor(
      user.exchange_rates || [],
      a.currency,
      currency,
      currency,
    );
    return factor
      ? sum + BigInt(convertMinor(a.balance, a.currency, currency, factor))
      : sum;
  }, 0n);
  const dialogProps: DialogProps = {
    selectedLedger: ledger,
    user,
    accounts,
    ledgers,
    refresh,
    close: closeLayer,
    notify: setToast,
    categoryVersion,
    manageCategories: (id) => {
      setCategoryLedger(id);
      setCategoryPopup(true);
    },
  };
  function openEntry(account?: string) {
    if (!visibleAccounts.some((a) => !a.archived && a.role !== "viewer")) {
      if (ledger && selectedLedger?.role !== "owner") {
        setToast(msg("이 가계부의 책임자에게 계좌 생성을 요청해 주세요."));
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
    if (next.getFullYear() < 1900 || next.getFullYear() > 2100) return;
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
          ...(format === "csv"
            ? {
                from: dateRange(date, period)[0],
                to: dateRange(date, period)[1],
                search: searchTerm,
                account: accountFilter,
                type: typeFilter,
                trash: String(trash),
              }
            : {}),
          format,
        }).toString(),
      format === "csv"
        ? "duet-ledger-transactions.csv"
        : "duet-ledger-data.json",
    ).catch((e) => setToast(e.message));
  }
  const headingTitles: Record<Page, [string, string]> = {
    home: [
      msg("돈의 흐름을 한눈에."),
      selectedLedger?.tagline ||
        msg("나의 기록도, 함께 쓰는 생활비도. 한곳에서 편하게."),
    ],
    ledger: trash
      ? [
          msg("삭제한 기록을 살펴봐요."),
          msg("삭제한 기록을 확인하고, 필요한 기록은 다시 복구하세요."),
        ]
      : [
          msg("하루하루, 차곡차곡."),
          msg("작은 기록이 모여 우리 일상의 흐름이 돼요."),
        ],
    stats: [
      msg("기록 속에서 찾는 패턴."),
      msg("어디에 쓰고, 얼마나 모았는지. 숫자를 조금 더 가까이."),
    ],
    accounts: [
      msg("나의 자산, 우리의 생활."),
      msg("계좌는 한 번만 등록하고, 필요한 계좌만 함께 볼 수 있어요."),
    ],
    "account-settings": [
      msg("나의 계정, 안전하게."),
      msg("프로필과 로그인 보안을 관리해요."),
    ],
    administration: [
      msg("서버 관리."),
      msg("가입 정책과 전체 서버 백업을 관리해요."),
    ],
    settings: [
      msg("내게 편한 방식으로."),
      msg("화면과 공유 범위를 살펴보고, 나의 기록을 안전하게."),
    ],
  };
  function summary() {
    return (
      <section className="summary-grid">
        <article className="summary-card total">
          <div className="card-topline">
            <span>{msg("기록 기준 순자산")}</span>
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
            {moneyAccounts.length}
            {msg("개 계좌 · 카드·대출 부채 포함")}
          </p>
          <div className="summary-decoration" />
        </article>
        <article className="summary-card income">
          <div className="card-topline">
            <span>{msg("이번 달 수입")}</span>
            <span className="summary-icon">
              <Icon name="in" />
            </span>
          </div>
          <div className="amount">
            <span className="won">{currency === "KRW" ? "₩" : currency}</span>
            {formatMoney(totals?.income || "0", scale, currency, false)}
          </div>
          <p className="card-footnote">{msg("선택한 조회 범위의 수입")}</p>
        </article>
        <article className="summary-card expense">
          <div className="card-topline">
            <span>{msg("이번 달 지출")}</span>
            <span className="summary-icon">
              <Icon name="up" />
            </span>
          </div>
          <div className="amount">
            <span className="won">{currency === "KRW" ? "₩" : currency}</span>
            {formatMoney(totals?.expense || "0", scale, currency, false)}
          </div>
          <p className="card-footnote">
            {msg("이체·잔액 조정 제외, 환불 차감")}
          </p>
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
            {msg("최근 내역")}{" "}
            <span className="subtle-count">{report.count}</span>
          </h2>
          <button className="text-link" onClick={() => navigate("ledger")}>
            {msg("전체 보기")} <Icon name="arrow" />
          </button>
        </div>
        <TableHeader />
        {rows(report.items.slice(0, 5))}
        <div className="transaction-panel-footer">
          <button onClick={() => navigate("ledger")}>
            {msg("이번 달 기록 모두 보기")}
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
            {msg("내 계좌")}{" "}
            <span className="subtle-count">{moneyAccounts.length}</span>
          </h2>
          <button className="text-link" onClick={() => navigate("accounts")}>
            {msg("전체")} <Icon name="arrow" />
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
                {a.shared ? msg("함께 보기") : msg("나만 보기")}
                {a.archived ? msg(" · 보관") : ""}
              </small>
            </span>
            <span className="account-mini-amount">
              {formatMoney(a.balance, a.scale, a.currency, false)}
              <small>{a.currency === "KRW" ? msg("원") : a.currency}</small>
            </span>
          </button>
        ))}
        {!moneyAccounts.length && (
          <Empty
            title={msg("아직 계좌가 없어요.")}
            description={msg("통장·현금·카드를 등록해보세요.")}
          >
            <button
              className="secondary-button"
              onClick={() => setModal({ kind: "account" })}
            >
              {msg("계좌 만들기")}
            </button>
          </Empty>
        )}
        <p className="account-list-note">
          <Icon name="shield" />
          {msg("공유한 계좌만 함께 볼 수 있어요")}
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
        <h3>{msg("함께 쓰고, 따로 지켜요.")}</h3>
        <p>
          {msg("생활비는 함께 보고,")}
          <br />
          {msg("개인 기록은 나만 볼 수 있도록.")}
        </p>
        <button
          className="text-link"
          onClick={() => setModal({ kind: "sharing" })}
        >
          {msg("공유 관리")} <Icon name="arrow" />
        </button>
      </section>
    );
  }
  const accountControls = (
    <div className="header-right">
      {loading && <Icon name="loader" className="spin loading-mark" />}
      <button
        className="mobile-ledger-picker secondary-button"
        onClick={() => setModal({ kind: "ledgers" })}
        aria-label={msg("가계부 선택")}
      >
        <Icon name="book" />
        <span>{selectedLedger?.name || msg("모아 보기")}</span>
        <Icon name="down" />
      </button>
      <div className="user-menu-wrap" ref={userMenuRef}>
        <button
          className="profile-button"
          onClick={() => setUserMenu(!userMenu)}
          aria-label={msg("사용자 메뉴")}
          aria-expanded={userMenu}
          aria-controls="user-dropdown"
        >
          <span className="avatar mint">{user.name.slice(0, 1)}</span>
          <span>{user.name}</span>
          <Icon name="down" />
        </button>
        {userMenu && (
          <div className="user-dropdown" id="user-dropdown">
            <button onClick={() => navigate("account-settings")}>
              <Icon name="user" />
              {msg("계정 설정")}
            </button>
            <button onClick={() => navigate("settings")}>
              <Icon name="settings" />
              {msg("설정")}
            </button>
            {user.admin && (
              <button onClick={() => navigate("administration")}>
                <Icon name="shield" />
                {msg("관리")}
              </button>
            )}
            <a href={manualURL()} target="_blank" rel="noopener noreferrer">
              <Icon name="info" />
              {msg("도움말 및 지원")}
            </a>
            <button
              onClick={() =>
                post("/logout")
                  .then(() =>
                    window.dispatchEvent(new Event("duet-ledger:unauthorized")),
                  )
                  .catch((e) => setToast(e.message))
              }
            >
              <Icon name="logout" />
              {msg("로그아웃")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
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
            aria-label={msg("듀엣 가계부 홈")}
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
              <small>{msg("나의 공간")}</small>
              <strong>{selectedLedger?.name || msg("모든 가계부")}</strong>
            </span>
            <Icon name="down" />
          </button>
          <p className="nav-label">WORKSPACE</p>
          <nav>
            {navigation.map((n) => (
              <button
                key={n.id}
                className={
                  "nav-item " +
                  (page === n.id || (n.id === "settings" && isSettings)
                    ? "active"
                    : "")
                }
                aria-current={page === n.id ? "page" : undefined}
                onClick={() => navigate(n.id)}
              >
                <Icon name={n.icon} />
                {msg(n.label)}
              </button>
            ))}
          </nav>
          {user.show_sidebar_message !== false && (
            <div className="sidebar-together">
              <div className="together-icon">
                <Icon name="people" />
              </div>
              <strong>{msg("혼자서도, 함께여도.")}</strong>
              <p>
                {msg("내 기록은 나답게,")}
                <br />
                {msg("우리의 기록은 함께.")}
              </p>
              <button
                className="text-link"
                onClick={() => setModal({ kind: "sharing" })}
              >
                {msg("공유 공간 살펴보기")} <Icon name="arrow" />
              </button>
              <div className="avatar-stack">
                <span className="avatar mint">{user.name.slice(0, 1)}</span>
                <small>
                  {user.name}
                  {msg("의 공간")}
                </small>
              </div>
            </div>
          )}
          <div className="sidebar-bottom">
            <span className="local-dot" />
            {selectedLedger?.kind === "shared"
              ? msg("우리의 기록, 우리의 공간")
              : msg("나의 기록, 나의 공간")}{" "}
            <Icon name="leaf" />
          </div>
        </aside>
        <div className="main-shell">
          {(!compactLayout || isSettings) && (
            <header className="app-header">
              <div className="header-breadcrumb">
                <span className="desktop-breadcrumb">
                  {selectedLedger?.name || msg("나의 공간")}
                  <span>/</span>
                  <strong>
                    {page === "ledger" && trash
                      ? msg("휴지통")
                      : page === "account-settings"
                        ? msg("계정 설정")
                        : page === "administration"
                          ? msg("관리")
                          : page === "settings"
                            ? msg("설정")
                            : msg(
                                navigation.find((n) => n.id === page)?.label ||
                                  "",
                              )}
                  </strong>
                </span>
              </div>
              {accountControls}
            </header>
          )}
          <main id="main-content">
            {!online && (
              <div className="inline-warning" role="status">
                {msg(
                  "인터넷 연결을 확인해 주세요. 오프라인에서는 기록을 저장할 수 없어요.",
                )}
              </div>
            )}
            {error && (
              <div className="error-banner" role="alert">
                {msg(error)}
                <button onClick={() => refresh().catch(() => {})}>
                  {msg("다시 불러오기")}
                </button>
              </div>
            )}
            {joined && (
              <div className="scope-explanation">
                <Icon name="people" />
                {msg(
                  "초대를 수락했어요. 책임자가 승인하면 공유 기록이 나타나요.",
                )}
              </div>
            )}
            <div
              className={`page-heading ${display.showPageHeadings ? "" : "heading-collapsed"} ${!display.showPageHeadings && (isSettings || (compactLayout && (page === "accounts" || !display.mobileTopEntry))) ? "visually-hidden" : ""}`}
            >
              <div
                className={
                  display.showPageHeadings ? undefined : "visually-hidden"
                }
              >
                <p className="eyebrow">
                  <Icon name="leaf" />
                  {page === "home"
                    ? msg("{0}님의 일상 기록", [user.name])
                    : "DUET LEDGER"}
                </p>
                <h1>{headingTitles[page][0]}</h1>
                <p className="page-subtitle">{headingTitles[page][1]}</p>
              </div>
              <div className="heading-actions">
                {page === "accounts" ? (
                  !compactLayout && (
                    <button
                      className="primary-button"
                      onClick={() => setModal({ kind: "account" })}
                    >
                      <Icon name="plus" />
                      {msg("계좌 만들기")}
                    </button>
                  )
                ) : isSettings ||
                  (compactLayout && !display.mobileTopEntry) ? null : (
                  <button
                    className="primary-button"
                    onClick={() => openEntry()}
                  >
                    <Icon name="plus" />
                    {msg("빠른 입력")}
                  </button>
                )}
              </div>
            </div>
            {!isSettings && (
              <div className="view-toolbar">
                <div className="scope-controls-row">
                  {!ledger && (
                    <div
                      className="scope-tabs"
                      role="group"
                      aria-label={msg("조회 범위")}
                    >
                      {[
                        ["all", msg("모아 보기"), "wallet"],
                        ["private", msg("개인"), "lock"],
                        ["shared", msg("공유"), "people"],
                      ].map(([id, label, icon]) => (
                        <button
                          key={id}
                          aria-pressed={scope === id}
                          onClick={() => scopeChange(id)}
                        >
                          <Icon name={icon as IconName} />
                          {label}
                        </button>
                      ))}
                    </div>
                  )}
                  {compactLayout && page === "accounts" && (
                    <button
                      className="primary-button mobile-account-create"
                      onClick={() => setModal({ kind: "account" })}
                    >
                      <Icon name="plus" />
                      {msg("계좌 만들기")}
                    </button>
                  )}
                </div>
                <div className="date-currency-toolbar period-toolbar">
                  {page !== "accounts" && (
                    <div className="month-nav">
                      <button
                        onClick={() => moveMonth(-1)}
                        aria-label={msg("이전 달")}
                      >
                        <Icon name="left" />
                      </button>
                      <button
                        className="month-label"
                        onClick={() => setMonthPicker(true)}
                        aria-label={msg("년·월 선택")}
                      >
                        <Icon name="calendar" />
                        {monthTitle(date)}
                      </button>
                      <button
                        onClick={() => moveMonth(1)}
                        aria-label={msg("다음 달")}
                      >
                        <Icon name="right" />
                      </button>
                    </div>
                  )}
                  {compactLayout && accountControls}
                  {page === "ledger" && (
                    <>
                      <div className="ledger-view-controls">
                        {trash && (
                          <button
                            className="secondary-button trash-return"
                            onClick={() => {
                              setTrash(false);
                              setPageNumber(1);
                            }}
                          >
                            {msg("일반 내역으로 돌아가기")}
                          </button>
                        )}
                        <div className="filter-buttons">
                          <div
                            className="segment-control"
                            role="group"
                            aria-label={msg("조회 기간")}
                          >
                            {[
                              ["day", msg("일")],
                              ["week", msg("주")],
                              ["month", msg("월")],
                              ["year", msg("연")],
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
                              aria-label={msg("목록 보기")}
                              aria-pressed={view === "list"}
                              onClick={() => setView("list")}
                            >
                              <Icon name="list" />
                            </button>
                            <button
                              aria-label={msg("달력 보기")}
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
                    </>
                  )}
                </div>
              </div>
            )}
            {page === "home" && (
              <>
                {!accounts.length && (
                  <div className="welcome-card">
                    <div>
                      <strong>{msg("나만의 첫 계좌를 만들어보세요.")}</strong>
                      <p>
                        {msg(
                          "공유 설정 없이 혼자 시작해도 좋아요. 필요할 때만 함께 쓸 수 있어요.",
                        )}
                      </p>
                    </div>
                    <button
                      className="primary-button"
                      onClick={() => setModal({ kind: "account" })}
                    >
                      <Icon name="plus" />
                      {msg("계좌 등록")}
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
                    {user.show_sidebar_message !== false && sharedNote()}
                  </aside>
                </div>
              </>
            )}
            {page === "ledger" && (
              <>
                <div className="search-filter-bar">
                  <label className="search-field">
                    <Icon name="search" />
                    <span className="visually-hidden">{msg("내역 검색")}</span>
                    <input
                      value={search}
                      onChange={(e) => {
                        setSearch(e.target.value);
                        setPageNumber(1);
                      }}
                      data-transaction-search
                      placeholder={msg(
                        "내용·분류·메모·작성자 이름·아이디로 검색",
                      )}
                    />
                  </label>
                  <div className="advanced-filters">
                    <select
                      aria-label={msg("계좌 필터")}
                      className="compact-select"
                      value={accountFilter}
                      onChange={(e) => {
                        setAccountFilter(e.target.value);
                        setPageNumber(1);
                      }}
                    >
                      <option value="">{msg("모든 계좌")}</option>
                      {visibleAccounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={msg("거래 종류 필터")}
                      className="compact-select"
                      value={typeFilter}
                      onChange={(e) => {
                        setTypeFilter(e.target.value);
                        setPageNumber(1);
                      }}
                    >
                      <option value="">{msg("모든 거래")}</option>
                      {Object.entries(kindNames)
                        .filter(
                          ([id]) =>
                            ["expense", "income", "transfer"].includes(id) ||
                            report.items.some((t) => t.kind === id),
                        )
                        .map(([id, name]) => (
                          <option key={id} value={id}>
                            {msg(name)}
                          </option>
                        ))}
                    </select>
                    <input
                      aria-label={msg("기준 날짜")}
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
                  </div>
                </div>
                <div className="scope-explanation ledger-summary">
                  <Icon name="info" />
                  {from} ~ {to} · {report.count}
                  {msg("건 ·")}{" "}
                  {trash
                    ? msg("휴지통 내역은 현재 잔액·통계에서 제외됩니다.")
                    : msg("수입 {0} / 지출 {1}", [
                        formatMoney(totals?.income || "0", scale, currency),
                        formatMoney(totals?.expense || "0", scale, currency),
                      ])}
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
                        <h3>
                          {day}
                          {msg("의 기록")}
                        </h3>
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
                      {msg("이전")}
                    </button>
                    <span>
                      {pageNumber} /{" "}
                      {Math.ceil(report.count / report.page_size)}
                    </span>
                    <button
                      disabled={pageNumber * report.page_size >= report.count}
                      onClick={() => setPageNumber(pageNumber + 1)}
                    >
                      {msg("다음")}
                      <Icon name="right" />
                    </button>
                  </div>
                )}
                {view === "calendar" && report.count > 200 && (
                  <p className="entry-hint">
                    {msg(
                      "날짜별 합계는 전체 기록 기준입니다. 선택일 내역은 위 페이지에서 나누어 확인할 수 있어요.",
                    )}
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
                    <h2>{msg("분류별로 자세히")}</h2>
                    <span className="panel-title-small">
                      {msg("이체 제외 · 환불 차감")}
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
                          {displayCategory(c.category, c.name)}
                        </span>
                        <strong>
                          {formatMoney(c.amount, c.scale, c.currency)}
                        </strong>
                        <small>{msg("순지출")}</small>
                      </div>
                    ))}
                  {!report.categories.length && (
                    <Empty
                      title={msg("아직 지출 기록이 없어요.")}
                      description={msg(
                        "기록을 추가하면 분류별 통계를 볼 수 있어요.",
                      )}
                    />
                  )}
                </section>
              </>
            )}
            {page === "accounts" && (
              <>
                <div className="scope-explanation">
                  <Icon name="info" />
                  {msg(
                    "선택한 계좌의 잔액을 합산해요. 통화가 다르면 따로 표시합니다.",
                  )}
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
                            ? msg("보관 중")
                            : {
                                bank: msg("예금"),
                                cash: msg("현금"),
                                card: msg("신용카드"),
                                loan: msg("대출"),
                              }[a.kind]}
                          <br />
                          {a.currency} ·{" "}
                          {a.role === "owner"
                            ? msg("책임자")
                            : a.role === "editor"
                              ? msg("편집자")
                              : msg("조회자")}
                        </p>
                      </div>
                      <div className="account-card-bottom">
                        <strong>
                          {formatMoney(a.balance, a.scale, a.currency, false)}
                          <small>
                            {a.currency === "KRW" ? msg("원") : a.currency}
                          </small>
                        </strong>
                        <span>
                          {msg("자세히")}
                          <Icon name="arrow" />
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
                {!moneyAccounts.length && (
                  <section className="panel">
                    <Empty
                      title={msg("이 범위에 계좌가 없어요.")}
                      description={msg(
                        "계좌를 만들거나 다른 보기 범위를 선택해 주세요.",
                      )}
                    >
                      <button
                        className="primary-button"
                        onClick={() => setModal({ kind: "account" })}
                      >
                        {msg("계좌 만들기")}
                      </button>
                    </Empty>
                  </section>
                )}
                <p className="single-scope-note">
                  {msg(
                    "개인 가계부는 처음에는 나만 볼 수 있고, 특정 계좌만 따로 공유할 수 있어요.",
                  )}
                </p>
              </>
            )}
            {isSettings && (
              <SettingsView
                section={
                  page as "settings" | "account-settings" | "administration"
                }
                user={user}
                accounts={accounts}
                refresh={refresh}
                navigate={navigate}
                open={(kind) => {
                  if (kind === "categories") setCategoryLedger(undefined);
                  setModal({ kind });
                }}
                theme={theme}
                setTheme={setTheme}
                notify={setToast}
                exportJSON={() => exportFile("json")}
                exportCSV={() => exportFile("csv")}
                showTrash={() => {
                  navigate("ledger");
                  setTrash(true);
                }}
                accent={accent}
                setAccent={setAccent}
              />
            )}
          </main>
          <footer className="app-footer">
            <span>{msg("기록이 쌓이면, 일상이 보이니까.")}</span>
            <span>
              Duet Ledger <span className="footer-dot">·</span> 0.1.0
            </span>
          </footer>
        </div>
      </div>
      <nav className="mobile-nav">
        {navigation.map((n) => (
          <button
            key={n.id}
            className={
              "nav-item " +
              (page === n.id || (n.id === "settings" && isSettings)
                ? "active"
                : "")
            }
            aria-current={page === n.id ? "page" : undefined}
            onClick={() => navigate(n.id)}
          >
            <Icon name={n.icon} />
            {msg(n.short)}
          </button>
        ))}
      </nav>
      {!isSettings && display.mobileFloatingEntry && (
        <button
          className={`mobile-fab ${display.floatingSide === "left" ? "mobile-fab-left" : ""}`}
          onClick={() => openEntry()}
          aria-label={msg("빠른 입력")}
        >
          <Icon name="plus" />
        </button>
      )}
      {monthPicker && (
        <MonthDialog
          date={date}
          timezone={user.timezone}
          close={closeLayer}
          select={(year, month) => {
            const day = Math.min(
              Number(date.slice(8, 10)),
              new Date(year, month, 0).getDate(),
            );
            setDate(
              `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
            );
            setPageNumber(1);
            setDay("");
          }}
        />
      )}
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
      {categoryPopup && (
        <CategoriesDialog
          {...dialogProps}
          selectedLedger={categoryLedger}
          close={closeLayer}
        />
      )}
      {modal?.kind === "categories" && (
        <CategoriesDialog
          {...dialogProps}
          selectedLedger={categoryLedger || ledger}
        />
      )}
      {modal?.kind === "account-trash" && (
        <AccountTrashDialog {...dialogProps} />
      )}
      {modal?.kind === "admin" && user.admin && (
        <AdminDialog {...dialogProps} />
      )}
      {modal?.kind === "lifecycle" && <LifecycleDialog {...dialogProps} />}
      {modal?.kind === "sharing" && <SharingDialog {...dialogProps} />}
      {modal?.kind === "security" && <SecurityDialog {...dialogProps} />}
      {modal?.kind === "api-keys" && <AppPasswordsDialog {...dialogProps} />}
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
          {msg(toast)}
        </div>
      )}
    </div>
  );
}

function TableHeader() {
  return (
    <div className="transaction-header">
      <span>{msg("내용·분류")}</span>
      <span>{msg("계좌")}</span>
      <span>{msg("공개 범위")}</span>
      <span>{msg("금액")}</span>
    </div>
  );
}
export function TransactionRows({
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
        title={msg("아직 기록이 없어요.")}
        description={msg("다른 범위를 선택하거나 첫 기록을 남겨보세요.")}
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
        const displayAmount = first.display_amount ?? first.amount;
        const displayCurrency = t.display_currency || t.currency;
        const displayScale = t.display_currency
          ? currencyScales[t.display_currency]
          : t.scale;
        const amount =
          t.kind === "transfer" && t.legs.length === 2
            ? formatMoney(
                BigInt(displayAmount) < 0n
                  ? -BigInt(displayAmount)
                  : BigInt(displayAmount),
                displayScale,
                displayCurrency,
              )
            : `${BigInt(displayAmount) > 0n ? "+" : ""}${formatMoney(displayAmount, displayScale, displayCurrency)}`;
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
                    {displayCategory(first.category, first.category_name)} ·{" "}
                    {t.creator}
                    {t.time ? " · " + t.time : ""}
                    {t.legs.some((l) => l.receipts.length > 0) && (
                      <Icon name="camera" />
                    )}
                  </span>
                </span>
              </span>
              <span className="transaction-account">
                {acs.map((a) => a?.name || msg("계좌")).join(" → ")}
              </span>
              {partial ? (
                <span className="privacy-badge shared">
                  <Icon name="people" />
                  {msg("일부만 공유")}
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
                {(t.original_currency || t.currency !== displayCurrency) && (
                  <small className="original-money">
                    {t.original_currency
                      ? formatMoney(
                          t.original_amount || "0",
                          currencyScales[t.original_currency],
                          t.original_currency,
                        )
                      : formatMoney(first.amount, t.scale, t.currency)}
                  </small>
                )}
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
          <h2>{msg("이번 달의 소비 흐름")}</h2>
          <p className="panel-subtitle">{msg("하루하루 모인 우리의 기록")}</p>
        </div>
        {onMore && (
          <button className="text-link" onClick={onMore}>
            {msg("자세히")}
            <Icon name="arrow" />
          </button>
        )}
      </div>
      <div className="chart-title-row">
        <div>
          <span className="panel-title-small">{msg("누적 순지출")}</span>
          <p className="chart-total">{formatMoney(total, scale, currency)}</p>
        </div>
        <span className="chart-key">{msg("선택한 계좌")}</span>
      </div>
      <div className="line-chart">
        <svg
          viewBox="0 0 520 173"
          role="img"
          aria-label={msg("이번 달 지출 {0}", [
            formatMoney(total, scale, currency),
          ])}
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
                {d}
                {msg("일")}
              </text>
            ))}
        </svg>
      </div>
      <div className="chart-note">
        <span>
          <Icon name="info" />
          {msg("이체 제외 · 환불은 발생일에 차감")}
        </span>
        <span>
          {report.count}
          {msg("건의 기록")}
        </span>
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
          <h2>{msg("어디에 썼을까요?")}</h2>
          <p className="panel-subtitle">
            {msg("분류별 순지출 비중 · 양수 항목")}
          </p>
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
                    `${displayCategory(c.category, c.name)} ${Math.round((Number(c.amount) / (sum || 1)) * 100)}%`,
                )
                .join(", ") || msg("아직 지출 없음")
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
            <small>{msg("가장 많이 쓴 곳")}</small>
            <strong>
              {positive[0]
                ? displayCategory(positive[0].category, positive[0].name)
                : msg("기록 없음")}
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
              <span>{displayCategory(c.category, c.name)}</span>
              <strong>{formatMoney(c.amount, scale, currency, false)}</strong>
            </div>
          ))}
          {!data.length && (
            <p className="panel-subtitle">{msg("첫 지출을 남겨보세요.")}</p>
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
        {weekdays().map((d) => (
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
              aria-label={msg("{0} 기록 보기", [day])}
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
        (a) =>
          a.id === user.default_account_id &&
          !a.archived &&
          a.role !== "viewer",
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
              msg("2단계 인증 {0} · 비밀번호·복구 코드", [
                user.totp_enabled ? msg("사용 중") : msg("미사용"),
              ]),
              () => open("security"),
            )}
            {row(
              msg("API 앱 비밀번호"),
              msg("계좌별 접근·기능 권한·만료·폐기"),
              () => open("api-keys"),
            )}
          </div>
        </section>
      )}
      {section === "settings" && (
        <>
          <section className="panel">
            <div className="setting-group">
              <h2>{msg("화면과 표시")}</h2>
              <div className="setting-row appearance-row">
                <div>
                  <strong>{msg("화면 밝기")}</strong>
                  <p>{msg("이 브라우저에 적용해요.")}</p>
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
                  <Help>{msg("이 계정의 현재 브라우저에 적용해요.")}</Help>
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
                      "특정 가계부를 선택하면 그 가계부 안에서만 선택해요. 기본 계좌가 없으면 기본 통화가 같은 계좌를 우선합니다.",
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
                  {accounts
                    .filter((a) => !a.archived && a.role !== "viewer")
                    .map((a) => (
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
            </div>
          </section>
          <section className="panel">
            <div className="setting-group">
              {row(
                msg("보조 통화와 환율"),
                msg("필요한 통화를 추가하고 환율을 설정해요."),
                () => setExchangeOpen(true),
              )}
            </div>
          </section>
          <section className="panel">
            <div className="setting-group">
              <h2>{msg("가계부와 공유")}</h2>
              {row(
                msg("가계부 관리"),
                msg("표시 순서·만들기·소개 문구·수정·삭제"),
                () => open("ledger-manage"),
              )}
              {row(
                msg("가계부 분류 관리"),
                msg("수입·지출 분류 추가·수정·순서 변경"),
                () => open("categories"),
              )}
              {row(msg("공유 관리"), msg("초대·승인·역할 변경·공유 해제"), () =>
                open("sharing"),
              )}
              {row(
                msg("책임자 이전·공유 나가기"),
                msg("기록을 유지하고 공유 관계를 정리해요."),
                () => open("lifecycle"),
              )}
            </div>
          </section>
          <section className="panel">
            <div className="setting-group">
              <h2>{msg("자료 관리")}</h2>
              {row(
                msg("기록 휴지통"),
                msg("현재 가계부 범위의 삭제한 기록을 조회·복구해요."),
                showTrash,
                msg("열기"),
              )}
              {row(
                msg("삭제한 계좌"),
                msg("책임자인 계좌를 복구해요."),
                () => open("account-trash"),
                msg("열기"),
              )}
              {row(
                msg("CSV 내보내기"),
                msg("기간·검색 조건의 기록을 원래 통화로 내보내요."),
                exportCSV,
                msg("내보내기"),
              )}
              {row(
                msg("JSON 자료 내보내기"),
                msg("전체 기간 자료 · 사진·공유 권한 제외"),
                exportJSON,
                msg("내보내기"),
              )}
              {row(
                msg("CSV·JSON 가져오기"),
                msg("미리 보기와 중복 확인 후 반영해요."),
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
              msg("공개 회원가입 허용·새 사용자 초대"),
              () => open("admin"),
              msg("가입·초대 관리"),
            )}
            {row(
              msg("서버 운영 백업"),
              msg("모든 사용자의 자료와 사진이 포함됩니다. 관리자 전용."),
              () => open("backup"),
              msg("백업"),
            )}
          </div>
        </section>
      )}
      {section === "settings" && (
        <>
          <DisplaySettings userId={user.id} />
          <AppearanceSettings userId={user.id} />
        </>
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

const rootElement = document.getElementById("root");
if (rootElement) createRoot(rootElement).render(<Root />);
