import { copyText } from "./clipboard";
import { useEffect, useState, useRef } from "react";
import { api, post, type Category } from "./api";
import { Modal, ErrorText, Help } from "./ui";
import type { DialogProps } from "./dialogs";

export function CategoriesDialog(p: DialogProps) {
  const owned = p.ledgers.filter((l) => l.role === "owner");
  const [ledger, setLedger] = useState(
    owned.find((l) => l.id === p.selectedLedger)?.id || owned[0]?.id || "",
  );
  const [kind, setKind] = useState("expense");
  const [list, setList] = useState<Category[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    if (ledger)
      setList(
        await api<Category[]>(`/categories?ledger=${ledger}&kind=${kind}`),
      );
  }
  useEffect(() => {
    let active = true;
    if (!ledger) {
      setList([]);
      return;
    }
    setError("");
    api<Category[]>(`/categories?ledger=${ledger}&kind=${kind}`)
      .then((v) => {
        if (active) setList(v);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [ledger, kind]);
  async function save(category: Partial<Category>) {
    setBusy(true);
    setError("");
    try {
      await post(`/ledgers/${ledger}/categories`, {
        code: category.code || "",
        name: category.name,
        kind,
        hidden: !!category.hidden,
      });
      await load();
      setName("");
      p.notify("분류 설정을 저장했어요.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(c: Category) {
    if (
      !confirm(
        `'${c.name}' 분류를 완전히 삭제할까요? 복구할 수 없으며, 과거 거래의 분류명과 금액은 유지됩니다.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await post(
        `/ledgers/${ledger}/categories/${encodeURIComponent(c.code)}?kind=${kind}`,
        {},
        "DELETE",
      );
      await load();
      p.notify("분류를 삭제했어요.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function move(index: number, delta: number) {
    const next = [...list];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    setBusy(true);
    setError("");
    try {
      await post(
        `/ledgers/${ledger}/categories/order`,
        { kind, codes: next.map((c) => c.code) },
        "PUT",
      );
      setList(next);
      p.notify("분류 순서를 저장했어요.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="가계부 분류 관리"
      subtitle="삭제한 분류는 복구할 수 없어요. 과거 거래의 분류명과 금액은 유지됩니다."
      onClose={p.close}
    >
      <label className="form-label" htmlFor="category-ledger">
        가계부
      </label>
      <select
        id="category-ledger"
        className="field-select"
        value={ledger}
        onChange={(e) => setLedger(e.target.value)}
      >
        {owned.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
          </option>
        ))}
      </select>
      <div className="entry-types">
        <button
          aria-pressed={kind === "expense"}
          onClick={() => setKind("expense")}
        >
          지출 분류
        </button>
        <button
          aria-pressed={kind === "income"}
          onClick={() => setKind("income")}
        >
          수입 분류
        </button>
      </div>
      {list.map((c, index) => (
        <CategoryRow
          key={ledger + kind + c.code}
          category={c}
          disabled={busy}
          save={save}
          remove={() => remove(c)}
          up={() => move(index, -1)}
          down={() => move(index, 1)}
          first={index === 0}
          last={index === list.length - 1}
        />
      ))}
      <form
        className="subform"
        onSubmit={(e) => {
          e.preventDefault();
          save({ name });
        }}
      >
        <label className="form-label" htmlFor="new-category">
          새 분류 이름
        </label>
        <div className="category-manage-row">
          <input
            id="new-category"
            className="field-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={60}
          />
          <button className="secondary-button" disabled={!ledger || busy}>
            추가
          </button>
        </div>
      </form>
      <ErrorText error={error} />
    </Modal>
  );
}
function CategoryRow({
  category: c,
  disabled,
  save,
  remove,
  up,
  down,
  first,
  last,
}: {
  category: Category;
  disabled: boolean;
  save: (c: Category) => void;
  remove: () => void;
  up: () => void;
  down: () => void;
  first: boolean;
  last: boolean;
}) {
  const [name, setName] = useState(c.name);
  return (
    <div className="category-manage-row">
      <div className="order-buttons">
        <button
          className="icon-button"
          aria-label={`${c.name} 위로`}
          disabled={disabled || first}
          onClick={up}
        >
          ↑
        </button>
        <button
          className="icon-button"
          aria-label={`${c.name} 아래로`}
          disabled={disabled || last}
          onClick={down}
        >
          ↓
        </button>
      </div>
      <input
        aria-label={`${c.name} 분류 이름`}
        className="field-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={60}
      />
      <button
        className="secondary-button"
        disabled={disabled}
        onClick={() => save({ ...c, name })}
      >
        수정
      </button>
      <button className="text-link" disabled={disabled} onClick={remove}>
        삭제
      </button>
    </div>
  );
}

type AccountInvite = {
  id: string;
  expires_at: number;
  used: boolean;
  cancelled: boolean;
  name: string;
};
export function AdminDialog(p: DialogProps) {
  const [open, setOpen] = useState(false);
  const [invitations, setInvitations] = useState<AccountInvite[]>([]);
  const [link, setLink] = useState("");
  const [linkId, setLinkId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() {
    const [s, i] = await Promise.all([
      api<{ registration_open: boolean }>("/admin/settings"),
      api<AccountInvite[]>("/admin/invitations"),
    ]);
    setOpen(s.registration_open);
    setInvitations(i);
  }
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="사용자와 가입 관리"
      subtitle="서버 관리자 전용 · 새 계정은 자기 개인 가계부만 만들며 기존 금융 자료에 접근하지 못합니다."
      onClose={p.close}
    >
      <label className="setting-row">
        <div>
          <strong>공개 회원가입 허용</strong>
          <p>꺼 두어도 초대 링크로 가입할 수 있어요.</p>
        </div>
        <input
          type="checkbox"
          checked={open}
          disabled={busy}
          onChange={(e) => {
            const value = e.target.checked;
            run(async () => {
              await post(
                "/admin/settings",
                { registration_open: value },
                "PATCH",
              );
              setOpen(value);
              p.notify("회원가입 설정을 저장했어요.");
            });
          }}
        />
      </label>
      <button
        className="primary-button"
        disabled={busy}
        onClick={() =>
          run(async () => {
            const v = await post<{ token: string; id: string }>(
              "/admin/invitations",
            );
            setLinkId(v.id);
            setLink(
              location.origin + "/#invite=" + encodeURIComponent(v.token),
            );
            await load();
          })
        }
      >
        새 사용자 초대 링크 만들기
      </button>
      {link && (
        <div className="modal-note">
          <p>
            48시간 동안 한 번만 사용할 수 있어요. 새 계정 테스트는 다른
            브라우저나 시크릿 창에서 진행하세요. 가계부 공유는 별도로
            설정합니다.
          </p>
          <input
            className="field-input"
            aria-label="새 사용자 초대 링크"
            readOnly
            value={link}
            onFocus={(e) => e.target.select()}
          />
          <button
            className="secondary-button"
            onClick={() =>
              run(async () => {
                await copyText(link);
                p.notify("초대 링크를 복사했어요.");
              })
            }
          >
            링크 복사
          </button>
        </div>
      )}
      {invitations
        .filter((i) => !i.cancelled)
        .map((i) => (
          <div className="setting-row" key={i.id}>
            <div>
              <strong>
                {i.used
                  ? `${i.name} 가입 완료`
                  : i.cancelled
                    ? "취소된 초대"
                    : i.expires_at * 1000 < Date.now()
                      ? "만료된 초대"
                      : "가입 대기"}
              </strong>
              <p>{new Date(i.expires_at * 1000).toLocaleString()} 만료</p>
            </div>
            {!i.used && !i.cancelled && (
              <button
                className="text-link"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await post(`/admin/invitations/${i.id}/cancel`);
                    if (linkId === i.id) setLink("");
                    await load();
                  })
                }
              >
                취소
              </button>
            )}
          </div>
        ))}
      <ErrorText error={error} />
    </Modal>
  );
}

export function AccountTrashDialog(p: DialogProps) {
  const [items, setItems] = useState<
    { id: string; name: string; ledger_name: string }[]
  >([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const load = () => api<typeof items>("/accounts/trash").then(setItems);
  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);
  return (
    <Modal
      title="삭제한 계좌"
      subtitle="복구하면 기록과 기존 공유 권한도 다시 활성화됩니다."
      onClose={p.close}
    >
      {!items.length && <p>삭제한 계좌가 없어요.</p>}
      {items.map((ac) => (
        <div className="setting-row" key={ac.id}>
          <div>
            <strong>{ac.name}</strong>
            <p>{ac.ledger_name}</p>
          </div>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={async () => {
              if (!confirm("계좌·기록과 기존 공유 권한을 다시 활성화할까요?"))
                return;
              setBusy(true);
              try {
                await post(`/accounts/${ac.id}/restore`);
                await load();
                await p.refresh();
                p.notify("계좌를 복구했어요.");
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            복구
          </button>
        </div>
      ))}
      <ErrorText error={error} />
    </Modal>
  );
}

export function ExchangeSettings({
  user,
  refresh,
  notify,
}: {
  user: import("./api").User;
  refresh: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [from, setFrom] = useState(
    user.default_currency === "USD" ? "KRW" : "USD",
  );
  const [to] = useState(user.default_currency || "KRW");
  const [rate, setRate] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [quoteStatus, setQuoteStatus] = useState("");
  const [quoteBusy, setQuoteBusy] = useState(false);
  const quoteVersion = useRef(0);
  async function fetchQuote() {
    const version = ++quoteVersion.current;
    setQuoteBusy(true);
    setQuoteStatus("최신 환율을 불러오는 중이에요…");
    try {
      const q = await api<{ rate: string; date: string }>(
        `/me/exchange-quote?from=${from}&to=${to}`,
      );
      if (version === quoteVersion.current) {
        setRate(String(q.rate));
        setQuoteStatus(`${q.date} 기준 · Frankfurter · 확인 후 저장하세요.`);
      }
    } catch (e) {
      if (version === quoteVersion.current)
        setQuoteStatus((e as Error).message);
    } finally {
      if (version === quoteVersion.current) setQuoteBusy(false);
    }
  }
  useEffect(() => {
    const existing = (user.exchange_rates || []).find(
      (r) => r.from === from && r.to === to,
    );
    if (existing) {
      setRate(existing.rate);
      setQuoteStatus("저장된 환율을 수정하고 저장하세요.");
    } else {
      setRate("");
      if (from !== to) void fetchQuote();
    }
    return () => {
      quoteVersion.current++;
    };
  }, [from, to]);
  const names = ["KRW", "USD", "JPY", "EUR", "GBP", "CNY", "TWD", "VND", "KWD"];
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const rates = user.exchange_rates || [];
  const saved = rates.find((r) => r.from === from && r.to === to);
  return (
    <div className="exchange-manager">
      <div className="exchange-heading">
        <span className="exchange-base">
          기본 통화 <strong>{to}</strong>
        </span>
        <p>보조 통화를 여러 개 등록해 함께 사용할 수 있어요.</p>
      </div>
      <section className="exchange-list" aria-label="등록한 환율">
        <h3>
          등록한 환율 <span>{rates.length}개</span>
          <button
            type="button"
            className="text-link add-secondary"
            disabled={
              busy ||
              !names.some(
                (c) =>
                  c !== to && !rates.some((r) => r.from === c && r.to === to),
              )
            }
            onClick={() => {
              const next = names.find(
                (c) =>
                  c !== to && !rates.some((r) => r.from === c && r.to === to),
              );
              if (next) setFrom(next);
            }}
          >
            + 통화 추가
          </button>
        </h3>
        {rates.length === 0 && (
          <p className="exchange-empty">
            아직 보조 통화가 없어요. 아래에서 첫 통화를 추가하세요.
          </p>
        )}
        {rates.map((r) => (
          <div className="exchange-row" key={r.from + r.to}>
            <div>
              <strong>{r.from}</strong>
              <span>
                1 {r.from} = {r.rate} {r.to}
              </span>
            </div>
            <div className="exchange-row-actions">
              <button
                className="text-link"
                disabled={busy || r.to !== to}
                title={
                  r.to !== to
                    ? "기본 통화가 바뀌었어요. 새 기본 통화 기준으로 환율을 추가하세요."
                    : "환율 수정"
                }
                onClick={() => {
                  quoteVersion.current++;
                  setQuoteBusy(false);
                  setFrom(r.from === to ? r.to : r.from);
                  setRate(r.from === to ? "" : r.rate);
                  setQuoteStatus("저장된 환율을 수정하고 저장하세요.");
                }}
              >
                수정
              </button>
              <button
                className="text-link"
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      "이 환율을 삭제할까요? 이미 저장한 계좌 반영 금액은 유지됩니다.",
                    )
                  )
                    void run(async () => {
                      await post("/me/exchange-rates", r, "DELETE");
                      notify("환율 설정을 삭제했어요.");
                    });
                }}
              >
                삭제
              </button>
            </div>
          </div>
        ))}
      </section>
      <form
        className="exchange-editor"
        onSubmit={(e) => {
          e.preventDefault();
          void run(async () => {
            await post("/me/exchange-rates", { from, to, rate }, "PUT");
            notify("환율을 저장했어요. 다른 통화도 추가할 수 있어요.");
          });
        }}
      >
        <h3>
          {saved ? "환율 수정" : "보조 통화 추가"}
          <Help>
            내 모든 가계부 조회에 적용해요. 이미 저장한 결제 금액은 바꾸지
            않아요. 외부 조회에는 통화 코드만 전달하며, 실제 카드 청구 환율과
            다를 수 있어요.
          </Help>
        </h3>
        <label htmlFor="exchange-from">보조 통화</label>
        <select
          id="exchange-from"
          aria-label="환율 원래 통화"
          className="field-select"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        >
          {names
            .filter((c) => c !== to)
            .map((c) => (
              <option key={c}>{c}</option>
            ))}
        </select>
        <label htmlFor="exchange-rate">1 {from}의 환산 금액</label>
        <div className="exchange-rate-input">
          <input
            id="exchange-rate"
            aria-label="환율"
            className="field-input"
            inputMode="decimal"
            value={rate}
            onChange={(e) => {
              quoteVersion.current++;
              setQuoteBusy(false);
              setQuoteStatus("직접 입력한 환율을 사용해요.");
              setRate(e.target.value);
            }}
            placeholder="환율 입력"
            required
          />
          <span aria-label="환율 대상 통화">{to}</span>
        </div>
        <p className="exchange-status" role="status">
          {quoteStatus}
        </p>
        <div className="exchange-buttons">
          <button
            type="button"
            className="secondary-button"
            disabled={quoteBusy || busy || from === to}
            onClick={() => void fetchQuote()}
          >
            환율 다시 불러오기
          </button>
          <button
            className="primary-button"
            disabled={busy || quoteBusy || from === to}
          >
            환율 저장
          </button>
        </div>
      </form>
      <ErrorText error={error} />
    </div>
  );
}
