import type { Account, Transaction, Report, User } from "./api";
import { msg } from "./i18n";
import { today } from "./dates";
import { offlineReport } from "./offline-report";
import {
  getStored,
  listStored,
  putStored,
  deleteStored,
  storedKey,
  acquireLease,
  releaseLease,
  type Stored,
} from "./offline-store";
export type OfflinePreferences = { enabled: boolean; days: 7 | 30 | 90 };
export type EntryInput = {
  path: string;
  payload: Record<string, unknown>;
  requestKey: string;
  base?: Transaction;
  photo?: File;
  removedPhotos: string[];
  photoTarget: string;
};
export type Pending = Stored & {
  kind: "queue";
  id: string;
  generation: string;
  created: number;
  input: EntryInput;
  result?: { id: string; posting_ids?: Record<string, string> };
  removed?: string[];
  error?: string;
  status?: number;
};
type CachedTransaction = Stored & {
  kind: "tx";
  value: Transaction;
  seen: number;
  pinned: boolean;
  generation: string;
};
type Transport = <T>(path: string, options?: RequestInit) => Promise<T>;
let transport: Transport;
export function setOfflineTransport(fn: Transport) {
  transport = fn;
}
let active: string | null = null;
try {
  active = localStorage.getItem("duet-ledger-offline-active");
} catch {}
let currentUser: User | undefined;
const listeners = new Set<() => void>();
let state = {
  connection: "unknown" as "unknown" | "online" | "offline" | "auth",
  syncing: false,
  pending: 0,
  lastContact: 0,
  storageError: false,
};
export function offlineState() {
  return state;
}
export function subscribeOffline(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
function update(next: Partial<typeof state>) {
  state = { ...state, ...next };
  for (const fn of listeners) fn();
}
export function noteConnection(online: boolean) {
  update({
    connection: online ? "online" : "offline",
    ...(online ? { lastContact: Date.now() } : {}),
  });
}
export function offlineOwner() {
  return active;
}
export function currentOfflineGeneration() {
  return currentUser?.data_generation;
}
export function preferences(owner = active): OfflinePreferences {
  try {
    const v = JSON.parse(
      localStorage.getItem("duet-ledger-offline-settings-" + owner) || "{}",
    );
    return {
      enabled: v.enabled !== false,
      days: [7, 30, 90].includes(v.days) ? v.days : 7,
    };
  } catch {
    return { enabled: true, days: 7 };
  }
}
async function meta<T>(name: string, owner = active): Promise<T | undefined> {
  if (!owner) return;
  return (await getStored(storedKey(owner, "meta", name)))?.value as
    T | undefined;
}
async function saveMeta(name: string, value: unknown, owner = active) {
  if (owner)
    await putStored({
      key: storedKey(owner, "meta", name),
      owner,
      kind: "meta",
      value,
    });
}
export async function pendingEntries(owner = active): Promise<Pending[]> {
  if (!owner) return [];
  return ((await listStored(owner, "queue")) as Pending[]).sort(
    (a, b) => a.created - b.created,
  );
}
async function countPending() {
  try {
    update({ pending: (await pendingEntries()).length });
  } catch {
    update({ storageError: true });
  }
}
export async function activateOfflineUser(user: User) {
  const prior = active;
  active = user.id;
  currentUser = user;
  try {
    localStorage.setItem("duet-ledger-offline-active", user.id);
    if (!preferences(user.id).enabled) return;
    const previous = await meta<User>("/me", user.id);
    if (
      previous?.data_generation &&
      previous.data_generation !== user.data_generation
    )
      await clearCached(user.id);
    await saveMeta("/me", { ...user, csrf: "" }, user.id);
    if (prior !== active) update({ pending: 0 });
    await countPending();
  } catch {
    update({ storageError: true });
  }
}
export async function suspendOfflineUser(clear = false) {
  const owner = active;
  active = null;
  currentUser = undefined;
  update({ pending: 0, connection: "auth" });
  try {
    if (localStorage.getItem("duet-ledger-offline-active") === owner)
      localStorage.removeItem("duet-ledger-offline-active");
    if (clear && owner) await clearCached(owner);
  } catch {
    update({ storageError: true });
  }
}
export async function cachedUser() {
  if (!active || !preferences().enabled) return;
  try {
    const user = await meta<User>("/me");
    currentUser = user;
    await countPending();
    return user;
  } catch {
    return;
  }
}
export async function clearCached(owner = active) {
  if (!owner) return;
  for (const kind of ["meta", "tx"]) {
    for (const row of await listStored(owner, kind))
      await deleteStored(row.key);
  }
}
export async function setOfflinePreferences(next: OfflinePreferences) {
  if (!active) throw new Error(msg("다시 로그인해 주세요."));
  if (!next.enabled && (await pendingEntries()).length)
    throw new Error(
      msg("전송 대기 기록을 먼저 동기화하거나 내보내고 취소해 주세요."),
    );
  localStorage.setItem(
    "duet-ledger-offline-settings-" + active,
    JSON.stringify(next),
  );
  if (!next.enabled) await clearCached();
  else if (currentUser) await activateOfflineUser(currentUser);
  window.dispatchEvent(new Event("duet-offline-settings"));
}
function recentStart(days: number, timezone: string) {
  const end = today(timezone),
    d = new Date(end + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - days + 1);
  return d.toISOString().slice(0, 10);
}
async function prune(owner: string) {
  const u = await meta<User>("/me", owner);
  if (!u) return;
  const start = recentStart(preferences(owner).days, u.timezone);
  const rows = (await listStored(owner, "tx")) as CachedTransaction[];
  const pending = await pendingEntries(owner);
  const protectedIds = new Set(
    pending.map((p) => p.input.base?.sync_id || p.input.base?.id),
  );
  for (const r of rows) {
    if (
      !r.pinned &&
      !protectedIds.has(r.value.sync_id || r.value.id) &&
      r.value.date < start &&
      r.seen < Date.now() - 30 * 86400000
    )
      await deleteStored(r.key);
  }
}
async function rememberTransactions(
  report: Report,
  path: string,
  viewed: boolean,
  owner: string,
) {
  const user = await meta<User>("/me", owner);
  if (!user || !user.data_generation) return;
  const params = new URLSearchParams(path.split("?")[1]);
  const allowedAccounts = await meta<Account[]>("/accounts", owner);
  const allowed = allowedAccounts
    ? new Map(allowedAccounts.map((a) => [a.id, a]))
    : undefined;
  const full =
    !params.get("search") &&
    !params.get("ledger") &&
    !params.get("account") &&
    (!params.get("scope") || params.get("scope") === "all") &&
    !params.get("currency") &&
    !params.get("type") &&
    params.get("trash") !== "true";
  if (full && report.count <= report.items.length) {
    const ids = new Set(report.items.map((t) => t.sync_id || t.id));
    for (const row of (await listStored(owner, "tx")) as CachedTransaction[]) {
      if (
        !row.value.deleted &&
        row.value.date >= (params.get("from") || "") &&
        row.value.date <= (params.get("to") || "9999") &&
        !ids.has(row.value.sync_id || row.value.id)
      )
        await deleteStored(row.key);
    }
  }
  for (const tx of report.items) {
    const key = storedKey(owner, "tx", tx.sync_id || tx.id),
      old = (await getStored(key)) as CachedTransaction | undefined;
    if (old && old.value.version > tx.version) continue;
    const merged =
      old && old.value.version === tx.version
        ? [
            ...new Map(
              [...old.value.legs, ...tx.legs].map((l) => [l.id, l]),
            ).values(),
          ]
        : tx.legs;
    const legs = allowed
      ? merged.filter((l) => allowed.has(l.account_id))
      : merged;
    if (!legs.length) continue;
    const clean = {
      ...tx,
      can_edit:
        tx.can_edit &&
        (!allowed ||
          legs.every((l) => allowed.get(l.account_id)?.role !== "viewer")),
      legs: legs.map((l) => ({ ...l, display_amount: undefined })),
      display_currency: undefined,
      display_scale: undefined,
    };
    await putStored({
      key,
      owner,
      kind: "tx",
      value: clean,
      seen: viewed ? Date.now() : old?.seen || 0,
      pinned: old?.pinned || false,
      generation: user.data_generation,
    });
  }
  await prune(owner);
}
export async function rememberResponse(
  path: string,
  data: unknown,
  owner: string | null,
  viewed = true,
) {
  try {
    if (path === "/me") {
      await activateOfflineUser(data as User);
      return;
    }
    if (!owner || owner !== active || !preferences(owner).enabled) return;
    if (
      path.startsWith("/transactions?") &&
      data &&
      Array.isArray((data as Report).items)
    ) {
      await rememberTransactions(data as Report, path, viewed, owner);
      return;
    }
    if (path === "/accounts") {
      const accounts = data as Account[];
      const old = await meta<Account[]>(path, owner);
      const allowed = new Map(accounts.map((a) => [a.id, a]));
      await saveMeta(path, data, owner);
      const signature = (v: Account[]) =>
        JSON.stringify(v.map((a) => [a.id, a.role, a.shared]).sort());
      if (!old || signature(old) !== signature(accounts)) {
        for (const row of (await listStored(
          owner,
          "tx",
        )) as CachedTransaction[]) {
          const legs = row.value.legs.filter((l) => allowed.has(l.account_id));
          if (!legs.length) {
            await deleteStored(row.key);
            continue;
          }
          row.value = {
            ...row.value,
            legs,
            can_edit:
              row.value.can_edit &&
              legs.every((l) => allowed.get(l.account_id)?.role !== "viewer"),
          };
          await putStored(row);
        }
      }
      if (old && signature(old) !== signature(accounts))
        for (const row of await listStored(owner, "meta"))
          if (
            String(row.key).includes("/categories?") ||
            String(row.key).includes("/me/entry-presets?")
          )
            await deleteStored(row.key);
    }
    if (
      path === "/accounts" ||
      path === "/ledgers" ||
      path.startsWith("/categories?") ||
      path.startsWith("/me/entry-presets?")
    )
      await saveMeta(path, data, owner);
  } catch {
    update({ storageError: true });
  }
}
export async function offlineResponse(path: string): Promise<unknown> {
  if (!active || !preferences().enabled)
    throw new Error(
      msg("저장된 오프라인 자료가 없어요. 서버 연결 후 다시 시도해 주세요."),
    );
  if (path === "/status")
    return { initialized: true, registration_open: false };
  if (path.startsWith("/transactions?")) {
    const user = await cachedUser();
    if (!user)
      throw new Error(
        msg("저장된 오프라인 자료가 없어요. 서버 연결 후 다시 시도해 주세요."),
      );
    await prune(active);
    const rows = (await listStored(active, "tx")) as CachedTransaction[];
    const records = new Map(
      rows.map((r) => [r.value.sync_id || r.value.id, r.value]),
    );
    for (const op of await pendingEntries()) {
      if (op.generation !== user.data_generation) continue;
      const local = await pendingTransaction(op, user);
      if (local) records.set(local.sync_id || local.id, local);
    }
    return offlineReport(
      [...records.values()],
      (await meta<Account[]>("/accounts")) || [],
      user,
      new URLSearchParams(path.split("?")[1]),
    );
  }
  const value = await meta(path);
  if (value !== undefined) return value;
  if (path.startsWith("/me/entry-presets?"))
    return { favorites: [], recent: [] };
  throw new Error(
    msg(
      "이 자료는 기기에 저장되어 있지 않아요. 서버에 연결한 뒤 조회해 주세요.",
    ),
  );
}
async function pendingTransaction(
  op: Pending,
  user: User,
): Promise<Transaction | undefined> {
  const p = op.input.payload,
    accounts = (await meta<Account[]>("/accounts", op.owner)) || [],
    a = accounts.find((a) => a.id === p.account_id);
  if (!a) return;
  const localId = "offline:" + op.id;
  const amount = String(p.amount),
    kind = String(p.kind),
    base = op.input.base;
  const sourceAmount = kind === "income" ? amount : String(-BigInt(amount));
  const legs = [
    {
      id: base?.legs.find((l) => l.account_id === a.id)?.id || localId,
      account_id: a.id,
      amount: sourceAmount,
      title: String(p.title),
      category: String(p.category),
      category_name: base?.legs[0]?.category_name || String(p.category),
      note: String(p.note || ""),
      receipts: base?.legs[0]?.receipts || [],
    },
  ];
  if (kind === "transfer")
    legs.push({
      id: localId + ":to",
      account_id: String(p.to_id),
      amount,
      title: String(p.title),
      category: "transfer",
      category_name: "transfer",
      note: String(p.target_note || ""),
      receipts: [],
    });
  return {
    ...base,
    original_currency: String(p.original_currency || ""),
    original_amount: String(p.original_amount || ""),
    exchange_rate: String(p.exchange_rate || ""),
    id: base?.id || localId,
    sync_id: base?.sync_id || localId,
    kind,
    date: String(p.date),
    time: String(p.time),
    timezone: String(p.timezone),
    currency: a.currency,
    scale: a.scale,
    creator: user.name,
    creator_username: user.username,
    version: base?.version || 0,
    can_edit: false,
    deleted: false,
    legs,
    pending: true,
  };
}
export async function pinTransaction(tx: Transaction, pinned: boolean) {
  if (!active) return;
  const key = storedKey(active, "tx", tx.sync_id || tx.id);
  const row = (await getStored(key)) as CachedTransaction | undefined;
  if (!row) throw new Error(msg("먼저 서버에 연결해 내역을 조회해 주세요."));
  row.pinned = pinned;
  await putStored(row);
}
export async function isPinned(tx: Transaction) {
  if (!active) return false;
  return !!(await getStored(storedKey(active, "tx", tx.sync_id || tx.id)))
    ?.pinned;
}
export async function cancelPending(op: Pending) {
  const owner = active;
  if (owner !== op.owner) return;
  const cancelHolder =
    holder + ":cancel:" + (crypto.randomUUID?.() || String(Math.random()));
  if (!(await acquireLease(owner, cancelHolder)))
    throw new Error(msg("동기화 중이에요. 잠시 후 다시 시도해 주세요."));
  try {
    await deleteStored(op.key);
    await countPending();
    window.dispatchEvent(new Event("duet-offline-updated"));
  } finally {
    await releaseLease(owner, cancelHolder);
  }
}
export function exportPending(rows: Pending[]) {
  const data = rows.map(({ input, generation, created, result, error }) => ({
    input: {
      ...input,
      photo: input.photo
        ? { name: input.photo.name, size: input.photo.size }
        : undefined,
    },
    generation,
    created,
    result,
    error,
  }));
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "duet-ledger-pending.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  for (const op of rows)
    if (op.input.photo) {
      const u = URL.createObjectURL(op.input.photo);
      const link = document.createElement("a");
      link.href = u;
      link.download = op.input.photo.name || "receipt";
      link.click();
      setTimeout(() => URL.revokeObjectURL(u), 1000);
    }
}
const temporary = (error: unknown) =>
  !(error && typeof error === "object" && "status" in error) ||
  Number((error as { status: number }).status) >= 500;
function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : msg("동기화하지 못했어요. 다시 시도해 주세요.");
}
async function sendOne(op: Pending) {
  const user = await transport<User>("/me");
  if (user.id !== op.owner || user.data_generation !== op.generation)
    throw Object.assign(
      new Error(
        msg(
          "계정 또는 서버 자료가 바뀌었어요. 이 대기 기록은 내보낸 뒤 직접 확인해 주세요.",
        ),
      ),
      { status: 409, code: "data_changed" },
    );
  const headers = {
    "X-Duet-User": op.owner,
    "X-Duet-Data-Generation": op.generation,
    "Idempotency-Key": op.input.requestKey,
  };
  if (!op.result) {
    op.result = await transport(op.input.path, {
      method: op.input.base ? "PUT" : "POST",
      headers,
      body: JSON.stringify(op.input.payload),
    });
    await putStored(op);
  }
  for (const id of op.input.removedPhotos) {
    if (op.removed?.includes(id)) continue;
    // A masked 404 may mean revoked access, not a successful deletion. Retain
    // the pending operation for review rather than silently acknowledging it.
    await transport(`/receipts/${id}`, { method: "DELETE", headers });
    op.removed = [...(op.removed || []), id];
    await putStored(op);
  }
  if (op.input.photo) {
    const form = new FormData();
    form.append("file", op.input.photo);
    const id = op.result!.posting_ids?.[op.input.photoTarget] || op.result!.id;
    await transport(`/transactions/${id}/receipts`, {
      method: "POST",
      headers,
      body: form,
    });
  }
  await deleteStored(op.key);
}
let running = false;
const holder = globalThis.crypto?.randomUUID?.() || String(Math.random());
export async function syncPending() {
  const owner = active;
  if (!owner || running || !transport) return;
  running = true;
  let lease = false;
  let renew: ReturnType<typeof setInterval> | undefined;
  try {
    const ops = await pendingEntries(owner);
    if (!ops.length) return;
    lease = await acquireLease(owner, holder);
    if (!lease) return;
    renew = setInterval(() => {
      void acquireLease(owner, holder).catch(() => {});
    }, 15000);
    update({ syncing: true });
    for (const op of ops) {
      if (active !== owner) break;
      if (op.error && op.status !== 401) continue;
      try {
        await sendOne(op);
      } catch (error) {
        if (!temporary(error)) {
          op.error = message(error);
          op.status = Number((error as { status?: number }).status) || 409;
          await putStored(op);
        } else {
          noteConnection(false);
          break;
        }
      }
    }
  } catch {
    update({ storageError: true });
  } finally {
    if (renew) clearInterval(renew);
    if (lease) await releaseLease(owner, holder);
    running = false;
    await countPending();
    update({ syncing: false });
    window.dispatchEvent(new Event("duet-offline-updated"));
  }
}
export async function retryPending() {
  for (const op of await pendingEntries()) {
    delete op.error;
    await putStored(op);
  }
  await syncPending();
}
export async function saveOfflineEntry(
  input: EntryInput,
): Promise<{ queued: boolean; id?: string }> {
  const owner = active;
  const user = currentUser || (await cachedUser());
  if (!owner || !user || !user.data_generation || !preferences().enabled) {
    return { queued: false };
  }
  if ((await pendingEntries()).length >= 500)
    throw new Error(
      msg("전송 대기 기록이 500건이에요. 먼저 동기화하거나 내보내 주세요."),
    );
  const op: Pending = {
    key: storedKey(owner, "queue", input.requestKey),
    owner,
    kind: "queue",
    id: input.requestKey,
    generation: input.base?.data_generation || user.data_generation,
    created: Date.now(),
    input,
  };
  // A retained response after a lost receipt upload must not repeat the mutation.
  const previous = (await getStored(op.key)) as Pending | undefined;
  if (previous) Object.assign(op, previous, { input });
  try {
    await putStored(op);
  } catch {
    update({ storageError: true });
    if (navigator.onLine && state.connection !== "offline")
      return { queued: false };
    throw new Error(
      msg(
        "기기에 기록을 저장하지 못했어요. 저장 공간과 브라우저 설정을 확인해 주세요.",
      ),
    );
  }
  await countPending();
  if (state.connection === "offline" || !navigator.onLine)
    return { queued: true };
  if (running) return { queued: true };
  let lease = false;
  let renewal: ReturnType<typeof setInterval> | undefined;
  try {
    lease = await acquireLease(owner, holder);
    if (!lease) return { queued: true };
    renewal = setInterval(() => {
      void acquireLease(owner, holder).catch(() => {});
    }, 15000);
    running = true;
    update({ syncing: true });
    await sendOne(op);
    return { queued: false, id: op.result?.id };
  } catch (error) {
    if (
      !temporary(error) &&
      !op.result &&
      (error as { status?: number }).status !== 401 &&
      (error as { code?: string }).code !== "data_changed"
    ) {
      await deleteStored(op.key);
      throw error;
    }
    if (!temporary(error)) {
      op.error = message(error);
      op.status = Number((error as { status?: number }).status) || 409;
      await putStored(op);
    } else noteConnection(false);
    return { queued: true };
  } finally {
    if (renewal) clearInterval(renewal);
    if (lease) await releaseLease(owner, holder);
    running = false;
    await countPending();
    update({ syncing: false });
  }
}
let warming = false,
  lastWarm = 0;
