// @vitest-environment happy-dom
import { afterEach, beforeEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  AppearanceSettings,
  ServerAppearanceSettings,
  useAppearance,
  validateCSS,
} from "./appearance";
import { Help } from "./ui";
import { api } from "./api";
vi.mock("./api", () => ({ api: vi.fn() }));
const empty = {
  css: { name: "", revision: "" },
  font: { name: "", revision: "" },
};
beforeEach(() => {
  vi.mocked(api).mockReset();
  vi.mocked(api).mockResolvedValue(empty);
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  history.replaceState({}, "", "/home");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function Preview({ id }: { id: string }) {
  useAppearance(id);
  return null;
}
it("CSS 크기 제한을 제거하되 외부 자료 로딩은 막는다", () => {
  expect(
    validateCSS("/*" + "x".repeat(70000) + "*/.panel{border-radius:20px}"),
  ).toContain("20px");
  for (const css of [
    '@import "https://example.com/a.css";',
    "body{background:u/**/rl(https://example.com)}",
    "body{background:\\75rl(x)}",
    '@namespace x "https://example.com";',
    'body{background:image("https://example.com")}',
  ])
    expect(() => validateCSS(css)).toThrow();
});
it("개인 배율과 색상은 유지하고 개인 CSS·글꼴은 더 이상 적용하지 않는다", () => {
  localStorage.setItem(
    "duet-ledger-appearance-one",
    JSON.stringify({
      scale: 117,
      css: "body{display:none}",
      font: "data:font/woff2;base64,Zm9udA==",
    }),
  );
  const v = render(
    <>
      <Preview id="one" />
      <AppearanceSettings userId="one" />
    </>,
  );
  expect(document.body.style.getPropertyValue("--text-scale")).toBe("1.17");
  expect(document.head.textContent).not.toContain("display:none");
  expect(document.querySelectorAll("input[type=file]").length).toBe(0);
  fireEvent.change(screen.getByLabelText("배경색"), {
    target: { value: "#abcdef" },
  });
  expect(document.body.style.getPropertyValue("--bg")).toBe("#abcdef");
  v.unmount();
  render(<Preview id="two" />);
  expect(document.body.style.getPropertyValue("--bg")).toBe("");
});
it("관리자가 큰 CSS를 서버에 저장하면 다른 사용자도 같은 디자인을 받는다", async () => {
  let meta = empty;
  let css = "";
  vi.mocked(api).mockImplementation(async (path, opts) => {
    if (path === "/admin/appearance/css" && opts?.method === "PUT") {
      const file = (opts.body as FormData).get("file") as File;
      css = await file.text();
      meta = { ...empty, css: { name: file.name, revision: "123" } };
      return { ok: true } as any;
    }
    return meta as any;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, text: async () => css })),
  );
  const actor = userEvent.setup();
  const v = render(
    <>
      <Preview id="admin" />
      <ServerAppearanceSettings />
    </>,
  );
  const large = "/*" + "x".repeat(70000) + "*/.panel{border-radius:24px}";
  await actor.upload(
    screen.getByLabelText("공통 CSS 파일"),
    new File([large], "shared.css", { type: "text/css" }),
  );
  await waitFor(() =>
    expect(
      document.querySelector("style[data-duet-server-appearance]")?.textContent,
    ).toContain("24px"),
  );
  expect(localStorage.length).toBe(0);
  expect(screen.getByText("모든 사용자에게 적용했어요.")).toBeTruthy();
  v.unmount();
  render(<Preview id="viewer" />);
  await waitFor(() =>
    expect(
      document.querySelector("style[data-duet-server-appearance]")?.textContent,
    ).toContain("24px"),
  );
});
it("안전 모드에서는 서버 CSS·글꼴을 건너뛰며 관리 해제 경로를 제공한다", () => {
  history.replaceState({}, "", "/admin?safe-theme=1");
  render(
    <>
      <Preview id="admin" />
      <ServerAppearanceSettings />
    </>,
  );
  expect(
    document.querySelector("style[data-duet-server-appearance]")?.textContent,
  ).toBe("");
  expect(screen.getByLabelText("공통 글꼴 파일")).toBeTruthy();
});
it("글씨 배율은 숫자 한 단위로 지정하고 범위를 벗어나면 보정한다", () => {
  render(<AppearanceSettings userId="number" />);
  const input = screen.getByLabelText("글씨 크기") as HTMLInputElement;
  expect(input.type).toBe("number");
  expect(input.step).toBe("1");
  fireEvent.change(input, { target: { value: "117" } });
  expect(
    JSON.parse(localStorage.getItem("duet-ledger-appearance-number")!).scale,
  ).toBe(117);
  fireEvent.change(input, { target: { value: "999" } });
  fireEvent.blur(input);
  expect(input.value).toBe("150");
});
it("도움말을 최상단 팝오버로 열고 화면 오른쪽·아래 경계 안에 배치한다", () => {
  render(<Help>긴 설명을 화면 안에 표시합니다.</Help>);
  const button = screen.getByRole("button", { name: "도움말" });
  const tip = document.querySelector<HTMLElement>('[role="tooltip"]')!;
  vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
    left: window.innerWidth - 24,
    right: window.innerWidth - 4,
    top: window.innerHeight - 28,
    bottom: window.innerHeight - 8,
    width: 20,
    height: 20,
  } as DOMRect);
  vi.spyOn(tip, "getBoundingClientRect").mockReturnValue({
    height: 120,
    width: 290,
  } as DOMRect);
  tip.showPopover = vi.fn(() => {
    tip.dataset.open = "true";
  });
  tip.hidePopover = vi.fn();
  fireEvent.pointerEnter(button, { pointerType: "mouse" });
  expect(tip.showPopover).toHaveBeenCalledTimes(1);
  expect(tip.getAttribute("popover")).toBe("manual");
  expect(
    Number.parseFloat(tip.style.left) + Number.parseFloat(tip.style.width),
  ).toBeLessThanOrEqual(window.innerWidth - 12);
  expect(Number.parseFloat(tip.style.top) + 120).toBeLessThanOrEqual(
    window.innerHeight - 12,
  );
  fireEvent.pointerLeave(button);
  expect(tip.hidePopover).toHaveBeenCalled();
  expect(tip.hasAttribute("data-open")).toBe(false);
});
