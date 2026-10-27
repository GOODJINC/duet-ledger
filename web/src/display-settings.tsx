import { useEffect, useState } from "react";
import { msg } from "./i18n";

export type DisplayPreferences = {
  showPageHeadings: boolean;
  mobileTopEntry: boolean;
  mobileFloatingEntry: boolean;
  floatingSide: "left" | "right";
};
const defaults: DisplayPreferences = {
  showPageHeadings: true,
  mobileTopEntry: true,
  mobileFloatingEntry: true,
  floatingSide: "right",
};
const key = (id: string) => `duet-ledger-display-${id}`;
function load(id: string): DisplayPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(key(id)) || "{}");
    return {
      showPageHeadings: value.showPageHeadings !== false,
      mobileTopEntry: value.mobileTopEntry !== false,
      mobileFloatingEntry: value.mobileFloatingEntry !== false,
      floatingSide: value.floatingSide === "left" ? "left" : "right",
    };
  } catch {
    return { ...defaults };
  }
}
export function useDisplayPreferences(id: string) {
  const [value, setValue] = useState(() => load(id));
  useEffect(() => {
    const sync = () => setValue(load(id));
    sync();
    window.addEventListener("duet-display", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("duet-display", sync);
      window.removeEventListener("storage", sync);
    };
  }, [id]);
  function save(next: DisplayPreferences) {
    localStorage.setItem(key(id), JSON.stringify(next));
    setValue(next);
    window.dispatchEvent(new Event("duet-display"));
  }
  return [value, save] as const;
}
export function useCompactLayout() {
  const [compact, setCompact] = useState(
    () => window.matchMedia?.("(max-width: 760px)").matches || false,
  );
  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 760px)");
    if (!media) return;
    const change = () => setCompact(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  return compact;
}
export function DisplaySettings({
  userId,
  embedded = false,
}: {
  userId: string;
  embedded?: boolean;
}) {
  const [value, save] = useDisplayPreferences(userId);
  const [error, setError] = useState("");
  function update(next: DisplayPreferences) {
    try {
      save(next);
      setError("");
    } catch {
      setError(msg("이 브라우저에 설정을 저장하지 못했어요."));
    }
  }
  const Container = embedded ? "div" : "section";
  const Heading = embedded ? "h3" : "h2";
  return (
    <Container className={embedded ? "browser-settings-group" : "panel"}>
      <div className="setting-group">
        <Heading>{msg("화면 구성")}</Heading>
        {!embedded && (
          <p className="setting-explainer">
            {msg("이 계정의 현재 브라우저에 적용해요.")}
          </p>
        )}
        {(
          [
            ["showPageHeadings", msg("페이지 타이틀·설명 표시")],
            ["mobileTopEntry", msg("모바일 상단 빠른 입력 표시")],
            ["mobileFloatingEntry", msg("모바일 하단 + 버튼 표시")],
          ] as const
        ).map(([field, title]) => (
          <label className="setting-row" key={field}>
            <span>{title}</span>
            <input
              type="checkbox"
              checked={value[field]}
              onChange={(e) => update({ ...value, [field]: e.target.checked })}
            />
          </label>
        ))}
        <label className="setting-row">
          <span>{msg("모바일 하단 + 버튼 위치")}</span>
          <select
            className="field-select display-side"
            value={value.floatingSide}
            onChange={(e) =>
              update({
                ...value,
                floatingSide: e.target.value as "left" | "right",
              })
            }
          >
            <option value="right">{msg("오른쪽")}</option>
            <option value="left">{msg("왼쪽")}</option>
          </select>
        </label>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
      </div>
    </Container>
  );
}
