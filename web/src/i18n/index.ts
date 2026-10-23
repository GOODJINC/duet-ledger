import { useSyncExternalStore } from "react";
import ko from "./ko.json";
import en from "./en.json";
import serverEnglish from "../../../internal/app/i18n/en.json";

export type Locale = "ko" | "en";
const storageKey = "duet-ledger-language";
let language: Locale = "ko";
try {
  if (localStorage.getItem(storageKey) === "en") language = "en";
} catch {}
const listeners = new Set<() => void>();
const catalogs: Record<Locale, Record<string, string>> = { ko, en };
export const getLocale = () => language;
export const intlLocale = () => (language === "en" ? "en-US" : "ko-KR");
export function setLocale(locale: string) {
  const next = locale === "en" ? "en" : "ko";
  document.documentElement.lang = next;
  document.title = next === "en" ? "Duet Ledger" : "듀엣 가계부";
  try {
    localStorage.setItem(storageKey, next);
  } catch {}
  if (next === language) return;
  language = next;
  listeners.forEach((listener) => listener());
}
export function useLocale() {
  return useSyncExternalStore((listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, getLocale);
}
export function msg(key: string, parameters: unknown[] = []) {
  const catalog = catalogs[language];
  const value =
    catalog[key] ??
    (language === "en"
      ? (serverEnglish as Record<string, string>)[key]
      : undefined) ??
    key;
  return value.replace(/\{(\d+)\}/g, (token, index: string) =>
    String(parameters[Number(index)] ?? token),
  );
}
export function monthName(month: number, long = false) {
  return new Intl.DateTimeFormat(intlLocale(), {
    month: long ? "long" : "short",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2024, month - 1, 1)));
}
export function monthTitle(date: string) {
  const [year, month] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(intlLocale(), {
    year: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 1)));
}
export function weekdays() {
  return Array.from({ length: 7 }, (_, day) =>
    new Intl.DateTimeFormat(intlLocale(), {
      weekday: language === "en" ? "short" : "narrow",
      timeZone: "UTC",
    }).format(new Date(Date.UTC(2024, 0, 7 + day))),
  );
}
export function manualURL(page = "index") {
  return `/manual/${language}/${page}.html`;
}
