import { useEffect, useState, type FormEvent } from "react";
import { api, post, type User } from "./api";
import { Modal, Help, ErrorText, PasswordInput } from "./ui";
import { copyText } from "./clipboard";
import type { DialogProps } from "./dialogs";
const permissions = [
  ["read", "조회·검색·통계"],
  ["create", "거래 추가"],
  ["update", "거래 수정"],
  ["delete", "삭제·휴지통 복구"],
  ["receipts", "영수증 첨부"],
] as const;
type Key = {
  id: string;
  name: string;
  permissions: string[];
  account_ids: string[];
  expires_at: number;
  created_at: string;
  last_used_at: string;
  revoked_at: string;
};
type KeyList = { enabled: boolean; items: Key[] };
type RequestLog = {
  id: string;
  name: string;
  method: string;
  path: string;
  status: number;
  created_at: string;
};
export function AdminAPISettings({
  user,
  refresh,
}: {
  user: User;
  refresh: () => Promise<void>;
}) {
  const [enabled, setEnabled] = useState(!!user.api_enabled);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<{ enabled: boolean }>("/admin/api-settings")
      .then((s) => {
        if (active) {
          setEnabled(!!s.enabled);
          setReady(true);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function change(next: boolean) {
    setBusy(true);
    setError("");
    try {
      await post("/admin/api-settings", { enabled: next }, "PATCH");
      setEnabled(next);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="setting-group">
        <h2>외부 API · MCP</h2>
        <label className="setting-row">
          <span>
            API 사용 허용 (모든 사용자)
            <Help>
              API와 MCP에 함께 적용돼요. 기본은 꺼져 있어요. 허용하면 각
              사용자가 자기 계좌와 권한을 선택해 앱 비밀번호를 발급합니다. 끄면
              기존 키도 즉시 차단하고, 다시 켜면 만료·폐기되지 않은 키를 사용할
              수 있어요.
            </Help>
          </span>
          <input
            aria-label="API 사용 허용"
            type="checkbox"
            checked={enabled}
            disabled={busy || !ready}
            onChange={(e) => void change(e.target.checked)}
          />
        </label>
        <p className="panel-subtitle">
          사용자는 계정 설정 → API 앱 비밀번호에서 API·MCP 연결을 관리해요.
        </p>
        <ErrorText error={error} />
      </div>
    </section>
  );
}
export function AppPasswordsDialog(p: DialogProps) {
  const [data, setData] = useState<KeyList>({ enabled: false, items: [] });
  const [logs, setLogs] = useState<RequestLog[]>([]);
  const [form, setForm] = useState(false);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [scopes, setScopes] = useState<string[]>(["read"]);
  const [lifetime, setLifetime] = useState("90d");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  async function load() {
    const [keys, requests] = await Promise.all([
      api<KeyList>("/me/app-passwords"),
      api<RequestLog[]>("/me/api-requests"),
    ]);
    setData(keys);
    setLogs(requests);
  }
  useEffect(() => {
    let active = true;
    Promise.all([
      api<KeyList>("/me/app-passwords"),
      api<RequestLog[]>("/me/api-requests"),
    ])
      .then(([keys, requests]) => {
        if (active) {
          setData(keys);
          setLogs(requests);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);
  async function issue(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await post<{ app_password: string }>("/me/app-passwords", {
        name,
        account_ids: selected,
        permissions: scopes,
        lifetime,
        password,
        code,
      });
      setSecret(result.app_password);
      setPassword("");
      setCode("");
      setName("");
      setForm(false);
      await load();
      p.notify("앱 비밀번호를 발급했어요.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function revoke(key: Key) {
    if (
      !confirm(
        `'${key.name}' 앱 비밀번호를 폐기할까요? 연결된 자동화가 즉시 중지됩니다.`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await post("/me/app-passwords/" + key.id, {}, "DELETE");
      await load();
      p.notify("앱 비밀번호를 폐기했어요.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const expiry = (key: Key) =>
    key.revoked_at
      ? "폐기됨"
      : key.expires_at && key.expires_at <= Date.now() / 1000
        ? "만료됨"
        : key.expires_at
          ? new Date(key.expires_at * 1000).toLocaleDateString() + " 만료"
          : "만료 없음";
  return (
    <Modal
      title="API 앱 비밀번호"
      subtitle="선택한 계좌만 연결하고 앱마다 다른 비밀번호를 발급하세요."
      onClose={p.close}
    >
      <p className="api-help-links">
        <a href="/api-help.html" target="_blank" rel="noopener noreferrer">
          API 연결 안내
        </a>
        <a href="/mcp-help.html" target="_blank" rel="noopener noreferrer">
          Codex MCP 연결 안내
        </a>
        <a href="/duet_api.py" download="duet_api.py">
          호출 도구 다운로드
        </a>
      </p>
      {loading ? (
        <p>불러오는 중이에요…</p>
      ) : (
        <>
          {!data.enabled && (
            <p className="inline-warning">
              관리자가 API 사용을 차단한 상태예요. 기존 키도 사용할 수 없으며
              폐기는 가능해요.
            </p>
          )}
          {secret && (
            <div className="api-secret">
              <strong>이번 한 번만 표시돼요. 지금 복사해 보관하세요.</strong>
              <PasswordInput
                aria-label="발급된 앱 비밀번호"
                value={secret}
                readOnly
                autoComplete="off"
              />
              <button
                className="secondary-button"
                onClick={() =>
                  copyText(secret)
                    .then(() => p.notify("앱 비밀번호를 복사했어요."))
                    .catch((e) => setError(e.message))
                }
              >
                앱 비밀번호 복사
              </button>
            </div>
          )}
          <button
            className="secondary-button"
            disabled={!data.enabled || busy}
            onClick={() => {
              setForm(!form);
              setSecret("");
              setPassword("");
              setCode("");
              if (!form) {
                setName("");
                setSelected([]);
                setScopes(["read"]);
                setLifetime("90d");
              }
              setError("");
            }}
          >
            {form ? "발급 취소" : "앱 비밀번호 만들기"}
          </button>
          {form && (
            <form className="api-key-form" onSubmit={issue}>
              <label className="form-label" htmlFor="api-key-name">
                연결 이름
              </label>
              <input
                id="api-key-name"
                className="field-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: Codex CLI, 생활비 자동 입력"
                required
                maxLength={60}
              />
              <fieldset>
                <legend>접근할 계좌</legend>
                <p className="entry-hint">
                  지금 선택한 계좌만 허용해요. 나중에 추가한 계좌는 자동으로
                  포함하지 않아요.
                </p>
                {p.accounts.length === 0 && (
                  <p className="entry-hint">
                    계좌·자산에서 먼저 계좌를 만들거나 계좌 공유를 승인받아
                    주세요.
                  </p>
                )}
                <div className="api-account-list">
                  {p.accounts.map((a) => (
                    <label key={a.id}>
                      <input
                        type="checkbox"
                        checked={selected.includes(a.id)}
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? [...selected, a.id]
                              : selected.filter((id) => id !== a.id),
                          )
                        }
                      />
                      <span>
                        {a.name}
                        <small>
                          {a.ledger_name} · {a.currency}
                          {a.role === "viewer" ? " · 조회만 가능" : ""}
                          {a.archived ? " · 보관됨" : ""}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>허용할 기능</legend>
                <div className="api-permissions">
                  {permissions.map(([id, label]) => (
                    <label key={id}>
                      <input
                        type="checkbox"
                        checked={scopes.includes(id)}
                        onChange={(e) =>
                          setScopes(
                            e.target.checked
                              ? [...scopes, id]
                              : scopes.filter((s) => s !== id),
                          )
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
                <p className="entry-hint">
                  조회 권한에는 영수증 다운로드도 포함돼요. 추가·수정 요청은
                  확인 화면 없이 바로 저장됩니다. 삭제는 휴지통 이동이며, 영수증
                  해제에는 삭제와 영수증 권한이 모두 필요해요. 공유받은 조회
                  전용 계좌는 쓰기 권한을 선택해도 변경할 수 없어요.
                </p>
              </fieldset>
              <label className="form-label" htmlFor="api-key-lifetime">
                유효기간
              </label>
              <select
                id="api-key-lifetime"
                className="field-select"
                value={lifetime}
                onChange={(e) => setLifetime(e.target.value)}
              >
                <option value="30d">30일</option>
                <option value="90d">90일</option>
                <option value="1y">1년</option>
                <option value="never">만료 없음</option>
              </select>
              <label className="form-label" htmlFor="api-key-password">
                현재 비밀번호
              </label>
              <PasswordInput
                id="api-key-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
              />
              {p.user.totp_enabled && (
                <>
                  <label className="form-label" htmlFor="api-key-code">
                    인증 코드 또는 복구 코드
                  </label>
                  <input
                    id="api-key-code"
                    className="field-input"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    autoComplete="one-time-code"
                    required
                  />
                </>
              )}
              <button
                className="primary-button"
                disabled={
                  busy ||
                  selected.length === 0 ||
                  scopes.length === 0 ||
                  !data.enabled
                }
              >
                발급하기
              </button>
            </form>
          )}
          <h3 className="api-section-title">발급한 연결</h3>
          {data.items.length === 0 && (
            <p className="entry-hint">아직 발급한 앱 비밀번호가 없어요.</p>
          )}
          {data.items.map((key) => (
            <div className="api-key-row" key={key.id}>
              <div>
                <strong>{key.name}</strong>
                <small>
                  {expiry(key)} · 계좌 {key.account_ids.length}개
                </small>
                <small>
                  계좌:{" "}
                  {key.account_ids
                    .map(
                      (id) =>
                        p.accounts.find((a) => a.id === id)?.name ||
                        "접근할 수 없는 계좌",
                    )
                    .join(", ")}
                </small>
                <small>
                  {key.permissions
                    .map((id) => permissions.find(([p]) => p === id)?.[1] || id)
                    .join(" · ")}
                </small>
                <small>
                  최근 사용:{" "}
                  {key.last_used_at
                    ? new Date(key.last_used_at).toLocaleString()
                    : "없음"}
                </small>
              </div>
              {!key.revoked_at && (
                <button
                  className="text-link"
                  disabled={busy}
                  onClick={() => void revoke(key)}
                >
                  폐기
                </button>
              )}
            </div>
          ))}
          {logs.length > 0 && (
            <details className="api-request-log">
              <summary>최근 API 사용 기록 ({logs.length}건)</summary>
              {logs.map((log) => (
                <div key={log.id}>
                  <strong>
                    {log.name} · {log.status}
                  </strong>
                  <code>
                    {log.method} {log.path}
                  </code>
                  <small>{new Date(log.created_at).toLocaleString()}</small>
                </div>
              ))}
            </details>
          )}
          <p className="entry-hint">
            연결할 때 Authorization: Bearer 앱비밀번호를 사용해요. 공유 해제·키
            폐기·비밀번호 변경·모든 기기 로그아웃 시 접근이 차단됩니다.
          </p>
        </>
      )}
      <ErrorText error={error} />
    </Modal>
  );
}
