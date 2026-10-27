import { msg } from "./i18n";
import {
  formatMoney,
  categories,
  displayCategory,
  type Report,
  type Account,
} from "./api";
import { Empty, Icon } from "./ui";

export function SummaryCards({
  balance,
  accountCount,
  totals,
  currency,
  scale,
}: {
  balance: bigint;
  accountCount: number;
  totals: Report["totals"][number] | undefined;
  currency: string;
  scale: number;
}) {
  return (
    <section className="summary-grid">
      <article className="summary-card total">
        <div className="card-topline">
          <span>{msg("기록 기준 순자산")}</span>
          <span className="summary-icon">
            <Icon name="wallet" />
          </span>
        </div>
        <div className="amount">
          <span className="won">{currency === "KRW" ? "₩" : currency}</span>
          {formatMoney(balance, scale, currency, false)}
        </div>
        <p className="card-footnote">
          <Icon name="check" />
          {accountCount}
          {msg("개 계좌 · 카드·대출 부채 포함")}
        </p>
        <div className="summary-decoration" />
      </article>
      <article className="summary-card income">
        <div className="card-topline">
          <span>{msg("이번 달 수입")}</span>
          <span className="summary-icon">
            <Icon name="in" />
          </span>
        </div>
        <div className="amount">
          <span className="won">{currency === "KRW" ? "₩" : currency}</span>
          {formatMoney(totals?.income || "0", scale, currency, false)}
        </div>
        <p className="card-footnote">{msg("선택한 조회 범위의 수입")}</p>
      </article>
      <article className="summary-card expense">
        <div className="card-topline">
          <span>{msg("이번 달 지출")}</span>
          <span className="summary-icon">
            <Icon name="up" />
          </span>
        </div>
        <div className="amount">
          <span className="won">{currency === "KRW" ? "₩" : currency}</span>
          {formatMoney(totals?.expense || "0", scale, currency, false)}
        </div>
        <p className="card-footnote">{msg("이체·잔액 조정 제외, 환불 차감")}</p>
      </article>
    </section>
  );
}
export function AccountsOverview({
  accounts,
  onMore,
  openAccount,
}: {
  accounts: Account[];
  onMore: () => void;
  openAccount: (account?: Account) => void;
}) {
  return (
    <section className="panel panel-pad">
      <div className="panel-heading">
        <h2>
          {msg("내 계좌")}{" "}
          <span className="subtle-count">{accounts.length}</span>
        </h2>
        <button className="text-link" onClick={onMore}>
          {msg("전체")} <Icon name="arrow" />
        </button>
      </div>
      {accounts.slice(0, 4).map((a) => (
        <button
          className="account-mini"
          key={a.id}
          onClick={() => openAccount(a)}
        >
          <span className={"bank-icon " + (a.shared ? "green" : "blue")}>
            <Icon name={a.kind === "card" ? "card" : "wallet"} />
          </span>
          <span>
            <span className="account-mini-title">{a.name}</span>
            <small>
              {a.shared ? msg("함께 보기") : msg("나만 보기")}
              {a.archived ? msg(" · 보관") : ""}
            </small>
          </span>
          <span className="account-mini-amount">
            {formatMoney(a.balance, a.scale, a.currency, false)}
            <small>{a.currency === "KRW" ? msg("원") : a.currency}</small>
          </span>
        </button>
      ))}
      {!accounts.length && (
        <Empty
          title={msg("아직 계좌가 없어요.")}
          description={msg("통장·현금·카드를 등록해보세요.")}
        >
          <button className="secondary-button" onClick={() => openAccount()}>
            {msg("계좌 만들기")}
          </button>
        </Empty>
      )}
      <p className="account-list-note">
        <Icon name="shield" />
        {msg("공유한 계좌만 함께 볼 수 있어요")}
      </p>
    </section>
  );
}
export function SharedLedgerNote({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="shared-note">
      <div className="leaf-decoration">
        <Icon name="leaf" />
      </div>
      <h3>{msg("함께 쓰고, 따로 지켜요.")}</h3>
      <p>
        {msg("생활비는 함께 보고,")}
        <br />
        {msg("개인 기록은 나만 볼 수 있도록.")}
      </p>
      <button className="text-link" onClick={onOpen}>
        {msg("공유 관리")} <Icon name="arrow" />
      </button>
    </section>
  );
}
function buildFlowChart(
  daily: Report["daily"],
  date: string,
  currency: string,
) {
  const days = new Date(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)),
    0,
  ).getDate();
  let cumulative = 0;
  const values = Array.from({ length: days }, (_, i) => {
    const day = `${date.slice(0, 7)}-${String(i + 1).padStart(2, "0")}`;
    cumulative += Number(
      daily.find((d) => d.currency === currency && d.date === day)?.expense ||
        0,
    );
    return cumulative;
  });
  const max = Math.max(1, ...values),
    min = Math.min(0, ...values);
  const x = (i: number) => 42 + (i / Math.max(1, days - 1)) * 454;
  const y = (v: number) => 140 - ((v - min) / (max - min || 1)) * 110;
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  return { days, max, min, x, y, points };
}

