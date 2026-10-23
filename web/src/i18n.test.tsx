// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Auth } from "./main";
import { EntryDialog } from "./dialogs";
import { CategoriesDialog } from "./preferences";
import {
  api,
  post,
  displayCategory,
  formatMoney,
  type Account,
  type User,
} from "./api";
import { msg, setLocale, monthTitle, weekdays, manualURL } from "./i18n";
import ko from "./i18n/ko.json";
import en from "./i18n/en.json";
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  api: vi.fn(),
  post: vi.fn(),
}));
beforeEach(() => {
  setLocale("ko");
  vi.mocked(api).mockResolvedValue([
    { code: "food", name: "식비", kind: "expense", hidden: false },
  ]);
});
afterEach(() => {
  cleanup();
  setLocale("ko");
  localStorage.clear();
});

it("한국어와 영어 카탈로그의 항목과 치환자를 일치시킨다", () => {
  expect(Object.keys(en).sort()).toEqual(Object.keys(ko).sort());
  for (const [key, translation] of Object.entries(en)) {
    expect(translation.trim(), key).not.toBe("");
    expect(translation.match(/\{\d+\}/g)?.sort() || [], key).toEqual(
      key.match(/\{\d+\}/g)?.sort() || [],
    );
    if (key !== "한국어") expect(translation, key).not.toMatch(/[가-힣]/);
  }
});
it("로그인 전 언어 선택으로 입력칸과 보안 버튼을 즉시 번역한다", async () => {
  const actor = userEvent.setup();
  render(<Auth initialized invite="" onLogin={vi.fn()} />);
  await actor.selectOptions(screen.getByLabelText("언어"), "en");
  expect(screen.getByRole("heading", { name: "Welcome back" })).toBeTruthy();
  expect(screen.getByLabelText("Username")).toBeTruthy();
  expect(screen.getByLabelText("Password")).toBeTruthy();
  await actor.click(screen.getByRole("button", { name: "Show password" }));
  expect(screen.getByLabelText("Password").getAttribute("type")).toBe("text");
  expect(document.documentElement.lang).toBe("en");
});
it("영어 빠른 입력이 시스템 분류만 번역하고 계좌 이름은 보존한다", async () => {
  setLocale("en");
  const user: User = {
    id: "user",
    name: "사용자",
    username: "testuser",
    admin: true,
    locale: "en",
    timezone: "Asia/Seoul",
    csrf: "csrf",
    totp_enabled: false,
  };
  const account: Account = {
    id: "account",
    ledger_id: "ledger",
    ledger_name: "개인 자료",
    name: "우리 통장",
    kind: "bank",
    currency: "KRW",
    scale: 0,
    opening: "0",
    balance: "0",
    archived: false,
    version: 1,
    role: "owner",
    shared: false,
    owner_name: "사용자",
  };
  render(
    <EntryDialog
      user={user}
      accounts={[account]}
      ledgers={[]}
      close={vi.fn()}
      refresh={vi.fn(async () => {})}
      notify={vi.fn()}
    />,
  );
  expect(screen.getByLabelText("Description")).toBeTruthy();
  expect(screen.getByLabelText("Amount")).toBeTruthy();
  expect(screen.getByLabelText("Note (optional)")).toBeTruthy();
  expect(await screen.findByRole("button", { name: "Food" })).toBeTruthy();
  expect(screen.getByRole("option", { name: /우리 통장/ })).toBeTruthy();
  expect(displayCategory("custom-food", "식비")).toBe("식비");
});
it("언어가 바뀌어도 큰 금액을 보존하고 날짜·요일·매뉴얼을 현지화한다", () => {
  setLocale("en");
  expect(formatMoney("9000000000000000", 0, "KRW")).toBe(
    "9,000,000,000,000,000 KRW",
  );
  expect(monthTitle("2026-10-23")).toBe("October 2026");
  expect(weekdays()).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
  expect(manualURL("api")).toBe("/manual/en/api.html");
  expect(msg("소수점 {0}자리까지 입력할 수 있어요.", [2])).toBe(
    "Use no more than 2 decimal places.",
  );
  expect(msg("현재 비밀번호를 확인해 주세요.")).toBe(
    "Check your current password.",
  );
});

it("기본 분류의 영어 표시를 저장한 이름에 자동으로 덮어쓰지 않는다", async () => {
  setLocale("en");
  const actor = userEvent.setup();
  vi.mocked(post).mockReset();
  const user: User = {
    id: "user",
    name: "사용자",
    username: "testuser",
    admin: true,
    locale: "en",
    timezone: "Asia/Seoul",
    csrf: "csrf",
    totp_enabled: false,
  };
  render(
    <CategoriesDialog
      user={user}
      accounts={[]}
      ledgers={[
        {
          id: "ledger",
          name: "내 자료",
          kind: "personal",
          role: "owner",
          timezone: "Asia/Seoul",
        },
      ]}
      close={vi.fn()}
      refresh={vi.fn(async () => {})}
      notify={vi.fn()}
    />,
  );
  const field = await screen.findByLabelText("Category name for Food");
  expect((field as HTMLInputElement).value).toBe("Food");
  await actor.click(screen.getByRole("button", { name: "Edit" }));
  expect(post).toHaveBeenCalledWith("/ledgers/ledger/categories", {
    code: "food",
    name: "식비",
    kind: "expense",
    hidden: false,
  });
});

it("사용자 이름이 시스템 번역 문구와 같아도 입력값을 번역하지 않는다", () => {
  setLocale("en");
  render(<Auth initialized={false} invite="" onLogin={vi.fn()} />);
  const field = screen.getByLabelText("Display name") as HTMLInputElement;
  fireEvent.change(field, { target: { value: "식비" } });
  expect(field.value).toBe("식비");
});
