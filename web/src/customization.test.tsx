// @vitest-environment happy-dom
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsView, Application, TransactionRows } from "./main";
import {
  EntryDialog,
  DetailDialog,
  MonthDialog,
  LedgerDialog,
  type DialogProps,
} from "./dialogs";
import { CategoriesDialog, ExchangeSettings } from "./preferences";
import {
  api,
  post,
  today,
  type User,
  type Account,
  type Transaction,
} from "./api";
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  api: vi.fn(),
  post: vi.fn(),
}));
const user: User = {
  id: "u",
  username: "owner",
  name: "민수",
  admin: true,
  locale: "ko",
  timezone: "Asia/Seoul",
  totp_enabled: false,
  csrf: "csrf",
};
const ledger = {
  id: "l",
  name: "우리집",
  kind: "shared" as const,
  role: "owner" as const,
  timezone: "Asia/Seoul",
};
const account: Account = {
  id: "a",
  ledger_id: "l",
  ledger_name: "우리집",
  name: "통장",
  kind: "bank",
  currency: "KRW",
  scale: 0,
  opening: "0",
  balance: "0",
  archived: false,
  version: 1,
  role: "owner",
  shared: true,
  owner_name: "민수",
};
const tx: Transaction = {
  id: "p",
  kind: "expense",
  date: "2026-10-22",
  time: "",
  currency: "KRW",
  scale: 0,
  version: 1,
  creator: "민수",
  can_edit: true,
  deleted: false,
  legs: [
    {
      id: "p",
      account_id: "a",
      amount: "-100",
      title: "점심",
      category: "food",
      note: "",
      receipts: [{ id: "photo", size: 10, media_type: "image/jpeg" }],
    },
  ],
};
const props = (): DialogProps => ({
  user,
  ledgers: [ledger],
  accounts: [account],
  close: vi.fn(),
  refresh: vi.fn(async () => {}),
  notify: vi.fn(),
});
const settings = () => ({
  user,
  refresh: vi.fn(async () => {}),
  open: vi.fn(),
  theme: "dark",
  setTheme: vi.fn(),
  notify: vi.fn(),
  exportJSON: vi.fn(),
  exportCSV: vi.fn(),
  showTrash: vi.fn(),
  accent: "green",
  setAccent: vi.fn(),
  navigate: vi.fn(),
});
beforeEach(() => {
  history.replaceState({}, "", "/home");
  vi.mocked(api).mockReset();
  vi.mocked(post).mockReset();
  vi.mocked(post).mockResolvedValue({ id: "p" });
  vi.mocked(api).mockResolvedValue([
    { code: "food", name: "식비", kind: "expense", hidden: false },
  ]);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("계정·일반·관리 설정을 분리하고 일반 사용자에게 관리 메뉴를 숨긴다", () => {
  const p = settings();
  const v = render(<SettingsView {...p} section="account-settings" />);
  expect(screen.getByText("로그인 보안")).toBeTruthy();
  expect(screen.queryByText("서버 운영 백업")).toBeNull();
  expect(screen.queryByText("테마 색상")).toBeNull();
  v.rerender(
    <SettingsView {...p} section="settings" user={{ ...user, admin: false }} />,
  );
  expect(screen.getByText("테마 색상")).toBeTruthy();
  expect(screen.getByText("디자인 직접 설정")).toBeTruthy();
  expect(
    screen.getByRole("navigation", { name: "설정 구분" }).textContent,
  ).toBe("계정 설정설정");
  expect(screen.queryByRole("button", { name: "가입·초대 관리" })).toBeNull();
  expect(screen.queryByText("서버 운영 백업")).toBeNull();
  v.rerender(<SettingsView {...p} section="administration" />);
  expect(screen.getByText("서버 운영 백업")).toBeTruthy();
  expect(screen.queryByText("디자인 직접 설정")).toBeNull();
  expect(screen.getByText("공통 CSS·글꼴")).toBeTruthy();
  expect(screen.queryByLabelText("표시할 이름")).toBeNull();
});
it("빠른 입력 시간은 필수이며 PC에서는 직접 입력한다", async () => {
  const p = props();
  const actor = userEvent.setup();
  render(<EntryDialog {...p} manageCategories={vi.fn()} />);
  const time = screen.getByLabelText("시간") as HTMLInputElement;
  expect(time.type).toBe("text");
  expect(time.required).toBe(true);
  expect(time.value).toMatch(/^\d{2}:\d{2}$/);
  expect(screen.queryByText("환불·잔액 조정이 필요할 때")).toBeNull();
  expect(screen.getByLabelText("메모 (선택)")).toBeTruthy();
  await actor.clear(time);
  await actor.type(screen.getByLabelText("금액"), "100");
  await actor.type(screen.getByLabelText("내용"), "점심");
  await actor.click(screen.getByRole("button", { name: "기록 저장하기" }));
  expect(post).not.toHaveBeenCalled();
  await actor.type(time, "14:30");
  await actor.click(screen.getByRole("button", { name: "기록 저장하기" }));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/transactions",
      expect.objectContaining({ time: "14:30" }),
      "POST",
      expect.any(Object),
    ),
  );
});
it("상세 사진은 보기·다운로드만 제공하고 수정에서 해제를 예약한다", async () => {
  const actor = userEvent.setup();
  const p = props();
  const v = render(<DetailDialog {...p} transaction={tx} edit={vi.fn()} />);
  expect(screen.getByAltText("첨부 영수증")).toBeTruthy();
  expect(screen.getByRole("button", { name: "사진 다운로드" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "첨부 해제" })).toBeNull();
  expect(document.querySelector('input[type="file"]')).toBeNull();
  v.unmount();
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
  render(<EntryDialog {...p} transaction={tx} />);
  await actor.click(screen.getByRole("button", { name: "첨부 해제" }));
  expect(api).not.toHaveBeenCalledWith("/receipts/photo", expect.anything());
  await actor.type(screen.getByLabelText("시간"), "12:30");
  await actor.click(screen.getByRole("button", { name: "수정 저장하기" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith("/receipts/photo", { method: "DELETE" }),
  );
  expect(post).toHaveBeenCalledTimes(1);
});
it("분류 변경은 전체 순서를 서버에 저장한다", async () => {
  vi.mocked(api).mockResolvedValue([
    { code: "food", name: "식비", kind: "expense", hidden: false },
    { code: "other", name: "기타", kind: "expense", hidden: false },
  ]);
  render(<CategoriesDialog {...props()} />);
  await userEvent.click(
    await screen.findByRole("button", { name: "기타 위로" }),
  );
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/ledgers/l/categories/order",
      { kind: "expense", codes: ["other", "food"] },
      "PUT",
    ),
  );
});
it("사용자 메뉴에서 계정 설정·설정·관리·로그아웃을 제공한다", async () => {
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === "/accounts") return [account] as any;
    if (path === "/ledgers") return [ledger] as any;
    if (path === "/me") return user as any;
    return {
      items: [],
      count: 0,
      page: 1,
      page_size: 50,
      totals: [],
      categories: [],
      daily: [],
    } as any;
  });
  render(
    <Application
      user={user}
      setUser={vi.fn()}
      invite=""
      clearInvite={vi.fn()}
      joined={false}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "사용자 메뉴" }));
  expect(screen.getByRole("button", { name: "계정 설정" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "로그아웃" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "관리" })).toBeTruthy();
});

