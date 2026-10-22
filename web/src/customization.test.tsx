// @vitest-environment happy-dom
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SettingsView, Application } from "./main";
import { EntryDialog, DetailDialog, type DialogProps } from "./dialogs";
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
  expect(
    screen.getByRole("button", { name: "관리" }),
  ).toBeTruthy();
});
