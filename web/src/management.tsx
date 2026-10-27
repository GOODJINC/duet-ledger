import { AccessReview } from "./access-review";
import { useTask } from "./use-task";
import { msg, intlLocale } from "./i18n";
import { copyText } from "./clipboard";
import { useEffect, useState, useRef, type FormEvent } from "react";
import { api, post, download, setCSRF, type User, type Sharing } from "./api";
import { PasswordInput, Modal, Icon, ErrorText, Busy } from "./ui";
import type { DialogProps } from "./dialogs";
export function LifecycleDialog(p: DialogProps) {
  const ownerPasswordRef = useRef<HTMLInputElement>(null);
  const [sharing, setSharing] = useState<Sharing>({
    invitations: [],
    shares: [],
  });
  const [ledger, setLedger] = useState(
    p.ledgers.find((l) => l.kind === "shared" && l.role === "owner")?.id || "",
  );
  const [member, setMember] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const task = useTask();
  useEffect(() => {
    api<Sharing>("/sharing")
      .then(setSharing)
      .catch((e) => task.setError(e.message));
  }, []);
  const choices = sharing.shares.filter(
    (s) => s.target_type === "ledger" && s.target_id === ledger,
  );
  return (
    <Modal
      title={msg("함께 시작하고, 안전하게 나와요.")}
      subtitle={msg(
        "공유 종료나 책임자 변경으로 원본 금융 기록을 지우지 않습니다.",
      )}
      onClose={p.close}
    >
      <section>
        <h3>{msg("공유 가계부 책임자 이전")}</h3>
        <label className="form-label" htmlFor="owner-ledger">
          {msg("가계부")}
        </label>
        <select
          id="owner-ledger"
          className="field-select"
          value={ledger}
          onChange={(e) => {
            setLedger(e.target.value);
            setMember("");
          }}
        >
          <option value="">{msg("가계부 선택")}</option>
          {p.ledgers
            .filter((l) => l.kind === "shared" && l.role === "owner")
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
        </select>
        <label className="form-label" htmlFor="owner-member">
          {msg("새 책임자 · 이미 참여한 멤버")}
        </label>
        <select
          id="owner-member"
          className="field-select"
          value={member}
          onChange={(e) => setMember(e.target.value)}
        >
          <option value="">{msg("멤버 선택")}</option>
          {choices.map((s) => (
            <option key={s.user_id} value={s.user_id}>
              {s.name} (@{s.username})
            </option>
          ))}
        </select>
        <label className="form-label" htmlFor="owner-password">
          {msg("내 비밀번호 확인")}
        </label>
        <PasswordInput
          id="owner-password"
          ref={ownerPasswordRef}
          className="field-input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
        />
        {p.user.totp_enabled && (
          <>
            <label className="form-label" htmlFor="owner-code">
              {msg("인증 코드 또는 복구 코드")}
            </label>
            <input
              id="owner-code"
              className="field-input"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoComplete="one-time-code"
            />
          </>
        )}
        <div className="modal-note">
          {msg(
            "이전 후에는 상대방이 멤버·계좌·공유 권한을 관리합니다. 본인은 편집자로 남으며, 필요하면 별도로 가계부에서 나갈 수 있어요.",
          )}
        </div>
        <button
          className="primary-button entry-submit"
          disabled={task.busy || !ledger || !member}
          onClick={() => {
            if (
              confirm(msg("선택한 멤버에게 가계부 책임자 권한을 이전할까요?"))
            )
              task.run(async () => {
                const result = await post<{ message: string }>(
                  `/ledgers/${ledger}/transfer-owner`,
                  {
                    user_id: member,
                    password: ownerPasswordRef.current?.value ?? password,
                    code,
                  },
                );
                await p.refresh();
                p.notify(result.message);
                p.close();
              });
          }}
        >
          <Busy busy={task.busy}>{msg("책임자 이전")}</Busy>
        </button>
      </section>
      <section className="subform">
        <h3>{msg("참여 중인 가계부에서 나가기")}</h3>
        {p.ledgers
          .filter((l) => l.role !== "owner")
          .map((l) => (
            <div className="management-row" key={l.id}>
              <strong>{l.name}</strong>
              <button
                className="text-link danger"
                disabled={task.busy}
                onClick={() => {
                  if (
                    confirm(
                      msg(
                        "가계부에서 나갈까요? 원본 기록은 남고, 별도로 공유받은 계좌 권한도 유지돼요.",
                      ),
                    )
                  )
                    task.run(async () => {
                      const result = await api<{ message: string }>(
                        `/ledgers/${l.id}/membership`,
                        { method: "DELETE" },
                      );
                      await p.refresh();
                      p.notify(result.message);
                    });
                }}
              >
                {msg("나가기")}
              </button>
            </div>
          ))}
        {!p.ledgers.some((l) => l.role !== "owner") && (
          <p className="setting-explainer">
            {msg("다른 사람이 책임자인 참여 가계부가 없어요.")}
          </p>
        )}
      </section>
      <section className="subform">
        <h3>{msg("공유받은 계좌에서 나가기")}</h3>
        {p.accounts
          .filter((a) => a.shared && a.role !== "owner")
          .map((a) => (
            <div className="management-row" key={a.id}>
              <strong>{a.name}</strong>
              <button
                className="text-link danger"
                disabled={task.busy}
                onClick={() => {
                  if (confirm(msg("이 계좌의 직접 공유 권한을 해제할까요?")))
                    task.run(async () => {
                      const result = await api<{ message: string }>(
                        `/accounts/${a.id}/grant`,
                        { method: "DELETE" },
                      );
                      await p.refresh();
                      p.notify(result.message);
                    });
                }}
              >
                {msg("직접 공유 해제")}
              </button>
            </div>
          ))}
        <p className="setting-explainer">
          {msg(
            "가계부 멤버 권한으로만 보고 있는 계좌는 가계부에서 나가야 합니다.",
          )}
        </p>
      </section>
      <ErrorText error={task.error} />
    </Modal>
  );
}

export function SharingDialog(p: DialogProps) {
  const [data, setData] = useState<Sharing>({ invitations: [], shares: [] });
  const [type, setType] = useState("account");
  const targets =
    type === "account"
      ? p.accounts
          .filter((a) => a.role === "owner")
          .map((a) => ({ id: a.id, name: a.name }))
      : p.ledgers.filter((l) => l.role === "owner" && l.kind === "shared");
  const [target, setTarget] = useState("");
  const [role, setRole] = useState("editor");
  const [link, setLink] = useState("");
  const task = useTask();
  async function load() {
    setData(await api<Sharing>("/sharing"));
  }
  useEffect(() => {
    load().catch((e) => task.setError(e.message));
  }, []);
  useEffect(() => {
    if (!targets.some((t) => t.id === target)) setTarget(targets[0]?.id || "");
  }, [type, p.accounts, p.ledgers]);
  return (
    <Modal
      title={msg("필요한 만큼, 함께.")}
      className="sharing-dialog"
      subtitle={msg("공유하지 않아도 개인 가계부로 완전하게 사용할 수 있어요.")}
      onClose={p.close}
    >
      <div className="privacy-notice">
        <Icon name="shield" />
        <div>
          <strong>{msg("공유하면 과거 내역·잔액·첨부 사진도 보여요.")}</strong>
          <p>
            {msg(
              "초대 수락 뒤 책임자가 승인해야 내용이 공개됩니다. 이미 저장한 자료는 공유 해제 후 회수할 수 없어요.",
            )}
          </p>
        </div>
      </div>
      <AccessReview accounts={p.accounts} />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          task.run(async () => {
            const result = await post<{ token: string }>("/invitations", {
              target_type: type,
              target_id: target,
              role,
            });
            setLink(location.origin + "/#invite=" + result.token);
            await load();
          });
        }}
      >
        <label className="form-label" htmlFor="share-type">
          {msg("무엇을 공유할까요?")}
        </label>
        <select
          id="share-type"
          className="field-select"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="account">{msg("특정 계좌만 공유")}</option>
          <option value="ledger">{msg("공유 가계부 전체 공유")}</option>
        </select>
        <label className="form-label" htmlFor="share-target">
          {msg("대상")}
        </label>
        <select
          id="share-target"
          className="field-select"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          required
        >
          <option value="" disabled>
            {msg("공유 대상 선택")}
          </option>
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        {!targets.length && (
          <p className="entry-hint">
            {msg("먼저 계좌 또는 공유 가계부를 만들어 주세요.")}
          </p>
        )}
        <label className="form-label" htmlFor="share-role">
          {msg("상대방의 역할")}
        </label>
        <select
          id="share-role"
          className="field-select"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          <option value="editor">{msg("편집자 · 조회·입력·수정 가능")}</option>
          <option value="viewer">{msg("조회자 · 보기만 가능")}</option>
        </select>
        <button
          className="primary-button entry-submit"
          disabled={task.busy || !targets.length}
        >
          <Busy busy={task.busy}>{msg("48시간 초대 링크 만들기")}</Busy>
        </button>
      </form>
      {link && (
        <div className="invite-link-box">
          <strong>{msg("이 링크는 지금 한 번만 보여요.")}</strong>
          <p>
            {msg(
              "상대방에게 전달하고, 아래에서 수락한 아이디를 확인해 승인하세요.",
            )}
          </p>
          <input
            className="field-input"
            readOnly
            value={link}
            aria-label={msg("초대 링크")}
            onFocus={(e) => e.target.select()}
          />
          <button
            className="secondary-button"
            onClick={() =>
              task.run(async () => {
                await copyText(link);
                p.notify(msg("초대 링크를 복사했어요."));
              })
            }
          >
            <Icon name="copy" />
            {msg("링크 복사")}
          </button>
        </div>
      )}
      <ErrorText error={task.error} />
      <section className="subform">
        <h3>{msg("승인 대기·초대 관리")}</h3>
        {data.invitations
          .filter((i) => ["open", "pending"].includes(i.status))
          .map((i) => (
            <div className="management-row" key={i.id}>
              <div>
                <strong>{i.target_name}</strong>
                <p>
                  {i.status === "pending"
                    ? `${i.claimant_name} (@${i.claimant_username}) · ${i.claimant_id.slice(0, 8)}`
                    : msg("수락 대기")}{" "}
                  · {i.role === "editor" ? msg("편집") : msg("조회")}
                </p>
                <small>
                  {new Date(i.expires_at * 1000).toLocaleString(intlLocale())}{" "}
                  {msg("만료")}
                </small>
              </div>
              <div className="row-actions">
                {i.status === "pending" && i.expires_at * 1000 > Date.now() && (
                  <button
                    className="secondary-button"
                    disabled={task.busy}
                    onClick={() =>
                      task.run(async () => {
                        await post(`/invitations/${i.id}/approve`);
                        await load();
                        await p.refresh();
                        p.notify(msg("공유를 승인했어요."));
                      })
                    }
                  >
                    {msg("승인")}
                  </button>
                )}
                <button
                  className="text-link"
                  disabled={task.busy}
                  onClick={() =>
                    task.run(async () => {
                      await post(`/invitations/${i.id}/cancel`);
                      await load();
                    })
                  }
                >
                  {msg("취소")}
                </button>
              </div>
            </div>
          ))}
        {!data.invitations.some((i) =>
          ["open", "pending"].includes(i.status),
        ) && (
          <p className="setting-explainer">{msg("대기 중인 초대가 없어요.")}</p>
        )}
      </section>
      <section className="subform">
        <h3>{msg("현재 공유 중")}</h3>
        {data.shares.map((s) => (
          <div
            className="management-row"
            key={s.target_type + s.target_id + s.user_id}
          >
            <div>
              <strong>
                {s.target_name} · {s.name}
              </strong>
              <p>
                {s.target_type === "account"
                  ? msg("이 계좌만")
                  : msg("가계부 전체")}{" "}
                · @{s.username}
              </p>
            </div>
            <div className="row-actions">
              <select
                className="compact-select"
                aria-label={msg("{0}의 역할", [s.name])}
                value={s.role}
                disabled={task.busy}
                onChange={(e) => {
                  const role = e.target.value;
                  task.run(async () => {
                    await post(
                      `/sharing/${s.target_type}/${s.target_id}/${s.user_id}`,
                      { role },
                      "PUT",
                    );
                    await load();
                    await p.refresh();
                  });
                }}
              >
                <option value="editor">{msg("편집자")}</option>
                <option value="viewer">{msg("조회자")}</option>
              </select>
              <button
                className="text-link danger"
                disabled={task.busy}
                onClick={() => {
                  if (
                    confirm(
                      msg(
                        "이 공유 경로를 해제할까요? 원본 기록은 유지됩니다. 다른 공유 경로가 남아 있으면 접근도 유지돼요.",
                      ),
                    )
                  )
                    task.run(async () => {
                      const result = await api<{ message: string }>(
                        `/sharing/${s.target_type}/${s.target_id}/${s.user_id}`,
                        { method: "DELETE" },
                      );
                      await load();
                      await p.refresh();
                      p.notify(result.message);
                    });
                }}
              >
                {msg("해제")}
              </button>
            </div>
          </div>
        ))}
        {!data.shares.length && (
          <p className="setting-explainer">
            {msg("아직 공유 중인 가계부·계좌가 없어요.")}
          </p>
        )}
      </section>
    </Modal>
  );
}
export function AcceptInviteDialog(p: DialogProps & { token: string }) {
  const [accepted, setAccepted] = useState(false);
  const task = useTask();
  return (
    <Modal
      title={
        accepted
          ? msg("수락했어요. 승인을 기다려 주세요.")
          : msg("함께 쓸 가계부로 초대받았어요.")
      }
      subtitle={msg("수락만으로 금융 기록이 공개되지는 않아요.")}
      onClose={p.close}
    >
      {accepted ? (
        <div className="modal-note">
          {msg("책임자가")} {p.user.name} (@{p.user.username}
          {msg(
            ") 계정임을 확인해 승인하면 공유 내용이 나타납니다. 승인 전에도 본인의 개인 가계부는 사용할 수 있어요.",
          )}
        </div>
      ) : (
        <>
          <div className="modal-note">
            {msg("현재 계정:")} {p.user.name} (@{p.user.username})<br />
            {msg("상대방이 이 계정을 확인할 수 있도록 알려 주세요.")}
          </div>
          <ErrorText error={task.error} />
          <button
            className="primary-button entry-submit"
            disabled={task.busy}
            onClick={() =>
              task.run(async () => {
                await post("/invitations/accept", { token: p.token });
                setAccepted(true);
                await p.refresh();
              })
            }
          >
            <Busy busy={task.busy}>{msg("이 계정으로 초대 수락")}</Busy>
          </button>
        </>
      )}
    </Modal>
  );
}
export function ImportDialog(p: DialogProps) {
  const [content, setContent] = useState("");
  const [filename, setFilename] = useState("");
  const [format, setFormat] = useState("csv");
  const [account, setAccount] = useState(
    p.accounts.find((a) => !a.archived && a.role !== "viewer")?.id || "",
  );
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null);
  const task = useTask();
  async function importRequest(dry_run: boolean) {
    if (format === "json") {
      let data;
      try {
        data = JSON.parse(content);
      } catch {
        throw new Error(msg("JSON 파일 형식을 확인해 주세요."));
      }
      return post<Record<string, unknown>>("/import/json", { data, dry_run });
    }
    return post<Record<string, unknown>>("/import/csv", {
      account_id: account,
      content,
      dry_run,
    });
  }
  return (
    <Modal
      title={msg("기록을 이어서 가져와요.")}
      subtitle={msg(
        "미리 확인한 뒤 반영합니다. CSV는 한 계좌, JSON은 새 개인 가계부로 가져와요.",
      )}
      onClose={p.close}
    >
      <label className="form-label" htmlFor="import-format">
        {msg("파일 종류")}
      </label>
      <select
        id="import-format"
        className="field-select"
        value={format}
        onChange={(e) => {
          setFormat(e.target.value);
          setPreview(null);
          setContent("");
          setFilename("");
        }}
      >
        <option value="csv">{msg("CSV · 한 계좌의 거래 내역")}</option>
        <option value="json">
          {msg("듀엣 가계부 JSON · 가계부 자료 이동")}
        </option>
      </select>
      {format === "csv" && (
        <>
          <label className="form-label" htmlFor="import-account">
            {msg("가져올 계좌")}
          </label>
          <select
            id="import-account"
            className="field-select"
            value={account}
            onChange={(e) => {
              setAccount(e.target.value);
              setPreview(null);
            }}
          >
            <option value="" disabled>
              {msg("계좌 선택")}
            </option>
            {p.accounts
              .filter((a) => a.role !== "viewer" && !a.archived)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.currency}
                </option>
              ))}
          </select>
          <div className="modal-note">
            {msg("UTF-8 CSV의 첫 줄: date, kind, title, amount")}
            <br />
            {msg(
              "선택 열: category, note. 날짜는 YYYY-MM-DD, 금액은 통화의 실제 금액으로 입력해요. 예: USD 12.50.",
            )}
            <br />
            kind: expense / income / transfer / refund / adjustment
          </div>
        </>
      )}
      <label className="receipt-button">
        <Icon name={format === "csv" ? "csv" : "json"} />
        {filename || msg("파일 선택")}
        <input
          type="file"
          key={format}
          className="visually-hidden"
          accept={format === "csv" ? ".csv,text/csv" : ".json,application/json"}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            if (f.size > (format === "csv" ? 5 : 20) * 1024 * 1024) {
              task.setError(
                msg("파일이 너무 커요. CSV 5MB, JSON 20MB까지 지원해요."),
              );
              return;
            }
            task.run(async () => {
              setContent(await f.text());
              setFilename(f.name);
              setPreview(null);
            });
          }}
        />
      </label>
      {preview && (
        <div className="modal-note">
          <strong>{msg("미리 확인")}</strong>
          <pre className="import-preview">
            {JSON.stringify(preview, null, 2)}
          </pre>
          <p>
            {msg(
              "JSON의 기존 공유 권한·로그인 정보·사진은 자동으로 가져오지 않습니다. 사진까지 복구하려면 운영 백업을 사용하세요.",
            )}
          </p>
        </div>
      )}
      <ErrorText error={task.error} />
      <button
        className="primary-button entry-submit"
        disabled={task.busy || !content || (format === "csv" && !account)}
        onClick={() =>
          task.run(async () => {
            if (!preview) {
              setPreview(await importRequest(true));
              return;
            }
            const result = await importRequest(false);
            await p.refresh();
            p.notify(
              format === "csv"
                ? msg("{0}건을 가져왔어요.", [result.inserted])
                : msg("새 개인 가계부로 자료를 가져왔어요."),
            );
            p.close();
          })
        }
      >
        <Busy busy={task.busy}>
          {preview ? msg("확인한 자료 가져오기") : msg("먼저 미리 보기")}
        </Busy>
      </button>
    </Modal>
  );
}
export function BackupDialog(p: DialogProps) {
  const [backups, setBackups] = useState<
    { name: string; size: number; created_at: string }[]
  >([]);
  const task = useTask();
  async function load() {
    setBackups(await api("/backups"));
  }
  useEffect(() => {
    load().catch((e) => task.setError(e.message));
  }, []);
  return (
    <Modal
      title={msg("기록을 안전하게 보관해요.")}
      subtitle={msg("서버 관리자 전용 · 운영 백업")}
      onClose={p.close}
    >
      <div className="inline-warning">
        <strong>{msg("다른 사용자의 비공개 자료도 모두 포함됩니다.")}</strong>
        <br />
        {msg("백업 ZIP은 암호화되지 않습니다. 안전한 곳에 보관해 주세요.")}
        <br />
        <code>master.key</code>
        {msg("는 ZIP에 포함되지 않으므로 별도로 보관해야 합니다.")}
      </div>
      <p className="setting-explainer">
        {msg(
          "거래와 영수증을 함께 백업합니다. 서버 실행 중 하루마다 자동 백업하며, 자동 정리 시 수동 생성분을 포함한 최근 7개만 남깁니다. 필요한 백업은 다른 장치에도 보관하세요.",
        )}
      </p>
      <ErrorText error={task.error} />
      <button
        className="primary-button entry-submit"
        disabled={task.busy}
        onClick={() =>
          task.run(async () => {
            await post("/backups");
            await load();
            p.notify(msg("백업을 만들고 파일 검증을 마쳤어요."));
          })
        }
      >
        <Busy busy={task.busy}>{msg("지금 운영 백업 만들기")}</Busy>
      </button>
      <section className="subform">
        <h3>{msg("저장된 백업")}</h3>
        {backups.map((b) => (
          <div className="management-row" key={b.name}>
            <div>
              <strong>
                {new Date(b.created_at).toLocaleString(intlLocale())}
              </strong>
              <p>{(b.size / 1024 / 1024).toFixed(2)} MB</p>
            </div>
            <button
              className="secondary-button"
              onClick={() =>
                task.run(() => download(`/backups/${b.name}`, b.name))
              }
              disabled={task.busy}
            >
              <Icon name="download" />
              {msg("다운로드")}
            </button>
          </div>
        ))}
        {!backups.length && (
          <p className="setting-explainer">{msg("아직 백업이 없어요.")}</p>
        )}
      </section>
      <div className="modal-note">
        {msg(
          "복원은 새 데이터 폴더에서 서버 명령으로 진행합니다. 기존 자료를 덮어쓰는 웹 복원 기능은 제공하지 않아요. 저장소의 실행 안내 문서를 참고하세요.",
        )}
      </div>
    </Modal>
  );
}
export function SecurityDialog(p: DialogProps) {
  const currentPasswordRef = useRef<HTMLInputElement>(null);
  const [section, setSection] = useState<"password" | "totp">("password");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [code, setCode] = useState("");
  const [secret, setSecret] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const task = useTask();
  async function passwordSubmit(e: FormEvent) {
    e.preventDefault();
    const form = new FormData(e.currentTarget as HTMLFormElement);
    await task.run(async () => {
      const user = await post<User>("/security/password", {
        current: String(form.get("current-password") || ""),
        password: String(form.get("new-password") || ""),
        code,
      });
      setCSRF(user.csrf);
      await p.refresh();
      p.notify(msg("비밀번호를 바꾸고 다른 기기의 로그인을 해제했어요."));
      p.close();
    });
  }
  return (
    <Modal
      title={msg("나의 기록을 지키는 방법.")}
      subtitle={msg("비밀번호·2단계 인증·로그인 세션 관리")}
      onClose={p.close}
    >
      <div className="entry-types">
        <button
          aria-pressed={section === "password"}
          onClick={() => {
            setSection("password");
            task.setError("");
          }}
        >
          {msg("비밀번호")}
        </button>
        <button
          aria-pressed={section === "totp"}
          onClick={() => {
            setSection("totp");
            task.setError("");
          }}
        >
          {msg("2단계 인증")}
        </button>
      </div>
      {codes.length ? (
        <>
          <div className="inline-warning">
            {msg(
              "복구 코드는 지금 한 번만 표시됩니다. 휴대폰을 잃어버렸을 때 사용할 수 있도록 별도로 보관해 주세요.",
            )}
          </div>
          <pre className="recovery-codes">{codes.join("\n")}</pre>
          <button
            className="secondary-button"
            onClick={() =>
              task.run(async () => {
                await copyText(codes.join("\n"));
                p.notify(msg("복구 코드를 복사했어요."));
              })
            }
          >
            <Icon name="copy" />
            {msg("복사")}
          </button>
        </>
      ) : section === "password" ? (
        <form onSubmit={passwordSubmit}>
          <label className="form-label" htmlFor="current-password">
            {msg("현재 비밀번호")}
          </label>
          <PasswordInput
            type="password"
            id="current-password"
            className="field-input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            maxLength={256}
          />
          <label className="form-label" htmlFor="new-password">
            {msg("새 비밀번호 · 8자 이상")}
          </label>
          <PasswordInput
            type="password"
            id="new-password"
            className="field-input"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            autoComplete="new-password"
            minLength={8}
            maxLength={256}
            required
          />
          {p.user.totp_enabled && (
            <>
              <label className="form-label" htmlFor="password-otp">
                {msg("인증 코드 또는 복구 코드")}
              </label>
              <input
                id="password-otp"
                className="field-input"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                required
                autoComplete="one-time-code"
              />
            </>
          )}
          <button className="primary-button entry-submit" disabled={task.busy}>
            <Busy busy={task.busy}>{msg("비밀번호 변경")}</Busy>
          </button>
        </form>
      ) : (
        <>
          <div className="modal-note">
            {msg("현재 2단계 인증:")}{" "}
            <strong>
              {p.user.totp_enabled ? msg("사용 중") : msg("사용하지 않음")}
            </strong>
            <br />
            {msg("인증 앱의 6자리 코드로 로그인을 한 번 더 보호할 수 있어요.")}
          </div>
          {!secret ? (
            <>
              <label className="form-label" htmlFor="totp-password">
                {msg("현재 비밀번호")}
              </label>
              <PasswordInput
                type="password"
                id="totp-password"
                ref={currentPasswordRef}
                className="field-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              {p.user.totp_enabled && (
                <>
                  <label className="form-label" htmlFor="totp-disable-code">
                    {msg("인증 코드 또는 복구 코드")}
                  </label>
                  <input
                    id="totp-disable-code"
                    className="field-input"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    autoComplete="one-time-code"
                  />
                </>
              )}
              <button
                className="primary-button entry-submit"
                disabled={task.busy}
                onClick={() =>
                  task.run(async () => {
                    const enteredPassword =
                      currentPasswordRef.current?.value ?? password;
                    if (!enteredPassword)
                      throw new Error(msg("현재 비밀번호를 입력해 주세요."));
                    if (p.user.totp_enabled) {
                      if (
                        !confirm(
                          msg(
                            "2단계 인증을 해제할까요? 비밀번호만으로 로그인하게 됩니다.",
                          ),
                        )
                      )
                        return;
                      const user = await post<User>("/security/totp/disable", {
                        password: enteredPassword,
                        code,
                      });
                      setCSRF(user.csrf);
                      await p.refresh();
                      p.notify(msg("2단계 인증을 해제했어요."));
                      p.close();
                    } else {
                      const result = await post<{
                        secret: string;
                        uri: string;
                      }>("/security/totp/start", { password: enteredPassword });
                      setSecret(result.secret);
                    }
                  })
                }
              >
                <Busy busy={task.busy}>
                  {p.user.totp_enabled
                    ? msg("2단계 인증 해제")
                    : msg("인증 앱 등록 시작")}
                </Busy>
              </button>
            </>
          ) : (
            <>
              <div className="modal-note">
                {msg(
                  "인증 앱에서 ‘설정 키 직접 입력’을 선택하고 아래 키를 등록하세요. 종류는 시간 기반(TOTP)입니다.",
                )}
              </div>
              <code className="secret-key">{secret}</code>
              <label className="form-label" htmlFor="totp-confirm">
                {msg("인증 앱의 6자리 코드")}
              </label>
              <input
                id="totp-confirm"
                className="field-input"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={6}
              />
              <button
                className="primary-button entry-submit"
                disabled={task.busy || code.length !== 6}
                onClick={() =>
                  task.run(async () => {
                    const result = await post<{
                      recovery_codes: string[];
                      csrf: string;
                    }>("/security/totp/confirm", { code });
                    setCSRF(result.csrf);
                    setCodes(result.recovery_codes);
                    setSecret("");
                    await p.refresh();
                  })
                }
              >
                <Busy busy={task.busy}>{msg("등록 확인·복구 코드 받기")}</Busy>
              </button>
            </>
          )}
        </>
      )}
      <ErrorText error={task.error} />
      <div className="subform">
        <button
          className="secondary-button"
          disabled={task.busy}
          onClick={() =>
            task.run(async () => {
              await post("/logout-all");
              window.dispatchEvent(new Event("duet-ledger:unauthorized"));
            })
          }
        >
          <Icon name="logout" />
          {msg("모든 기기 로그아웃")}
        </button>
      </div>
    </Modal>
  );
}