it("다른 연도와 월로 바로 이동한다", async () => {
  const select = vi.fn();
  const close = vi.fn();
  render(<MonthDialog date="2026-10-31" select={select} close={close} />);
  const actor = userEvent.setup();
  await actor.clear(screen.getByLabelText("연도"));
  await actor.type(screen.getByLabelText("연도"), "2025");
  await actor.click(screen.getByRole("button", { name: "8월" }));
  expect(select).toHaveBeenCalledWith(2025, 8);
  expect(close).toHaveBeenCalled();
});
it("가계부 선택은 이동만 제공하고 관리 화면에서 순서를 저장한다", async () => {
  const p = {
    ...props(),
    ledgers: [ledger, { ...ledger, id: "l2", name: "개인" }],
  };
  const actor = userEvent.setup();
  const v = render(<LedgerDialog {...p} selected="" select={vi.fn()} />);
  expect(screen.queryByRole("button", { name: "개인 위로" })).toBeNull();
  v.unmount();
  render(<LedgerDialog {...p} selected="" select={vi.fn()} manage />);
  expect(screen.queryByRole("button", { name: "선택 화면" })).toBeNull();
  await actor.click(screen.getByRole("button", { name: "개인 위로" }));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/ledgers/order",
      { ids: ["l2", "l"] },
      "PUT",
    ),
  );
});
it("일반 설정에서 기본 통화를 저장한다", async () => {
  const p = settings();
  render(<SettingsView {...p} section="settings" />);
  const actor = userEvent.setup();
  await actor.selectOptions(screen.getByLabelText("기본 통화"), "JPY");
  await actor.click(screen.getByRole("button", { name: "설정 저장" }));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/me",
      expect.objectContaining({ default_currency: "JPY" }),
      "PATCH",
    ),
  );
});
it("분류 삭제는 복구 버튼 없이 삭제 API를 호출한다", async () => {
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
  render(<CategoriesDialog {...props()} />);
  const actor = userEvent.setup();
  await actor.click(await screen.findByRole("button", { name: "삭제" }));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/ledgers/l/categories/food?kind=expense",
      {},
      "DELETE",
    ),
  );
  expect(screen.queryByRole("button", { name: "다시 사용" })).toBeNull();
});
it("기본 통화로 조회하고 날짜·보기 도구가 검색 위에 표시된다", async () => {
  const preferred = { ...user, default_currency: "USD" };
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === "/accounts")
      return [
        account,
        { ...account, id: "usd", currency: "USD", scale: 2 },
      ] as any;
    if (path === "/ledgers") return [ledger] as any;
    if (path === "/me") return preferred as any;
    return {
      items: [],
      count: 0,
      page: 1,
      page_size: 50,
      totals: [],
      categories: [],
      daily: [],
    } as any;
  });
  const actor = userEvent.setup();
  render(
    <Application
      user={preferred}
      setUser={vi.fn()}
      invite=""
      clearInvite={vi.fn()}
      joined={false}
    />,
  );
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(expect.stringContaining("currency=USD")),
  );
  expect(document.querySelector(".sidebar nav")?.textContent).not.toContain(
    "설정",
  );
  expect(screen.queryByLabelText("통화 선택")).toBeNull();
  await actor.click(screen.getAllByRole("button", { name: "가계부" })[0]);
  const period = screen.getByRole("group", { name: "조회 기간" });
  const search = screen.getByPlaceholderText(
    "내용·분류·메모·작성자 이름·아이디로 검색",
  );
  expect(
    period.compareDocumentPosition(search) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(period.closest(".period-toolbar")).toBeTruthy();
  expect(
    period
      .closest(".period-toolbar")
      ?.querySelector('[aria-label="년·월 선택"]'),
  ).toBeTruthy();
  await actor.click(screen.getByRole("button", { name: "년·월 선택" }));
  await actor.clear(screen.getByLabelText("연도"));
  await actor.type(screen.getByLabelText("연도"), "2025");
  await actor.click(screen.getByRole("button", { name: "8월" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      expect.stringContaining("from=2025-08-01"),
    ),
  );
});

