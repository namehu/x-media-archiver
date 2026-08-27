import type { AuthSession } from "@/lib/api";

const LOCAL_PRIVACY_MODE_KEY = "xma:webui:media-privacy-mode";
const LOCAL_ADULT_ACKNOWLEDGEMENT_KEY = "xma:webui:adult-content-acknowledged";

export function initializeMediaPrivacyMode() {
  syncMediaPrivacyMode(true);
}

export function syncMediaPrivacyMode(enabled: boolean) {
  document.documentElement.dataset.mediaPrivacyMode = enabled ? "on" : "off";
}

export function applyDisabledModeFallback(session: AuthSession): AuthSession {
  if (session.auth_mode !== "disabled" || session.status !== "authenticated") return session;
  return {
    ...session,
    user: {
      username: session.user?.username || "local",
      media_privacy_mode: readLocalPrivacyMode(),
    },
  };
}

export function persistDisabledPrivacyMode(enabled: boolean) {
  try {
    window.localStorage.setItem(LOCAL_PRIVACY_MODE_KEY, enabled ? "1" : "0");
  } catch {
    // The serverless compatibility mode remains usable when storage is unavailable.
  }
}

export function acknowledgeAdultContentForTab() {
  try {
    window.sessionStorage.setItem(LOCAL_ADULT_ACKNOWLEDGEMENT_KEY, "1");
  } catch {
    // A storage-restricted browser will ask again after the next reload.
  }
}

export function clearAdultContentAcknowledgementForTab() {
  try {
    window.sessionStorage.removeItem(LOCAL_ADULT_ACKNOWLEDGEMENT_KEY);
  } catch {
    // Nothing else can be cleared when browser storage is unavailable.
  }
}

export function readAdultContentAcknowledgementForTab() {
  try {
    return window.sessionStorage.getItem(LOCAL_ADULT_ACKNOWLEDGEMENT_KEY) === "1";
  } catch {
    return false;
  }
}

function readLocalPrivacyMode() {
  try {
    return window.localStorage.getItem(LOCAL_PRIVACY_MODE_KEY) === "1";
  } catch {
    return false;
  }
}
