import { useState } from "react";
import { msg } from "./i18n";

// Shared mutation feedback for dialogs; callers keep control over save/close.
export function useTask() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : msg("처리하지 못했어요."),
      );
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run, setError };
}
