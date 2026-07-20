type HistoryRecord = Record<string, unknown>;

const DIALOG_HISTORY_KEY = "__dialog_history__";

function asHistoryRecord(state: unknown): HistoryRecord {
  if (typeof state === "object" && state !== null && !Array.isArray(state)) {
    return state as HistoryRecord;
  }

  return {};
}

export function pushDialogHistoryEntry() {
  const token = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  history.pushState({ ...asHistoryRecord(history.state), [DIALOG_HISTORY_KEY]: token }, "", window.location.href);
  return token;
}

export function isDialogHistoryEntry(state: unknown, token: string) {
  return asHistoryRecord(state)[DIALOG_HISTORY_KEY] === token;
}

export function bindDialogHistoryEntry(token: string, onExit: () => void) {
  let disposed = false;

  const handlePopState = (event: PopStateEvent) => {
    if (disposed || isDialogHistoryEntry(event.state, token)) return;
    onExit();
  };

  window.addEventListener("popstate", handlePopState);

  return () => {
    disposed = true;
    window.removeEventListener("popstate", handlePopState);
  };
}

export function closeDialogHistoryEntry(token: string, onExit: () => void) {
  if (isDialogHistoryEntry(history.state, token)) {
    history.back();
    return;
  }

  onExit();
}
