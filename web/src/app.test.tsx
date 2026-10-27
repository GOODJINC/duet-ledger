// @vitest-environment happy-dom
import { dateRange } from "./dates";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Auth } from "./auth";
import { EntryDialog, AccountDialog } from "./dialogs";
import {
  APIError,
  post,
  api,
  toMinor,
  formatMoney,
  type Account,
  type User,
  type Ledger,
} from "./api";

vi.mock("./api", async (importOriginal) => {
  const original = await importOriginal<typeof import("./api")>();
  return { ...original, api: vi.fn(), post: vi.fn() };
});
const user: User = {
  id: "u1",
  username: "minsu",
  name: "민수",
  admin: true,
  locale: "ko",
  timezone: "Asia/Seoul",
  totp_enabled: false,
  csrf: "test-csrf",
};
const ledger: Ledger = {
  id: "l1",
  name: "개인",
  kind: "personal",
  role: "owner",
  timezone: "Asia/Seoul",
};
const account: Account = {
  id: "a1",
  ledger_id: "l1",
  ledger_name: "개인",
  name: "내 통장",
  kind: "bank",
  currency: "USD",
  scale: 2,
  opening: "10000",
  balance: "10000",
  archived: false,
  version: 1,
  role: "owner",
  shared: false,
  owner_name: "민수",
};
const props = () => ({
  user,
  ledgers: [ledger],
  accounts: [account],
  refresh: vi.fn(async () => {}),
  close: vi.fn(),
  notify: vi.fn(),
});
beforeEach(() => {
  vi.mocked(post).mockReset();
  vi.mocked(api).mockReset();
  vi.mocked(api).mockImplementation(async (path) =>
    path.startsWith("/categories")
      ? ((path.includes("kind=income")
          ? [{ code: "salary", name: "월급", kind: "income", hidden: false }]
          : [
              { code: "food", name: "식비", kind: "expense", hidden: false },
            ]) as any)
      : ({} as any),
  );
});
afterEach(() => cleanup());

