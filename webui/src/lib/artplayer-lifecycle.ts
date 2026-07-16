import type Artplayer from "artplayer";
import { bindFullscreenWebHistory } from "./artplayer-fullscreen-history";

/**
 * Creates the cleanup routine for an ArtPlayer instance mounted by React.
 *
 * ArtPlayer may move its player element outside the React-owned container while
 * in web fullscreen mode. The cleanup restores that state before destruction
 * and removes only the element created by this instance as a final safeguard.
 */
export function createArtplayerCleanup(player: Artplayer, container: HTMLElement): () => void {
  const playerElement = container.querySelector<HTMLElement>(".art-video-player");
  const unbindFullscreenHistory = bindFullscreenWebHistory(player);
  let destroyed = false;

  const exitWebFullscreen = () => {
    if (destroyed) return;

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
    exitWebFullscreen();
  };

  window.addEventListener("pagehide", handlePageHide);

  return () => {
    window.removeEventListener("pagehide", handlePageHide);
    unbindFullscreenHistory();

    if (destroyed) return;

    exitWebFullscreen();
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
