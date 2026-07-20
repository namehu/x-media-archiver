type HistoryRecord = Record<string, unknown>;

const DIALOG_HISTORY_KEY = "__dialog_history__";

function asHistoryRecord(state: unknown): HistoryRecord {
  if (typeof state === "object" && state !== null && !Array.isArray(state)) {
    return state as HistoryRecord;
  }

  return {};
}

export function createDialogHistoryEntry(state: unknown) {
  const token = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return {
    token,
    state: { ...asHistoryRecord(state), [DIALOG_HISTORY_KEY]: token },
  };
}

export function isDialogHistoryEntry(state: unknown, token: string) {
  return asHistoryRecord(state)[DIALOG_HISTORY_KEY] === token;
}

export function closeDialogHistoryEntry(token: string, onExit: () => void) {
  const routerState = asHistoryRecord(history.state).usr;
  if (isDialogHistoryEntry(routerState, token)) {
    history.back();
    return;
  }

  onExit();
}
