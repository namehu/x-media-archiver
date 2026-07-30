import type Artplayer from "artplayer";
import { bindFullscreenWebHistory } from "./artplayer-fullscreen-history";

type ArtplayerCleanupOptions = {
  bindFullscreenHistory?: boolean;
};

/**
 * Creates the cleanup routine for an ArtPlayer instance mounted by React.
 *
 * ArtPlayer may move its player element outside the React-owned container while
 * in web fullscreen mode. The cleanup restores that state before destruction
 * and removes only the element created by this instance as a final safeguard.
 */
export function createArtplayerCleanup(
  player: Artplayer,
  container: HTMLElement,
  options: ArtplayerCleanupOptions = {},
): () => void {
  const playerElement = container.querySelector<HTMLElement>(".art-video-player");
  const unbindFullscreenHistory =
    options.bindFullscreenHistory === false ? () => undefined : bindFullscreenWebHistory(player);
  let destroyed = false;

  const stopPlayback = () => {
    if (destroyed) return;

    try {
      player.pause();
    } catch (error) {
      console.warn("[ArtPlayer] Failed to pause player", error);
    }
  };

  const exitFullscreen = () => {
    if (destroyed) return;

    try {
      if (player.fullscreen) {
        player.fullscreen = false;
      }
    } catch (error) {
      console.warn("[ArtPlayer] Failed to exit fullscreen", error);
    }

    try {
      if (player.fullscreenWeb) {
        player.fullscreenWeb = false;
      }
    } catch (error) {
      console.warn("[ArtPlayer] Failed to exit fullscreenWeb", error);
    }
  };

  const handlePageHide = () => {
    unbindFullscreenHistory();
    stopPlayback();
    exitFullscreen();
  };

  window.addEventListener("pagehide", handlePageHide);

  return () => {
    window.removeEventListener("pagehide", handlePageHide);
    unbindFullscreenHistory();

    if (destroyed) return;

    stopPlayback();
    exitFullscreen();
    destroyed = true;

    try {
      player.destroy(true);
    } catch (error) {
      console.error("[ArtPlayer] Failed to destroy player", error);
    } finally {
      if (playerElement?.isConnected) {
        playerElement.remove();
      }

      container.replaceChildren();
    }
  };
}