it("이번 달 버튼과 기본 통화 계좌 우선 선택", async () => {
  const actor = userEvent.setup();
  const choose = vi.fn();
  const v = render(
    <MonthDialog
      date="2020-01-31"
      timezone="Asia/Seoul"
      select={choose}
      close={vi.fn()}
    />,
  );
  await actor.click(screen.getByRole("button", { name: "이번 달" }));
  const date = today("Asia/Seoul");
  expect(choose).toHaveBeenCalledWith(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)),
  );
  v.unmount();
  render(
    <EntryDialog
      {...props()}
      user={{ ...user, default_currency: "USD" }}
      accounts={[account, { ...account, id: "usd", currency: "USD", scale: 2 }]}
    />,
  );
  expect((screen.getByLabelText("계좌") as HTMLSelectElement).value).toBe(
    "usd",
  );
  expect((screen.getByLabelText("입력 통화") as HTMLSelectElement).value).toBe(
    "USD",
  );
});
it("원화 계좌의 외화 결제를 원금액·환율·반영액과 함께 저장한다", async () => {
  const actor = userEvent.setup();
  render(
    <EntryDialog
      {...props()}
      user={{
        ...user,
        default_account_id: account.id,
        default_currency: "USD",
        exchange_rates: [{ from: "USD", to: "KRW", rate: "1400" }],
      }}
    />,
  );
  expect((screen.getByLabelText("계좌") as HTMLSelectElement).value).toBe(
    account.id,
  );
  await waitFor(() =>
    expect((screen.getByLabelText("적용 환율") as HTMLInputElement).value).toBe(
      "1400",
    ),
  );
  await actor.type(screen.getByLabelText("금액"), "20");
  await actor.type(screen.getByLabelText("내용"), "구독료");
  const privacy = screen.getByText("공유된 계좌에 기록하고 있어요.");
  const attachment = screen.getByText(/사진 선택 · JPG/);
  expect(
    attachment.compareDocumentPosition(privacy) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  await actor.click(screen.getByRole("button", { name: "기록 저장하기" }));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/transactions",
      expect.objectContaining({
        amount: "28000",
        original_currency: "USD",
        original_amount: "2000",
        exchange_rate: "1400",
      }),
      "POST",
      expect.any(Object),
    ),
  );
});
it("페이지 뒤로가기와 팝업 뒤로가기를 별도로 처리한다", async () => {
  const confirmExit = vi.fn(() => false);
  vi.stubGlobal("confirm", confirmExit);
  history.replaceState({}, "", "/home");
  const actor = userEvent.setup();
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === "/accounts") return [account] as any;
    if (path === "/ledgers") return [ledger] as any;
    if (path === "/me") return user as any;
    if (path.startsWith("/categories"))
      return [
        { code: "food", name: "식비", kind: "expense", hidden: false },
      ] as any;
    return {
      items: [],
      count: 0,
      page: 1,
      page_size: 50,
      totals: [],
      categories: [],
      daily: [],
    } as any;
  });
  render(
    <Application
      user={user}
      setUser={vi.fn()}
      invite=""
      clearInvite={vi.fn()}
      joined={false}
    />,
  );
  await waitFor(() => expect(api).toHaveBeenCalledWith("/accounts"));
  await actor.click(screen.getByRole("button", { name: "사용자 메뉴" }));
  await actor.click(screen.getByRole("button", { name: "설정" }));
  expect(location.pathname).toBe("/settings");
  expect(screen.queryByRole("button", { name: "빠른 입력" })).toBeNull();
  history.back();
  await waitFor(() => expect(location.pathname).toBe("/home"));
  await actor.click(screen.getAllByRole("button", { name: "빠른 입력" })[0]);
  expect(await screen.findByRole("dialog")).toBeTruthy();
  expect(history.state.overlay).toBe(1);
  await actor.type(screen.getByLabelText("내용"), "입력 중");
  expect(screen.queryByRole("button", { name: "분류 관리 열기" })).toBeNull();
  history.back();
  await waitFor(() => expect(confirmExit).toHaveBeenCalledOnce());
  await waitFor(() => expect(history.state.overlay).toBe(1));
  expect((screen.getByLabelText("내용") as HTMLInputElement).value).toBe(
    "입력 중",
  );
  confirmExit.mockReturnValue(true);
  history.back();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(location.pathname).toBe("/home");
});

