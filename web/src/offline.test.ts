// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from "vitest";
import type { User, Transaction } from "./api";
const memory = vi.hoisted(() => new Map<string, Record<string, unknown>>());
vi.mock("./offline-store", () => ({
  storedKey: (owner: string, kind: string, id: string) =>
    JSON.stringify([owner, kind, id]),
  getStored: async (key: string) => memory.get(key),
  listStored: async (owner: string, kind: string) =>
    [...memory.values()].filter((r) => r.owner === owner && r.kind === kind),
  putStored: async (row: Record<string, unknown>) => {
    memory.set(row.key as string, { ...row });
  },
  deleteStored: async (key: string) => {
    memory.delete(key);
  },
  acquireLease: async () => true,
  releaseLease: async () => {},
}));
let offline: typeof import("./offline");
const user: User = {
  id: "owner",
  username: "owner",
  name: "Owner",
  data_generation: "generation",
  admin: false,
  locale: "ko",
  timezone: "Asia/Seoul",
  csrf: "do-not-store-this",
  totp_enabled: false,
};
const entry = () => ({
  path: "/transactions",
  payload: {
    kind: "expense",
    date: "2026-10-30",
    time: "12:00",
    timezone: "Asia/Seoul",
    amount: "100",
    account_id: "account",
    title: "pending",
    category: "food",
    note: "",
  },
  requestKey: "one-request",
  removedPhotos: [],
  photoTarget: "account",
});
beforeEach(async () => {
  memory.clear();
  localStorage.clear();
  vi.resetModules();
  offline = await import("./offline");
  await offline.activateOfflineUser(user);
  offline.noteConnection(false);
});
it("stores drafts durably by request key without persisting CSRF secrets", async () => {
  await offline.saveOfflineEntry(entry());
  await offline.saveOfflineEntry(entry());
  expect(await offline.pendingEntries()).toHaveLength(1);
  const profile = [...memory.values()].find((r) => r.kind === "meta")!
    .value as User;
  expect(profile.csrf).toBe("");
});
it("preserves the source generation of an old edit and blocks stale replay", async () => {
  const base = {
    id: "posting",
    sync_id: "event",
    data_generation: "before-restore",
    version: 1,
    legs: [],
  } as unknown as Transaction;
  await offline.saveOfflineEntry({
    ...entry(),
    path: "/transactions/posting",
    base,
  });
  let mutations = 0;
  offline.setOfflineTransport(async <T>(path: string) => {
    if (path !== "/me") mutations++;
    return user as T;
  });
  offline.noteConnection(true);
  await offline.syncPending();
  const pending = await offline.pendingEntries();
  expect(pending).toHaveLength(1);
  expect(pending[0].generation).toBe("before-restore");
  expect(pending[0].status).toBe(409);
  expect(mutations).toBe(0);
});
it("does not drop operations rejected after access is revoked", async () => {
  await offline.saveOfflineEntry(entry());
  offline.setOfflineTransport(async <T>(path: string) => {
    if (path === "/me") return user as T;
    throw Object.assign(new Error("access revoked"), { status: 403 });
  });
  offline.noteConnection(true);
  await offline.syncPending();
  const pending = await offline.pendingEntries();
  expect(pending[0].status).toBe(403);
  expect(pending[0].error).toBe("access revoked");
});
it("retries temporary failures but removes a queue item only after acknowledgment", async () => {
  await offline.saveOfflineEntry(entry());
  let fail = true,
    mutations = 0;
  offline.setOfflineTransport(async <T>(path: string) => {
    if (path === "/me") return user as T;
    mutations++;
    if (fail) throw new TypeError("network");
    return { id: "saved" } as T;
  });
  offline.noteConnection(true);
  await offline.syncPending();
  expect(await offline.pendingEntries()).toHaveLength(1);
  fail = false;
  offline.noteConnection(true);
  await offline.syncPending();
  expect(await offline.pendingEntries()).toHaveLength(0);
  expect(mutations).toBe(2);
});
it("pauses expired sessions and resumes after signing in again", async () => {
  await offline.saveOfflineEntry(entry());
  let expired = true;
  offline.setOfflineTransport(async <T>(path: string) => {
    if (expired) throw Object.assign(new Error("sign in"), { status: 401 });
    return (path === "/me" ? user : { id: "saved" }) as T;
  });
  offline.noteConnection(true);
  await offline.syncPending();
  expect((await offline.pendingEntries())[0].status).toBe(401);
  expired = false;
  await offline.activateOfflineUser(user);
  await offline.syncPending();
  expect(await offline.pendingEntries()).toHaveLength(0);
});
it("isolates accounts and keeps pending work when viewing copies are cleared", async () => {
  await offline.saveOfflineEntry(entry());
  await offline.clearCached();
  expect(await offline.pendingEntries()).toHaveLength(1);
  await offline.activateOfflineUser({ ...user, id: "another" });
  expect(await offline.pendingEntries()).toHaveLength(0);
  expect(await offline.pendingEntries("owner")).toHaveLength(1);
});

it("retains uncertain photo deletion instead of treating a masked 404 as success", async () => {
  offline.noteConnection(true);
  offline.setOfflineTransport(async <T>(path: string) => {
    if (path === "/me") return user as T;
    if (path.startsWith("/receipts/"))
      throw Object.assign(new Error("not found or no access"), { status: 404 });
    return { id: "saved" } as T;
  });
  const result = await offline.saveOfflineEntry({
    ...entry(),
    removedPhotos: ["photo"],
  });
  expect(result.queued).toBe(true);
  const ops = await offline.pendingEntries();
  expect(ops).toHaveLength(1);
  expect(ops[0].result?.id).toBe("saved");
  expect(ops[0].status).toBe(404);
});
