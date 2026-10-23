import { useEffect, useState } from "react";
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
  scale: 112,
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
    new TextEncoder().encode(text).length > 65536 ||
    /[\\<>\u0000]|url\s*\(|@import|@namespace|@document|@font-face|image\s*\(|image-set\s*\(|expression\s*\(|-moz-binding|behavior\s*:/i.test(
      text.replace(/\/\*[\s\S]*?\*\//g, ""),
    )
  )
    throw new Error(
      "CSS는 64KB 이하이며 외부 주소·글꼴 선언·이스케이프 문자를 포함할 수 없어요.",
    );
  return text;
}
function load(id: string): Appearance {
  try {
    const value = {
      ...defaults,
      ...JSON.parse(localStorage.getItem(key(id)) || "{}"),
    };
    value.scale = Math.max(90, Math.min(150, Number(value.scale) || 112));
    for (const field of ["background", "primary"] as const)
      if (!/^#[\da-f]{6}$/i.test(value[field])) value[field] = "";
    value.css = validateCSS(String(value.css));
    if (!/^data:font\/woff2;base64,[A-Za-z0-9+/=]+$/.test(value.font))
      value.font = "";
    return value;
  } catch {
    return { ...defaults };
  }
}
export function useAppearance(id: string) {
  useEffect(() => {
    let fontURL = "";
    const style = document.createElement("style");
    style.dataset.duetAppearance = "true";
    document.head.append(style);
    const apply = () => {
      if (fontURL) URL.revokeObjectURL(fontURL);
      fontURL = "";
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
      let fontCSS = "";
      if (v.font) {
        const raw = atob(v.font.split(",")[1]);
        const bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0));
        fontURL = URL.createObjectURL(
          new Blob([bytes], { type: "font/woff2" }),
        );
        fontCSS = `@font-face{font-family:DuetUserFont;src:url("${fontURL}") format("woff2");font-display:swap}body,input,select,textarea,button{font-family:DuetUserFont,system-ui,sans-serif}`;
      }
      style.textContent = fontCSS + v.css;
    };
    apply();
    window.addEventListener("duet-appearance", apply);
    window.addEventListener("storage", apply);
    return () => {
      style.remove();
      if (fontURL) URL.revokeObjectURL(fontURL);
      for (const name of ["--text-scale", "--bg", "--green"])
        document.body.style.removeProperty(name);
      window.removeEventListener("duet-appearance", apply);
      window.removeEventListener("storage", apply);
    };
  }, [id]);
}
export function AppearanceSettings({ userId }: { userId: string }) {
  const [value, setValue] = useState(() => load(userId));
  const [message, setMessage] = useState("");
  const [scaleDraft, setScaleDraft] = useState(String(value.scale));
  function save(next: Appearance) {
    try {
      localStorage.setItem(key(userId), JSON.stringify(next));
      setValue(next);
      setScaleDraft(String(next.scale));
      window.dispatchEvent(new Event("duet-appearance"));
      setMessage("이 브라우저에 적용했어요.");
    } catch {
      setMessage("브라우저 저장 공간이 부족해요. 파일 크기를 줄여 주세요.");
    }
  }
  async function upload(file: File | undefined, font: boolean) {
    if (!file) return;
    try {
      if (font) {
        if (file.size > 1024 * 1024)
          throw new Error("글꼴은 WOFF2 형식, 1MB 이하로 올려 주세요.");
        const bytes = new Uint8Array(await file.arrayBuffer());
        const view = new DataView(bytes.buffer);
        if (
          bytes.length < 48 ||
          new TextDecoder().decode(bytes.slice(0, 4)) !== "wOF2" ||
          view.getUint32(8) !== bytes.length ||
          view.getUint32(16) > 20 * 1024 * 1024
        )
          throw new Error("올바른 WOFF2 글꼴 파일을 선택해 주세요.");
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () =>
            resolve(
              String(reader.result).replace(/^data:[^;]*;/, "data:font/woff2;"),
            );
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
        save({ ...value, font: data, fontName: file.name });
      } else {
        if (file.size > 65536)
          throw new Error("CSS 파일은 64KB 이하로 올려 주세요.");
        save({
          ...value,
          css: validateCSS(await file.text()),
          cssName: file.name,
        });
      }
    } catch (e) {
      setMessage((e as Error).message);
    }
  }
  return (
    <section className="panel">
      <div className="setting-group">
        <h2>
          디자인 직접 설정{" "}
          <Help>
            계정별로 현재 브라우저에만 저장해요. CSS는 외부 파일을 불러올 수
            없어요. 화면이 가려지면 주소 끝에 ?safe-theme=1을 붙여 접속한 뒤
            초기화하세요. 사이트 데이터 삭제 시 초기화되며 서버 백업에는
            포함되지 않아요.
          </Help>
        </h2>
        <div className="setting-row">
          <label htmlFor="custom-size">
            글씨 크기<small className="scale-range">90~150% · 1% 단위</small>
          </label>
          <div>
            <input
              id="custom-size"
              aria-label="글씨 크기"
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
          <label htmlFor="custom-bg">배경색</label>
          <input
            id="custom-bg"
            type="color"
            value={value.background || "#f6f8f5"}
            onChange={(e) => save({ ...value, background: e.target.value })}
          />
        </div>
        <div className="setting-row">
          <label htmlFor="custom-primary">메인 색상</label>
          <input
            id="custom-primary"
            type="color"
            value={value.primary || "#2d6b50"}
            onChange={(e) => save({ ...value, primary: e.target.value })}
          />
        </div>
        <div className="setting-row">
          <div className="appearance-file-title">
            CSS 파일{" "}
            <Help>64KB 이하. 외부 주소나 @import는 사용할 수 없어요.</Help>
          </div>
          <label className="design-file-box" htmlFor="custom-css">
            <Icon name="plus" size={18} />
            <span>{value.cssName || "CSS 파일 첨부"}</span>
            <input
              id="custom-css"
              type="file"
              className="visually-hidden"
              accept=".css,text/css"
              onChange={(e) => {
                void upload(e.target.files?.[0], false);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <div className="setting-row">
          <div className="appearance-file-title">
            사용자 글꼴{" "}
            <Help>
              WOFF2 형식, 1MB 이하. 사용 권한이 있는 글꼴을 올려 주세요.
            </Help>
          </div>
          <label className="design-file-box" htmlFor="custom-font">
            <Icon name="plus" size={18} />
            <span>{value.fontName || "사용자 글꼴 첨부"}</span>
            <input
              id="custom-font"
              type="file"
              className="visually-hidden"
              accept=".woff2,font/woff2"
              onChange={(e) => {
                void upload(e.target.files?.[0], true);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <button
          className="secondary-button"
          onClick={() => save({ ...defaults })}
        >
          기본 디자인으로 초기화
        </button>
        <p role="status" className="entry-hint">
          {message}
        </p>
      </div>
    </section>
  );
}
