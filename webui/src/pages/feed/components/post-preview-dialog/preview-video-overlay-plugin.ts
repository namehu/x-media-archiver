import type Artplayer from "artplayer";

export const PREVIEW_VIDEO_OVERLAY_PLUGIN_NAME = "feedPreviewOverlay" as const;

const PREVIEW_VIDEO_OVERLAY_LAYER_NAME = "feed-preview-overlay";

export interface PreviewVideoOverlayPluginApi {
  name: typeof PREVIEW_VIDEO_OVERLAY_PLUGIN_NAME;
  destroy(): void;
}

function hasOverlayLayer(art: Artplayer) {
  return Boolean(
    (art.layers as Artplayer["layers"] & Record<string, unknown>)[PREVIEW_VIDEO_OVERLAY_LAYER_NAME],
  );
}

export function createPreviewVideoOverlayPlugin(onTargetChange: (target: HTMLElement | null) => void) {
  return (art: Artplayer): PreviewVideoOverlayPluginApi => {
    let layerElement: HTMLElement | null = null;
    let destroyed = false;

    const api: PreviewVideoOverlayPluginApi = {
      name: PREVIEW_VIDEO_OVERLAY_PLUGIN_NAME,
      destroy() {
        if (destroyed) return;

        destroyed = true;
        onTargetChange(null);

        if (hasOverlayLayer(art)) {
          art.layers.remove(PREVIEW_VIDEO_OVERLAY_LAYER_NAME);
        } else {
          layerElement = null;
        }
      },
    };

    art.layers.add({
      name: PREVIEW_VIDEO_OVERLAY_LAYER_NAME,
      html: "",
      style: {
        position: "absolute",
        inset: "0",
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      },
      mounted(element) {
        layerElement = element;
        onTargetChange(element);
      },
      beforeUnmount(element) {
        if (layerElement !== element) return;

        layerElement = null;
        onTargetChange(null);
      },
    });

    return api;
  };
}
