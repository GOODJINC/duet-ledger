import { Fragment, type ReactNode } from "react";
import { msg, weekdays } from "./i18n";
import {
  formatMoney,
  currencyScales,
  displayCategory,
  type Account,
  type Transaction,
  type Report,
} from "./api";
import { Empty, Icon, Privacy } from "./ui";

export function TransactionTableHeader() {
  return (
    <div className="transaction-header">
      <span>{msg("내용·분류")}</span>
      <span>{msg("계좌")}</span>
      <span>{msg("공개 범위")}</span>
      <span>{msg("금액")}</span>
    </div>
  );
}
export function TransactionRows({
  items,
  accounts,
  open,
}: {
  items: Transaction[];
  accounts: Account[];
  open: (t: Transaction) => void;
}) {
  if (!items.length)
    return (
      <Empty
        title={msg("아직 기록이 없어요.")}
        description={msg("다른 범위를 선택하거나 첫 기록을 남겨보세요.")}
      />
    );
  let previousDate = "";
  return (
    <>
      {items.map((transaction) => {
        const showDate = transaction.date !== previousDate;
        previousDate = transaction.date;
        return (
          <Fragment key={transaction.id}>
            {showDate && (
              <div className="transaction-day-heading">
                <strong>{transaction.date}</strong>
              </div>
            )}
            <TransactionRow
              transaction={transaction}
              accounts={accounts}
              onOpen={open}
            />
          </Fragment>
        );
      })}
    </>
  );
}

function TransactionRow({
  transaction,
  accounts,
  onOpen,
}: {
  transaction: Transaction;
  accounts: Account[];
  onOpen: (transaction: Transaction) => void;
}) {
  const firstLeg = transaction.legs[0];
  const transactionAccounts = transaction.legs.map((l) =>
    accounts.find((a) => a.id === l.account_id),
  );
  const partiallyShared =
    transactionAccounts.some((a) => a?.shared) &&
    transactionAccounts.some((a) => !a?.shared);
  const displayAmount = firstLeg.display_amount ?? firstLeg.amount;
  const displayCurrency = transaction.display_currency || transaction.currency;
  const displayScale = transaction.display_currency
    ? currencyScales[transaction.display_currency]
    : transaction.scale;
  const formattedAmount =
    transaction.kind === "transfer" && transaction.legs.length === 2
      ? formatMoney(
          BigInt(displayAmount) < 0n
            ? -BigInt(displayAmount)
            : BigInt(displayAmount),
          displayScale,
          displayCurrency,
        )
      : `${BigInt(displayAmount) > 0n ? "+" : ""}${formatMoney(displayAmount, displayScale, displayCurrency)}`;
  return (
    <button className="transaction-row" onClick={() => onOpen(transaction)}>
      <span className="transaction-main">
        <span className={"category-icon category-" + firstLeg.category}>
          <Icon
            name={
              transaction.kind === "transfer"
                ? "transfer"
                : firstLeg.category === "food"
                  ? "food"
                  : firstLeg.category === "coffee"
                    ? "coffee"
                    : "wallet"
            }
          />
        </span>
        <span className="transaction-text">
          <span className="transaction-title">{firstLeg.title}</span>
          <span className="transaction-meta">
            {displayCategory(firstLeg.category, firstLeg.category_name)} ·{" "}
            {transaction.creator}
            {transaction.time ? " · " + transaction.time : ""}
            {transaction.legs.some((l) => l.receipts.length > 0) && (
              <Icon name="camera" />
            )}
          </span>
        </span>
      </span>
      <span className="transaction-account">
        {transactionAccounts.map((a) => a?.name || msg("계좌")).join(" → ")}
      </span>
      {partiallyShared ? (
        <span className="privacy-badge shared">
          <Icon name="people" />
          {msg("일부만 공유")}
        </span>
      ) : (
        <Privacy shared={transactionAccounts.some((a) => a?.shared)} />
      )}
      <span
        className={
          "transaction-amount " +
          (transaction.kind === "transfer"
            ? "transfer"
            : BigInt(firstLeg.amount) > 0n
              ? "positive"
              : "negative")
        }
      >
        {transaction.kind === "transfer" && transaction.legs.length === 2
          ? "↔ "
          : ""}
        {formattedAmount}
        {(transaction.original_currency ||
          transaction.currency !== displayCurrency) && (
          <small className="original-money">
            {transaction.original_currency
              ? formatMoney(
                  transaction.original_amount || "0",
                  currencyScales[transaction.original_currency],
                  transaction.original_currency,
                )
              : formatMoney(
                  firstLeg.amount,
                  transaction.scale,
                  transaction.currency,
                )}
          </small>
        )}
      </span>
    </button>
  );
}

export function CalendarView({
  date,
  report,
  currency,
  scale,
  selected,
  select,
  children,
}: {
  date: string;
  report: Report;
  currency: string;
  scale: number;
  selected: string;
  select: (v: string) => void;
  children: ReactNode;
}) {
  const y = Number(date.slice(0, 4)),
    m = Number(date.slice(5, 7));
  const first = new Date(y, m - 1, 1).getDay(),
    last = new Date(y, m, 0).getDate();
  return (
    <section className="panel">
      <div className="calendar-grid">
        {weekdays().map((d) => (
          <div className="calendar-weekday" key={d}>
            {d}
          </div>
        ))}
        {Array.from({ length: Math.ceil((first + last) / 7) * 7 }, (_, i) => {
          const d = i - first + 1;
          if (d < 1 || d > last)
            return <div className="calendar-day outside" key={i} />;
          const day = `${date.slice(0, 7)}-${String(d).padStart(2, "0")}`;
          const total = report.daily.find(
            (t) => t.currency === currency && t.date === day,
          );
          return (
            <button
              key={i}
              className={"calendar-day " + (day === selected ? "selected" : "")}
              onClick={() => select(day === selected ? "" : day)}
              aria-label={msg("{0} 기록 보기", [day])}
            >
              <span className="calendar-date">{d}</span>
              {total && BigInt(total.income) !== 0n && (
                <span className="calendar-income">
                  +{formatMoney(total.income, scale, currency, false)}
                </span>
              )}
              {total && BigInt(total.expense) !== 0n && (
                <span className="calendar-expense">
                  −{formatMoney(total.expense, scale, currency, false)}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {children}
    </section>
  );
}
