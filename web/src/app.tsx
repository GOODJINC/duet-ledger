import { isWritableAccount } from "./accounts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDisplayPreferences, useCompactLayout } from "./display-settings";
import {
  msg,
  useLocale,
  setLocale as setLanguage,
  monthTitle,
  manualURL,
} from "./i18n";
import { exchangeFactor, convertMinor } from "./exchange";
import { canLeaveEntry } from "./entry-exit";
import {
  api,
  post,
  download,
  setCSRF,
  formatMoney,
  currencyScales,
  kindNames,
  categories,
  displayCategory,
  type User,
  type Ledger,
  type Account,
  type Transaction,
  type Report,
} from "./api";
import { today, dateRange } from "./dates";
import { Brand, Icon, Privacy, Empty, type IconName } from "./ui";
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
  AdminDialog,
  AccountTrashDialog,
} from "./preferences";
import { useAppearance } from "./appearance";
import { AppPasswordsDialog } from "./api-settings";
import { SettingsView } from "./settings";
import {
  type Page,
  mainNavigation,
  pageURL,
  pageFromLocation,
} from "./navigation";
import {
  TransactionTableHeader,
  TransactionRows,
  CalendarView,
} from "./ledger-views";
import {
  SummaryCards,
  AccountsOverview,
  SharedLedgerNote,
  FlowPanel,
  DonutPanel,
} from "./dashboard-panels";

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
const emptyReport: Report = {
  items: [],
  count: 0,
  page: 1,
  page_size: 50,
  totals: [],
  categories: [],
  daily: [],
};
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
    const p = pageFromLocation();
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
      let next = pageFromLocation();
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
  const scale = currencyScales[currency] || 0;
  const selectedLedger = ledgers.find((l) => l.id === ledger);
  const totals = report.totals.find((t) => t.currency === currency);
  const balance = visibleAccounts.reduce((sum, a) => {
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
    if (!visibleAccounts.some(isWritableAccount)) {
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
        <TransactionTableHeader />
        {rows(report.items.slice(0, 5))}
        <div className="transaction-panel-footer">
          <button onClick={() => navigate("ledger")}>
            {msg("이번 달 기록 모두 보기")}
          </button>
        </div>
      </section>
    );
  }
  const actionInScope = !compactLayout && !ledger && !isSettings;
  const actionInMobileToolbar =
    compactLayout && page === "accounts" && !display.showPageHeadings;
  const primaryAction =
    page === "accounts" ? (
      <button
        className={`primary-button ${actionInMobileToolbar ? "mobile-account-create" : ""}`}
        onClick={() => setModal({ kind: "account" })}
      >
        <Icon name="plus" />
        {msg("계좌 만들기")}
      </button>
    ) : isSettings || (compactLayout && !display.mobileTopEntry) ? null : (
      <button className="primary-button" onClick={() => openEntry()}>
        <Icon name="plus" />
        {msg("빠른 입력")}
      </button>
    );
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
            {mainNavigation.map((n) => (
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
                                mainNavigation.find((n) => n.id === page)
                                  ?.label || "",
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
              className={`page-heading ${display.showPageHeadings ? "" : "heading-collapsed"} ${!display.showPageHeadings && (isSettings || actionInScope || actionInMobileToolbar || (compactLayout && !display.mobileTopEntry)) ? "visually-hidden" : ""}`}
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
                {!actionInScope && !actionInMobileToolbar && primaryAction}
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
                  {actionInScope && primaryAction}
                </div>
                <div className="date-currency-toolbar period-toolbar">
                  {actionInMobileToolbar && primaryAction}
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
                <SummaryCards
                  balance={balance}
                  accountCount={visibleAccounts.length}
                  totals={totals}
                  currency={currency}
                  scale={scale}
                />
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
                    <AccountsOverview
                      accounts={visibleAccounts}
                      onMore={() => navigate("accounts")}
                      openAccount={(account) =>
                        setModal({ kind: "account", account })
                      }
                    />
                    <DonutPanel
                      report={report}
                      currency={currency}
                      scale={scale}
                    />
                    {user.show_sidebar_message !== false && (
                      <SharedLedgerNote
                        onOpen={() => setModal({ kind: "sharing" })}
                      />
                    )}
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
                    <TransactionTableHeader />
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
                <SummaryCards
                  balance={balance}
                  accountCount={visibleAccounts.length}
                  totals={totals}
                  currency={currency}
                  scale={scale}
                />
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
                <div className="scope-explanation accounts-summary">
                  <Icon name="info" />
                  {msg(
                    "선택한 계좌의 잔액을 합산해요. 통화가 다르면 따로 표시합니다.",
                  )}
                </div>
                <div className="accounts-grid">
                  {visibleAccounts.map((a) => (
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
                {!visibleAccounts.length && (
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
        {mainNavigation.map((n) => (
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
