import { useEffect, useState } from "react";
import {
  api,
  post,
  formatMoney,
  type Account,
  type EntryPreset,
  type EntryPresetInput,
} from "./api";
import { msg } from "./i18n";
import { ErrorText, Icon } from "./ui";
import { useTask } from "./use-task";

export function EntryShortcuts({
  ledger,
  accounts,
  select,
  current,
}: {
  ledger?: string;
  accounts: Account[];
  select: (input: EntryPresetInput) => boolean;
  current: () => EntryPresetInput;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"favorites" | "recent">("favorites");
  const [data, setData] = useState<{
    favorites: EntryPreset[];
    recent: EntryPreset[];
  }>({ favorites: [], recent: [] });
  const [loading, setLoading] = useState(true);
  const task = useTask();
  async function load() {
    return api<{ favorites: EntryPreset[]; recent: EntryPreset[] }>(
      `/me/entry-presets?ledger=${encodeURIComponent(ledger || "")}`,
    );
  }
  useEffect(() => {
    let active = true;
    setLoading(true);
    load()
      .then((value) => {
        if (active)
          setData({
            favorites: Array.isArray(value?.favorites) ? value.favorites : [],
            recent: Array.isArray(value?.recent) ? value.recent : [],
          });
      })
      .catch((e) => {
        if (active) task.setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [ledger]);
  async function save(input: EntryPresetInput) {
    await post("/me/entry-presets", input);
    setData(await load());
    setTab("favorites");
  }
  return (
    <details
      className="entry-shortcuts"
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>{msg("즐겨찾기·최근 입력")}</summary>
      {open && (
        <>
          <p className="entry-hint">
            {msg(
              "입력 가능한 계좌만 보여요. 불러온 내용은 확인 후 저장해 주세요. 영수증은 복사하지 않아요.",
            )}
          </p>
          <div className="shortcut-toolbar">
            <div className="entry-types">
              <button
                type="button"
                aria-pressed={tab === "favorites"}
                onClick={() => setTab("favorites")}
              >
                {msg("즐겨찾기")}
              </button>
              <button
                type="button"
                aria-pressed={tab === "recent"}
                onClick={() => setTab("recent")}
              >
                {msg("최근 입력")}
              </button>
            </div>
            <button
              type="button"
              className="text-link"
              disabled={task.busy}
              onClick={() => task.run(() => save(current()))}
            >
              {msg("현재 입력 즐겨찾기 저장")}
            </button>
          </div>
          <div className="shortcut-list" aria-busy={loading}>
            {loading ? (
              <p>{msg("불러오는 중이에요.")}</p>
            ) : (
              data[tab].map((item) => {
                const account = accounts.find(
                  (a) => a.id === item.input.account_id,
                );
                if (!account) return null;
                return (
                  <div className="shortcut-row" key={item.id}>
                    <button
                      type="button"
                      className="shortcut-select"
                      disabled={task.busy}
                      onClick={() => {
                        if (select(item.input)) setOpen(false);
                      }}
                    >
                      <strong>{item.input.title}</strong>
                      <span>
                        {account.name} ·{" "}
                        {formatMoney(
                          item.input.amount,
                          account.scale,
                          account.currency,
                        )}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      disabled={task.busy}
                      aria-label={
                        tab === "favorites"
                          ? msg("{0} 즐겨찾기 삭제", [item.input.title])
                          : msg("{0} 즐겨찾기 추가", [item.input.title])
                      }
                      onClick={() =>
                        task.run(async () => {
                          if (tab === "recent") await save(item.input);
                          else {
                            if (
                              !confirm(
                                msg(
                                  "즐겨찾기를 삭제할까요? 거래 기록은 유지돼요.",
                                ),
                              )
                            )
                              return;
                            await api(`/me/entry-presets/${item.id}`, {
                              method: "DELETE",
                            });
                            setData(await load());
                          }
                        })
                      }
                    >
                      <Icon name={tab === "favorites" ? "trash" : "plus"} />
                    </button>
                  </div>
                );
              })
            )}
            {!loading && !data[tab].length && (
              <p className="entry-hint">
                {tab === "favorites"
                  ? msg("자주 쓰는 입력을 즐겨찾기로 저장해 보세요.")
                  : msg("아직 재사용할 입력이 없어요.")}
              </p>
            )}
          </div>
        </>
      )}
      <ErrorText error={task.error} />
    </details>
  );
}
