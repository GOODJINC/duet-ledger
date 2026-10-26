import { EntryShortcuts } from "./entry-shortcuts";
import { useTask } from "./use-task";
import { msg, monthName, intlLocale } from "./i18n";
import {
  exchangeFactor,
  factorDecimal,
  convertMinor,
  rateFraction,
} from "./exchange";
import { useEffect, useState, type FormEvent } from "react";
import {
  api,
  post,
  download,
  formatMoney,
  toDecimal,
  toMinor,
  today,
  displayCategory,
  kindNames,
  currencyScales,
  type EntryPresetInput,
  type Category,
  type User,
  type Ledger,
  type Account,
  type Transaction,
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
  categoryVersion?: number;
  manageCategories?: (ledgerId?: string) => void;
};

export function EntryDialog(
  p: DialogProps & { transaction?: Transaction; accountId?: string },
) {
  function chooseReceipt(e: import("react").ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024)
      task.setError(msg("사진은 5MB까지 첨부할 수 있어요."));
    else if (
      !["image/jpeg", "image/png"].includes(f.type) &&
      !(f.type === "" && /\.(jpe?g|png)$/i.test(f.name))
    )
      task.setError(
        msg(
          "JPG 또는 PNG 사진을 선택해 주세요. HEIC·다른 형식은 먼저 변환해 주세요.",
        ),
      );
    else {
      task.setError("");
      setFile(f);
    }
    e.target.value = "";
  }
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
  const [mobileTime, setMobileTime] = useState(
    () => !!window.matchMedia?.("(pointer: coarse)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia?.("(pointer: coarse)");
    if (!media) return;
    const change = () => setMobileTime(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  const [removedPhotos, setRemovedPhotos] = useState<string[]>([]);
  const [photoTarget, setPhotoTarget] = useState(firstPhotoTarget());
  function firstPhotoTarget() {
    return tx?.legs[0]?.account_id || "";
  }

  const [accountId, setAccountId] = useState(
    first?.account_id ||
      (editable.some((a) => a.id === p.accountId) ? p.accountId : undefined) ||
      editable.find((a) => a.id === p.user.default_account_id)?.id ||
      editable.find((a) => a.currency === (p.user.default_currency || "KRW"))
        ?.id ||
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
    tx?.original_currency && tx.original_amount
      ? toDecimal(tx.original_amount, currencyScales[tx.original_currency])
      : first
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
  const [inputCurrency, setInputCurrency] = useState(
    tx?.original_currency ||
      tx?.currency ||
      p.user.default_currency ||
      account?.currency ||
      "KRW",
  );
  const [rate, setRate] = useState(tx?.exchange_rate || "");
  const foreign =
    kind !== "transfer" && !!account && inputCurrency !== account.currency;
  useEffect(() => {
    if (kind === "transfer") {
      setInputCurrency(account?.currency || "KRW");
      return;
    }
    if (
      tx?.original_currency === inputCurrency &&
      accountId === first?.account_id
    ) {
      setRate(tx.exchange_rate || "");
      return;
    }
    const factor = exchangeFactor(
      p.user.exchange_rates || [],
      inputCurrency,
      account?.currency || "KRW",
      p.user.default_currency || "KRW",
    );
    setRate(factor ? factorDecimal(factor) : "");
  }, [inputCurrency, accountId, kind, JSON.stringify(p.user.exchange_rates)]);
  let converted = "";
  try {
    const f = rateFraction(rate);
    if (f && account)
      converted = convertMinor(
        toMinor(
          amount,
          inputCurrency === account.currency
            ? account.scale
            : currencyScales[inputCurrency],
        ),
        inputCurrency,
        account.currency,
        f,
      );
  } catch {}
  const [presetRevision, setPresetRevision] = useState(0);
  const [category, setCategory] = useState(first?.category || "food");
  const [note, setNote] = useState(first?.note || "");
  const [targetNote, setTargetNote] = useState(
    tx?.legs.find((l) => l.account_id !== accountId)?.note || "",
  );
  const [file, setFile] = useState<File | null>(null);
  const [savedId, setSavedId] = useState("");
  const [savedPhotoId, setSavedPhotoId] = useState("");
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
    if (photoTarget !== accountId && photoTarget !== target)
      setPhotoTarget(accountId);
  }, [accountId, target, photoTarget]);
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
              : presetRevision > 0
                ? ""
                : list[0]?.code || "",
        );
      })
      .catch((e) => {
        if (active) setCategoryError(e.message);
      });
    return () => {
      active = false;
    };
  }, [accountId, categoryKind, p.categoryVersion, presetRevision]);
  function buildInput() {
    if (!account || !editable.some((a) => a.id === accountId))
      throw new Error(msg("선택한 가계부의 계좌를 선택해 주세요."));
    if (kind !== "transfer" && !category)
      throw new Error(msg("분류를 먼저 설정해 주세요."));
    return {
      kind,
      date,
      time: clock,
      timezone: tx?.timezone || p.user.timezone,
      ledger_id: p.selectedLedger || "",
      amount: foreign ? converted || "" : toMinor(amount, account.scale),
      ...(foreign
        ? {
            original_currency: inputCurrency,
            original_amount: toMinor(amount, currencyScales[inputCurrency]),
            exchange_rate: rate,
          }
        : {}),
      account_id: accountId,
      to_id: kind === "transfer" ? target : "",
      title,
      category: kind === "transfer" ? "transfer" : category,
      note,
      target_note: kind === "transfer" ? targetNote : "",
      version: tx?.version || 0,
    };
  }
  function applyPreset(input: EntryPresetInput) {
    const source = editable.find((a) => a.id === input.account_id);
    const destination =
      input.kind === "transfer"
        ? editable.find((a) => a.id === input.to_id)
        : undefined;
    if (!source || (input.kind === "transfer" && !destination)) {
      task.setError(msg("이 입력에 필요한 계좌 권한을 다시 확인해 주세요."));
      return false;
    }
    if (
      (title || amount || note || targetNote || file) &&
      !confirm(
        msg("작성 중인 내용을 바꾸고 불러올까요? 선택한 사진도 초기화돼요."),
      )
    )
      return false;
    setKind(input.kind);
    setAccountId(source.id);
    setTarget(input.to_id || "");
    setTitle(input.title);
    setCategory(input.category);
    setNote(input.note || "");
    setTargetNote(input.target_note || "");
    setInputCurrency(input.original_currency || source.currency);
    setAmount(
      toDecimal(
        input.original_amount || input.amount,
        input.original_currency
          ? currencyScales[input.original_currency]
          : source.scale,
      ),
    );
    const factor = exchangeFactor(
      p.user.exchange_rates || [],
      input.original_currency || source.currency,
      source.currency,
      p.user.default_currency || "KRW",
    );
    setRate(factor ? factorDecimal(factor) : "");
    setDate(today(p.user.timezone));
    setClock(
      new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
        timeZone: p.user.timezone,
      }).format(new Date()),
    );
    setFile(null);
    setPresetRevision((v) => v + 1);
    task.setError("");
    return true;
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    await task.run(async () => {
      if (!account || !editable.some((a) => a.id === accountId))
        throw new Error(msg("선택한 가계부의 계좌를 선택해 주세요."));
      if (kind !== "transfer" && !category)
        throw new Error(msg("분류를 먼저 설정해 주세요."));
      let id = savedId;
      let photoId = savedPhotoId;
      if (!id) {
        const payload = buildInput();
        const result = await post<{
          id: string;
          posting_ids?: Record<string, string>;
        }>(
          tx ? `/transactions/${tx.id}` : "/transactions",
          payload,
          tx ? "PUT" : "POST",
          { "Idempotency-Key": requestKey },
        );
        id = result.id;
        setSavedId(id);
        photoId = result.posting_ids?.[photoTarget] || id;
        setSavedPhotoId(photoId);
        await p.refresh();
      }
      for (const receiptId of removedPhotos) {
        await api(`/receipts/${receiptId}`, { method: "DELETE" });
        setRemovedPhotos((old) => old.filter((value) => value !== receiptId));
      }
      if (file) {
        const body = new FormData();
        body.append("file", file);
        await api(
          `/transactions/${tx && kind === "transfer" ? photoId : id}/receipts`,
          { method: "POST", body },
        );
        await p.refresh();
      }
      p.notify(tx ? msg("기록을 수정했어요.") : msg("기록을 저장했어요."));
      p.close();
    });
  }
  return (
    <Modal
      title={tx ? msg("기록을 다듬어요.") : msg("오늘의 기록을 남겨요.")}
      subtitle={msg("저장 전 계좌와 공개 대상을 확인해 주세요.")}
      onClose={p.close}
    >
      <form onSubmit={submit} className="entry-form">
        <fieldset disabled={task.busy || !!savedId} className="plain-fieldset">
          {!tx && (
            <EntryShortcuts
              ledger={p.selectedLedger}
              accounts={editable}
              select={applyPreset}
              current={buildInput}
            />
          )}
          <div className="entry-types">
            {[
              ["expense", msg("지출")],
              ["income", msg("수입")],
              ["transfer", msg("이체")],
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
                {msg(label)}
              </button>
            ))}
          </div>
          <div className="entry-amount-wrap">
            <select
              id="entry-currency"
              aria-label={msg("입력 통화")}
              value={kind === "transfer" ? account?.currency : inputCurrency}
              disabled={kind === "transfer"}
              onChange={(e) => setInputCurrency(e.target.value)}
            >
              {[
                ...new Set([
                  p.user.default_currency || "KRW",
                  ...(p.user.exchange_rates || []).flatMap((r) => [
                    r.from,
                    r.to,
                  ]),
                  ...(tx || presetRevision > 0 ? [inputCurrency] : []),
                  ...(kind === "transfer" && account ? [account.currency] : []),
                ]),
              ].map((code) => (
                <option key={code}>{code}</option>
              ))}
            </select>
            <span className="visually-hidden">{msg("금액")}</span>
            <input
              aria-label={msg("금액")}
              aria-describedby="entry-currency"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal"
              placeholder="0"
              required
              maxLength={25}
              autoFocus
            />
          </div>
          <div className="amount-suggestions">
            {(inputCurrency === "KRW" ? [5000, 10000, 30000] : [5, 10, 25]).map(
              (n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setAmount(String(n))}
                >
                  {n.toLocaleString(intlLocale())}
                  {inputCurrency === "KRW" ? msg("원") : " " + inputCurrency}
                </button>
              ),
            )}
          </div>
          {foreign && (
            <div className="entry-fx">
              <label className="form-label" htmlFor="entry-rate">
                {msg("적용 환율")}
              </label>
              <div>
                <div className="fx-rate-line">
                  <span>1 {inputCurrency} =</span>
                  <input
                    id="entry-rate"
                    className="field-input"
                    inputMode="decimal"
                    value={rate}
                    onChange={(e) => setRate(e.target.value)}
                    placeholder={msg("환율 입력")}
                    required
                  />
                  <span>{account?.currency}</span>
                </div>
                <p className="entry-hint">
                  {msg("계좌 반영:")}{" "}
                  {converted
                    ? formatMoney(converted, account!.scale, account!.currency)
                    : msg("환율을 설정해 주세요.")}{" "}
                  {msg("· 저장한 환율은 이 기록에 보존돼요.")}
                </p>
              </div>
            </div>
          )}
          <label className="form-label" htmlFor="entry-title">
            {msg("내용")}
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
                ? msg("예: 10월 월급")
                : kind === "transfer"
                  ? msg("예: 생활비 통장으로 이체")
                  : kind === "refund"
                    ? msg("예: 반품 환불")
                    : kind === "adjustment"
                      ? msg("예: 실제 통장 잔액 맞추기")
                      : msg("예: 점심 식사")
            }
          />
          <label className="form-label" htmlFor="entry-account">
            {kind === "transfer" ? msg("보내는 계좌") : msg("계좌")}
          </label>
          <select
            id="entry-account"
            className="field-select"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            required
          >
            <option value="" disabled>
              {msg("계좌 선택")}
            </option>
            {editable.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.shared ? msg("공유") : msg("개인")} · {a.currency}
              </option>
            ))}
          </select>
          <label className="form-label" htmlFor="entry-date">
            {msg("날짜")}
          </label>
          <div className="entry-date-fields">
            <div>
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
            <div>
              <label className="visually-hidden" htmlFor="entry-time">
                {msg("시간")}
              </label>
              <input
                id="entry-time"
                required
                type={mobileTime ? "time" : "text"}
                inputMode={mobileTime ? undefined : "numeric"}
                className="field-input"
                value={clock}
                placeholder="HH:mm"
                maxLength={5}
                pattern={
                  mobileTime ? undefined : "([01][0-9]|2[0-3]):[0-5][0-9]"
                }
                title={msg("24시간 형식으로 입력하세요. 예: 14:30")}
                onChange={(e) => setClock(e.target.value)}
                onBlur={() => {
                  const v = clock.trim();
                  if (/^\d{4}$/.test(v))
                    setClock(v.slice(0, 2) + ":" + v.slice(2));
                  else if (/^\d{1,2}:\d{2}$/.test(v))
                    setClock(v.padStart(5, "0"));
                }}
              />
            </div>
          </div>
          {kind === "transfer" ? (
            <>
              <label className="form-label" htmlFor="entry-target">
                {msg("받는 계좌 · 같은 통화")}
              </label>
              <select
                id="entry-target"
                className="field-select"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                required
              >
                <option value="" disabled>
                  {msg("받는 계좌 선택")}
                </option>
                {targets.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name} · {a.shared ? msg("공유") : msg("개인")}
                  </option>
                ))}
              </select>
              <p className="entry-hint">
                {msg(
                  "이체는 수입·지출에 포함되지 않아요. 두 계좌의 잔액이 함께 바뀝니다.",
                )}
                {p.selectedLedger &&
                  msg(
                    " 다른 가계부의 계좌로 이체하려면 모든 가계부 모아 보기로 전환해 주세요.",
                  )}
              </p>
            </>
          ) : (
            <>
              <div className="entry-category-heading">
                <span className="form-label">
                  {categoryKind === "income"
                    ? msg("수입 분류")
                    : msg("지출 분류")}
                </span>
              </div>
              <div className="category-picker">
                {choices.map((c) => (
                  <button
                    type="button"
                    key={c.code}
                    className="category-choice"
                    aria-pressed={category === c.code}
                    onClick={() => setCategory(c.code)}
                  >
                    {displayCategory(c.code, c.name)}
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
                      {displayCategory(category, first?.category_name)}{" "}
                      {msg("· 기존 분류")}
                    </button>
                  )}
              </div>

              <ErrorText error={categoryError} />
            </>
          )}
          <label className="form-label" htmlFor="entry-note">
            {kind === "transfer" ? msg("보내는 계좌에 남길 메모") : msg("메모")}{" "}
            {msg("(선택)")}
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
                {msg("받는 계좌에 남길 메모 (선택)")}
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
          {tx && !["income", "expense", "transfer"].includes(tx.kind) && (
            <p className="entry-hint">
              {msg("이전 버전의")} {msg(kindNames[tx.kind])}{" "}
              {msg("기록입니다. 기존 계산 방식으로 유지됩니다.")}
            </p>
          )}
        </fieldset>
        {tx && (
          <div className="receipt-gallery edit-receipts">
            {tx.legs.flatMap((leg) =>
              leg.receipts.map((ref) => (
                <div
                  key={ref.id}
                  className={
                    removedPhotos.includes(ref.id)
                      ? "pending-photo-removal"
                      : ""
                  }
                >
                  <a
                    href={`/api/receipts/${ref.id}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <img
                      src={`/api/receipts/${ref.id}`}
                      alt={msg("첨부 영수증")}
                    />
                  </a>
                  <button
                    type="button"
                    className="text-link"
                    disabled={task.busy || !!savedId}
                    onClick={() => {
                      if (removedPhotos.includes(ref.id))
                        setRemovedPhotos((old) =>
                          old.filter((id) => id !== ref.id),
                        );
                      else if (
                        confirm(
                          msg(
                            "사진 첨부를 해제할까요? 수정 저장 시 반영됩니다.",
                          ),
                        )
                      )
                        setRemovedPhotos((old) => [...old, ref.id]);
                    }}
                  >
                    {removedPhotos.includes(ref.id)
                      ? msg("해제 취소")
                      : msg("첨부 해제")}
                  </button>
                </div>
              )),
            )}
          </div>
        )}
        {(kind !== "transfer" || !!tx) && (
          <>
            {kind === "transfer" && tx && (
              <>
                <label className="form-label" htmlFor="photo-target">
                  {msg("사진을 첨부할 거래")}
                </label>
                <select
                  id="photo-target"
                  className="field-select"
                  value={photoTarget}
                  onChange={(e) => setPhotoTarget(e.target.value)}
                >
                  {[account, p.accounts.find((a) => a.id === target)]
                    .filter((a): a is Account => !!a)
                    .map((ac) => (
                      <option key={ac.id} value={ac.id}>
                        {ac.name}
                        {msg("의 거래")}
                      </option>
                    ))}
                </select>
              </>
            )}
            <div className="receipt-actions">
              <label className="receipt-button">
                <Icon name="camera" />
                <span>
                  {file ? file.name : msg("사진 선택 · JPG/PNG 5MB 이하")}
                </span>
                <input
                  aria-label={msg("영수증 사진 선택")}
                  type="file"
                  accept="image/*"
                  className="visually-hidden"
                  disabled={task.busy}
                  onChange={chooseReceipt}
                />
              </label>
            </div>
          </>
        )}
        {savedId && task.error && (
          <div className="inline-warning">
            {msg(
              "거래는 이미 저장됐어요. 사진 변경만 다시 시도하거나 창을 닫아도 됩니다.",
            )}
          </div>
        )}
        <ErrorText error={task.error} />
        <div className="entry-save-area">
          {account && (
            <div className="privacy-notice">
              <Icon name={account.shared ? "people" : "lock"} />
              <div>
                <strong>
                  {kind === "transfer"
                    ? msg("각 계좌를 볼 수 있는 사람에게 따로 표시돼요.")
                    : account.shared
                      ? msg("공유된 계좌에 기록하고 있어요.")
                      : msg("나에게만 보이는 기록이에요.")}
                </strong>
                <p>
                  {kind === "transfer"
                    ? msg(
                        "각 계좌의 메모·영수증은 해당 계좌의 공개 범위를 따릅니다.",
                      )
                    : account.shared
                      ? msg("거래 내용과 첨부 사진도 공유 대상에게 보입니다.")
                      : msg(
                          "이 계좌의 이름·잔액·내역은 다른 사람에게 공개되지 않아요.",
                        )}
                </p>
              </div>
            </div>
          )}
          <button
            className="primary-button entry-submit"
            disabled={task.busy || !editable.length}
          >
            <Busy busy={task.busy}>
              {savedId
                ? msg("사진 변경 다시 시도")
                : tx
                  ? msg("수정 저장하기")
                  : msg("기록 저장하기")}
            </Busy>
          </button>
        </div>
        {tx && !savedId && (
          <button
            type="button"
            className="text-link danger-text entry-trash"
            disabled={task.busy}
            onClick={() =>
              task.run(async () => {
                if (
                  !confirm(
                    msg(
                      "이 기록을 휴지통으로 옮길까요? 설정에서 복구할 수 있어요.",
                    ),
                  )
                )
                  return;
                await post(`/transactions/${tx.id}/trash`, {
                  version: tx.version,
                });
                await p.refresh();
                p.notify(msg("기록을 휴지통으로 옮겼어요."));
                p.close();
              })
            }
          >
            <Icon name="trash" />
            {msg("기록 삭제")}
          </button>
        )}
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
  const [tagline, setTagline] = useState("");
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
    setTagline(l.tagline || "");
    setTimezone(l.timezone);
    setCreating(false);
  }
  return (
    <Modal
      title={manage ? msg("가계부 관리") : msg("가계부 선택")}
      subtitle={
        manage
          ? msg("표시 순서 조정 · 책임자는 가계부 수정과 삭제도 가능해요.")
          : msg("이동할 가계부를 선택하세요.")
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
                <strong>{msg("모든 가계부 모아 보기")}</strong>
                <p>{msg("내가 볼 수 있는 계좌를 한곳에")}</p>
              </div>
              {!p.selected && <Icon name="check" />}
            </button>
            {p.ledgers.map((l) => (
              <div className="ledger-sort-row" key={l.id}>
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
                    <p>
                      {l.kind === "personal"
                        ? msg("개인 가계부")
                        : msg("공유 가계부")}
                    </p>
                  </div>
                  {p.selected === l.id && <Icon name="check" />}
                </button>
              </div>
            ))}
          </div>
          <button className="text-link" onClick={() => setManage(true)}>
            {msg("가계부 관리")}
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
                setTagline("");
              }}
            >
              {msg("새 가계부 만들기")}
            </button>
            <button
              className="secondary-button"
              onClick={() => task.run(loadTrash)}
            >
              {msg("가계부 휴지통")}
            </button>
          </div>
          {p.ledgers.map((l, index) => (
            <div className="setting-row" key={l.id}>
              <div>
                <strong>{l.name}</strong>
                <p>
                  {l.kind === "personal" ? msg("개인") : msg("공유")} ·{" "}
                  {l.timezone}
                </p>
              </div>
              <div className="ledger-row-actions">
                <div className="order-buttons">
                  {[-1, 1].map((delta) => (
                    <button
                      key={delta}
                      className="icon-button"
                      disabled={
                        task.busy ||
                        index + delta < 0 ||
                        index + delta >= p.ledgers.length
                      }
                      aria-label={`${l.name} ${delta < 0 ? msg("위로") : msg("아래로")}`}
                      onClick={() =>
                        task.run(async () => {
                          const ids = p.ledgers.map((l) => l.id);
                          [ids[index], ids[index + delta]] = [
                            ids[index + delta],
                            ids[index],
                          ];
                          await post("/ledgers/order", { ids }, "PUT");
                          await p.refresh();
                        })
                      }
                    >
                      {delta < 0 ? "↑" : "↓"}
                    </button>
                  ))}
                </div>
                {l.role === "owner" && (
                  <button className="secondary-button" onClick={() => edit(l)}>
                    {msg("수정·삭제")}
                  </button>
                )}
              </div>
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
                      { name, timezone, tagline },
                      "PATCH",
                    );
                  } else {
                    await post("/ledgers", { name, kind, timezone, tagline });
                  }
                  await p.refresh();
                  setCreating(false);
                  setEditId("");
                  p.notify(
                    editing
                      ? msg("가계부를 수정했어요.")
                      : msg("가계부를 만들었어요."),
                  );
                });
              }}
            >
              <h3>{editing ? msg("가계부 수정") : msg("새 가계부 만들기")}</h3>
              <label className="form-label" htmlFor="ledger-name">
                {msg("가계부 이름")}
              </label>
              <input
                id="ledger-name"
                className="field-input"
                required
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <label className="form-label" htmlFor="ledger-tagline">
                {msg("홈 소개 문구 (선택)")}
              </label>
              <input
                id="ledger-tagline"
                className="field-input"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                maxLength={120}
                placeholder={msg(
                  "나의 기록도, 함께 쓰는 생활비도. 한곳에서 편하게.",
                )}
              />
              {!editing && (
                <>
                  <label className="form-label" htmlFor="ledger-kind">
                    {msg("사용 방식")}
                  </label>
                  <select
                    id="ledger-kind"
                    className="field-select"
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                  >
                    <option value="personal">{msg("개인")}</option>
                    <option value="shared">
                      {msg("공유 · 초대한 사람과 함께")}
                    </option>
                  </select>
                </>
              )}
              <label className="form-label" htmlFor="ledger-timezone">
                {msg("시간대")}
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
                {editing ? msg("수정 저장") : msg("가계부 만들기")}
              </button>
              {editing && (
                <button
                  type="button"
                  className="secondary-button danger-text"
                  disabled={task.busy}
                  onClick={() =>
                    task.run(async () => {
                      const answer = prompt(
                        msg(
                          "가계부와 모든 계좌·내역을 휴지통으로 옮기고 공유 접근을 중단합니다. 복구할 수 있어요. 계속하려면 가계부 이름 '{0}'을 입력해 주세요.",
                          [editing.name],
                        ),
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
                      p.notify(msg("가계부를 휴지통으로 옮겼어요."));
                    })
                  }
                >
                  {msg("가계부 삭제")}
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
                        msg(
                          "계좌·내역과 기존 공유 접근 권한도 다시 활성화됩니다. 복구할까요?",
                        ),
                      )
                    )
                      return;
                    await post(`/ledgers/${l.id}/restore`);
                    await p.refresh();
                    await loadTrash();
                    p.notify(msg("가계부를 복구했어요."));
                  })
                }
              >
                {msg("복구")}
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
  const [currency, setCurrency] = useState(
    ac?.currency || p.user.default_currency || "KRW",
  );
  const [opening, setOpening] = useState("0");
  const [archived, setArchived] = useState(ac?.archived || false);
  const task = useTask();
  return (
    <Modal
      title={ac ? ac.name : msg("첫 계좌부터, 가볍게.")}
      subtitle={
        ac
          ? msg("계좌 설정과 공개 범위를 확인하세요.")
          : msg("은행 연결 없이 직접 관리하는 통장·현금·카드를 등록해요.")
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
                {msg("기록 기준 잔액")}
                {ac.kind === "card" || ac.kind === "loan"
                  ? msg(" · 부채는 음수")
                  : ""}
              </p>
              <strong>{formatMoney(ac.balance, ac.scale, ac.currency)}</strong>
            </div>
          </div>
          <div className="detail-line">
            <span>{msg("가계부")}</span>
            <strong>{ac.ledger_name}</strong>
          </div>
          <div className="detail-line">
            <span>{msg("공개 범위")}</span>
            <Privacy shared={ac.shared} />
          </div>
          <div className="detail-line">
            <span>{msg("관리 책임자")}</span>
            <strong>{ac.owner_name}</strong>
          </div>
          <div className="detail-line">
            <span>{msg("상태")}</span>
            <strong>{ac.archived ? msg("보관 중") : msg("사용 중")}</strong>
          </div>
          <div className="account-detail-actions">
            <button
              className="secondary-button"
              onClick={() => {
                p.showLedger(ac.id);
                p.close();
              }}
            >
              {msg("내역 보기")}
            </button>
            {ac.role !== "viewer" && !ac.archived && (
              <button className="primary-button" onClick={() => p.entry(ac.id)}>
                {msg("기록 추가")}
              </button>
            )}
          </div>
          {ac.role === "owner" && (
            <button
              className="text-link"
              style={{ marginTop: 20 }}
              onClick={() => setEditing(true)}
            >
              {msg("계좌 설정")} <Icon name="arrow" />
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
              p.notify(
                ac ? msg("계좌 설정을 바꿨어요.") : msg("계좌를 만들었어요."),
              );
              p.close();
            });
          }}
        >
          <label className="form-label" htmlFor="account-name">
            {msg("계좌 이름")}
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
                {msg("등록할 가계부")}
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
                      {l.name} ·{" "}
                      {l.kind === "shared" ? msg("공유") : msg("개인")}
                    </option>
                  ))}
              </select>
              <div className="form-two-cols">
                <div>
                  <label className="form-label" htmlFor="account-kind">
                    {msg("계좌 종류")}
                  </label>
                  <select
                    id="account-kind"
                    className="field-select"
                    value={kind}
                    onChange={(e) => setKind(e.target.value as Account["kind"])}
                  >
                    <option value="bank">{msg("예금·체크카드")}</option>
                    <option value="cash">{msg("현금")}</option>
                    <option value="card">{msg("신용카드")}</option>
                    <option value="loan">{msg("대출")}</option>
                  </select>
                </div>
                <div>
                  <label className="form-label" htmlFor="account-currency">
                    {msg("통화")}
                  </label>
                  <select
                    id="account-currency"
                    className="field-select"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                  >
                    {[
                      ...new Set([
                        p.user.default_currency || "KRW",
                        ...(p.user.exchange_rates || []).flatMap((r) => [
                          r.from,
                          r.to,
                        ]),
                      ]),
                    ].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>
              <label className="form-label" htmlFor="account-opening">
                {msg("시작 잔액")}
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
                {msg(
                  "신용카드 미결제액·대출 잔액은 음수로 입력해요. 시작 잔액은 수입으로 잡지 않아요.",
                )}
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
                      ? msg("이 가계부의 모든 멤버에게 공개됩니다.")
                      : msg("처음에는 나만 볼 수 있어요.")}
                  </strong>
                  <p>
                    {msg(
                      "개인 가계부의 특정 계좌만 나중에 공유할 수도 있어요.",
                    )}
                  </p>
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
              {msg("계좌 보관 (기존 기록은 유지)")}
            </label>
          )}
          {ac && (
            <button
              type="button"
              className="secondary-button danger-text"
              disabled={task.busy}
              onClick={() =>
                task.run(async () => {
                  const answer = prompt(
                    msg(
                      "계좌와 내역을 숨기고 공유 접근을 중단합니다. 이체 상대 계좌의 기록은 남습니다. 설정에서 복구할 수 있어요. 삭제하려면 계좌 이름 '{0}'을 입력해 주세요.",
                      [ac.name],
                    ),
                  );
                  if (answer === null) return;
                  await post(
                    `/accounts/${ac.id}`,
                    { confirm_name: answer, version: ac.version },
                    "DELETE",
                  );
                  await p.refresh();
                  p.notify(msg("계좌를 휴지통으로 옮겼어요."));
                  p.close();
                })
              }
            >
              {msg("계좌 삭제")}
            </button>
          )}
          <ErrorText error={task.error} />
          <button className="primary-button entry-submit" disabled={task.busy}>
            <Busy busy={task.busy}>
              {ac ? msg("설정 저장") : msg("계좌 만들기")}
            </Busy>
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
  const task = useTask();
  async function toggle() {
    await task.run(async () => {
      await post(`/transactions/${t.id}/${t.deleted ? "restore" : "trash"}`, {
        version: t.version,
      });
      await p.refresh();
      p.notify(
        t.deleted
          ? msg("기록을 복구했어요.")
          : msg("기록을 휴지통으로 옮겼어요."),
      );
      p.close();
    });
  }
  return (
    <Modal
      title={msg("기록 자세히 보기")}
      subtitle={`${t.date}${t.time ? " " + t.time : ""} · ${msg(kindNames[t.kind] || t.kind)} · ${t.creator}`}
      onClose={p.close}
    >
      {t.original_currency && (
        <div className="modal-note">
          {msg("결제 원금액")}{" "}
          {formatMoney(
            t.original_amount || "0",
            currencyScales[t.original_currency],
            t.original_currency,
          )}{" "}
          {msg("· 적용 환율 1")} {t.original_currency} = {t.exchange_rate}{" "}
          {t.currency}
          <p>{msg("아래 금액은 계좌에 실제 반영된 기록 금액이에요.")}</p>
        </div>
      )}
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
              <span>{msg("계좌")}</span>
              <strong>{ac?.name || msg("계좌")}</strong>
            </div>
            <div className="detail-line">
              <span>{msg("분류")}</span>
              <strong>{displayCategory(l.category, l.category_name)}</strong>
            </div>
            <div className="detail-line">
              <span>{msg("공개 범위")}</span>
              <Privacy shared={ac?.shared || false} />
            </div>
            {l.note && (
              <div className="detail-line">
                <span>{msg("메모")}</span>
                <strong className="wrap-text">{l.note}</strong>
              </div>
            )}
            {!t.deleted && (
              <div className="receipt-gallery">
                {l.receipts.map((ref) => (
                  <div key={ref.id}>
                    <a
                      href={`/api/receipts/${ref.id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <img
                        src={`/api/receipts/${ref.id}`}
                        alt={msg("첨부 영수증")}
                      />
                    </a>
                    <button
                      className="text-link"
                      onClick={() =>
                        download(
                          `/receipts/${ref.id}`,
                          `receipt-${ref.id}.jpg`,
                        ).catch((e) => task.setError(e.message))
                      }
                    >
                      <Icon name="download" />
                      {msg("사진 다운로드")}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        );
      })}
      {t.kind === "transfer" && t.legs.length === 1 && (
        <div className="modal-note">
          {msg(
            "상대 계좌는 비공개이거나 현재 조회 범위 밖에 있어요. 이체는 수입·지출 통계에서 제외합니다.",
          )}
        </div>
      )}
      <ErrorText error={task.error} />
      {t.can_edit ? (
        <div className="account-detail-actions">
          {!t.deleted && !(t.kind === "transfer" && t.legs.length !== 2) && (
            <button className="secondary-button" onClick={p.edit}>
              {msg("수정하기")}
            </button>
          )}
          {t.deleted && (
            <button
              className="secondary-button"
              disabled={task.busy}
              onClick={toggle}
            >
              <Icon name="restore" />
              {msg("복구하기")}
            </button>
          )}
        </div>
      ) : (
        <div className="modal-note">
          {msg(
            "이 기록 전체를 수정할 권한이 없어요. 이체의 금액 수정·삭제에는 양쪽 계좌의 편집 권한이 필요합니다.",
          )}
        </div>
      )}
    </Modal>
  );
}

export function MonthDialog({
  timezone = "Asia/Seoul",
  date,
  select,
  close,
}: {
  timezone?: string;
  date: string;
  select: (year: number, month: number) => void;
  close: () => void;
}) {
  const [year, setYear] = useState(date.slice(0, 4));
  const valid =
    /^\d{4}$/.test(year) && Number(year) >= 1900 && Number(year) <= 2100;
  return (
    <Modal
      title={msg("년·월 선택")}
      subtitle={msg("연도를 입력하고 원하는 월을 선택하세요.")}
      onClose={close}
    >
      <div className="month-toolbar">
        <div className="year-picker">
          <button
            className="icon-button"
            aria-label={msg("이전 연도")}
            disabled={!valid || Number(year) <= 1900}
            onClick={() => setYear(String(Number(year) - 1))}
          >
            <Icon name="left" />
          </button>
          <label htmlFor="picker-year">{msg("연도")}</label>
          <input
            id="picker-year"
            className="field-input"
            type="number"
            min={1900}
            max={2100}
            step={1}
            value={year}
            onChange={(e) => setYear(e.target.value)}
          />
          <button
            className="icon-button"
            aria-label={msg("다음 연도")}
            disabled={!valid || Number(year) >= 2100}
            onClick={() => setYear(String(Number(year) + 1))}
          >
            <Icon name="right" />
          </button>
        </div>
        <button
          className="secondary-button current-month-button"
          onClick={() => {
            const now = today(timezone);
            select(Number(now.slice(0, 4)), Number(now.slice(5, 7)));
            close();
          }}
        >
          {msg("이번 달")}
        </button>
      </div>
      <div className="month-grid">
        {Array.from({ length: 12 }, (_, i) => i + 1).map((month) => (
          <button
            key={month}
            className="secondary-button"
            disabled={!valid}
            aria-pressed={
              Number(year) === Number(date.slice(0, 4)) &&
              month === Number(date.slice(5, 7))
            }
            onClick={() => {
              select(Number(year), month);
              close();
            }}
          >
            {monthName(month)}
          </button>
        ))}
      </div>
    </Modal>
  );
}
