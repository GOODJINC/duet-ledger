// @vitest-environment happy-dom
import { afterEach, it, expect, vi } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AppearanceSettings, useAppearance, validateCSS } from "./appearance";
afterEach(() => {
  cleanup();
  localStorage.clear();
  history.replaceState({}, "", "/home");
  vi.restoreAllMocks();
});
it("CSS는 일반 스타일을 허용하고 외부 로딩·우회 표현을 막는다", () => {
  expect(
    validateCSS(
      ".panel{border-radius:20px}@media(max-width:700px){body{color:red}}",
    ),
  ).toContain("20px");
  for (const css of [
    '@import "https://example.com/a.css";',
    "body{background:u/**/rl(https://example.com)}",
    "body{background:\\75rl(x)}",
    '@namespace x "https://example.com";',
    'body{background:image("https://example.com")}',
    "x".repeat(65537),
  ])
    expect(() => validateCSS(css)).toThrow();
});
function Preview({ id }: { id: string }) {
  useAppearance(id);
  return null;
}
it("크기·색상은 계정별로 분리하고 초기화하며 안전 모드에서는 사용자 CSS를 건너뛴다", async () => {
  const v = render(
    <>
      <Preview id="one" />
      <AppearanceSettings userId="one" />
    </>,
  );
  fireEvent.change(screen.getByLabelText("글씨 크기"), {
    target: { value: "130" },
  });
  expect(document.body.style.getPropertyValue("--text-scale")).toBe("1.3");
  fireEvent.change(screen.getByLabelText("배경색"), {
    target: { value: "#abcdef" },
  });
  expect(document.body.style.getPropertyValue("--bg")).toBe("#abcdef");
  v.unmount();
  const other = render(<Preview id="two" />);
  expect(document.body.style.getPropertyValue("--bg")).toBe("");
  other.unmount();
  history.replaceState({}, "", "/settings?safe-theme=1");
  const safe = render(
    <>
      <Preview id="one" />
      <AppearanceSettings userId="one" />
    </>,
  );
  expect(document.body.style.getPropertyValue("--bg")).toBe("");
  fireEvent.click(
    screen.getByRole("button", { name: "기본 디자인으로 초기화" }),
  );
  await waitFor(() =>
    expect(
      JSON.parse(localStorage.getItem("duet-ledger-appearance-one")!).css,
    ).toBe(""),
  );
  safe.unmount();
});
it("CSS 파일을 적용하고 외부 로딩 CSS와 잘못된 글꼴은 저장하지 않는다", async () => {
  const actor = userEvent.setup();
  render(
    <>
      <Preview id="upload" />
      <AppearanceSettings userId="upload" />
    </>,
  );
  const css = document.querySelector<HTMLInputElement>("#custom-css")!;
  await actor.upload(
    css,
    new File([".panel{border-radius:24px}"], "custom.css", {
      type: "text/css",
    }),
  );
  await waitFor(() =>
    expect(
      JSON.parse(localStorage.getItem("duet-ledger-appearance-upload")!)
        .cssName,
    ).toBe("custom.css"),
  );
  expect(
    document.querySelector("style[data-duet-appearance]")?.textContent,
  ).toContain("24px");
  await actor.upload(
    css,
    new File(['@import "https://example.com/remote.css";'], "bad.css", {
      type: "text/css",
    }),
  );
  await waitFor(() =>
    expect(document.querySelector('p[role="status"]')?.textContent).toContain(
      "외부",
    ),
  );
  expect(
    JSON.parse(localStorage.getItem("duet-ledger-appearance-upload")!).cssName,
  ).toBe("custom.css");
  await actor.upload(
    document.querySelector<HTMLInputElement>("#custom-font")!,
    new File(["not a font"], "bad.woff2", { type: "font/woff2" }),
  );
  await waitFor(() =>
    expect(document.querySelector('p[role="status"]')?.textContent).toContain(
      "올바른 WOFF2",
    ),
  );
  expect(
    JSON.parse(localStorage.getItem("duet-ledger-appearance-upload")!).font,
  ).toBe("");
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
  expect(document.querySelectorAll(".design-file-box").length).toBe(2);
});
