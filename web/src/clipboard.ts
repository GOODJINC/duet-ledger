import { msg } from "./i18n";
// HTTP access over a private network may not expose navigator.clipboard.
export async function copyText(text: string) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch {
    /* Try a synchronous selection copy next. */
  }
  const focused = document.activeElement as HTMLElement | null;
  const field = document.createElement("textarea");
  field.value = text;
  field.readOnly = true;
  field.style.cssText =
    "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0";
  // A modal dialog makes nodes outside it inert, so append inside that dialog.
  (
    focused?.closest("dialog") ||
    document.querySelector("dialog[open]") ||
    document.body
  ).append(field);
  field.focus();
  field.select();
  field.setSelectionRange(0, text.length);
  let copied = false;
  try {
    copied = !!document.execCommand?.("copy");
  } finally {
    field.remove();
    focused?.focus();
  }
  if (!copied)
    throw new Error(
      msg(
        "브라우저가 복사를 막았어요. 링크 입력칸을 선택한 뒤 Ctrl+C 또는 길게 눌러 복사해 주세요.",
      ),
    );
}
