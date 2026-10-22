// @vitest-environment happy-dom
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PasswordInput } from "./ui";
import { SecurityDialog } from "./management";
import { EntryDialog, LedgerDialog, type DialogProps } from "./dialogs";
import { Auth } from "./main";
import { api, post, type User, type Account, type Ledger } from "./api";
vi.mock("./api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./api")>();
  return { ...original, api: vi.fn(), post: vi.fn() };
});
const user: User = {
  id: "u1",
  username: "owner",
  name: "테스트",
  admin: true,
  locale: "ko",
  timezone: "Asia/Seoul",
  totp_enabled: false,
  csrf: "csrf",
  show_sidebar_message: true,
};
const personal: Ledger = {
  id: "private",
  name: "개인",
  kind: "personal",
  role: "owner",
  timezone: "Asia/Seoul",
};
const family: Ledger = {
  ...personal,
  id: "family",
  name: "가족",
  kind: "shared",
};
const account: Account = {
  id: "private-account",
  ledger_id: personal.id,
  ledger_name: personal.name,
  name: "개인 통장",
  kind: "bank",
  currency: "KRW",
  scale: 0,
  opening: "0",
  balance: "0",
  archived: false,
  version: 1,
  role: "owner",
  shared: false,
  owner_name: user.name,
};
const shared: Account = {
  ...account,
  id: "family-account",
  ledger_id: family.id,
  ledger_name: family.name,
  name: "가족 통장",
  shared: true,
};
function props(): DialogProps {
  return {
    user,
    accounts: [account, shared],
    ledgers: [personal, family],
    refresh: vi.fn(async () => {}),
    close: vi.fn(),
    notify: vi.fn(),
  };
}
beforeEach(() => {
  vi.mocked(api).mockReset();
  vi.mocked(post).mockReset();
  vi.mocked(api).mockImplementation(async (path) =>
    path.includes("kind=income")
      ? ([
          { code: "salary", name: "월급", kind: "income", hidden: false },
        ] as any)
      : ([
          { code: "food", name: "식비", kind: "expense", hidden: false },
        ] as any),
  );
});
afterEach(cleanup);
it("비밀번호 보기를 켜고 꺼도 입력값이 유지된다", async () => {
  const actor = userEvent.setup();
  render(
    <>
      <label htmlFor="secret">비밀번호</label>
      <PasswordInput id="secret" defaultValue="password8" />
    </>,
  );
  const input = screen.getByLabelText("비밀번호") as HTMLInputElement;
  expect(input.type).toBe("password");
  await actor.click(screen.getByRole("button", { name: "비밀번호 보기" }));
  expect(input.type).toBe("text");
  expect(input.value).toBe("password8");
  await actor.click(screen.getByRole("button", { name: "비밀번호 숨기기" }));
  expect(input.type).toBe("password");
  expect(input.value).toBe("password8");
});
it("자동완성된 현재 비밀번호도 변경 요청에 전달한다", async () => {
  const actor = userEvent.setup();
  const p = props();
  vi.mocked(post).mockResolvedValue(user);
  render(<SecurityDialog {...p} />);
  await actor.type(screen.getByLabelText("새 비밀번호 · 8자 이상"), "newpass8");
  (screen.getByLabelText("현재 비밀번호") as HTMLInputElement).value =
    "autofilled-current";
  await actor.click(screen.getByRole("button", { name: "비밀번호 변경" }));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith("/security/password", {
      current: "autofilled-current",
      password: "newpass8",
      code: "",
    }),
  );
});
it("자동완성된 비밀번호로 2단계 인증을 시작한다", async () => {
  const actor = userEvent.setup();
  vi.mocked(post).mockResolvedValue({ secret: "TEST-SECRET", uri: "test" });
  render(<SecurityDialog {...props()} />);
  await actor.click(screen.getByRole("button", { name: "2단계 인증" }));
  (screen.getByLabelText("현재 비밀번호") as HTMLInputElement).value =
    "autofilled-current";
  await actor.click(screen.getByRole("button", { name: "인증 앱 등록 시작" }));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith("/security/totp/start", {
      password: "autofilled-current",
    }),
  );
  expect(await screen.findByText("TEST-SECRET")).toBeTruthy();
});
it("가족 가계부에서 개인 계좌를 제외하고 수입 분류·시간을 저장한다", async () => {
  const actor = userEvent.setup();
  const p = props();
  vi.mocked(post).mockResolvedValue({ id: "record" });
  render(<EntryDialog {...p} selectedLedger="family" />);
  expect(screen.queryByRole("option", { name: /개인 통장/ })).toBeNull();
  expect((screen.getByLabelText("계좌") as HTMLSelectElement).value).toBe(
    shared.id,
  );
  await actor.click(screen.getByRole("button", { name: "수입" }));
  expect(screen.getByPlaceholderText("예: 10월 월급")).toBeTruthy();
  expect(await screen.findByRole("button", { name: "월급" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "식비" })).toBeNull();
  expect(screen.queryByLabelText("직접 분류 입력")).toBeNull();
  await actor.type(screen.getByLabelText("금액"), "100000");
  await actor.type(screen.getByLabelText("내용"), "월급");
  const clock = screen.getByLabelText("시간 (선택)") as HTMLInputElement;
  await actor.clear(clock);
  await actor.type(clock, "13:45");
  await actor.click(screen.getByRole("button", { name: "기록 저장하기" }));
  await waitFor(() => expect(p.close).toHaveBeenCalled());
  expect(post).toHaveBeenCalledWith(
    "/transactions",
    expect.objectContaining({
      account_id: shared.id,
      ledger_id: family.id,
      category: "salary",
      kind: "income",
      time: "13:45",
    }),
    "POST",
    expect.any(Object),
  );
});
it("가계부 선택 화면은 생성 입력창 없이 기존 가계부부터 보여준다", () => {
  render(<LedgerDialog {...props()} selected="" select={vi.fn()} />);
  expect(screen.getByText("모든 가계부 모아 보기")).toBeTruthy();
  expect(screen.getByText("가족")).toBeTruthy();
  expect(screen.queryByLabelText("가계부 이름")).toBeNull();
  expect(screen.queryByRole("button", { name: "새 가계부 만들기" })).toBeNull();
});
it("회원가입 허용 시 공개 가입을 안내하고 일반 가입 경로를 사용한다", async () => {
  const actor = userEvent.setup();
  vi.mocked(post).mockResolvedValue({ ...user, admin: false });
  render(<Auth initialized registrationOpen invite="" onLogin={vi.fn()} />);
  await actor.click(screen.getByRole("button", { name: "회원가입" }));
  await actor.type(screen.getByLabelText("표시할 이름"), "새 사용자");
  await actor.type(screen.getByLabelText("아이디"), "newuser");
  await actor.type(screen.getByLabelText("비밀번호 · 8자 이상"), "password8");
  await actor.type(screen.getByLabelText("비밀번호 다시 입력"), "password8");
  await actor.click(screen.getByRole("button", { name: "가입하고 시작하기" }));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/join",
      expect.objectContaining({
        username: "newuser",
        password: "password8",
        token: "",
      }),
    ),
  );
});
