// @vitest-environment happy-dom
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppPasswordsDialog, AdminAPISettings } from "./api-settings";
import { api, post, type User, type Account } from "./api";
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  api: vi.fn(),
  post: vi.fn(),
}));
const user: User = {
  id: "user",
  name: "민수",
  username: "minsu",
  admin: true,
  locale: "ko",
  timezone: "Asia/Seoul",
  csrf: "csrf",
  totp_enabled: false,
  api_enabled: true,
};
const accounts: Account[] = [
  {
    id: "one",
    name: "개인 통장",
    ledger_name: "개인",
    ledger_id: "l",
    kind: "bank",
    currency: "KRW",
    scale: 0,
    opening: "0",
    balance: "0",
    archived: false,
    version: 1,
    role: "owner",
    shared: false,
    owner_name: "민수",
  },
  {
    id: "two",
    name: "비공개 통장",
    ledger_name: "개인",
    ledger_id: "l",
    kind: "bank",
    currency: "KRW",
    scale: 0,
    opening: "0",
    balance: "0",
    archived: false,
    version: 1,
    role: "owner",
    shared: false,
    owner_name: "민수",
  },
];
const props = () => ({
  user,
  accounts,
  ledgers: [],
  close: vi.fn(),
  refresh: vi.fn(async () => {}),
  notify: vi.fn(),
});
beforeEach(() => {
  localStorage.clear();
  vi.mocked(api).mockReset();
  vi.mocked(post).mockReset();
  vi.mocked(api).mockImplementation(async (path) =>
    path === "/me/app-passwords" ? ({ enabled: true, items: [] } as any) : [],
  );
  vi.mocked(post).mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("관리자 API 스위치를 저장하고 사용자 상태를 갱신한다", async () => {
  vi.mocked(api).mockResolvedValue({ enabled: false });
  const refresh = vi.fn(async () => {});
  render(<AdminAPISettings user={user} refresh={refresh} />);
  const checkbox = await screen.findByRole("checkbox", {
    name: "API 사용 허용",
  });
  await waitFor(() =>
    expect((checkbox as HTMLInputElement).disabled).toBe(false),
  );
  await userEvent.click(checkbox);
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/admin/api-settings",
      { enabled: true },
      "PATCH",
    ),
  );
  expect(refresh).toHaveBeenCalled();
});
it("허용된 사용자는 계좌·권한·유효기간과 비밀번호 확인으로 키를 발급한다", async () => {
  const actor = userEvent.setup();
  const p = props();
  vi.mocked(post).mockResolvedValue({ app_password: "dl_app_ONCE_ONLY" });
  const v = render(<AppPasswordsDialog {...p} />);
  await actor.click(
    await screen.findByRole("button", { name: "앱 비밀번호 만들기" }),
  );
  expect(
    (
      screen.getByRole("checkbox", {
        name: "조회·검색·통계",
      }) as HTMLInputElement
    ).checked,
  ).toBe(true);
  expect(
    Array.from(
      (screen.getByLabelText("유효기간") as HTMLSelectElement).options,
    ).map((o) => o.value),
  ).toEqual(["30d", "90d", "1y", "never"]);
  await actor.type(screen.getByLabelText("연결 이름"), "Codex CLI");
  await actor.click(screen.getByRole("checkbox", { name: /^개인 통장/ }));
  await actor.click(screen.getByRole("checkbox", { name: "거래 추가" }));
  await actor.selectOptions(screen.getByLabelText("유효기간"), "never");
  await actor.type(screen.getByLabelText("현재 비밀번호"), "password8");
  await actor.click(screen.getByRole("button", { name: "발급하기" }));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith("/me/app-passwords", {
      name: "Codex CLI",
      account_ids: ["one"],
      permissions: ["read", "create"],
      lifetime: "never",
      password: "password8",
      code: "",
    }),
  );
  expect(
    (screen.getByLabelText("발급된 앱 비밀번호") as HTMLInputElement).value,
  ).toBe("dl_app_ONCE_ONLY");
  expect(localStorage.length).toBe(0);
  v.unmount();
  render(<AppPasswordsDialog {...p} />);
  await screen.findByRole("button", { name: "앱 비밀번호 만들기" });
  expect(screen.queryByLabelText("발급된 앱 비밀번호")).toBeNull();
});
it("API 중지 상태에서도 기존 앱 비밀번호를 폐기할 수 있다", async () => {
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
  vi.mocked(api).mockImplementation(async (path) =>
    path === "/me/app-passwords"
      ? ({
          enabled: false,
          items: [
            {
              id: "key",
              name: "자동화",
              permissions: ["read"],
              account_ids: ["one"],
              expires_at: 0,
              created_at: "2026-10-23",
              last_used_at: "",
              revoked_at: "",
            },
          ],
        } as any)
      : [],
  );
  render(<AppPasswordsDialog {...props()} />);
  const button = await screen.findByRole("button", {
    name: "앱 비밀번호 만들기",
  });
  expect((button as HTMLButtonElement).disabled).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "폐기" }));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith("/me/app-passwords/key", {}, "DELETE"),
  );
});
it("2단계 인증 계정에는 인증 코드 입력을 요구한다", async () => {
  const actor = userEvent.setup();
  render(
    <AppPasswordsDialog {...props()} user={{ ...user, totp_enabled: true }} />,
  );
  await actor.click(
    await screen.findByRole("button", { name: "앱 비밀번호 만들기" }),
  );
  expect(
    (screen.getByLabelText("인증 코드 또는 복구 코드") as HTMLInputElement)
      .required,
  ).toBe(true);
});
