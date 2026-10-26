import { useEffect, useRef } from "react";
import { msg } from "./i18n";

const guards: (() => boolean)[] = [];

// Browser Back and the dialog's own controls must ask the same question.
export function canLeaveEntry() {
  return guards.at(-1)?.() ?? true;
}

export function useEntryExit(signature: string, busy: boolean) {
  const touched = useRef(false);
  const completed = useRef(false);
  const baseline = useRef(signature);
  if (!touched.current) baseline.current = signature;
  const state = useRef({ dirty: false, busy });
  state.current = {
    dirty: touched.current && signature !== baseline.current,
    busy,
  };

  useEffect(() => {
    const guard = () => {
      if (completed.current) return true;
      if (state.current.busy) return false;
      if (!state.current.dirty) return true;
      if (!confirm(msg("작성 중인 내용을 버리고 나갈까요?"))) return false;
      completed.current = true;
      return true;
    };
    guards.push(guard);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!completed.current && (state.current.dirty || state.current.busy)) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      guards.splice(guards.indexOf(guard), 1);
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, []);
  return {
    touch: () => {
      touched.current = true;
    },
    complete: () => {
      completed.current = true;
    },
  };
}
