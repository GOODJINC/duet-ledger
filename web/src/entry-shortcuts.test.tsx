// @vitest-environment happy-dom
import { today } from "./dates";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EntryDialog, type DialogProps } from "./dialogs";
import { canLeaveEntry } from "./entry-exit";
import { AccessReview } from "./access-review";
import {
  api,
  post,
  type Account,
  type EntryPresetInput,
  type User,
} from "./api";

vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  api: vi.fn(),
  post: vi.fn(),
}));
const user: User = {
  id: "u",
  name: "User",
  username: "user",
  admin: false,
  locale: "ko",
  timezone: "Asia/Seoul",
  csrf: "csrf",
  totp_enabled: false,
  default_currency: "KRW",
  exchange_rates: [{ from: "USD", to: "KRW", rate: "1400" }],
};
const account: Account = {
  id: "a",
  ledger_id: "l",
  ledger_name: "Personal",
  name: "은행",
  kind: "bank",
  currency: "KRW",
  scale: 0,
  opening: "0",
  balance: "0",
  archived: false,
  version: 1,
  role: "owner",
  shared: false,
  owner_name: "User",
};
const input: EntryPresetInput = {
  kind: "expense",
  account_id: "a",
  amount: "12000",
  title: "즐겨찾는 점심",
  category: "food",
  note: "메모",
};
let favorite: EntryPresetInput;
function props(): DialogProps {
  return {
    user,
    accounts: [account],
    ledgers: [],
    selectedLedger: "l",
    refresh: vi.fn(async () => {}),
    close: vi.fn(),
    notify: vi.fn(),
  };
}
beforeEach(() => {
  favorite = { ...input };
  vi.mocked(api).mockReset();
  vi.mocked(post).mockReset();
  vi.mocked(api).mockImplementation(async (path) =>
    path.startsWith("/me/entry-presets")
      ? ({
          favorites: [{ id: "f", input: favorite }],
          recent: [{ id: "r", input: { ...favorite, title: "최근 점심" } }],
        } as any)
      : ([
          { code: "food", name: "식비", kind: "expense", hidden: false },
        ] as any),
  );
  vi.mocked(post).mockResolvedValue({ id: "saved" });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function openShortcuts() {
  const summary = screen.getByText("즐겨찾기·최근 입력");
  const details = summary.closest("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  await screen.findByRole("button", { name: /즐겨찾는 점심.*은행/ });
}
it("loads a favorite as a new draft with today's date and requires explicit transaction save", async () => {
  const actor = userEvent.setup();
  render(<EntryDialog {...props()} />);
  await openShortcuts();
  await actor.click(
    screen.getByRole("button", { name: /즐겨찾는 점심.*은행/ }),
  );
  expect((screen.getByLabelText("내용") as HTMLInputElement).value).toBe(
    input.title,
  );
  expect((screen.getByLabelText("날짜") as HTMLInputElement).value).toBe(
    today(user.timezone),
  );
  expect(vi.mocked(post)).not.toHaveBeenCalled();
  await actor.click(screen.getByRole("button", { name: "기록 저장하기" }));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/transactions",
      expect.objectContaining({
        amount: "12000",
        date: today(user.timezone),
        version: 0,
      }),
      "POST",
      expect.objectContaining({ "Idempotency-Key": expect.any(String) }),
    ),
  );
});
it("reuses foreign amounts with the current rate instead of the historical rate", async () => {
  favorite = {
    ...input,
    amount: "20000",
    original_currency: "USD",
    original_amount: "2000",
    exchange_rate: "1000",
  };
  const actor = userEvent.setup();
  render(<EntryDialog {...props()} />);
  await openShortcuts();
  await actor.click(
    screen.getByRole("button", { name: /즐겨찾는 점심.*은행/ }),
  );
  expect(
    Number((screen.getByLabelText("금액") as HTMLInputElement).value),
  ).toBe(20);
  await actor.click(screen.getByRole("button", { name: "기록 저장하기" }));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/transactions",
      expect.objectContaining({
        amount: "28000",
        original_amount: "2000",
        exchange_rate: "1400",
      }),
      "POST",
      expect.anything(),
    ),
  );
});
it("offers recent input without mutating the original and filters the request to the selected ledger", async () => {
  const actor = userEvent.setup();
  render(<EntryDialog {...props()} />);
  await openShortcuts();
  await actor.click(screen.getByRole("button", { name: "최근 입력" }));
  await actor.click(screen.getByRole("button", { name: /최근 점심.*은행/ }));
  expect((screen.getByLabelText("내용") as HTMLInputElement).value).toBe(
    "최근 점심",
  );
  expect(post).not.toHaveBeenCalled();
  expect(api).toHaveBeenCalledWith("/me/entry-presets?ledger=l");
});
it("displays the effective role and both independent sharing paths", () => {
  render(
    <AccessReview
      accounts={[
        {
          ...account,
          shared: true,
          role: "editor",
          access_paths: [
            { type: "ledger", role: "viewer" },
            { type: "account", role: "editor" },
          ],
        },
      ]}
    />,
  );
  const details = screen
    .getByText("내 계좌 접근 권한 확인")
    .closest("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  expect(screen.getByText("가계부 전체 공유 · 조회자")).toBeTruthy();
  expect(screen.getByText("계좌 직접 공유 · 편집자")).toBeTruthy();
  expect(screen.getByText("User · 편집자")).toBeTruthy();
});

it("keeps an unsaved draft when replacement is cancelled", async () => {
  const actor = userEvent.setup();
  vi.stubGlobal(
    "confirm",
    vi.fn(() => false),
  );
  render(<EntryDialog {...props()} />);
  await actor.type(screen.getByLabelText("내용"), "아직 작성 중");
  await openShortcuts();
  await actor.click(
    screen.getByRole("button", { name: /즐겨찾는 점심.*은행/ }),
  );
  expect((screen.getByLabelText("내용") as HTMLInputElement).value).toBe(
    "아직 작성 중",
  );
  expect(post).not.toHaveBeenCalled();
});

it("keeps a changed draft when closing is cancelled, and asks before browser Back", async () => {
  const actor = userEvent.setup();
  const p = props();
  const ask = vi.fn(() => false);
  vi.stubGlobal("confirm", ask);
  render(<EntryDialog {...p} />);
  await actor.type(screen.getByLabelText("내용"), "작성 중");
  await actor.click(screen.getByRole("button", { name: "뒤로가기" }));
  expect(p.close).not.toHaveBeenCalled();
  expect((screen.getByLabelText("내용") as HTMLInputElement).value).toBe(
    "작성 중",
  );
  expect(canLeaveEntry()).toBe(false);
  ask.mockReturnValue(true);
  await actor.click(screen.getByRole("button", { name: "닫기" }));
  expect(p.close).toHaveBeenCalledOnce();
  expect(canLeaveEntry()).toBe(true);
});
it("closes an untouched entry without confirmation and protects page reload only after changes", async () => {
  const actor = userEvent.setup();
  const p = props();
  const ask = vi.fn(() => false);
  vi.stubGlobal("confirm", ask);
  render(<EntryDialog {...p} />);
  await actor.click(screen.getByRole("button", { name: "닫기" }));
  expect(p.close).toHaveBeenCalledOnce();
  expect(ask).not.toHaveBeenCalled();
  const clean = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(clean);
  expect(clean.defaultPrevented).toBe(false);
  await actor.type(screen.getByLabelText("금액"), "5000");
  const dirty = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(dirty);
  expect(dirty.defaultPrevented).toBe(true);
});
it("returns after saving without a discard prompt and blocks exit while saving", async () => {
  const actor = userEvent.setup();
  const p = props();
  const ask = vi.fn(() => false);
  vi.stubGlobal("confirm", ask);
  let finish!: (value: { id: string }) => void;
  vi.mocked(post).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<EntryDialog {...p} />);
  await actor.type(screen.getByLabelText("내용"), "점심");
  await actor.type(screen.getByLabelText("금액"), "5000");
  await actor.click(screen.getByRole("button", { name: "기록 저장하기" }));
  await waitFor(() => expect(post).toHaveBeenCalled());
  expect(canLeaveEntry()).toBe(false);
  finish({ id: "new" });
  await waitFor(() => expect(p.close).toHaveBeenCalledOnce());
  expect(canLeaveEntry()).toBe(true);
  expect(ask).not.toHaveBeenCalled();
});
