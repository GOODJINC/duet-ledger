// @vitest-environment happy-dom
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Application, Auth } from "./main";
import { DisplaySettings } from "./display-settings";
import { AppearanceSettings } from "./appearance";
import { Modal } from "./ui";
import { lockPageScroll } from "./scroll-lock";
import { api, post, type User } from "./api";

vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  api: vi.fn(),
  post: vi.fn(),
}));
const user: User = {
  id: "display-user",
  name: "사용자",
  username: "tester",
  locale: "ko",
  timezone: "Asia/Seoul",
  admin: false,
  csrf: "csrf",
  totp_enabled: false,
};
let compact = false;
beforeEach(() => {
  localStorage.clear();
  history.replaceState({}, "", "/home");
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query === "(max-width: 760px)" && compact,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.mocked(api).mockReset();
  vi.mocked(post).mockReset();
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === "/accounts" || path === "/ledgers") return [] as any;
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
  vi.mocked(post).mockResolvedValue(user);
});
afterEach(() => {
  cleanup();
  compact = false;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});
const appProps = () => ({
  user,
  setUser: vi.fn(),
  invite: "",
  clearInvite: vi.fn(),
  joined: false,
});

it("defaults to 100% while preserving an explicitly saved scale", () => {
  const view = render(<AppearanceSettings userId={user.id} />);
  expect((screen.getByLabelText("글씨 크기") as HTMLInputElement).value).toBe(
    "100",
  );
  view.unmount();
  localStorage.setItem(
    `duet-ledger-appearance-${user.id}`,
    JSON.stringify({ scale: 117 }),
  );
  render(<AppearanceSettings userId={user.id} />);
  expect((screen.getByLabelText("글씨 크기") as HTMLInputElement).value).toBe(
    "117",
  );
});
it("saves browser-specific layout choices and updates the mobile screen immediately", async () => {
  compact = true;
  const actor = userEvent.setup();
  render(
    <>
      <Application {...appProps()} />
      <DisplaySettings userId={user.id} />
    </>,
  );
  await waitFor(() =>
    expect(
      document.querySelector(".period-toolbar .header-right"),
    ).not.toBeNull(),
  );
  expect(document.querySelector("header.app-header")).toBeNull();
  expect(document.querySelectorAll(".user-menu-wrap")).toHaveLength(1);
  await actor.click(screen.getByLabelText("페이지 타이틀·설명 표시"));
  expect(
    document
      .querySelector(".page-heading")
      ?.classList.contains("heading-collapsed"),
  ).toBe(true);
  await actor.click(screen.getByLabelText("모바일 상단 빠른 입력 표시"));
  expect(document.querySelector(".heading-actions button")).toBeNull();
  await actor.selectOptions(
    screen.getByLabelText("모바일 하단 + 버튼 위치"),
    "left",
  );
  expect(document.querySelector(".mobile-fab-left")).not.toBeNull();
  await actor.click(screen.getByLabelText("모바일 하단 + 버튼 표시"));
  expect(document.querySelector(".mobile-fab")).toBeNull();
  expect(
    JSON.parse(localStorage.getItem(`duet-ledger-display-${user.id}`)!),
  ).toEqual({
    showPageHeadings: false,
    mobileTopEntry: false,
    mobileFloatingEntry: false,
    floatingSide: "left",
  });
});
it("keeps one account menu beside month navigation on mobile ledger pages", async () => {
  compact = true;
  history.replaceState({}, "", "/ledger");
  render(<Application {...appProps()} />);
  await waitFor(() =>
    expect(
      document.querySelector(".period-toolbar .header-right"),
    ).not.toBeNull(),
  );
  expect(document.querySelector(".period-toolbar .month-nav")).not.toBeNull();
  expect(document.querySelectorAll(".user-menu-wrap")).toHaveLength(1);
  expect(document.querySelector(".mobile-logo")).toBeNull();
});
it("sends the 30-day choice with login credentials", async () => {
  const actor = userEvent.setup();
  render(<Auth initialized={true} invite="" onLogin={vi.fn()} />);
  await actor.type(screen.getByLabelText("아이디"), "tester");
  await actor.type(
    screen.getByLabelText("비밀번호", { exact: true }),
    "password-123",
  );
  await actor.click(screen.getByLabelText("30일 동안 로그인 유지"));
  await actor.click(screen.getByRole("button", { name: "로그인" }));
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      "/login",
      expect.objectContaining({ remember: true, username: "tester" }),
    ),
  );
});
it("locks the page until every nested dialog closes and restores original styles and scroll", () => {
  vi.stubGlobal("scrollY", 240);
  vi.stubGlobal("scrollX", 0);
  const scroll = vi.fn();
  vi.stubGlobal("scrollTo", scroll);
  document.body.style.position = "relative";
  const outer = lockPageScroll(),
    inner = lockPageScroll();
  expect(document.body.style.position).toBe("fixed");
  expect(document.body.style.top).toBe("-240px");
  outer();
  outer();
  expect(document.body.style.position).toBe("fixed");
  inner();
  expect(document.body.style.position).toBe("relative");
  expect(document.body.style.top).toBe("");
  expect(scroll).toHaveBeenCalledWith(0, 240);
  document.body.style.removeProperty("position");
});
it("releases the scroll lock when a modal unmounts", () => {
  const view = render(
    <Modal title="Dialog" onClose={vi.fn()}>
      Content
    </Modal>,
  );
  expect(document.body.style.position).toBe("fixed");
  view.unmount();
  expect(document.body.style.position).toBe("");
});

