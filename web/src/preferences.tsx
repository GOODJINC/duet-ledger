import { copyText } from "./clipboard";
import { useEffect, useState } from "react";
import { api, post, type Category } from "./api";
import { Modal, ErrorText } from "./ui";
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
        await api<Category[]>(
          `/categories?ledger=${ledger}&kind=${kind}&include_hidden=true`,
        ),
      );
  }
  useEffect(() => {
    let active = true;
    if (!ledger) {
      setList([]);
      return;
    }
    setError("");
    api<Category[]>(
      `/categories?ledger=${ledger}&kind=${kind}&include_hidden=true`,
    )
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
      subtitle="책임자가 수입·지출 분류를 관리합니다. 삭제해도 기존 기록은 남아요."
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
  up,
  down,
  first,
  last,
}: {
  category: Category;
  disabled: boolean;
  save: (c: Category) => void;
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
      <button
        className="text-link"
        disabled={disabled}
        onClick={() => save({ ...c, hidden: !c.hidden })}
      >
        {c.hidden ? "다시 사용" : "삭제"}
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
