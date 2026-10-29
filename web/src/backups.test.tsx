// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { BackupDialog } from "./backups";
import { api, post, download, type User } from "./api";
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  api: vi.fn(),
  post: vi.fn(),
  download: vi.fn(),
}));
const user: User = {
  id: "admin",
  username: "admin",
  name: "Admin",
  admin: true,
  locale: "ko",
  timezone: "Asia/Seoul",
  totp_enabled: false,
  csrf: "csrf",
};
const props = {
  user,
  accounts: [],
  ledgers: [],
  refresh: vi.fn(),
  close: vi.fn(),
  notify: vi.fn(),
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api).mockResolvedValue([
    { name: "duet-test.zip", size: 1000, created_at: "2026-10-29T00:00:00Z" },
  ]);
  vi.mocked(post).mockResolvedValue({ name: "duet-new.zip" });
  vi.mocked(download).mockResolvedValue(undefined);
});
afterEach(cleanup);
it("creates and downloads a validated backup with one click", async () => {
  render(<BackupDialog {...props} />);
  fireEvent.click(screen.getByText("백업 만들고 다운로드"));
  await waitFor(() =>
    expect(download).toHaveBeenCalledWith(
      "/backups/duet-new.zip",
      "duet-new.zip",
    ),
  );
  expect(post).toHaveBeenCalledWith("/backups");
});
it("checks a saved backup before displaying destructive confirmation", async () => {
  render(<BackupDialog {...props} />);
  await screen.findByLabelText("백업 다운로드");
  fireEvent.click(screen.getAllByText("복원")[1]);
  expect(screen.queryByText("현재 자료 백업 후 복원")).toBeNull();
  vi.mocked(api).mockResolvedValueOnce({
    token: "preview",
    created_at: "2026-10-29T00:00:00Z",
    users: 2,
    accounts: 3,
    transactions: 4,
    receipts: 1,
  });
  fireEvent.click(screen.getByText("백업 확인하기"));
  await screen.findByText("복원할 자료 확인");
  const [, options] = vi.mocked(api).mock.calls.at(-1)!;
  expect((options!.body as FormData).get("name")).toBe("duet-test.zip");
  const submit = screen.getByText(
    "현재 자료 백업 후 복원",
  ) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  fireEvent.click(
    screen.getByLabelText("모든 사용자 자료가 바뀌는 것을 확인했어요."),
  );
  expect(submit.disabled).toBe(false);
  expect(
    screen.getByLabelText("현재 비밀번호").getAttribute("required"),
  ).not.toBeNull();
});
it("requires an authentication code for administrators with 2FA", async () => {
  render(<BackupDialog {...props} user={{ ...user, totp_enabled: true }} />);
  fireEvent.click(screen.getByText("키 파일 다운로드"));
  expect(
    screen.getByLabelText("인증 코드 또는 복구 코드").getAttribute("required"),
  ).not.toBeNull();
  expect(post).not.toHaveBeenCalled();
});
it("rejects oversized ZIP files before uploading", async () => {
  render(<BackupDialog {...props} />);
  fireEvent.click(screen.getAllByText("복원")[0]);
  const file = new File([""], "large.zip", { type: "application/zip" });
  Object.defineProperty(file, "size", { value: 513 * 1024 * 1024 });
  fireEvent.change(screen.getByLabelText("백업 ZIP"), {
    target: { files: [file] },
  });
  expect(
    screen.getByText("백업 ZIP은 512MB 이하, 키 파일은 32바이트여야 해요."),
  ).toBeTruthy();
  expect(
    (screen.getByText("백업 확인하기") as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(api).toHaveBeenCalledTimes(1);
});