it("uses a page header for long dialogs while retaining compact month selection", async () => {
  const close = vi.fn();
  const view = render(
    <Modal title="Long form" onClose={close}>
      Form
    </Modal>,
  );
  expect(screen.getByRole("dialog").classList.contains("page-dialog")).toBe(
    true,
  );
  fireEvent(
    screen.getByRole("dialog"),
    new Event("cancel", { cancelable: true }),
  );
  expect(close).toHaveBeenCalledOnce();
  view.unmount();
  render(
    <Modal title="Month" compact onClose={close}>
      Choices
    </Modal>,
  );
  expect(screen.getByRole("dialog").classList.contains("compact-dialog")).toBe(
    true,
  );
  expect(screen.queryByRole("button", { name: "뒤로가기" })).toBeNull();
});

it("keeps account creation beside scope tabs on mobile", async () => {
  compact = true;
  history.replaceState({}, "", "/accounts");
  const actor = userEvent.setup();
  render(<Application {...appProps()} />);
  const create = document.querySelector<HTMLButtonElement>(
    ".mobile-account-create",
  )!;
  expect(create.closest(".scope-controls-row")).not.toBeNull();
  expect(
    document.querySelector(".scope-controls-row .scope-tabs"),
  ).not.toBeNull();
  await actor.click(create);
  expect(await screen.findByRole("dialog")).toBeTruthy();
});
it("identifies trash in the breadcrumb and headings without the old banner", async () => {
  const actor = userEvent.setup();
  render(<Application {...appProps()} />);
  await actor.click(screen.getByRole("button", { name: "사용자 메뉴" }));
  await actor.click(screen.getByRole("button", { name: "설정" }));
  const row = screen
    .getByText("기록 휴지통", { exact: true })
    .closest(".setting-row")!;
  await actor.click(row.querySelector(".secondary-button")!);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
    "삭제한 기록을 살펴봐요.",
  );
  expect(
    document.querySelector(".desktop-breadcrumb strong")?.textContent,
  ).toBe("휴지통");
  expect(document.querySelector(".trash-mode")).toBeNull();
  expect(
    screen.queryByRole("button", { name: "일반 내역으로 돌아가기" }),
  ).toBeNull();
  await actor.click(screen.getAllByRole("button", { name: "가계부" })[0]);
  expect(screen.getByRole("heading", { level: 1 }).textContent).toBe(
    "하루하루, 차곡차곡.",
  );
});
