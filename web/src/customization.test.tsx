// @vitest-environment happy-dom
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsView, Application } from "./main";
import {
  EntryDialog,
  DetailDialog,
  MonthDialog,
  LedgerDialog,
  type DialogProps,
} from "./dialogs";
import { CategoriesDialog, AdminDialog } from "./preferences";
import { api, post, type User, type Account, type Transaction } from "./api";
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
  expect(
    screen.getByRole("navigation", { name: "설정 구분" }).textContent,
  ).toBe("계정 설정설정");
  expect(screen.queryByRole("button", { name: "가입·초대 관리" })).toBeNull();
  expect(screen.queryByText("서버 운영 백업")).toBeNull();
  v.rerender(<SettingsView {...p} section="administration" />);
  expect(screen.getByText("서버 운영 백업")).toBeTruthy();
  expect(screen.queryByLabelText("표시할 이름")).toBeNull();
});
it("빠른 입력의 선택 시간은 비울 수 있고 PC에서는 직접 입력한다", async () => {
  const p = props();
  const actor = userEvent.setup();
  render(<EntryDialog {...p} manageCategories={vi.fn()} />);
  const time = screen.getByLabelText("시간 (선택)") as HTMLInputElement;
  expect(time.type).toBe("text");
  expect(time.required).toBe(false);
  expect(screen.queryByText("환불·잔액 조정이 필요할 때")).toBeNull();
  expect(screen.getByLabelText("메모 (선택)")).toBeTruthy();
  await actor.clear(time);
  await actor.type(screen.getByLabelText("금액"), "100");
  await actor.type(screen.getByLabelText("내용"), "점심");
  await actor.click(screen.getByRole("button", { name: "기록 저장하기" }));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/transactions",
      expect.objectContaining({ time: "" }),
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
