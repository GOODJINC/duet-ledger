import type { Account, Report, Transaction, User } from "./api";
import { currencyScales } from "./currency-data";
import { convertMinor, exchangeFactor } from "./exchange";

// Offline totals are explicitly limited to stored records. IDs group the two
// sides of transfers without exposing or inventing inaccessible counterparts.
export function offlineReport(
  records: Transaction[],
  accounts: Account[],
  user: User,
  params: URLSearchParams,
): Report {
  const accountMap = new Map(accounts.map((a) => [a.id, a]));
  const items: Transaction[] = [];
  for (const original of records) {
    if (
      original.date < (params.get("from") || "") ||
      original.date > (params.get("to") || "9999-12-31")
    )
      continue;
    if (original.deleted !== (params.get("trash") === "true")) continue;
    if (params.get("type") && params.get("type") !== original.kind) continue;
    const legs = original.legs.filter((l) => {
      const a = accountMap.get(l.account_id);
      if (!a) return false;
      if (params.get("ledger") && a.ledger_id !== params.get("ledger"))
        return false;
      if (params.get("account") && a.id !== params.get("account")) return false;
      if (params.get("currency") && a.currency !== params.get("currency"))
        return false;
      if (
        (params.get("scope") === "private" && a.shared) ||
        (params.get("scope") === "shared" && !a.shared)
      )
        return false;
      return true;
    });
    if (!legs.length) continue;
    const search = (params.get("search") || "").toLocaleLowerCase();
    if (
      search &&
      !legs.some((l) =>
        [
          l.title,
          l.note,
          l.category,
          l.category_name,
          original.creator,
          original.creator_username,
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(search),
      )
    )
      continue;
    const item = { ...original, legs: legs.map((l) => ({ ...l })) };
    if (item.kind === "transfer" && legs.length !== 2) item.can_edit = false;
    const target = params.get("display_currency");
    if (target && currencyScales[target] !== undefined) {
      const factor = exchangeFactor(
        user.exchange_rates || [],
        item.currency,
        target,
        user.default_currency || "KRW",
      );
      if (factor) {
        item.display_currency = target;
        item.display_scale = currencyScales[target];
        for (const l of item.legs)
          l.display_amount = convertMinor(
            l.amount,
            item.currency,
            target,
            factor,
          );
      }
    }
    items.push(item);
  }
  items.sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      (b.time || "").localeCompare(a.time || "") ||
      b.id.localeCompare(a.id),
  );
  const totals = new Map<
    string,
    { income: bigint; expense: bigint; scale: number }
  >();
  const categories = new Map<
    string,
    {
      name: string;
      currency: string;
      scale: number;
      category: string;
      amount: bigint;
    }
  >();
  const daily = new Map<
    string,
    {
      currency: string;
      scale: number;
      date: string;
      income: bigint;
      expense: bigint;
    }
  >();
  for (const t of items) {
    // Missing rates are visible in original currency, matching online exclusion.
    if (params.get("display_currency") && !t.display_currency) continue;
    const currency = t.display_currency || t.currency,
      scale = t.display_scale ?? t.scale;
    const sum = totals.get(currency) || { income: 0n, expense: 0n, scale };
    const key = JSON.stringify([currency, t.date]);
    const day = daily.get(key) || {
      currency,
      scale,
      date: t.date,
      income: 0n,
      expense: 0n,
    };
    for (const leg of t.legs) {
      const n = BigInt(leg.display_amount ?? leg.amount);
      if (t.kind === "income") {
        sum.income += n;
        day.income += n;
      }
      if (t.kind === "expense" || t.kind === "refund") {
        sum.expense -= n;
        day.expense -= n;
        const k = JSON.stringify([
          currency,
          leg.category,
          leg.category_name || leg.category,
        ]);
        const cat = categories.get(k) || {
          currency,
          scale,
          category: leg.category,
          name: leg.category_name || leg.category,
          amount: 0n,
        };
        cat.amount -= n;
        categories.set(k, cat);
      }
    }
    totals.set(currency, sum);
    daily.set(key, day);
  }
  const page = Math.max(1, Number(params.get("page")) || 1),
    size = Math.min(200, Math.max(1, Number(params.get("page_size")) || 50));
  return {
    items: items.slice((page - 1) * size, page * size),
    count: items.length,
    page,
    page_size: size,
    offline: true,
    totals: [...totals].map(([currency, t]) => ({
      currency,
      scale: t.scale,
      income: String(t.income),
      expense: String(t.expense),
    })),
    categories: [...categories.values()].map((c) => ({
      ...c,
      amount: String(c.amount),
    })),
    daily: [...daily.values()]
      .map((d) => ({
        ...d,
        income: String(d.income),
        expense: String(d.expense),
      }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}
