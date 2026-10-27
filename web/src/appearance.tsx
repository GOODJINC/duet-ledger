import { msg, manualURL } from "./i18n";
import { useEffect, useState } from "react";
import { api } from "./api";
import { Help, Icon } from "./ui";

export type Appearance = {
  scale: number;
  background: string;
  primary: string;
  css: string;
  cssName: string;
  font: string;
  fontName: string;
};
const defaults: Appearance = {
  scale: 100,
  background: "",
  primary: "",
  css: "",
  cssName: "",
  font: "",
  fontName: "",
};
const key = (id: string) => `duet-ledger-appearance-${id}`;
export function validateCSS(text: string) {
  // Block resource loads and encoded tokens, including CSS escape obfuscation.
  if (
    /[\\<>\u0000]|url\s*\(|@import|@namespace|@document|@font-face|image\s*\(|image-set\s*\(|expression\s*\(|-moz-binding|behavior\s*:/i.test(
      text.replace(/\/\*[\s\S]*?\*\//g, ""),
    )
  )
    throw new Error(
      msg("CSS는 외부 주소·글꼴 선언·이스케이프 문자를 포함할 수 없어요."),
    );
  return text;
}
function load(id: string): Appearance {
  try {
    const value = {
      ...defaults,
      ...JSON.parse(localStorage.getItem(key(id)) || "{}"),
    };
    value.scale = Math.max(90, Math.min(150, Number(value.scale) || 100));
    for (const field of ["background", "primary"] as const)
      if (!/^#[\da-f]{6}$/i.test(value[field])) value[field] = "";
    value.css = "";
    value.cssName = "";
    value.font = "";
    value.fontName = "";
    return value;
  } catch {
    return { ...defaults };
  }
}
export function useAppearance(id: string) {
  useEffect(() => {
    let active = true;
    let revision = "";
    let syncVersion = 0;
    const globalStyle = document.createElement("style");
    globalStyle.dataset.duetServerAppearance = "true";
    document.head.append(globalStyle);
    async function syncServer() {
      const version = ++syncVersion;
      if (new URLSearchParams(location.search).has("safe-theme")) {
        globalStyle.textContent = "";
        return;
      }
      try {
        const meta = await api<ServerAppearance>("/appearance");
        const next =
          (meta.css?.revision || "") + ":" + (meta.font?.revision || "");
        if (!active || version !== syncVersion || revision === next) return;
        let css = "";
        if (meta.css?.revision) {
          const response = await fetch(
            "/api/appearance/css?revision=" + meta.css.revision,
            { credentials: "same-origin", cache: "no-store" },
          );
          if (!response.ok) return;
          css = await response.text();
          validateCSS(css);
        }
        const font = meta.font?.revision
          ? `@font-face{font-family:DuetServerFont;src:url("/api/appearance/font?revision=${encodeURIComponent(meta.font.revision)}") format("woff2");font-display:swap}body,input,select,textarea,button{font-family:DuetServerFont,system-ui,sans-serif}`
          : "";
        if (active && version === syncVersion) {
          revision = next;
          globalStyle.textContent = font + css;
        }
      } catch {
        /* Keep the last successful server design during a network interruption. */
      }
    }
    const apply = () => {
      const safe = new URLSearchParams(location.search).has("safe-theme");
      const v = safe ? defaults : load(id);
      const body = document.body;
      body.style.setProperty("--text-scale", String(v.scale / 100));
      for (const [name, value] of [
        ["--bg", v.background],
        ["--green", v.primary],
      ] as const) {
        if (value) body.style.setProperty(name, value);
        else body.style.removeProperty(name);
      }
    };
    apply();
    void syncServer();
    const poll = window.setInterval(() => void syncServer(), 15000);
    window.addEventListener("duet-server-appearance", syncServer);
    window.addEventListener("duet-appearance", apply);
    window.addEventListener("storage", apply);
    return () => {
      active = false;
      clearInterval(poll);
      globalStyle.remove();
      window.removeEventListener("duet-server-appearance", syncServer);
      for (const name of ["--text-scale", "--bg", "--green"])
        document.body.style.removeProperty(name);
      window.removeEventListener("duet-appearance", apply);
      window.removeEventListener("storage", apply);
    };
  }, [id]);
}
export function AppearanceSettings({
  userId,
  embedded = false,
}: {
  userId: string;
  embedded?: boolean;
}) {
  const [value, setValue] = useState(() => load(userId));
  const [message, setMessage] = useState("");
  const [scaleDraft, setScaleDraft] = useState(String(value.scale));
  function save(next: Appearance) {
    try {
      localStorage.setItem(key(userId), JSON.stringify(next));
      setValue(next);
      setScaleDraft(String(next.scale));
      window.dispatchEvent(new Event("duet-appearance"));
      setMessage(msg("이 브라우저에 적용했어요."));
    } catch {
      setMessage(
        msg("브라우저 저장 공간이 부족해요. 파일 크기를 줄여 주세요."),
      );
    }
  }
  const Container = embedded ? "div" : "section";
  const Heading = embedded ? "h3" : "h2";
  return (
    <Container className={embedded ? "browser-settings-group" : "panel"}>
      <div className="setting-group">
        <Heading>
          {msg("디자인 직접 설정")}{" "}
          <Help>
            {msg(
              "글씨 크기·색상은 현재 브라우저에 저장해요. 공통 CSS·글꼴은 관리자가 설정해요.",
            )}
          </Help>
        </Heading>
        <div className="setting-row">
          <label htmlFor="custom-size">
            {msg("글씨 크기")}
            <small className="scale-range">{msg("90~150% · 1% 단위")}</small>
          </label>
          <div>
            <input
              id="custom-size"
              aria-label={msg("글씨 크기")}
              type="number"
              min="90"
              max="150"
              step="1"
              value={scaleDraft}
              inputMode="numeric"
              onChange={(e) => {
                const raw = e.target.value;
                setScaleDraft(raw);
                const n = Number(raw);
                if (raw && Number.isInteger(n) && n >= 90 && n <= 150)
                  save({ ...value, scale: n });
              }}
              onBlur={() => {
                const n = Math.round(Number(scaleDraft));
                save({
                  ...value,
                  scale: Math.max(90, Math.min(150, n || value.scale)),
                });
              }}
            />
            <span aria-hidden="true">%</span>
          </div>
        </div>
        <div className="setting-row">
          <label htmlFor="custom-bg">{msg("배경색")}</label>
          <input
            id="custom-bg"
            type="color"
            value={value.background || "#f6f8f5"}
            onChange={(e) => save({ ...value, background: e.target.value })}
          />
        </div>
        <div className="setting-row">
          <label htmlFor="custom-primary">{msg("메인 색상")}</label>
          <input
            id="custom-primary"
            type="color"
            value={value.primary || "#2d6b50"}
            onChange={(e) => save({ ...value, primary: e.target.value })}
          />
        </div>
        <button
          className="secondary-button"
          onClick={() => save({ ...defaults })}
        >
          {msg("개인 디자인 초기화")}
        </button>
        <p role="status" className="entry-hint">
          {message}
        </p>
      </div>
    </Container>
  );
}

export type ServerAppearance = {
  css: { name: string; revision: string };
  font: { name: string; revision: string };
};
const emptyServer: ServerAppearance = {
  css: { name: "", revision: "" },
  font: { name: "", revision: "" },
};
export function ServerAppearanceSettings() {
  const [value, setValue] = useState(emptyServer);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    api<ServerAppearance>("/appearance")
      .then((v) => {
        if (active) setValue(v?.css && v?.font ? v : emptyServer);
      })
      .catch((e) => setMessage(e.message));
    return () => {
      active = false;
    };
  }, []);
  async function update(kind: "css" | "font", file?: File) {
    setBusy(true);
    setMessage("");
    try {
      if (file) {
        if (kind === "css") validateCSS(await file.text());
        const form = new FormData();
        form.append("file", file);
        await api("/admin/appearance/" + kind, { method: "PUT", body: form });
      } else await api("/admin/appearance/" + kind, { method: "DELETE" });
      setValue(await api<ServerAppearance>("/appearance"));
      window.dispatchEvent(new Event("duet-server-appearance"));
      setMessage(msg("모든 사용자에게 적용했어요."));
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="setting-group">
        <h2 className="settings-section-title">
          {msg("공통 CSS·글꼴")}{" "}
          <Help>
            {msg(
              "관리자만 공통 CSS·WOFF2 파일을 적용할 수 있어요. 모든 사용자에게 적용되며 서버 백업에 포함돼요. 화면이 가려지면 /admin?safe-theme=1에서 해제해요.",
            )}
          </Help>
        </h2>
        <p className="settings-section-description">
          {msg("관리자가 설정한 디자인을 모든 사용자에게 적용해요.")}
        </p>
        <div className="appearance-guide-links">
          <a
            className="text-link"
            href={manualURL("appearance")}
            target="_blank"
            rel="noopener noreferrer"
          >
            {msg("CSS·글꼴 적용 안내")}
          </a>
          <a
            className="text-link"
            href="/manual/samples/soft-blue.css"
            download="duet-ledger-soft-blue.css"
          >
            {msg("샘플 CSS 다운로드")}
          </a>
        </div>
        {(["css", "font"] as const).map((kind) => (
          <div className="setting-row" key={kind}>
            <div className="appearance-file-title">
              {kind === "css" ? msg("CSS 파일") : msg("사용자 글꼴")}
              <Help>
                {kind === "css"
                  ? msg(
                      "CSS 파일로 색상·간격을 바꿔요. 앱의 파일 용량 제한은 없어요.",
                    )
                  : msg(
                      "사용 권한이 있는 WOFF2 글꼴을 올려요. 앱의 파일 용량 제한은 없어요.",
                    )}
              </Help>
            </div>
            <label className="design-file-box" htmlFor={"server-" + kind}>
              <Icon name="plus" size={18} />
              <span>{value[kind]?.name || msg("파일 첨부")}</span>
              <input
                id={"server-" + kind}
                aria-label={
                  kind === "css" ? msg("공통 CSS 파일") : msg("공통 글꼴 파일")
                }
                type="file"
                className="visually-hidden"
                accept={kind === "css" ? ".css,text/css" : ".woff2,font/woff2"}
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void update(kind, file);
                  e.target.value = "";
                }}
              />
            </label>
            {value[kind]?.name && (
              <button
                className="text-link"
                disabled={busy}
                onClick={() => {
                  if (
                    confirm(
                      msg("모든 사용자의 공통 {0} 적용을 해제할까요?", [
                        kind === "css" ? "CSS" : msg("글꼴"),
                      ]),
                    )
                  )
                    void update(kind);
                }}
              >
                {msg("해제")}
              </button>
            )}
          </div>
        ))}
        <p className="entry-hint" role="status">
          {message}
        </p>
      </div>
    </section>
  );
}
