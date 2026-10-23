import { it, expect } from "vitest";
import {
  convertMinor,
  exchangeFactor,
  rateFraction,
  factorDecimal,
} from "./exchange";
it("통화 자릿수와 반올림을 정수로 계산한다", () => {
  expect(convertMinor("2099", "USD", "KRW", [1400n, 1n])).toBe("29386");
  expect(convertMinor("-1", "KRW", "KRW", [1n, 2n])).toBe("-1");
  expect(convertMinor("1", "USD", "KRW", rateFraction("1325.56")!)).toBe("13");
});
it("정방향·역방향과 기본 통화를 통한 교차 환산", () => {
  const rates = [
    { from: "USD", to: "KRW", rate: "1400" },
    { from: "EUR", to: "KRW", rate: "1500" },
  ];
  expect(exchangeFactor(rates, "USD", "KRW", "KRW")).toEqual([1400n, 1n]);
  expect(exchangeFactor(rates, "KRW", "USD", "KRW")).toEqual([1n, 1400n]);
  expect(
    convertMinor(
      "100",
      "EUR",
      "USD",
      exchangeFactor(rates, "EUR", "USD", "KRW")!,
    ),
  ).toBe("107");
  expect(exchangeFactor(rates, "JPY", "KRW", "KRW")).toBeNull();
  expect(factorDecimal([1400n, 1n])).toBe("1400");
});
