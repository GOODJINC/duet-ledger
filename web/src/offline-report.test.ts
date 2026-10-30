import { expect, it } from "vitest";
import { offlineReport } from "./offline-report";
import type { User, Account, Transaction } from "./api";
const user = {
  id: "u",
  name: "민수",
  username: "minsu",
  timezone: "Asia/Seoul",
  locale: "ko",
  admin: false,
  csrf: "",
  totp_enabled: false,
  default_currency: "KRW",
  exchange_rates: [{ from: "USD", to: "KRW", rate: "1400" }],
} as User;
const accounts = [
  {
    id: "a",
    ledger_id: "private",
    shared: false,
    currency: "KRW",
    role: "owner",
  },
  {
    id: "b",
    ledger_id: "shared",
    shared: true,
    currency: "KRW",
    role: "editor",
  },
] as Account[];
function tx(
  id: string,
  amount: string,
  kind = "expense",
  account = "a",
): Transaction {
  return {
    id,
    sync_id: id,
    kind,
    date: "2026-10-30",
    time: "12:00",
    currency: "KRW",
    scale: 0,
    version: 1,
    creator: "민수",
    creator_username: "minsu",
    can_edit: true,
    deleted: false,
    legs: [
      {
        id: id + "-p",
        account_id: account,
        amount,
        title: "점심",
        category: "food",
        category_name: "식비",
        note: "메모",
        receipts: [],
      },
    ],
  };
}
const params = (s = "") =>
  new URLSearchParams("from=2026-10-01&to=2026-10-31&" + s);
it("totals only stored rows and marks offline results", () => {
  const report = offlineReport(
    [tx("i", "1000", "income"), tx("e", "-300")],
    accounts,
    user,
    params(),
  );
  expect(report.offline).toBe(true);
  expect(report.totals).toEqual([
    { currency: "KRW", scale: 0, income: "1000", expense: "300" },
  ]);
  expect(report.categories[0].amount).toBe("300");
});
it("filters ledger, account and sharing without leaking inaccessible legs", () => {
  const report = offlineReport(
    [
      tx("one", "-100"),
      tx("two", "-200", "expense", "b"),
      tx("hidden", "-900", "expense", "unknown"),
    ],
    accounts,
    user,
    params("ledger=shared"),
  );
  expect(report.items.map((t) => t.id)).toEqual(["two"]);
  expect(
    offlineReport(report.items, accounts, user, params("scope=private")).count,
  ).toBe(0);
});
it("searches category labels, notes and creator names", () => {
  for (const search of ["식비", "메모", "minsu", "점심"])
    expect(
      offlineReport([tx("a", "-3")], accounts, user, params("search=" + search))
        .count,
    ).toBe(1);
});
it("keeps deleted records out of ordinary views", () => {
  const t = { ...tx("a", "-3"), deleted: true };
  expect(offlineReport([t], accounts, user, params()).count).toBe(0);
  expect(offlineReport([t], accounts, user, params("trash=true")).count).toBe(
    1,
  );
});
it("paginates records while totaling the complete stored selection", () => {
  const r = offlineReport(
    [tx("a", "-3"), tx("b", "-4")],
    accounts,
    user,
    params("page=2&page_size=1"),
  );
  expect(r.items).toHaveLength(1);
  expect(r.count).toBe(2);
  expect(r.totals[0].expense).toBe("7");
});
it("converts foreign currency using integer arithmetic", () => {
  const t = { ...tx("usd", "-123"), currency: "USD", scale: 2 };
  const r = offlineReport([t], accounts, user, params("display_currency=KRW"));
  expect(r.totals[0].expense).toBe("1722");
  expect(r.items[0].legs[0].display_amount).toBe("-1722");
});
it("does not add transfers to income or expense and blocks editing partial transfers", () => {
  const t = tx("transfer", "-100", "transfer");
  const r = offlineReport([t], accounts, user, params());
  expect(r.totals[0].expense).toBe("0");
  expect(r.items[0].can_edit).toBe(false);
});
it("does not merge category labels containing separators", () => {
  const a = tx("a", "-10"),
    b = tx("b", "-20");
  a.legs[0].category = "x|y";
  a.legs[0].category_name = "z";
  b.legs[0].category = "x";
  b.legs[0].category_name = "y|z";
  expect(
    offlineReport([a, b], accounts, user, params()).categories,
  ).toHaveLength(2);
});
it("excludes missing exchange rates from display-currency totals", () => {
  const t = { ...tx("foreign", "-100"), currency: "JPY", scale: 0 };
  const r = offlineReport([t], accounts, user, params("display_currency=KRW"));
  expect(r.items).toHaveLength(1);
  expect(r.totals).toHaveLength(0);
});
