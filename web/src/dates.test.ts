import { afterEach, expect, it, vi } from "vitest";
import { currentTime, today } from "./dates";

afterEach(() => vi.useRealTimers());

it("keeps the date and 24-hour clock in the user's timezone across New Year", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-12-31T16:05:00Z"));
  expect([today("Asia/Seoul"), currentTime("Asia/Seoul")]).toEqual([
    "2027-01-01",
    "01:05",
  ]);
  expect([today("UTC"), currentTime("UTC")]).toEqual(["2026-12-31", "16:05"]);
});

it("keeps the clock correct across a daylight-saving transition", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2024-03-10T06:59:00Z"));
  expect(currentTime("America/New_York")).toBe("01:59");
  vi.setSystemTime(new Date("2024-03-10T07:00:00Z"));
  expect(currentTime("America/New_York")).toBe("03:00");
});
