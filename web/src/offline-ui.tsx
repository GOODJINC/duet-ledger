import { useEffect, useState, useSyncExternalStore } from "react";
import { msg, intlLocale } from "./i18n";
import { Icon, ErrorText } from "./ui";
import {
  offlineState,
  subscribeOffline,
  preferences,
  setOfflinePreferences,
  pendingEntries,
  syncPending,
  retryPending,
  warmOffline,
  clearCached,
  cancelPending,
  exportPending,
  type Pending,
} from "./offline";
export function ConnectionStatus({ userId }: { userId: string }) {
  const state = useSyncExternalStore(subscribeOffline, offlineState);
  const [open, setOpen] = useState(false),
    [entries, setEntries] = useState<Pending[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const run = async () => {
      if (!active || document.visibilityState === "hidden") return;
      await syncPending();
      await warmOffline();
    };
    void run();
    const timer = setInterval(() => void run(), 15000);
    window.addEventListener("online", run);
    window.addEventListener("focus", run);
    window.addEventListener("duet-offline-settings", run);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("online", run);
      window.removeEventListener("focus", run);
      window.removeEventListener("duet-offline-settings", run);
    };
  }, [userId]);
  useEffect(() => {
    if (open)
      pendingEntries()
        .then(setEntries)
        .catch((e) => setError(e.message));
  }, [open, state.pending, state.syncing]);
  const label = state.syncing
    ? msg("동기화 중")
    : state.connection === "offline"
      ? msg("서버 연결 안 됨")
      : state.connection === "auth"
        ? msg("다시 로그인 필요")
        : state.connection === "online"
          ? msg("서버 연결 정상")
          : msg("서버 연결 확인 중");
  return (
    <div className="connection-status">
      <button
        className={
          "icon-button connection-button " +
          (state.connection === "offline" ? "disconnected" : "")
        }
        aria-label={msg("서버 연결 상태")}
        aria-expanded={open}
        title={label}
        onClick={() => setOpen(!open)}
      >
        <Icon
          name={
            state.syncing
              ? "loader"
              : state.connection === "offline"
                ? "cloud-off"
                : "cloud"
          }
          className={state.syncing ? "spin" : ""}
        />
        {state.pending > 0 && (
          <span className="connection-count">{state.pending}</span>
        )}
      </button>
      {open && (
        <section
          className="connection-popover"
          aria-label={msg("서버 연결 상태")}
        >
          <div className="connection-heading">
            <strong>{label}</strong>
            <button
              className="icon-button"
              onClick={() => setOpen(false)}
              aria-label={msg("닫기")}
            >
              <Icon name="close" />
            </button>
          </div>
          <p>
            {state.lastContact
              ? msg("마지막 서버 응답: {0}", [
                  new Date(state.lastContact).toLocaleString(intlLocale()),
                ])
              : msg("아직 서버 연결을 확인하지 못했어요.")}
          </p>
          <p>{msg("전송 대기: {0}건", [state.pending])}</p>
          <ErrorText error={error} />
          {state.storageError && (
            <p className="inline-warning">
              {msg(
                "기기 저장 공간을 사용할 수 없어요. 브라우저 설정과 저장 공간을 확인해 주세요.",
              )}
            </p>
          )}
          <div className="backup-actions">
            <button
              className="secondary-button"
              disabled={state.syncing}
              onClick={() => {
                setError("");
                retryPending()
                  .then(() => warmOffline(true))
                  .catch((e) => setError(e.message));
              }}
            >
              {msg("다시 연결·동기화")}
            </button>
            {entries.length > 0 && (
              <button
                className="secondary-button"
                onClick={() => exportPending(entries)}
              >
                {msg("대기 기록 내보내기")}
              </button>
            )}
          </div>
          {entries.map((op) => (
            <div className="pending-entry" key={op.id}>
              <strong>{String(op.input.payload.title)}</strong>
              {op.result && (
                <p>
                  {msg(
                    "거래는 서버에 저장됐어요. 남은 사진 변경을 확인해 주세요.",
                  )}
                </p>
              )}
              <p>
                {String(op.input.payload.date)} ·{" "}
                {op.error || msg("서버 연결 후 전송해요.")}
              </p>
              <button
                className="text-link danger-text"
                disabled={state.syncing}
                onClick={() => {
                  if (
                    !confirm(
                      msg(
                        "전송 대기를 취소할까요? 이 기기의 대기 기록만 삭제하며 서버에 이미 저장된 기록은 유지해요.",
                      ),
                    )
                  )
                    return;
                  cancelPending(op)
                    .then(() => pendingEntries().then(setEntries))
                    .catch((e) => setError(e.message));
                }}
              >
                {msg("대기 취소")}
              </button>
            </div>
          ))}
          <p className="setting-explainer">
            {msg(
              "앱이 열려 있을 때 자동 동기화해요. 기기 자료를 삭제하기 전에 대기 기록을 내보내 주세요.",
            )}
          </p>
        </section>
      )}
    </div>
  );
}
export function OfflineSettings({ userId }: { userId: string }) {
  const [value, setValue] = useState(() => preferences(userId));
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function save(next: typeof value) {
    setBusy(true);
    try {
      await setOfflinePreferences(next);
      setValue(next);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel" data-settings-scope="offline">
      <div className="setting-group">
        <h2 className="settings-section-title">{msg("오프라인 내역")}</h2>
        <p className="settings-section-description">
          {msg("이 브라우저에 자료를 저장해요. 공용 기기에서는 꺼 주세요.")}
        </p>
        <div className="setting-row">
          <label htmlFor="offline-enabled">{msg("오프라인 사용")}</label>
          <input
            id="offline-enabled"
            type="checkbox"
            checked={value.enabled}
            disabled={busy}
            onChange={(e) => void save({ ...value, enabled: e.target.checked })}
          />
        </div>
        <div className="setting-row">
          <label htmlFor="offline-days">{msg("최근 내역 자동 저장")}</label>
          <select
            id="offline-days"
            className="field-select offline-days"
            value={value.days}
            disabled={busy || !value.enabled}
            onChange={(e) =>
              void save({
                ...value,
                days: Number(e.target.value) as 7 | 30 | 90,
              })
            }
          >
            <option value="7">{msg("최근 7일")}</option>
            <option value="30">{msg("최근 30일")}</option>
            <option value="90">{msg("최근 90일")}</option>
          </select>
        </div>
        <p className="setting-explainer">
          {msg(
            "조회한 과거 내역은 마지막 조회일부터 30일간 보관해요. 직접 보관한 내역과 전송 대기 기록은 자동 삭제하지 않아요.",
          )}
        </p>
        <p className="setting-explainer">
          {msg(
            "영수증 사진은 조회용으로 자동 저장하지 않아요. 대기 기록에 첨부한 사진은 전송할 때까지 보관해요.",
          )}
        </p>
        <ErrorText error={error} />
        <div className="backup-actions">
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() =>
              pendingEntries()
                .then(exportPending)
                .catch((e) => setError(e.message))
            }
          >
            {msg("대기 기록 내보내기")}
          </button>
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => {
              if (
                !confirm(
                  msg(
                    "이 기기에 저장된 조회 자료를 지울까요? 전송 대기 기록과 서버 자료는 유지해요.",
                  ),
                )
              )
                return;
              clearCached().catch((e) => setError(e.message));
            }}
          >
            {msg("조회 자료 지우기")}
          </button>
        </div>
        <p className="setting-explainer">
          {msg(
            "서버 백업에는 기기의 전송 대기 기록이 포함되지 않아요. 앱을 닫은 뒤 다시 여는 오프라인 사용에는 HTTPS가 필요해요.",
          )}
        </p>
      </div>
    </section>
  );
}
