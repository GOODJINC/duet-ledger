import { useEffect, useState, type FormEvent } from "react";
import {
  api,
  post,
  download,
  setCSRF,
  formatMoney,
  toDecimal,
  toMinor,
  today,
  categories,
  categoryName,
  kindNames,
  currencyScales,
  type Category,
  type User,
  type Ledger,
  type Account,
  type Transaction,
  type Sharing,
  type Receipt,
} from "./api";
import { Modal, Icon, Privacy, ErrorText, Busy } from "./ui";
export type DialogProps = {
  selectedLedger?: string;
  user: User;
  accounts: Account[];
  ledgers: Ledger[];
  refresh: () => Promise<void>;
  close: () => void;
  notify: (text: string) => void;
};
function useTask() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "처리하지 못했어요.");
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run, setError };
}
export function EntryDialog(
  p: DialogProps & { transaction?: Transaction; accountId?: string },
) {
  const tx = p.transaction;
  const editable = p.accounts.filter(
    (a) =>
      !a.archived &&
      a.role !== "viewer" &&
      (!p.selectedLedger || a.ledger_id === p.selectedLedger),
  );
  const negative = tx?.legs.find((l) => BigInt(l.amount) < 0n);
  const first = negative || tx?.legs[0];
  const [kind, setKind] = useState(tx?.kind || "expense");
  const [accountId, setAccountId] = useState(
    first?.account_id ||
      (editable.some((a) => a.id === p.accountId) ? p.accountId : undefined) ||
      editable[0]?.id ||
      "",
  );
  const account = p.accounts.find((a) => a.id === accountId);
  const [target, setTarget] = useState(
    tx?.legs.find((l) => l.account_id !== accountId)?.account_id || "",
  );
  const [date, setDate] = useState(tx?.date || today(p.user.timezone));
  const [clock, setClock] = useState(
    tx?.time ||
      (tx
        ? ""
        : new Intl.DateTimeFormat("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
            timeZone: p.user.timezone,
          }).format(new Date())),
  );
  const categoryKind = kind === "income" ? "income" : "expense";
  const [choices, setChoices] = useState<Category[]>([]);
  const [categoryError, setCategoryError] = useState("");
  const [title, setTitle] = useState(first?.title || "");
  const [amount, setAmount] = useState(
    first
      ? toDecimal(
          kind === "adjustment"
            ? first.amount
            : BigInt(first.amount) < 0n
              ? (-BigInt(first.amount)).toString()
              : first.amount,
          tx!.scale,
        )
      : "",
  );
  const [category, setCategory] = useState(first?.category || "food");
  const [note, setNote] = useState(first?.note || "");
  const [targetNote, setTargetNote] = useState(
    tx?.legs.find((l) => l.account_id !== accountId)?.note || "",
  );
  const [file, setFile] = useState<File | null>(null);
  const [savedId, setSavedId] = useState("");
  const [requestKey] = useState(
    () =>
      crypto.randomUUID?.() ||
      Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
        b.toString(16).padStart(2, "0"),
      ).join(""),
  );
  const task = useTask();
  const targets = editable.filter(
    (a) =>
      a.id !== accountId &&
      a.currency === account?.currency &&
      a.scale === account?.scale,
  );
  useEffect(() => {
    if (!targets.some((a) => a.id === target)) setTarget(targets[0]?.id || "");
  }, [accountId]);
  useEffect(() => {
    if (!accountId) {
      setChoices([]);
      return;
    }
    let active = true;
    setCategoryError("");
    api<Category[]>(
      `/categories?account=${encodeURIComponent(accountId)}&kind=${categoryKind}`,
    )
      .then((list) => {
        if (!active) return;
        setChoices(list);
        setCategory((old) =>
          list.some((c) => c.code === old)
            ? old
            : tx && first?.category === old
              ? old
              : list[0]?.code || "",
        );
      })
      .catch((e) => {
        if (active) setCategoryError(e.message);
      });
    return () => {
      active = false;
    };
  }, [accountId, categoryKind]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    await task.run(async () => {
      if (!account || !editable.some((a) => a.id === accountId))
        throw new Error("선택한 가계부의 계좌를 선택해 주세요.");
      if (kind !== "transfer" && !category)
        throw new Error("분류를 먼저 설정해 주세요.");
      let id = savedId;
      if (!id) {
        const payload = {
          kind,
          date,
          time: clock,
          timezone: tx?.timezone || p.user.timezone,
          ledger_id: p.selectedLedger || "",
          amount: toMinor(amount, account.scale),
          account_id: accountId,
          to_id: kind === "transfer" ? target : "",
          title,
          category: kind === "transfer" ? "transfer" : category,
          note,
          target_note: kind === "transfer" ? targetNote : "",
          version: tx?.version || 0,
        };
        const result = await post<{ id: string }>(
          tx ? `/transactions/${tx.id}` : "/transactions",
          payload,
          tx ? "PUT" : "POST",
          { "Idempotency-Key": requestKey },
        );
        id = result.id;
        setSavedId(id);
        await p.refresh();
      }
      if (file) {
        const body = new FormData();
        body.append("file", file);
        await api(`/transactions/${id}/receipts`, { method: "POST", body });
        await p.refresh();
      }
      p.notify(tx ? "기록을 수정했어요." : "기록을 저장했어요.");
      p.close();
    });
  }
  return (
    <Modal
      title={tx ? "기록을 다듬어요." : "오늘의 기록을 남겨요."}
      subtitle="저장 전 계좌와 공개 대상을 확인해 주세요."
      onClose={p.close}
    >
      <form onSubmit={submit}>
        <fieldset disabled={task.busy || !!savedId} className="plain-fieldset">
          <div className="entry-types">
            {[
              ["expense", "지출"],
              ["income", "수입"],
              ["transfer", "이체"],
            ].map(([id, label]) => (
              <button
                type="button"
                key={id}
                aria-pressed={kind === id}
                onClick={() => {
                  setKind(id);
                  setCategory(id === "income" ? "salary" : "food");
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <label className="entry-amount-wrap">
            <span id="entry-currency">
              {account?.currency === "KRW" ? "₩" : account?.currency || "₩"}
            </span>
            <span className="visually-hidden">금액</span>
            <input
              aria-label="금액"
              aria-describedby="entry-currency"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0"
              required
              maxLength={25}
              autoFocus
            />
          </label>
          <div className="amount-suggestions">
            {(account?.currency === "KRW"
              ? [5000, 10000, 30000]
              : [5, 10, 25]
            ).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setAmount(String(n))}
              >
                {n.toLocaleString()}
                {account?.currency === "KRW"
                  ? "원"
                  : " " + (account?.currency || "")}
              </button>
            ))}
          </div>
          <label className="form-label" htmlFor="entry-title">
            내용
          </label>
          <input
            id="entry-title"
            className="field-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
            maxLength={100}
            placeholder={
              kind === "income"
                ? "예: 10월 월급"
                : kind === "transfer"
                  ? "예: 생활비 통장으로 이체"
                  : kind === "refund"
                    ? "예: 반품 환불"
                    : kind === "adjustment"
                      ? "예: 실제 통장 잔액 맞추기"
                      : "예: 점심 식사"
            }
          />
          <div className="form-two-cols">
            <div>
              <label className="form-label" htmlFor="entry-account">
                {kind === "transfer" ? "보내는 계좌" : "계좌"}
              </label>
              <select
                id="entry-account"
                className="field-select"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
                required
              >
                <option value="" disabled>
                  계좌 선택
                </option>
                {editable.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.shared ? "공유" : "개인"} · {a.currency}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label" htmlFor="entry-date">
                날짜
              </label>
              <input
                type="date"
                id="entry-date"
                className="field-input"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                min="1900-01-01"
                max="2100-12-31"
                required
              />
            </div>
          </div>
          <label className="form-label" htmlFor="entry-time">
            시간 · 선택
          </label>
          <input
            id="entry-time"
            type="time"
            className="field-input"
            value={clock}
            onChange={(e) => setClock(e.target.value)}
          />
          <p className="entry-hint">
            {tx?.timezone || p.user.timezone} 기준 · 기존에 시간이 없던 기록은
            비워 둘 수 있어요.
          </p>
          {kind === "transfer" ? (
            <>
              <label className="form-label" htmlFor="entry-target">
                받는 계좌 · 같은 통화
              </label>
              <select
                id="entry-target"
                className="field-select"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                required
              >
                <option value="" disabled>
                  받는 계좌 선택
                </option>
                {targets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.shared ? "공유" : "개인"}
                  </option>
                ))}
              </select>
              <p className="entry-hint">
                이체는 수입·지출에 포함되지 않아요. 두 계좌의 잔액이 함께
                바뀝니다.
                {p.selectedLedger &&
                  " 다른 가계부의 계좌로 이체하려면 모든 가계부 모아 보기로 전환해 주세요."}
              </p>
            </>
          ) : (
            <>
              <span className="form-label">
                {categoryKind === "income" ? "수입 분류" : "지출 분류"}
              </span>
              <div className="category-picker">
                {choices.map((c) => (
                  <button
                    type="button"
                    key={c.code}
                    className="category-choice"
                    aria-pressed={category === c.code}
                    onClick={() => setCategory(c.code)}
                  >
                    {c.name}
                  </button>
                ))}
                {tx &&
                  category &&
                  !choices.some((c) => c.code === category) && (
                    <button
                      type="button"
                      className="category-choice"
                      aria-pressed
                    >
                      {first?.category_name || categoryName(category)} · 기존
                      분류
                    </button>
                  )}
              </div>
              <p className="entry-hint">
                분류 추가·수정·삭제는 설정 → 가계부 분류 관리에서 할 수 있어요.
              </p>
              <ErrorText error={categoryError} />
            </>
          )}
          <label className="form-label" htmlFor="entry-note">
            {kind === "transfer" ? "보내는 계좌에 남길 메모" : "메모"} · 선택
          </label>
          <textarea
            id="entry-note"
            className="field-input"
            rows={2}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
          />
          {kind === "transfer" && (
            <>
              <label className="form-label" htmlFor="target-note">
                받는 계좌에 남길 메모 · 선택
              </label>
              <textarea
                id="target-note"
                className="field-input"
                rows={2}
                value={targetNote}
                onChange={(e) => setTargetNote(e.target.value)}
                maxLength={1000}
              />
            </>
          )}
          {account && (
            <div className="privacy-notice">
              <Icon name={account.shared ? "people" : "lock"} />
              <div>
                <strong>
                  {kind === "transfer"
                    ? "각 계좌를 볼 수 있는 사람에게 따로 표시돼요."
                    : account.shared
                      ? "공유된 계좌에 기록하고 있어요."
                      : "나에게만 보이는 기록이에요."}
                </strong>
                <p>
                  {kind === "transfer"
                    ? "각 계좌의 메모·영수증은 해당 계좌의 공개 범위를 따릅니다."
                    : account.shared
                      ? "거래 내용과 첨부 사진도 공유 대상에게 보입니다."
                      : "이 계좌의 이름·잔액·내역은 다른 사람에게 공개되지 않아요."}
                </p>
              </div>
            </div>
          )}
          <label className="form-label" htmlFor="entry-kind-more">
            환불·잔액 조정이 필요할 때
          </label>
          <select
            id="entry-kind-more"
            className="field-select"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
          >
            {Object.entries(kindNames).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
          <p className="entry-hint">
            환불: 반품 등 돌려받은 금액으로 지출에서 차감해요. 잔액 조정: 실제
            잔액과의 차이만 더하거나 빼며 수입·지출 통계에 넣지 않아요.
          </p>
          {kind === "adjustment" && (
            <p className="entry-hint">
              잔액에 더할 차액을 입력하세요. 줄이려면 음수를 사용합니다.
              수입·지출에서는 제외돼요.
            </p>
          )}
        </fieldset>
        {kind !== "transfer" && (
          <label className="receipt-button">
            <Icon name="camera" />
            {file ? file.name : "영수증 사진 첨부 · JPG/PNG 5MB 이하"}
            <input
              type="file"
              accept="image/jpeg,image/png"
              className="visually-hidden"
              disabled={task.busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f && f.size > 5 * 1024 * 1024) {
                  task.setError("사진은 5MB까지 첨부할 수 있어요.");
                  e.target.value = "";
                } else setFile(f || null);
              }}
            />
          </label>
        )}
        {savedId && task.error && (
          <div className="inline-warning">
            거래는 이미 저장됐어요. 사진 첨부만 다시 시도하거나 창을 닫아도
            됩니다.
          </div>
        )}
        <ErrorText error={task.error} />
        <button
          className="primary-button entry-submit"
          disabled={task.busy || !editable.length}
        >
          <Busy busy={task.busy}>
            {savedId
              ? "사진 첨부 다시 시도"
              : tx
                ? "수정 저장하기"
                : "기록 저장하기"}
          </Busy>
        </button>
      </form>
    </Modal>
  );
}
export function LedgerDialog(
  p: DialogProps & {
    select: (id: string) => void;
    selected: string;
    manage?: boolean;
  },
) {
  const [manage, setManage] = useState(!!p.manage);
  const [creating, setCreating] = useState(false);
  const [editId, setEditId] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState("personal");
  const [timezone, setTimezone] = useState(p.user.timezone);
  const [trash, setTrash] = useState<Ledger[]>([]);
  const task = useTask();
  const owned = p.ledgers.filter((l) => l.role === "owner");
  const editing = owned.find((l) => l.id === editId);
  async function loadTrash() {
    setTrash(await api<Ledger[]>("/ledgers?trash=true"));
  }
  function edit(l: Ledger) {
    setEditId(l.id);
    setName(l.name);
    setTimezone(l.timezone);
    setCreating(false);
  }
  return (
    <Modal
      title={manage ? "가계부 관리" : "가계부 선택"}
      subtitle={
        manage
          ? "이름·시간대 수정과 복구 가능한 삭제"
          : "이동할 가계부를 선택하세요."
      }
      onClose={p.close}
    >
      {!manage ? (
        <>
          <div className="ledger-options">
            <button
              className="profile-choice"
              onClick={() => {
                p.select("");
                p.close();
              }}
            >
              <Icon name="wallet" />
              <div>
                <strong>모든 가계부 모아 보기</strong>
                <p>내가 볼 수 있는 계좌를 한곳에</p>
              </div>
              {!p.selected && <Icon name="check" />}
            </button>
            {p.ledgers.map((l) => (
              <button
                className="profile-choice"
                key={l.id}
                onClick={() => {
                  p.select(l.id);
                  p.close();
                }}
              >
                <Icon name={l.kind === "personal" ? "lock" : "people"} />
                <div>
                  <strong>{l.name}</strong>
                  <p>{l.kind === "personal" ? "개인 가계부" : "공유 가계부"}</p>
                </div>
                {p.selected === l.id && <Icon name="check" />}
              </button>
            ))}
          </div>
          <button className="text-link" onClick={() => setManage(true)}>
            가계부 관리
          </button>
        </>
      ) : (
        <>
          <div className="ledger-manage-actions">
            <button
              className="secondary-button"
              onClick={() => {
                setCreating(true);
                setEditId("");
                setName("");
              }}
            >
              새 가계부 만들기
            </button>
            <button
              className="secondary-button"
              onClick={() => task.run(loadTrash)}
            >
              가계부 휴지통
            </button>
            <button className="text-link" onClick={() => setManage(false)}>
              선택 화면
            </button>
          </div>
          {owned.map((l) => (
            <div className="setting-row" key={l.id}>
              <div>
                <strong>{l.name}</strong>
                <p>
                  {l.kind === "personal" ? "개인" : "공유"} · {l.timezone}
                </p>
              </div>
              <button className="secondary-button" onClick={() => edit(l)}>
                수정·삭제
              </button>
            </div>
          ))}
          {(creating || editing) && (
            <form
              className="subform"
              onSubmit={(e) => {
                e.preventDefault();
                task.run(async () => {
                  if (editing) {
                    await post(
                      `/ledgers/${editing.id}`,
                      { name, timezone },
                      "PATCH",
                    );
                  } else {
                    await post("/ledgers", { name, kind, timezone });
                  }
                  await p.refresh();
                  setCreating(false);
                  setEditId("");
                  p.notify(
                    editing ? "가계부를 수정했어요." : "가계부를 만들었어요.",
                  );
                });
              }}
            >
              <h3>{editing ? "가계부 수정" : "새 가계부 만들기"}</h3>
              <label className="form-label" htmlFor="ledger-name">
                가계부 이름
              </label>
              <input
                id="ledger-name"
                className="field-input"
                required
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              {!editing && (
                <>
                  <label className="form-label" htmlFor="ledger-kind">
                    사용 방식
                  </label>
                  <select
                    id="ledger-kind"
                    className="field-select"
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                  >
                    <option value="personal">개인</option>
                    <option value="shared">공유 · 초대한 사람과 함께</option>
                  </select>
                </>
              )}
              <label className="form-label" htmlFor="ledger-timezone">
                시간대
              </label>
              <input
                id="ledger-timezone"
                className="field-input"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                required
              />
              <button
                className="primary-button entry-submit"
                disabled={task.busy}
              >
                {editing ? "수정 저장" : "가계부 만들기"}
              </button>
              {editing && (
                <button
                  type="button"
                  className="secondary-button danger-text"
                  disabled={task.busy}
                  onClick={() =>
                    task.run(async () => {
                      const answer = prompt(
                        `가계부와 모든 계좌·내역을 휴지통으로 옮기고 공유 접근을 중단합니다. 복구할 수 있어요. 계속하려면 가계부 이름 '${editing.name}'을 입력해 주세요.`,
                      );
                      if (answer === null) return;
                      await post(
                        `/ledgers/${editing.id}`,
                        { confirm_name: answer },
                        "DELETE",
                      );
                      if (p.selected === editing.id) p.select("");
                      setEditId("");
                      await p.refresh();
                      await loadTrash();
                      p.notify("가계부를 휴지통으로 옮겼어요.");
                    })
                  }
                >
                  가계부 삭제
                </button>
              )}
            </form>
          )}
          {trash.map((l) => (
            <div className="setting-row" key={l.id}>
              <strong>{l.name}</strong>
              <button
                className="secondary-button"
                onClick={() =>
                  task.run(async () => {
                    if (
                      !confirm(
                        "계좌·내역과 기존 공유 접근 권한도 다시 활성화됩니다. 복구할까요?",
                      )
                    )
                      return;
                    await post(`/ledgers/${l.id}/restore`);
                    await p.refresh();
                    await loadTrash();
                    p.notify("가계부를 복구했어요.");
                  })
                }
              >
                복구
              </button>
            </div>
          ))}
        </>
      )}
      <ErrorText error={task.error} />
    </Modal>
  );
}
export function AccountDialog(
  p: DialogProps & {
    account?: Account;
    entry: (id: string) => void;
    showLedger: (id: string) => void;
  },
) {
  const ac = p.account;
  const [editing, setEditing] = useState(!ac);
  const [name, setName] = useState(ac?.name || "");
  const [ledger, setLedger] = useState(
    (p.selectedLedger
      ? p.ledgers.find((l) => l.id === p.selectedLedger && l.role === "owner")
          ?.id
      : p.ledgers.find((l) => l.role === "owner")?.id) || "",
  );
  const [kind, setKind] = useState(ac?.kind || "bank");
  const [currency, setCurrency] = useState(ac?.currency || "KRW");
  const [opening, setOpening] = useState("0");
  const [archived, setArchived] = useState(ac?.archived || false);
  const task = useTask();
  return (
    <Modal
      title={ac ? ac.name : "첫 계좌부터, 가볍게."}
      subtitle={
        ac
          ? "계좌 설정과 공개 범위를 확인하세요."
          : "은행 연결 없이 직접 관리하는 통장·현금·카드를 등록해요."
      }
      onClose={p.close}
    >
      {ac && !editing ? (
        <>
          <div className="detail-hero">
            <span className="bank-icon green">
              <Icon name={ac.kind === "card" ? "card" : "wallet"} />
            </span>
            <div>
              <p className="panel-subtitle">
                기록 기준 잔액
                {ac.kind === "card" || ac.kind === "loan"
                  ? " · 부채는 음수"
                  : ""}
              </p>
              <strong>{formatMoney(ac.balance, ac.scale, ac.currency)}</strong>
            </div>
          </div>
          <div className="detail-line">
            <span>가계부</span>
            <strong>{ac.ledger_name}</strong>
          </div>
          <div className="detail-line">
            <span>공개 범위</span>
            <Privacy shared={ac.shared} />
          </div>
          <div className="detail-line">
            <span>관리 책임자</span>
            <strong>{ac.owner_name}</strong>
          </div>
          <div className="detail-line">
            <span>상태</span>
            <strong>{ac.archived ? "보관 중" : "사용 중"}</strong>
          </div>
          <div className="account-detail-actions">
            <button
              className="secondary-button"
              onClick={() => {
                p.showLedger(ac.id);
                p.close();
              }}
            >
              내역 보기
            </button>
            {ac.role !== "viewer" && !ac.archived && (
              <button className="primary-button" onClick={() => p.entry(ac.id)}>
                기록 추가
              </button>
            )}
          </div>
          {ac.role === "owner" && (
            <button
              className="text-link"
              style={{ marginTop: 20 }}
              onClick={() => setEditing(true)}
            >
              계좌 이름·보관 설정 <Icon name="arrow" />
            </button>
          )}
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            task.run(async () => {
              if (ac)
                await post(
                  `/accounts/${ac.id}`,
                  { name, archived, version: ac.version },
                  "PATCH",
                );
              else
                await post("/accounts", {
                  ledger_id: ledger,
                  name,
                  kind,
                  currency,
                  scale: currencyScales[currency],
                  opening: toMinor(opening, currencyScales[currency]),
                });
              await p.refresh();
              p.notify(ac ? "계좌 설정을 바꿨어요." : "계좌를 만들었어요.");
              p.close();
            });
          }}
        >
          <label className="form-label" htmlFor="account-name">
            계좌 이름
          </label>
          <input
            id="account-name"
            className="field-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={60}
          />
          {!ac && (
            <>
              <label className="form-label" htmlFor="account-ledger">
                등록할 가계부
              </label>
              <select
                id="account-ledger"
                className="field-select"
                value={ledger}
                onChange={(e) => setLedger(e.target.value)}
                required
              >
                {p.ledgers
                  .filter(
                    (l) =>
                      l.role === "owner" &&
                      (!p.selectedLedger || l.id === p.selectedLedger),
                  )
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name} · {l.kind === "shared" ? "공유" : "개인"}
                    </option>
                  ))}
              </select>
              <div className="form-two-cols">
                <div>
                  <label className="form-label" htmlFor="account-kind">
                    계좌 종류
                  </label>
                  <select
                    id="account-kind"
                    className="field-select"
                    value={kind}
                    onChange={(e) => setKind(e.target.value as Account["kind"])}
                  >
                    <option value="bank">예금·체크카드</option>
                    <option value="cash">현금</option>
                    <option value="card">신용카드</option>
                    <option value="loan">대출</option>
                  </select>
                </div>
                <div>
                  <label className="form-label" htmlFor="account-currency">
                    통화
                  </label>
                  <select
                    id="account-currency"
                    className="field-select"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                  >
                    {Object.keys(currencyScales).map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>
              <label className="form-label" htmlFor="account-opening">
                시작 잔액
              </label>
              <input
                id="account-opening"
                className="field-input"
                inputMode="decimal"
                value={opening}
                onChange={(e) => setOpening(e.target.value)}
                required
              />
              <p className="entry-hint">
                신용카드 미결제액·대출 잔액은 음수로 입력해요. 시작 잔액은
                수입으로 잡지 않아요.
              </p>
              <div className="privacy-notice">
                <Icon
                  name={
                    p.ledgers.find((l) => l.id === ledger)?.kind === "shared"
                      ? "people"
                      : "lock"
                  }
                />
                <div>
                  <strong>
                    {p.ledgers.find((l) => l.id === ledger)?.kind === "shared"
                      ? "이 가계부의 모든 멤버에게 공개됩니다."
                      : "처음에는 나만 볼 수 있어요."}
                  </strong>
                  <p>개인 가계부의 특정 계좌만 나중에 공유할 수도 있어요.</p>
                </div>
              </div>
            </>
          )}
          {ac && (
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={archived}
                onChange={(e) => setArchived(e.target.checked)}
              />
              계좌 보관 · 기존 기록은 유지
            </label>
          )}
          <ErrorText error={task.error} />
          <button className="primary-button entry-submit" disabled={task.busy}>
            <Busy busy={task.busy}>{ac ? "설정 저장" : "계좌 만들기"}</Busy>
          </button>
        </form>
      )}
    </Modal>
  );
}
export function DetailDialog(
  p: DialogProps & { transaction: Transaction; edit: () => void },
) {
  const t = p.transaction;
  const [refs, setRefs] = useState<Record<string, Receipt[]>>(() =>
    Object.fromEntries(t.legs.map((l) => [l.id, l.receipts])),
  );
  const task = useTask();
  async function toggle() {
    await task.run(async () => {
      await post(`/transactions/${t.id}/${t.deleted ? "restore" : "trash"}`, {
        version: t.version,
      });
      await p.refresh();
      p.notify(
        t.deleted ? "기록을 복구했어요." : "기록을 휴지통으로 옮겼어요.",
      );
      p.close();
    });
  }
  return (
    <Modal
      title="기록 자세히 보기"
      subtitle={`${t.date}${t.time ? " " + t.time : ""} · ${kindNames[t.kind] || t.kind} · ${t.creator}`}
      onClose={p.close}
    >
      {t.legs.map((l) => {
        const ac = p.accounts.find((a) => a.id === l.account_id)!;
        return (
          <section className="leg-detail" key={l.id}>
            <div className="detail-hero">
              <span className={"category-icon category-" + l.category}>
                <Icon
                  name={
                    l.category === "food"
                      ? "food"
                      : t.kind === "transfer"
                        ? "transfer"
                        : "wallet"
                  }
                />
              </span>
              <div>
                <h3>{l.title}</h3>
                <strong>
                  {BigInt(l.amount) > 0n ? "+" : ""}
                  {formatMoney(l.amount, t.scale, t.currency)}
                </strong>
              </div>
            </div>
            <div className="detail-line">
              <span>계좌</span>
              <strong>{ac?.name || "계좌"}</strong>
            </div>
            <div className="detail-line">
              <span>분류</span>
              <strong>{l.category_name || categoryName(l.category)}</strong>
            </div>
            <div className="detail-line">
              <span>공개 범위</span>
              <Privacy shared={ac?.shared || false} />
            </div>
            {l.note && (
              <div className="detail-line">
                <span>메모</span>
                <strong className="wrap-text">{l.note}</strong>
              </div>
            )}
            {!t.deleted && (
              <div className="receipt-gallery">
                {(refs[l.id] || []).map((ref) => (
                  <div key={ref.id}>
                    <a
                      href={`/api/receipts/${ref.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img src={`/api/receipts/${ref.id}`} alt="첨부 영수증" />
                    </a>
                    {!!ac && ac.role !== "viewer" && (
                      <button
                        className="text-link"
                        disabled={task.busy}
                        onClick={() =>
                          task.run(async () => {
                            await api(`/receipts/${ref.id}`, {
                              method: "DELETE",
                            });
                            setRefs({
                              ...refs,
                              [l.id]: refs[l.id].filter((r) => r.id !== ref.id),
                            });
                            await p.refresh();
                          })
                        }
                      >
                        첨부 해제
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {!t.deleted && !!ac && ac.role !== "viewer" && (
              <label className="receipt-button">
                <Icon name="camera" />이 계좌에 영수증 첨부
                <input
                  className="visually-hidden"
                  type="file"
                  accept="image/png,image/jpeg"
                  disabled={task.busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    task.run(async () => {
                      const body = new FormData();
                      body.append("file", f);
                      const ref = await api<Receipt>(
                        `/transactions/${l.id}/receipts`,
                        { method: "POST", body },
                      );
                      setRefs({
                        ...refs,
                        [l.id]: [...(refs[l.id] || []), ref],
                      });
                      await p.refresh();
                    });
                  }}
                />
              </label>
            )}
          </section>
        );
      })}
      {t.kind === "transfer" && t.legs.length === 1 && (
        <div className="modal-note">
          상대 계좌는 비공개이거나 현재 조회 범위 밖에 있어요. 이체는 수입·지출
          통계에서 제외합니다.
        </div>
      )}
      <ErrorText error={task.error} />
      {t.can_edit ? (
        <div className="account-detail-actions">
          {!t.deleted && !(t.kind === "transfer" && t.legs.length !== 2) && (
            <button className="secondary-button" onClick={p.edit}>
              수정하기
            </button>
          )}
          <button
            className="secondary-button"
            disabled={task.busy}
            onClick={toggle}
          >
            <Icon name={t.deleted ? "restore" : "trash"} />
            {t.deleted ? "복구하기" : "휴지통으로"}
          </button>
        </div>
      ) : (
        <div className="modal-note">
          이 기록 전체를 수정할 권한이 없어요. 이체의 금액 수정·삭제에는 양쪽
          계좌의 편집 권한이 필요합니다.
        </div>
      )}
    </Modal>
  );
}