export function FlowPanel({
  report,
  currency,
  scale,
  date,
  onMore,
}: {
  report: Report;
  currency: string;
  scale: number;
  date: string;
  onMore?: () => void;
}) {
  const total =
    report.totals.find((t) => t.currency === currency)?.expense || "0";
  const { days, max, min, x, y, points } = buildFlowChart(
    report.daily,
    date,
    currency,
  );
  return (
    <section className="panel panel-pad">
      <div className="panel-heading">
        <div>
          <h2>{msg("이번 달의 소비 흐름")}</h2>
          <p className="panel-subtitle">{msg("하루하루 모인 우리의 기록")}</p>
        </div>
        {onMore && (
          <button className="text-link" onClick={onMore}>
            {msg("자세히")}
            <Icon name="arrow" />
          </button>
        )}
      </div>
      <div className="chart-title-row">
        <div>
          <span className="panel-title-small">{msg("누적 순지출")}</span>
          <p className="chart-total">{formatMoney(total, scale, currency)}</p>
        </div>
        <span className="chart-key">{msg("선택한 계좌")}</span>
      </div>
      <div className="line-chart">
        <svg
          viewBox="0 0 520 173"
          role="img"
          aria-label={msg("이번 달 지출 {0}", [
            formatMoney(total, scale, currency),
          ])}
        >
          <path
            className="chart-gridline"
            d="M42 30H500M42 85H500M42 140H500"
          />
          <text x="0" y="33" className="chart-axis">
            {formatMoney(BigInt(Math.round(max)), scale, currency, false)}
          </text>
          <text x="10" y="143" className="chart-axis">
            {formatMoney(BigInt(Math.round(min)), scale, currency, false)}
          </text>
          <polygon
            points={`${x(0)},${y(0)} ${points} ${x(days - 1)},${y(0)}`}
            fill="#a6bf8c"
            opacity=".12"
          />
          <polyline
            points={points}
            stroke="#86a56e"
            strokeWidth="2.5"
            fill="none"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {[1, 7, 14, 21, days]
            .filter((v, i, a) => v <= days && a.indexOf(v) === i)
            .map((d) => (
              <text
                key={d}
                x={x(d - 1)}
                y="165"
                textAnchor="middle"
                className="chart-axis"
              >
                {d}
                {msg("일")}
              </text>
            ))}
        </svg>
      </div>
      <div className="chart-note">
        <span>
          <Icon name="info" />
          {msg("이체 제외 · 환불은 발생일에 차감")}
        </span>
        <span>
          {report.count}
          {msg("건의 기록")}
        </span>
      </div>
    </section>
  );
}
export function DonutPanel({
  report,
  currency,
  scale,
}: {
  report: Report;
  currency: string;
  scale: number;
}) {
  const data = report.categories.filter((c) => c.currency === currency);
  const positive = data.filter((c) => BigInt(c.amount) > 0n);
  const sum = positive.reduce((s, c) => s + Number(c.amount), 0);
  let offset = 0;
  return (
    <section className="panel panel-pad donut-panel">
      <div className="panel-heading">
        <div>
          <h2>{msg("어디에 썼을까요?")}</h2>
          <p className="panel-subtitle">
            {msg("분류별 순지출 비중 · 양수 항목")}
          </p>
        </div>
      </div>
      <div className="donut-layout">
        <div className="donut-content">
          <svg
            viewBox="0 0 136 136"
            role="img"
            aria-label={
              positive
                .map(
                  (c) =>
                    `${displayCategory(c.category, c.name)} ${Math.round((Number(c.amount) / (sum || 1)) * 100)}%`,
                )
                .join(", ") || msg("아직 지출 없음")
            }
          >
            <circle
              cx="68"
              cy="68"
              r="54"
              stroke="var(--mint-soft)"
              strokeWidth="11"
              fill="none"
            />
            {positive.map((c) => {
              const ratio = (Number(c.amount) / (sum || 1)) * 100;
              const previous = offset;
              offset += ratio;
              return (
                <circle
                  key={c.category + ":" + c.name}
                  cx="68"
                  cy="68"
                  r="54"
                  fill="none"
                  stroke={
                    categories.find((v) => v.id === c.category)?.color ||
                    "#b3c4a7"
                  }
                  strokeWidth="11"
                  pathLength="100"
                  strokeDasharray={`${Math.max(0, ratio - 1.7)} ${100 - Math.max(0, ratio - 1.7)}`}
                  strokeDashoffset={-previous}
                />
              );
            })}
          </svg>
          <div className="donut-center">
            <small>{msg("가장 많이 쓴 곳")}</small>
            <strong>
              {positive[0]
                ? displayCategory(positive[0].category, positive[0].name)
                : msg("기록 없음")}
            </strong>
          </div>
        </div>
        <div className="category-legend">
          {data.slice(0, 4).map((c) => (
            <div className="legend-row" key={c.category + ":" + c.name}>
              <span
                className="legend-dot"
                style={{
                  background:
                    categories.find((v) => v.id === c.category)?.color ||
                    "#b3c4a7",
                }}
              />
              <span>{displayCategory(c.category, c.name)}</span>
              <strong>{formatMoney(c.amount, scale, currency, false)}</strong>
            </div>
          ))}
          {!data.length && (
            <p className="panel-subtitle">{msg("첫 지출을 남겨보세요.")}</p>
          )}
        </div>
      </div>
    </section>
  );
}