it("달러 거래를 원화로 표시할 때 원화 소수 자릿수를 사용한다", () => {
  render(
    <TransactionRows
      items={[
        {
          ...tx,
          kind: "income",
          currency: "USD",
          scale: 2,
          display_currency: "KRW",
          legs: [{ ...tx.legs[0], amount: "500", display_amount: "7000" }],
        },
      ]}
      accounts={[account]}
      open={vi.fn()}
    />,
  );
  expect(screen.getByText("+7,000원")).toBeTruthy();
  expect(screen.getByText("5.00 USD")).toBeTruthy();
});

it("기본 통화만 제공하고 등록한 보조 통화만 입력에 추가한다", () => {
  const v = render(<EntryDialog {...props()} />);
  expect(
    Array.from(
      (screen.getByLabelText("입력 통화") as HTMLSelectElement).options,
    ).map((o) => o.value),
  ).toEqual(["KRW"]);
  v.unmount();
  render(
    <EntryDialog
      {...props()}
      user={{
        ...user,
        default_currency: "KRW",
        exchange_rates: [{ from: "USD", to: "KRW", rate: "1400" }],
      }}
    />,
  );
  expect(
    Array.from(
      (screen.getByLabelText("입력 통화") as HTMLSelectElement).options,
    ).map((o) => o.value),
  ).toEqual(["KRW", "USD"]);
});
it("팝업 바깥 클릭은 입력을 유지하고 ESC 요청은 닫기를 호출한다", () => {
  const p = props();
  render(<EntryDialog {...p} />);
  const dialog = screen.getByRole("dialog");
  fireEvent.click(dialog, { clientX: -100, clientY: -100 });
  expect(p.close).not.toHaveBeenCalled();
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(p.close).toHaveBeenCalledTimes(1);
});
it("환율 관리가 별도 창에서 열리고 뒤로가기로 닫힌다", async () => {
  const actor = userEvent.setup();
  vi.mocked(api).mockResolvedValue({ rate: "1400", date: "2026-10-23" } as any);
  render(<SettingsView {...settings()} section="settings" />);
  expect(screen.queryByLabelText("환율")).toBeNull();
  await actor.click(
    screen
      .getByText("보조 통화와 환율")
      .closest(".setting-row")!
      .querySelector("button.secondary-button")!,
  );
  expect(await screen.findByRole("dialog")).toBeTruthy();
  expect(screen.queryByLabelText("환율")).toBeNull();
  await actor.click(screen.getByRole("button", { name: "+ 통화 추가" }));
  await waitFor(() =>
    expect((screen.getByLabelText("환율") as HTMLInputElement).value).toBe(
      "1400",
    ),
  );
  expect(post).not.toHaveBeenCalled();
  await actor.click(screen.getByRole("button", { name: "환율 저장" }));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/me/exchange-rates",
      { from: "USD", to: "KRW", rate: "1400" },
      "PUT",
    ),
  );
  history.back();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});
