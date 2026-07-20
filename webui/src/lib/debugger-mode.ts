const DEBUGGER_MODE_STORAGE_KEY = "xma:webui:debugger-mode";

export function initializeDebuggerMode() {
  syncDebuggerMode(resolveDebuggerMode(window.location.search).enabled);
}

export function syncDebuggerMode(enabled: boolean) {
  document.documentElement.dataset.debuggerMode = enabled ? "on" : "off";
}

export function resolveDebuggerMode(search: string) {
  const params = new URLSearchParams(search);
  const rawValue = params.get("debugger");
  const hasUrlFlag = rawValue !== null;

  if (hasUrlFlag) {
    const enabled = !/^(0|false|off)$/i.test(rawValue ?? "");
    return { enabled, hasUrlFlag, persist: true };
  }

  return {
    enabled: readPersistedDebuggerMode(),
    hasUrlFlag: false,
    persist: false,
  };
}

export function readPersistedDebuggerMode() {
  try {
    return window.sessionStorage.getItem(DEBUGGER_MODE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function persistDebuggerMode(enabled: boolean) {
  try {
    if (enabled) {
      window.sessionStorage.setItem(DEBUGGER_MODE_STORAGE_KEY, "1");
      return;
    }

    window.sessionStorage.removeItem(DEBUGGER_MODE_STORAGE_KEY);
  } catch {
    // Ignore storage failures and keep debugger mode URL-driven.
  }
}

export function buildDebuggerSearch(search: string, enabled: boolean) {
  const params = new URLSearchParams(search);

  if (enabled) {
    params.set("debugger", "1");
  } else {
    params.delete("debugger");
  }

  const nextSearch = params.toString();
  return nextSearch ? `?${nextSearch}` : "";
}
