import type Artplayer from "artplayer";

const FULLSCREEN_HISTORY_KEY = "__artplayer_fullscreen_web__";

type HistoryRecord = Record<string, unknown>;

function asHistoryRecord(state: unknown): HistoryRecord {
  if (typeof state === "object" && state !== null && !Array.isArray(state)) {
    return state as HistoryRecord;
  }

  return {};
}

/**
 * Makes ArtPlayer web fullscreen a browser-history state.
 *
 * The first browser back action exits web fullscreen; the next one leaves the
 * route. Forward navigation restores web fullscreen for the same instance.
 */
export function bindFullscreenWebHistory(player: Artplayer): () => void {
  const token = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  let disposed = false;
  let syncingFromHistory = false;

  const isCurrentPlayerEntry = (state: unknown) => asHistoryRecord(state)[FULLSCREEN_HISTORY_KEY] === token;

  const handleFullscreenWeb = (enabled: boolean) => {
    if (disposed || syncingFromHistory) return;

    if (enabled) {
      if (!isCurrentPlayerEntry(history.state)) {
        history.pushState(
          { ...asHistoryRecord(history.state), [FULLSCREEN_HISTORY_KEY]: token },
          "",
          window.location.href,
        );
      }
      return;
    }

    if (isCurrentPlayerEntry(history.state)) {
      history.back();
    }
  };

  const handlePopState = (event: PopStateEvent) => {
    if (disposed) return;

    const shouldBeFullscreen = isCurrentPlayerEntry(event.state);
    if (player.fullscreenWeb === shouldBeFullscreen) return;

    syncingFromHistory = true;
    try {
      player.fullscreenWeb = shouldBeFullscreen;
    } finally {
      queueMicrotask(() => {
        syncingFromHistory = false;
      });
    }
  };

  player.on("fullscreenWeb", handleFullscreenWeb);
  window.addEventListener("popstate", handlePopState);

  return () => {
    disposed = true;
    player.off("fullscreenWeb", handleFullscreenWeb);
    window.removeEventListener("popstate", handlePopState);
  };
}
