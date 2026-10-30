import {
  offlineOwner,
  currentOfflineGeneration,
  offlineState,
  offlineResponse,
  rememberResponse,
  noteConnection,
  suspendOfflineUser,
  setOfflineTransport,
} from "./offline";
import { msg, getLocale, intlLocale } from "./i18n";
export type ExchangeRate = { from: string; to: string; rate: string };
export type User = {
  data_generation?: string;
  api_enabled?: boolean;
  default_account_id?: string;
  exchange_rates?: ExchangeRate[];
  id: string;
  username: string;
  name: string;
  admin: boolean;
  locale: "ko" | "en";
  timezone: string;
  totp_enabled: boolean;
  csrf: string;
  default_currency?: string;
  show_sidebar_message?: boolean;
  sharing_pending?: boolean;
};
export type Ledger = {
  id: string;
  name: string;
  kind: "personal" | "shared";
  role: "owner" | "editor" | "viewer";
  timezone: string;
  tagline?: string;
};
export type Account = {
  access_paths?: {
    type: "owner" | "ledger" | "account";
    role: "owner" | "editor" | "viewer";
  }[];
  id: string;
  ledger_id?: string;
  ledger_name: string;
  name: string;
  kind: "cash" | "bank" | "card" | "loan";
  currency: string;
  scale: number;
  opening: string;
  balance: string;
  archived: boolean;
  version: number;
  role: "owner" | "editor" | "viewer";
  shared: boolean;
  owner_name: string;
};
export type Receipt = { id: string; size: number; media_type: string };
export type PurgeResult = {
  deleted: number;
  skipped?: number;
  cleanup_pending: number;
};
export function purgeMessage(result: PurgeResult) {
  if (result.cleanup_pending)
    return msg(
      "영구 삭제했지만 일부 사진 파일 정리에 실패했어요. 서버 관리자에게 문의해 주세요.",
    );
  if (result.skipped)
    return msg(
      "{0}건을 영구 삭제했어요. 다른 책임자의 기록 {1}건은 유지했어요.",
      [result.deleted, result.skipped],
    );
  return msg("{0}개 항목을 영구 삭제했어요.", [result.deleted]);
}
export type Leg = {
  id: string;
  account_id: string;
  amount: string;
  display_amount?: string;
  title: string;
  category: string;
  category_name?: string;
  note: string;
  receipts: Receipt[];
};
export type Transaction = {
  data_generation?: string;
  sync_id?: string;
  pending?: boolean;
  can_purge?: boolean;
  original_currency?: string;
  original_amount?: string;
  exchange_rate?: string;
  display_currency?: string;
  display_scale?: number;
  id: string;
  kind: string;
  date: string;
  time?: string;
  timezone?: string;
  creator_username?: string;
  currency: string;
  scale: number;
  version: number;
  creator: string;
  can_edit: boolean;
  deleted: boolean;
  legs: Leg[];
};
export type Report = {
  offline?: boolean;
  missing_currencies?: string[];
  items: Transaction[];
  count: number;
  page: number;
  page_size: number;
  totals: {
    currency: string;
    scale: number;
    income: string;
    expense: string;
  }[];
  categories: {
    name?: string;
    currency: string;
    scale: number;
    category: string;
    amount: string;
  }[];
  daily: {
    currency: string;
    scale: number;
    date: string;
    income: string;
    expense: string;
  }[];
};
export type Invitation = {
  id: string;
  target_type: "ledger" | "account";
  target_id: string;
  target_name: string;
  role: string;
  status: string;
  expires_at: number;
  claimant_id: string;
  claimant_name: string;
  claimant_username: string;
};
export type Share = {
  target_type: string;
  target_id: string;
  target_name: string;
  user_id: string;
  name: string;
  username: string;
  role: string;
};
export type Sharing = { invitations: Invitation[]; shares: Share[] };
let csrf = "";
export function setCSRF(value: string) {
  csrf = value;
}
export class APIError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T = unknown>(
  path: string,
  options: RequestInit = {},
  networkOnly = false,
): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Accept-Language", getLocale());
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  if (options.method && options.method !== "GET")
    headers.set("X-CSRF-Token", csrf);
  const owner = offlineOwner();
  if (
    !networkOnly &&
    (!options.method || options.method === "GET") &&
    (!navigator.onLine || offlineState().connection === "offline")
  )
    return (await offlineResponse(path)) as T;
  const method = options.method || "GET";
  const controller = new AbortController();
  const timer =
    method === "GET" && !options.signal
      ? setTimeout(() => controller.abort(), 10000)
      : undefined;
  try {
    const response = await fetch("/api" + path, {
      ...options,
      headers,
      credentials: "same-origin",
      cache: "no-store",
      signal: options.signal || (timer ? controller.signal : undefined),
    });
    noteConnection(true);
    if (!response.ok) {
      let error = {
        error: "request_failed",
        message: msg("처리하지 못했어요. 연결 상태를 확인해 주세요."),
      };
      try {
        error = await response.json();
      } catch {}
      if (response.status === 401 && error.error === "login_required") {
        if (owner === offlineOwner()) {
          await suspendOfflineUser();
          window.dispatchEvent(new Event("duet-ledger:unauthorized"));
        }
      }
      if (response.status >= 500) {
        noteConnection(false);
        if (method === "GET" && !networkOnly)
          return (await offlineResponse(path)) as T;
      }
      throw new APIError(response.status, error.error, msg(error.message));
    }
    const value = await response.json();
    if (path === "/me" && value.csrf) setCSRF(value.csrf);
    const responseOwner = response.headers?.get("X-Duet-User");
    const responseGeneration = response.headers?.get("X-Duet-Data-Generation");
    const current = currentOfflineGeneration();
    if (
      method === "GET" &&
      (!networkOnly || !path.startsWith("/transactions?")) &&
      (path === "/me" ||
        ((!responseOwner || responseOwner === owner) &&
          (!responseGeneration || !current || responseGeneration === current)))
    )
      await rememberResponse(path, value, owner);
    if (path === "/logout") await suspendOfflineUser(true);
    if (path === "/status" && value.initialized === false && owner)
      await suspendOfflineUser(true);
    return value as T;
  } catch (error) {
    if (error instanceof APIError) throw error;
    noteConnection(false);
    if (method === "GET" && !networkOnly)
      return (await offlineResponse(path)) as T;
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
export const post = <T = unknown>(
  path: string,
  body: unknown = {},
  method = "POST",
  headers?: Record<string, string>,
) => api<T>(path, { method, body: JSON.stringify(body), headers });
export async function download(path: string, filename: string) {
  const response = await fetch("/api" + path, {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    const e = await response.json();
    throw new Error(msg(e.message) || msg("내보내기에 실패했어요."));
  }
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export { currencyScales } from "./currency-data";
export function formatMoney(
  value: string | bigint,
  scale = 0,
  currency = "KRW",
  unit = true,
) {
  let n = BigInt(value || "0");
  const negative = n < 0n;
  if (negative) n = -n;
  const base = 10n ** BigInt(scale);
  let number = (n / base).toLocaleString(intlLocale());
  if (scale) number += "." + (n % base).toString().padStart(scale, "0");
  return `${negative ? "−" : ""}${number}${unit ? (currency === "KRW" ? msg("원") : ` ${currency}`) : ""}`;
}
export function toMinor(decimal: string, scale: number) {
  const clean = decimal.trim().replaceAll(",", "");
  if (!/^-?\d+(\.\d+)?$/.test(clean))
    throw new Error(msg("금액을 숫자로 입력해 주세요."));
  const negative = clean.startsWith("-");
  const [whole, fraction = ""] = clean.replace("-", "").split(".");
  if (fraction.length > scale)
    throw new Error(msg("소수점 {0}자리까지 입력할 수 있어요.", [scale]));
  return (
    (negative ? -1n : 1n) *
    (BigInt(whole) * 10n ** BigInt(scale) +
      BigInt((fraction + "0".repeat(scale)).slice(0, scale) || "0"))
  ).toString();
}
export function toDecimal(minor: string, scale: number) {
  const n = BigInt(minor);
  const absolute = n < 0n ? -n : n;
  const base = 10n ** BigInt(scale);
  return (
    (n < 0n ? "-" : "") +
    (absolute / base).toString() +
    (scale ? "." + (absolute % base).toString().padStart(scale, "0") : "")
  );
}
export const categories = [
  { id: "opening_balance", label: "시작 잔액", color: "#8da6a0" },
  { id: "food", label: "식비", color: "#9fb58c" },
  { id: "groceries", label: "장보기", color: "#c5cfa5" },
  { id: "coffee", label: "카페·간식", color: "#d8b79b" },
  { id: "transport", label: "교통", color: "#a6bec7" },
  { id: "home", label: "주거·생활", color: "#bcb3cb" },
  { id: "shopping", label: "쇼핑", color: "#d4b2c1" },
  { id: "health", label: "건강", color: "#d8b2a6" },
  { id: "salary", label: "월급", color: "#92b18b" },
  { id: "side_income", label: "부수입", color: "#83a9b8" },
  { id: "allowance", label: "용돈", color: "#9eaf7e" },
  { id: "bonus", label: "상여", color: "#d3b179" },
  {
    id: "financial_income",
    label: "금융소득",
    color: "#b79dcc",
  },
  { id: "other", label: "기타", color: "#bdc8b3" },
  { id: "transfer", label: "이체", color: "#a6bcae" },
];
export const categoryName = (id: string) =>
  msg(categories.find((category) => category.id === id)?.label || id);
export const kindNames: Record<string, string> = {
  income: "수입",
  expense: "지출",
  refund: "환불",
  transfer: "이체",
  adjustment: "잔액 조정",
};
export type Category = {
  code: string;
  name: string;
  kind: "income" | "expense";
  hidden: boolean;
};

export function displayCategory(code: string, name?: string) {
  const builtin = categories.find((category) => category.id === code);
  return builtin && (!name || name === builtin.label)
    ? categoryName(code)
    : name || code;
}

export type EntryPresetInput = {
  kind: string;
  account_id: string;
  to_id?: string;
  amount: string;
  title: string;
  category: string;
  note?: string;
  target_note?: string;
  original_currency?: string;
  original_amount?: string;
  exchange_rate?: string;
};
export type EntryPreset = { id: string; input: EntryPresetInput };

setOfflineTransport(
  <T>(path: string, options: RequestInit = {}): Promise<T> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    return api<T>(
      path,
      { ...options, signal: controller.signal },
      true,
    ).finally(() => clearTimeout(timeout));
  },
);