it("환율 API 실패 후 직접 입력으로 저장한다", async () => {
  const actor = userEvent.setup();
  vi.mocked(api).mockRejectedValue(new Error("연결 실패"));
  render(
    <ExchangeSettings
      user={user}
      refresh={vi.fn(async () => {})}
      notify={vi.fn()}
    />,
  );
  expect(screen.queryByLabelText("환율")).toBeNull();
  expect(api).not.toHaveBeenCalled();
  await actor.click(screen.getByRole("button", { name: "+ 통화 추가" }));
  expect(await screen.findByText("연결 실패")).toBeTruthy();
  await actor.type(screen.getByLabelText("환율"), "1350");
  await actor.click(screen.getByRole("button", { name: "환율 저장" }));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/me/exchange-rates",
      { from: "USD", to: "KRW", rate: "1350" },
      "PUT",
    ),
  );
});
it("단축키가 검색·빠른 입력을 열고 입력 중에는 무시한다", async () => {
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === "/accounts") return [account] as any;
    if (path === "/ledgers") return [ledger] as any;
    if (path === "/me") return user as any;
    if (path.startsWith("/categories")) return [] as any;
    return {
      items: [],
      count: 0,
      page: 1,
      page_size: 50,
      totals: [],
      categories: [],
      daily: [],
    } as any;
  });
  render(
    <Application
      user={user}
      setUser={vi.fn()}
      invite=""
      clearInvite={vi.fn()}
      joined={false}
    />,
  );
  await waitFor(() => expect(api).toHaveBeenCalledWith("/accounts"));
  fireEvent.keyDown(document.body, { key: "/" });
  const search = await screen.findByPlaceholderText(
    "내용·분류·메모·작성자 이름·아이디로 검색",
  );
  await waitFor(() => expect(document.activeElement).toBe(search));
  fireEvent.keyDown(search, { key: "q" });
  expect(screen.queryByRole("dialog")).toBeNull();
  search.blur();
  fireEvent.keyDown(document.body, { key: "Q" });
  expect(await screen.findByRole("dialog")).toBeTruthy();
  expect(screen.queryByText("초기 개발판")).toBeNull();
  expect(document.querySelector(".mobile-ledger-picker")).toBeTruthy();
});
it("소개 카드 설정은 왼쪽과 홈에 함께 적용되고 닫기 버튼은 없다", async () => {
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === "/accounts") return [account] as any;
    if (path === "/ledgers") return [ledger] as any;
    return {
      items: [],
      count: 0,
      page: 1,
      page_size: 50,
      totals: [],
      categories: [],
      daily: [],
    } as any;
  });
  const p = {
    user: { ...user, show_sidebar_message: true },
    setUser: vi.fn(),
    invite: "",
    clearInvite: vi.fn(),
    joined: false,
  };
  const v = render(<Application {...p} />);
  await screen.findByText("함께 쓰고, 따로 지켜요.");
  expect(screen.getByText("혼자서도, 함께여도.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "소개 문구 숨기기" })).toBeNull();
  v.rerender(
    <Application {...p} user={{ ...user, show_sidebar_message: false }} />,
  );
  expect(screen.queryByText("함께 쓰고, 따로 지켜요.")).toBeNull();
  expect(screen.queryByText("혼자서도, 함께여도.")).toBeNull();
});
it("여러 보조 통화를 목록과 빠른 입력에서 함께 제공하고 새 통화를 추가한다", async () => {
  const actor = userEvent.setup();
  const rates = [
    { from: "USD", to: "KRW", rate: "1400" },
    { from: "JPY", to: "KRW", rate: "9" },
  ];
  vi.mocked(api).mockResolvedValue({ rate: "1500", date: "2026-10-23" } as any);
  const v = render(
    <ExchangeSettings
      user={{ ...user, default_currency: "KRW", exchange_rates: rates }}
      refresh={vi.fn(async () => {})}
      notify={vi.fn()}
    />,
  );
  expect(screen.getByText("1 USD = 1400 KRW")).toBeTruthy();
  expect(screen.getByText("1 JPY = 9 KRW")).toBeTruthy();
  await actor.click(screen.getByRole("button", { name: "+ 통화 추가" }));
  await waitFor(() =>
    expect(
      (screen.getByLabelText("환율 원래 통화") as HTMLSelectElement).value,
    ).toBe("EUR"),
  );
  await actor.click(screen.getByRole("button", { name: "환율 저장" }));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/me/exchange-rates",
      { from: "EUR", to: "KRW", rate: "1500" },
      "PUT",
    ),
  );
  v.unmount();
  render(
    <EntryDialog {...props()} user={{ ...user, exchange_rates: rates }} />,
  );
  expect(
    Array.from(
      (screen.getByLabelText("입력 통화") as HTMLSelectElement).options,
    ).map((o) => o.value),
  ).toEqual(["KRW", "USD", "JPY"]);
});
it("사진 선택 하나만 제공하고 미지원 이미지 형식을 검증한다", () => {
  render(<EntryDialog {...props()} />);
  const picker = screen.getByLabelText("영수증 사진 선택") as HTMLInputElement;
  expect(screen.queryByLabelText("영수증 촬영")).toBeNull();
  expect(picker.accept).toBe("image/*");
  expect(picker.hasAttribute("capture")).toBe(false);

  fireEvent.change(picker, {
    target: {
      files: [new File(["x"], "unsupported.heic", { type: "image/heic" })],
    },
  });
  expect(screen.getByText(/JPG 또는 PNG 사진을 선택/)).toBeTruthy();
  fireEvent.change(picker, {
    target: { files: [new File(["x"], "receipt.jpg", { type: "image/jpeg" })] },
  });
  expect(screen.getByText("receipt.jpg")).toBeTruthy();
  expect(screen.queryByText(/JPG 또는 PNG 사진을 선택/)).toBeNull();
});
it("안전 모드 주소는 관리 초기 화면과 설정 이동에서도 유지된다", async () => {
  history.replaceState({}, "", "/admin?safe-theme=1");
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === "/accounts") return [account] as any;
    if (path === "/ledgers") return [ledger] as any;
    if (path === "/appearance")
      return {
        css: { name: "", revision: "" },
        font: { name: "", revision: "" },
      } as any;
    return {
      items: [],
      count: 0,
      page: 1,
      page_size: 50,
      totals: [],
      categories: [],
      daily: [],
    } as any;
  });
  render(
    <Application
      user={user}
      setUser={vi.fn()}
      invite=""
      clearInvite={vi.fn()}
      joined={false}
    />,
  );
  expect(location.search).toBe("?safe-theme=1");
  expect(screen.getByText("공통 CSS·글꼴")).toBeTruthy();
  const actor = userEvent.setup();
  await actor.click(screen.getByRole("button", { name: "사용자 메뉴" }));
  await actor.click(screen.getAllByRole("button", { name: "설정" })[0]);
  expect(location.pathname).toBe("/settings");
  expect(location.search).toBe("?safe-theme=1");
  expect(screen.queryByText("공통 CSS·글꼴")).toBeNull();
});

it("groups account-wide preferences separately from browser display preferences", () => {
  render(<SettingsView {...settings()} section="settings" />);
  const account = document.querySelector('[data-settings-scope="account"]')!;
  const browser = document.querySelector('[data-settings-scope="browser"]')!;
  for (const name of ["언어", "시간대", "기본 통화", "빠른 입력 기본 계좌"])
    expect(account.contains(screen.getByLabelText(name))).toBe(true);
  for (const name of [
    "화면 구성",
    "디자인 직접 설정",
    "화면 밝기",
    "테마 색상",
  ])
    expect(browser.contains(screen.getByText(name))).toBe(true);
  expect(browser.querySelectorAll("section.panel")).toHaveLength(0);
  expect(browser.contains(screen.getByLabelText("글씨 크기"))).toBe(true);
});
