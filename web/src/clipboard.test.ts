// @vitest-environment happy-dom
import { afterEach, it, expect, vi } from "vitest";
import { copyText } from "./clipboard";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});
it("Clipboard API가 거부되면 열린 대화창 안에서 선택 복사를 시도한다", async () => {
  const dialog = document.createElement("dialog");
  dialog.setAttribute("open", "");
  const button = document.createElement("button");
  dialog.append(button);
  document.body.append(dialog);
  button.focus();
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
    new Error("denied"),
  );
  const command = vi.fn(() => {
    const field = document.activeElement as HTMLTextAreaElement;
    expect(field.closest("dialog")).toBe(dialog);
    expect(field.value).toBe("http://host/#invite=token");
    return true;
  });
  Object.defineProperty(document, "execCommand", {
    value: command,
    configurable: true,
  });
  await copyText("http://host/#invite=token");
  expect(command).toHaveBeenCalledWith("copy");
  expect(document.querySelector("textarea")).toBeNull();
  expect(document.activeElement).toBe(button);
});
it("복사 성공 여부를 확인할 수 없으면 수동 복사를 안내한다", async () => {
  vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
    new Error("denied"),
  );
  Object.defineProperty(document, "execCommand", {
    value: () => false,
    configurable: true,
  });
  await expect(copyText("link")).rejects.toThrow("Ctrl+C");
});