export async function warmOffline(force = false) {
  const owner = active;
  if (
    !owner ||
    !preferences().enabled ||
    warming ||
    !transport ||
    (!force && state.connection !== "offline" && Date.now() - lastWarm < 60000)
  )
    return;
  warming = true;
  try {
    const user = await transport<User>("/me");
    if (user.id !== owner) return;
    await transport("/accounts");
    await transport("/ledgers");
    const params = new URLSearchParams({
      from: recentStart(preferences().days, user.timezone),
      to: today(user.timezone),
      page_size: "200",
      page: "1",
    });
    const seenIDs = new Set<string>();
    let complete = false;
    for (let page = 1; page <= 200; page++) {
      if (active !== owner) break;
      params.set("page", String(page));
      const report = await transport<Report>("/transactions?" + params);
      await rememberResponse("/transactions?" + params, report, owner, false);
      for (const tx of report.items) seenIDs.add(tx.sync_id || tx.id);
      if (page * 200 >= report.count) {
        complete = true;
        break;
      }
    }
    if (
      complete &&
      active === owner &&
      currentUser?.data_generation === user.data_generation
    ) {
      for (const row of (await listStored(
        owner,
        "tx",
      )) as CachedTransaction[]) {
        if (
          !row.value.deleted &&
          row.value.date >= params.get("from")! &&
          row.value.date <= params.get("to")! &&
          !seenIDs.has(row.value.sync_id || row.value.id)
        )
          await deleteStored(row.key);
      }
    }
    const accounts = (await meta<Account[]>("/accounts", owner)) || [];
    for (const account of accounts) {
      if (active !== owner) break;
      for (const kind of ["expense", "income"])
        await transport(
          `/categories?account=${encodeURIComponent(account.id)}&kind=${kind}`,
        );
    }
    lastWarm = Date.now();
  } catch {
    /* Failed background refresh never changes confirmed server data. */
  } finally {
    warming = false;
  }
}

if (typeof window !== "undefined")
  window.addEventListener("storage", (event) => {
    if (
      event.key === "duet-ledger-offline-active" &&
      active &&
      event.newValue !== active
    ) {
      void suspendOfflineUser().then(() =>
        window.dispatchEvent(new Event("duet-ledger:unauthorized")),
      );
    }
  });
