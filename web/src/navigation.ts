import type { IconName } from "./ui";

export type Page =
  | "home"
  | "ledger"
  | "stats"
  | "accounts"
  | "settings"
  | "account-settings"
  | "administration";
const pagePaths: Record<Page, string> = {
  home: "/home",
  ledger: "/ledger",
  stats: "/stats",
  accounts: "/accounts",
  settings: "/settings",
  "account-settings": "/account",
  administration: "/admin",
};
export function pageURL(page: Page): string {
  return (
    pagePaths[page] +
    (new URLSearchParams(location.search).has("safe-theme")
      ? "?safe-theme=1"
      : "")
  );
}
export function pageFromLocation(): Page {
  return (
    (Object.entries(pagePaths).find(
      ([, path]) => path === location.pathname.replace(/\/$/, ""),
    )?.[0] as Page) || "home"
  );
}
export const mainNavigation: {
  id: Page;
  label: string;
  short: string;
  icon: IconName;
}[] = [
  { id: "home", label: "홈", short: "홈", icon: "home" },
  {
    id: "ledger",
    label: "가계부",
    short: "가계부",
    icon: "book",
  },
  {
    id: "stats",
    label: "통계·분석",
    short: "통계",
    icon: "chart",
  },
  {
    id: "accounts",
    label: "계좌·자산",
    short: "계좌",
    icon: "wallet",
  },
];
