import type { ExchangeRate } from "./api";
import { currencyScales } from "./currency-data";
type Factor = [bigint, bigint];
export function rateFraction(rate: string): Factor | null {
  if (!/^\d{1,13}(\.\d{1,12})?$/.test(rate)) return null;
  const [whole, part = ""] = rate.split(".");
  const n = BigInt(whole + part);
  return n > 0n ? [n, 10n ** BigInt(part.length)] : null;
}
export function exchangeFactor(
  rates: ExchangeRate[],
  from: string,
  to: string,
  base: string,
): Factor | null {
  if (from === to) return [1n, 1n];
  const direct = (f: string, t: string): Factor | null => {
    const found = rates.find((r) => r.from === f && r.to === t);
    if (found) return rateFraction(found.rate);
    const reverse = rates.find((r) => r.from === t && r.to === f);
    if (reverse) {
      const r = rateFraction(reverse.rate);
      return r ? [r[1], r[0]] : null;
    }
    return null;
  };
  const r = direct(from, to);
  if (r) return r;
  for (const mid of [...new Set([base, ...Object.keys(currencyScales)])]) {
    if (mid === from || mid === to) continue;
    const a = direct(from, mid),
      b = direct(mid, to);
    if (a && b) return [a[0] * b[0], a[1] * b[1]];
  }
  return null;
}
export function factorDecimal(factor: Factor) {
  const [n, d] = factor;
  const scaled = (n * 10n ** 12n + d / 2n) / d;
  return `${scaled / 10n ** 12n}.${(scaled % 10n ** 12n).toString().padStart(12, "0")}`
    .replace(/0+$/, "")
    .replace(/\.$/, "");
}
export function convertMinor(
  amount: string,
  from: string,
  to: string,
  factor: Factor,
): string {
  const raw = BigInt(amount),
    negative = raw < 0n;
  const n =
    (negative ? -raw : raw) * factor[0] * 10n ** BigInt(currencyScales[to]);
  const d = factor[1] * 10n ** BigInt(currencyScales[from]);
  const converted = (n + d / 2n) / d;
  return (negative ? -converted : converted).toString();
}