describe("정확한 금액과 기간", () => {
  it("소수와 큰 금액을 부동소수점 오차 없이 처리한다", () => {
    expect(toMinor("12.34", 2)).toBe("1234");
    expect(toMinor("0.01", 2)).toBe("1");
    expect(toMinor("-1.50", 2)).toBe("-150");
    expect(formatMoney("9000000000000000", 0, "KRW")).toBe(
      "9,000,000,000,000,000원",
    );
    expect(() => toMinor("1.234", 2)).toThrow();
    expect(() => toMinor("1.2", 0)).toThrow();
  });
  it("월말·윤년·월요일 시작 주간을 정확히 선택한다", () => {
    expect(dateRange("2024-02-15", "month")).toEqual([
      "2024-02-01",
      "2024-02-29",
    ]);
    expect(dateRange("2026-10-22", "week")).toEqual([
      "2026-10-19",
      "2026-10-25",
    ]);
    expect(dateRange("2026-10-22", "year")).toEqual([
      "2026-01-01",
      "2026-12-31",
    ]);
  });
});
describe("실제 입력 화면", () => {
  it("초기 코드 없이 첫 관리자 계정을 만든다", async () => {
    const actor = userEvent.setup();
    const onLogin = vi.fn();
    vi.mocked(post).mockResolvedValue(user);
    render(<Auth initialized={false} invite="" onLogin={onLogin} />);
    expect(screen.queryByLabelText("초기 설정 코드")).toBeNull();
    expect(screen.getByText(/처음 만든 계정이 관리자가 됩니다/)).toBeTruthy();
    await actor.type(screen.getByLabelText("표시할 이름"), "민수");
    await actor.type(screen.getByLabelText("아이디"), "minsu");
    await actor.type(
      screen.getByLabelText("비밀번호 · 8자 이상"),
      "my-first-private-password",
    );
    await actor.type(
      screen.getByLabelText("비밀번호 다시 입력"),
      "my-first-private-password",
    );
    await actor.click(
      screen.getByRole("button", { name: "내 가계부 시작하기" }),
    );
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith(user, false));
    expect(post).toHaveBeenCalledWith("/setup", {
      username: "minsu",
      name: "민수",
      password: "my-first-private-password",
    });
  });
  it("다른 사람이 초기 설정을 마치면 로그인 화면으로 바꾼다", async () => {
    const actor = userEvent.setup();
    vi.mocked(post).mockRejectedValue(
      new APIError(409, "conflict", "이미 초기 설정을 마쳤어요."),
    );
    render(<Auth initialized={false} invite="" onLogin={vi.fn()} />);
    await actor.type(screen.getByLabelText("표시할 이름"), "민수");
    await actor.type(screen.getByLabelText("아이디"), "minsu");
    await actor.type(
      screen.getByLabelText("비밀번호 · 8자 이상"),
      "my-first-private-password",
    );
    await actor.type(
      screen.getByLabelText("비밀번호 다시 입력"),
      "my-first-private-password",
    );
    await actor.click(
      screen.getByRole("button", { name: "내 가계부 시작하기" }),
    );
    expect(await screen.findByRole("button", { name: "로그인" })).toBeTruthy();
    expect(screen.queryByLabelText("표시할 이름")).toBeNull();
    expect(
      screen.getByText(
        "이미 관리자 계정이 만들어졌어요. 기존 계정으로 로그인해 주세요.",
      ),
    ).toBeTruthy();
  });
  it("로그인 정보를 API로 전달하고 인증 코드 요청에 대응한다", async () => {
    const actor = userEvent.setup();
    const onLogin = vi.fn();
    vi.mocked(post)
      .mockRejectedValueOnce(new APIError(401, "totp_required", "코드 필요"))
      .mockResolvedValueOnce(user);
    render(<Auth initialized invite="" onLogin={onLogin} />);
    await actor.type(screen.getByLabelText("아이디"), "minsu");
    await actor.type(
      screen.getByLabelText("비밀번호"),
      "correct-password-for-login",
    );
    await actor.click(screen.getByRole("button", { name: "로그인" }));
    expect(
      await screen.findByLabelText("인증 앱 코드 또는 복구 코드"),
    ).toBeTruthy();
    await actor.type(
      screen.getByLabelText("인증 앱 코드 또는 복구 코드"),
      "123456",
    );
    await actor.click(screen.getByRole("button", { name: "로그인" }));
    await waitFor(() => expect(onLogin).toHaveBeenCalledWith(user, false));
    expect(vi.mocked(post).mock.calls[1][1]).toMatchObject({
      username: "minsu",
      code: "123456",
    });
  });
  it("개인 계좌의 지출을 최소 단위 문자열로 저장한다", async () => {
    const actor = userEvent.setup();
    const p = props();
    vi.mocked(post).mockResolvedValue({ id: "posting1" });
    render(<EntryDialog {...p} />);
    expect(screen.getByText("나에게만 보이는 기록이에요.")).toBeTruthy();
    await actor.type(screen.getByLabelText("금액"), "12.34");
    await actor.type(screen.getByLabelText("내용"), "점심 식사");
    await actor.click(screen.getByRole("button", { name: "기록 저장하기" }));
    await waitFor(() => expect(p.close).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith(
      "/transactions",
      expect.objectContaining({
        amount: "1234",
        account_id: "a1",
        kind: "expense",
      }),
      "POST",
      expect.objectContaining({ "Idempotency-Key": expect.any(String) }),
    );
  });
  it("공유 계좌는 저장 전에 공개 대상을 알린다", () => {
    const p = props();
    p.accounts = [{ ...account, shared: true }];
    render(<EntryDialog {...p} />);
    expect(screen.getByText("공유된 계좌에 기록하고 있어요.")).toBeTruthy();
    expect(
      screen.getByText("거래 내용과 첨부 사진도 공유 대상에게 보입니다."),
    ).toBeTruthy();
  });
  it("대상 계좌를 바꾸지 않고 음수 부채 잔액으로 계좌를 만든다", async () => {
    const actor = userEvent.setup();
    const p = props();
    vi.mocked(post).mockResolvedValue({ id: "newaccount" });
    render(<AccountDialog {...p} entry={() => {}} showLedger={() => {}} />);
    await actor.type(screen.getByLabelText("계좌 이름"), "신용카드");
    await actor.selectOptions(screen.getByLabelText("계좌 종류"), "card");
    await actor.clear(screen.getByLabelText("시작 잔액"));
    await actor.type(screen.getByLabelText("시작 잔액"), "-50000");
    await actor.click(screen.getByRole("button", { name: "계좌 만들기" }));
    await waitFor(() => expect(p.close).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith(
      "/accounts",
      expect.objectContaining({
        opening: "-50000",
        kind: "card",
        ledger_id: "l1",
        currency: "KRW",
      }),
    );
  });
  it("사진 실패 뒤 재시도해도 거래를 중복 생성하지 않는다", async () => {
    const actor = userEvent.setup();
    const p = props();
    vi.mocked(post).mockResolvedValue({ id: "saved" });
    let uploads = 0;
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.startsWith("/categories"))
        return [
          { code: "food", name: "식비", kind: "expense", hidden: false },
        ] as any;
      if (uploads++ === 0) throw new Error("사진 전송 실패");
      return { id: "receipt" } as any;
    });
    render(<EntryDialog {...p} />);
    await actor.type(screen.getByLabelText("금액"), "12.34");
    await actor.type(screen.getByLabelText("내용"), "영수증 기록");
    const input = document.querySelector(
      "input[type=file]",
    ) as HTMLInputElement;
    await actor.upload(
      input,
      new File(["test"], "receipt.png", { type: "image/png" }),
    );
    await actor.click(screen.getByRole("button", { name: "기록 저장하기" }));
    expect(await screen.findByText("사진 전송 실패")).toBeTruthy();
    await actor.click(
      screen.getByRole("button", { name: "사진 변경 다시 시도" }),
    );
    await waitFor(() => expect(p.close).toHaveBeenCalled());
    expect(post).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(api).mock.calls.filter(([path]) => path.endsWith("/receipts")),
    ).toHaveLength(2);
  });
});
