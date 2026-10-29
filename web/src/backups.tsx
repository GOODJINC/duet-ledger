import { useEffect, useState, type FormEvent } from "react";
import { api, post, download } from "./api";
import { msg, intlLocale } from "./i18n";
import { Modal, Icon, ErrorText, Busy, PasswordInput } from "./ui";
import { useTask } from "./use-task";
import type { DialogProps } from "./dialogs";

type Backup = {
  name: string;
  size: number;
  created_at: string;
  before_restore?: boolean;
};
type Preview = {
  token: string;
  created_at: string;
  users: number;
  accounts: number;
  transactions: number;
  receipts: number;
  expires_at: string;
};

function AuthenticationFields(p: {
  password: string;
  setPassword: (value: string) => void;
  code: string;
  setCode: (value: string) => void;
  totp: boolean;
}) {
  return (
    <>
      <label className="form-label" htmlFor="backup-password">
        {msg("현재 비밀번호")}
      </label>
      <PasswordInput
        id="backup-password"
        value={p.password}
        onChange={(e) => p.setPassword(e.target.value)}
        autoComplete="current-password"
        required
      />
      {p.totp && (
        <>
          <label className="form-label" htmlFor="backup-code">
            {msg("인증 코드 또는 복구 코드")}
          </label>
          <input
            id="backup-code"
            className="field-input"
            value={p.code}
            onChange={(e) => p.setCode(e.target.value)}
            autoComplete="one-time-code"
            required
          />
        </>
      )}
    </>
  );
}

