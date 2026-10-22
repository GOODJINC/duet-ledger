export type User = {
  id: string;
  username: string;
  name: string;
  admin: boolean;
  locale: "ko" | "en";
  timezone: string;
  totp_enabled: boolean;
  csrf: string;
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
export type Leg = {
  id: string;
  account_id: string;
  amount: string;
  title: string;
  category: string;
  category_name?: string;
  note: string;
  receipts: Receipt[];
};
export type Transaction = {
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
): Promise<T> {
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  if (options.method && options.method !== "GET")
    headers.set("X-CSRF-Token", csrf);
  const response = await fetch("/api" + path, {
    ...options,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    let error = {
      error: "request_failed",
      message: "처리하지 못했어요. 연결 상태를 확인해 주세요.",
    };
    try {
      error = await response.json();
    } catch {}
    if (response.status === 401 && error.error === "login_required")
      window.dispatchEvent(new Event("duet-ledger:unauthorized"));
    throw new APIError(response.status, error.error, error.message);
  }
  return (await response.json()) as T;
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
    throw new Error(e.message || "내보내기에 실패했어요.");
  }
  const url = URL.createObjectURL(await response.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const currencyScales: Record<string, number> = {
  KRW: 0,
  USD: 2,
  EUR: 2,
  JPY: 0,
  GBP: 2,
  CNY: 2,
  TWD: 2,
  VND: 0,
  KWD: 3,
};
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
  let number = (n / base).toLocaleString("ko-KR");
  if (scale) number += "." + (n % base).toString().padStart(scale, "0");
  return `${negative ? "−" : ""}${number}${unit ? (currency === "KRW" ? "원" : ` ${currency}`) : ""}`;
}
export function toMinor(decimal: string, scale: number) {
  const clean = decimal.trim().replaceAll(",", "");
  if (!/^-?\d+(\.\d+)?$/.test(clean))
    throw new Error("금액을 숫자로 입력해 주세요.");
  const negative = clean.startsWith("-");
  const [whole, fraction = ""] = clean.replace("-", "").split(".");
  if (fraction.length > scale)
    throw new Error(`소수점 ${scale}자리까지 입력할 수 있어요.`);
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
export function today(timezone = "Asia/Seoul") {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}
export const categories = [
  { id: "food", ko: "식비", en: "Food", color: "#9fb58c" },
  { id: "groceries", ko: "장보기", en: "Groceries", color: "#c5cfa5" },
  { id: "coffee", ko: "카페·간식", en: "Coffee", color: "#d8b79b" },
  { id: "transport", ko: "교통", en: "Transport", color: "#a6bec7" },
  { id: "home", ko: "주거·생활", en: "Home", color: "#bcb3cb" },
  { id: "shopping", ko: "쇼핑", en: "Shopping", color: "#d4b2c1" },
  { id: "health", ko: "건강", en: "Health", color: "#d8b2a6" },
  { id: "salary", ko: "월급", en: "Salary", color: "#92b18b" },
  { id: "side_income", ko: "부수입", en: "Side income", color: "#83a9b8" },
  { id: "allowance", ko: "용돈", en: "Allowance", color: "#9eaf7e" },
  { id: "bonus", ko: "상여", en: "Bonus", color: "#d3b179" },
  {
    id: "financial_income",
    ko: "금융소득",
    en: "Investment income",
    color: "#b79dcc",
  },
  { id: "other", ko: "기타", en: "Other", color: "#bdc8b3" },
  { id: "transfer", ko: "이체", en: "Transfer", color: "#a6bcae" },
];
export const categoryName = (id: string, en = false) =>
  categories.find((c) => c.id === id)?.[en ? "en" : "ko"] || id;
export const kindNames: Record<string, string> = {
  income: "수입",
  expense: "지출",
  refund: "환불",
  transfer: "이체",
  adjustment: "잔액 조정",
};
export function dateRange(date: string, period: string) {
  const [year, month, day] = date.split("-").map(Number);
  if (period === "year") return [`${year}-01-01`, `${year}-12-31`];
  if (period === "day") return [date, date];
  if (period === "week") {
    const d = new Date(year, month - 1, day, 12);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const format = (v: Date) =>
      `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`;
    const start = format(d);
    d.setDate(d.getDate() + 6);
    return [start, format(d)];
  }
  return [
    `${year}-${String(month).padStart(2, "0")}-01`,
    `${year}-${String(month).padStart(2, "0")}-${new Date(year, month, 0).getDate()}`,
  ];
}

export type Category = {
  code: string;
  name: string;
  kind: "income" | "expense";
  hidden: boolean;
};