export function BackupDialog(p: DialogProps) {
  const [tab, setTab] = useState<"backup" | "restore">("backup");
  const [backups, setBackups] = useState<Backup[]>([]);
  const [source, setSource] = useState("");
  const [archive, setArchive] = useState<File>();
  const [key, setKey] = useState<File>();
  const [preview, setPreview] = useState<Preview>();
  const [keyForm, setKeyForm] = useState(false);
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const task = useTask();
  async function load() {
    setBackups(await api<Backup[]>("/backups"));
  }
  useEffect(() => {
    load().catch((e) => task.setError(e.message));
  }, []);
  const auth = {
    password,
    setPassword,
    code,
    setCode,
    totp: p.user.totp_enabled,
  };
  function resetPreview() {
    setPreview(undefined);
    setConfirmed(false);
    setPassword("");
    setCode("");
    task.setError("");
  }
  async function inspect(e: FormEvent) {
    e.preventDefault();
    await task.run(async () => {
      const form = new FormData();
      if (source) form.append("name", source);
      else if (archive) form.append("archive", archive);
      else throw new Error(msg("복원할 백업을 하나 선택해 주세요."));
      if (key) form.append("key", key);
      setPreview(
        await api<Preview>("/backups/restore/preview", {
          method: "POST",
          body: form,
        }),
      );
      setPassword("");
      setCode("");
      setConfirmed(false);
    });
  }
  async function restore(e: FormEvent) {
    e.preventDefault();
    if (!preview || !confirmed) return;
    await task.run(async () => {
      await post("/backups/restore/confirm", {
        token: preview.token,
        password,
        code,
        confirm: true,
      });
      window.location.reload();
    });
  }
  async function saveKey(e: FormEvent) {
    e.preventDefault();
    await task.run(async () => {
      const result = await post<{ key: string }>("/backups/key", {
        password,
        code,
      });
      const bytes = Uint8Array.from(atob(result.key), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(
        new Blob([bytes], { type: "application/octet-stream" }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "master.key";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setPassword("");
      setCode("");
      setKeyForm(false);
      p.notify(msg("키 파일을 백업 ZIP과 함께 안전하게 보관해 주세요."));
    });
  }
  return (
    <Modal
      title={msg("백업과 복원")}
      subtitle={msg("서버 관리자 전용 · 모든 사용자의 자료")}
      onClose={() => {
        if (!task.busy) p.close();
      }}
    >
      <div className="settings-tabs backup-tabs">
        {(["backup", "restore"] as const).map((value) => (
          <button
            key={value}
            className={tab === value ? "active" : ""}
            disabled={task.busy}
            onClick={() => {
              setTab(value);
              setKeyForm(false);
              resetPreview();
            }}
          >
            {value === "backup" ? msg("백업") : msg("복원")}
          </button>
        ))}
      </div>
      <ErrorText error={task.error} />
      {tab === "backup" ? (
        <>
          <div className="inline-warning">
            {msg(
              "모든 사용자의 비공개 자료와 영수증을 포함해요. 백업 ZIP은 암호화되지 않으므로 안전한 곳에 보관해 주세요.",
            )}
          </div>
          <p className="setting-explainer">
            {msg(
              "하루마다 자동 백업하고 최근 7개를 보관해요. 수동 백업도 정리 대상이므로 필요한 파일은 다른 장치에 내려받아 주세요.",
            )}
          </p>
          <button
            className="primary-button entry-submit"
            disabled={task.busy}
            onClick={() =>
              task.run(async () => {
                const result = await post<{ name: string }>("/backups");
                await load();
                await download(`/backups/${result.name}`, result.name);
                p.notify(msg("백업을 만들고 파일 검증을 마쳤어요."));
              })
            }
          >
            <Busy busy={task.busy}>{msg("백업 만들고 다운로드")}</Busy>
          </button>
          <section className="subform">
            <div className="management-row">
              <div>
                <h3>{msg("복원용 키 파일")}</h3>
                <p>
                  {msg(
                    "master.key는 ZIP에 포함되지 않아요. 처음 한 번 내려받아 별도로 보관해 주세요.",
                  )}
                </p>
              </div>
              <button
                className="secondary-button"
                disabled={task.busy}
                onClick={() => {
                  setKeyForm(!keyForm);
                  setPassword("");
                  setCode("");
                }}
              >
                {msg("키 파일 다운로드")}
              </button>
            </div>
            {keyForm && (
              <form onSubmit={saveKey}>
                <AuthenticationFields {...auth} />
                <button
                  className="primary-button entry-submit"
                  disabled={task.busy}
                >
                  <Busy busy={task.busy}>{msg("확인 후 다운로드")}</Busy>
                </button>
              </form>
            )}
          </section>
          <section className="subform">
            <h3>{msg("저장된 백업")}</h3>
            {backups.map((b) => (
              <div className="management-row backup-row" key={b.name}>
                <div>
                  <strong>
                    {new Date(b.created_at).toLocaleString(intlLocale())}
                  </strong>
                  <p>
                    {b.before_restore && <>{msg("복원 직전 자동 백업")} · </>}
                    {(b.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
                <div className="backup-actions">
                  <button
                    className="secondary-button"
                    disabled={task.busy}
                    aria-label={msg("백업 다운로드")}
                    onClick={() =>
                      task.run(() => download(`/backups/${b.name}`, b.name))
                    }
                  >
                    <Icon name="download" />
                  </button>
                  <button
                    className="secondary-button"
                    disabled={task.busy}
                    onClick={() => {
                      setSource(b.name);
                      setKey(undefined);
                      setTab("restore");
                      resetPreview();
                    }}
                  >
                    {msg("복원")}
                  </button>
                </div>
              </div>
            ))}
            {!backups.length && (
              <p className="setting-explainer">{msg("아직 백업이 없어요.")}</p>
            )}
          </section>
        </>
      ) : (
        <>
          <div className="inline-warning">
            <strong>
              {msg("모든 사용자의 자료가 백업 시점으로 바뀝니다.")}
            </strong>
            <br />
            {msg(
              "복원 전 현재 자료를 자동 백업해요. 복원이 끝나면 모두 다시 로그인해야 하며, 기존 초대 링크와 API 앱 비밀번호는 사용할 수 없어요.",
            )}
          </div>
          {!preview ? (
            <form className="backup-restore-form" onSubmit={inspect}>
              <label className="form-label" htmlFor="restore-source">
                {msg("복원할 백업")}
              </label>
              <select
                id="restore-source"
                className="field-select"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                disabled={task.busy}
              >
                <option value="">{msg("내 장치에서 ZIP 선택")}</option>
                {backups.map((b) => (
                  <option value={b.name} key={b.name}>
                    {new Date(b.created_at).toLocaleString(intlLocale())}
                    {b.before_restore ? " · " + msg("복원 직전 자동 백업") : ""}
                  </option>
                ))}
              </select>
              {!source && (
                <label className="design-file-box backup-file">
                  <Icon name="plus" />
                  <span>
                    {archive?.name || msg("백업 ZIP 첨부 (최대 512MB)")}
                  </span>
                  <input
                    type="file"
                    className="visually-hidden"
                    accept=".zip,application/zip"
                    aria-label={msg("백업 ZIP")}
                    disabled={task.busy}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file && file.size > 512 * 1024 * 1024) {
                        task.setError(
                          msg(
                            "백업 ZIP은 512MB 이하, 키 파일은 32바이트여야 해요.",
                          ),
                        );
                        setArchive(undefined);
                      } else {
                        setArchive(file);
                        task.setError("");
                      }
                    }}
                  />
                </label>
              )}
              <label className="form-label">
                {msg("원래 키 파일 (다른 서버의 백업인 경우)")}
              </label>
              <label className="design-file-box backup-file">
                <Icon name="plus" />
                <span>{key?.name || msg("master.key 첨부")}</span>
                <input
                  type="file"
                  className="visually-hidden"
                  accept=".key"
                  aria-label="master.key"
                  disabled={task.busy}
                  onChange={(e) => {
                    setKey(e.target.files?.[0]);
                  }}
                />
              </label>
              {key && (
                <button
                  type="button"
                  className="text-link"
                  disabled={task.busy}
                  onClick={() => setKey(undefined)}
                >
                  {msg("키 파일 선택 해제")}
                </button>
              )}
              <p className="setting-explainer">
                {msg(
                  "같은 서버에서 만든 백업은 현재 키를 자동으로 사용해요. 512MB보다 큰 ZIP이나 서버에 로그인할 수 없는 경우에는 매뉴얼의 명령어 복원을 이용해 주세요.",
                )}
              </p>
              <button
                className="primary-button entry-submit"
                disabled={task.busy || (!source && !archive)}
              >
                <Busy busy={task.busy}>{msg("백업 확인하기")}</Busy>
              </button>
            </form>
          ) : (
            <form onSubmit={restore} className="backup-restore-form">
              <h3>{msg("복원할 자료 확인")}</h3>
              <p>{new Date(preview.created_at).toLocaleString(intlLocale())}</p>
              <dl className="backup-summary">
                <div>
                  <dt>{msg("사용자")}</dt>
                  <dd>{preview.users}</dd>
                </div>
                <div>
                  <dt>{msg("계좌")}</dt>
                  <dd>{preview.accounts}</dd>
                </div>
                <div>
                  <dt>{msg("거래")}</dt>
                  <dd>{preview.transactions}</dd>
                </div>
                <div>
                  <dt>{msg("영수증")}</dt>
                  <dd>{preview.receipts}</dd>
                </div>
              </dl>
              <p className="setting-explainer">
                {msg(
                  "확인한 자료는 10분 동안 복원할 수 있어요. 현재 서버의 master.key는 유지돼요.",
                )}
              </p>
              <AuthenticationFields {...auth} />
              <label className="backup-confirm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  required
                />
                {msg("모든 사용자 자료가 바뀌는 것을 확인했어요.")}
              </label>
              <div className="backup-actions">
                <button
                  type="button"
                  className="secondary-button"
                  disabled={task.busy}
                  onClick={resetPreview}
                >
                  {msg("다시 선택")}
                </button>
                <button
                  className="primary-button"
                  disabled={task.busy || !confirmed}
                >
                  <Busy busy={task.busy}>{msg("현재 자료 백업 후 복원")}</Busy>
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </Modal>
  );
}
