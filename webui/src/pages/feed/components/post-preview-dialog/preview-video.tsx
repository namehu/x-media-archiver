import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import Artplayer from "artplayer";
import { createArtplayerCleanup } from "@/lib/artplayer-lifecycle";
import {
  clampPlaybackTime,
  finiteOrZero,
  formatPlaybackClock,
  formatPlaybackCountdown,
  remainingPlaybackSeconds,
  type FeedVideoPlaybackSnapshot,
  type FeedVideoPlaybackStateApi,
} from "../../video-playback-state";
import {
  createPreviewVideoOverlayPlugin,
  type PreviewVideoOverlayPluginApi,
} from "./preview-video-overlay-plugin";

const LONG_PRESS_DELAY_MS = 280;
const LONG_PRESS_RATE = 2;
const LONG_PRESS_CANCEL_DISTANCE_PX = 10;
const SEEK_ACTIVATION_DISTANCE_PX = 18;
const SEEK_WINDOW_MIN_SECONDS = 12;
const SEEK_WINDOW_MAX_SECONDS = 120;

export function PreviewVideo({
  src,
  previewUrl,
  active,
  videoId,
  getVideoState,
  updateVideoState,
  onControlToggle,
  onTweetGesture,
  onTweetWheel,
  overlay,
}: {
  src: string;
  previewUrl?: string | null;
  active: boolean;
  videoId: string;
  onControlToggle?: React.Dispatch<React.SetStateAction<boolean>>;
  onTweetGesture?: (direction: -1 | 1) => void;
  onTweetWheel?: (deltaY: number) => void;
  overlay?: ReactNode;
} & FeedVideoPlaybackStateApi) {
  const containerRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const restorePlaybackRateRef = useRef<number | null>(null);
  const seekOverlaySnapshotRef = useRef<{ delta: number; targetTime: number } | null>(null);
  // 通过 ref 缓存回调，避免父组件渲染抖动导致 Artplayer 事件监听器引用变化并重建播放器。
  const onTweetGestureRef = useRef(onTweetGesture);
  const onTweetWheelRef = useRef(onTweetWheel);
  onTweetGestureRef.current = onTweetGesture;
  onTweetWheelRef.current = onTweetWheel;
  const gestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startedAt: number;
    startTime: number;
    targetTime: number;
    seekActive: boolean;
    verticalActive: boolean;
  } | null>(null);
  const [gestureOverlay, setGestureOverlay] = useState<
    | null
    | {
        type: "long-press";
        label: string;
      }
    | {
        type: "seek";
        delta: number;
        targetTime: number;
        duration: number;
      }
  >(null);
  const [overlayTarget, setOverlayTarget] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!active || !src || !container) {
      return undefined;
    }

    const initialState = getVideoState(videoId);
    let disposing = false;
    let overlayPluginApi: PreviewVideoOverlayPluginApi | null = null;
    const overlayPlugin = createPreviewVideoOverlayPlugin(setOverlayTarget);
    const player = new Artplayer({
      container,
      url: src,
      autoSize: true,
      fullscreen: true,
      fullscreenWeb: false,
      setting: true,
      playbackRate: true,
      aspectRatio: true,
      playsInline: true,
      gesture: false,
      fastForward: false,
      theme: brandColor(),
      moreVideoAttr: {
        preload: "auto",
        playsInline: true,
      },
      plugins: [
        (art) => {
          const api = overlayPlugin(art);
          overlayPluginApi = api;
          if (disposing) api.destroy();
          return api;
        },
      ],
      ...(previewUrl ? { poster: previewUrl } : {}),
    });

    const cleanupPlayer = createArtplayerCleanup(player, container, { bindFullscreenHistory: false });
    const playerVideo = player.video;
    const interactionSurface = player.template.$player;
    interactionSurface.style.pointerEvents = "auto";
    let restoredPlaybackState = !initialState;
    let chromeVisibleBeforePointerDown = true;

    const isPlayerChromeVisible = () =>
      interactionSurface.classList.contains("art-control-show") ||
      interactionSurface.classList.contains("art-hover");

    const syncPreviewChromeVisibility = () => {
      onControlToggle?.(isPlayerChromeVisible());
    };

    // Artplayer renders its bottom controls from both of these root classes.
    // Mirror the rendered state so the plugin overlay cannot drift out of sync.
    const controlVisibilityObserver = new MutationObserver(syncPreviewChromeVisibility);
    controlVisibilityObserver.observe(interactionSurface, {
      attributes: true,
      attributeFilter: ["class"],
    });

    const keepFullWebPlayerAccessible = () => {
      // 某些浏览器会将全屏播放器标记 aria-hidden；对话框场景下需恢复到可访问树。
      if (player.fullscreenWeb && interactionSurface.getAttribute("aria-hidden") === "true") {
        interactionSurface.removeAttribute("aria-hidden");
      }
    };
    const accessibilityObserver = new MutationObserver(keepFullWebPlayerAccessible);
    accessibilityObserver.observe(interactionSurface, {
      attributes: true,
      attributeFilter: ["aria-hidden"],
    });

    const enterLockedWebFullscreen = () => {
      if (disposing || player.fullscreen || player.fullscreenWeb) return;
      player.fullscreenWeb = true;
      queueMicrotask(keepFullWebPlayerAccessible);
    };

    const restoreLockedWebFullscreen = () => {
      window.requestAnimationFrame(enterLockedWebFullscreen);
    };

    enterLockedWebFullscreen();

    const updateDefaultTimeDisplay = () => {
      const timeElement = getArtplayerTimeElement(player);
      const remainingSeconds = remainingPlaybackSeconds(playerVideo.duration, playerVideo.currentTime);
      if (timeElement && remainingSeconds !== null) {
        timeElement.textContent = formatPlaybackCountdown(remainingSeconds);
      }
    };

    const writePlayerState = (snapshot: FeedVideoPlaybackSnapshot = {}) => {
      updateDefaultTimeDisplay();
      return updateVideoState(videoId, {
        currentTime:
          restoredPlaybackState || !initialState ? finiteOrZero(playerVideo.currentTime) : initialState.currentTime,
        paused: playerVideo.paused,
        ended: playerVideo.ended,
        playbackRate: player.playbackRate,
        volume: playerVideo.volume,
        muted: playerVideo.muted,
        duration: Number.isFinite(playerVideo.duration) ? playerVideo.duration : null,
        ...snapshot,
      });
    };

    const restorePlaybackState = () => {
      if (restoredPlaybackState) return;
      const state = initialState;
      if (!state) return;

      restoredPlaybackState = true;
      playerVideo.muted = state.muted;
      playerVideo.volume = clampVolume(state.volume);
      player.playbackRate = state.playbackRate > 0 ? state.playbackRate : 1;
      const targetTime = state.ended ? 0 : clampPlaybackTime(state.currentTime, playerVideo.duration || state.duration);
      playerVideo.currentTime = targetTime;
      writePlayerState({
        currentTime: targetTime,
        paused: state.paused,
        ended: state.ended,
      });
    };

    if (playerVideo.readyState >= 1) {
      restorePlaybackState();
    } else {
      playerVideo.addEventListener("loadedmetadata", restorePlaybackState, { once: true });
    }

    const writePlayingState = () => writePlayerState({ paused: false, ended: false });
    const writePausedState = () => writePlayerState();

    playerVideo.addEventListener("durationchange", writePausedState);
    playerVideo.addEventListener("timeupdate", writePausedState);
    playerVideo.addEventListener("play", writePlayingState);
    playerVideo.addEventListener("pause", writePausedState);
    playerVideo.addEventListener("volumechange", writePausedState);
    playerVideo.addEventListener("ratechange", writePausedState);
    playerVideo.addEventListener("seeked", writePausedState);
    playerVideo.addEventListener("ended", writePausedState);

    player.on("fullscreenWeb", (enabled: boolean) => {
      if (enabled || player.fullscreen) return;
      restoreLockedWebFullscreen();
    });

    player.on("fullscreen", (enabled: boolean) => {
      if (!enabled) {
        restoreLockedWebFullscreen();
      }
    });

    const handlePlayerChromeChange = () => syncPreviewChromeVisibility();
    player.on("control", handlePlayerChromeChange);
    player.on("hover", handlePlayerChromeChange);
    syncPreviewChromeVisibility();

    const syncTimer = window.setInterval(writePausedState, 250);

    const clearLongPressTimer = () => {
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }
    };

    const stopFastForward = () => {
      if (restorePlaybackRateRef.current === null) return;
      player.playbackRate = restorePlaybackRateRef.current;
      restorePlaybackRateRef.current = null;
      setGestureOverlay((current) => (current?.type === "long-press" ? null : current));
    };

    const resetGestureState = () => {
      clearLongPressTimer();
      stopFastForward();
      gestureRef.current = null;
      seekOverlaySnapshotRef.current = null;
      setGestureOverlay((current) => (current?.type === "seek" ? null : current));
    };

    const isInteractiveTarget = (target: EventTarget | null) =>
      target instanceof HTMLElement &&
      Boolean(
        target.closest(
          ".art-bottom, .art-controls, .art-settings, .art-contextmenus, .art-layer button, button, input, select, textarea, a",
        ),
      );

    const captureGesturePointer = (pointerId: number) => {
      if (interactionSurface.hasPointerCapture(pointerId)) return;

      try {
        interactionSurface.setPointerCapture(pointerId);
      } catch {
        // Ignore browsers that reject capture after the active pointer ended.
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== -1 && event.button !== 0) return;
      if (isInteractiveTarget(event.target)) return;

      chromeVisibleBeforePointerDown = isPlayerChromeVisible();
      // Wake Artplayer itself immediately. Updating only React state would show
      // the top overlay while leaving the native bottom controls hidden.
      player.controls.show = true;

      gestureRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startedAt: performance.now(),
        startTime: player.currentTime,
        targetTime: player.currentTime,
        seekActive: false,
        verticalActive: false,
      };

      // Keep ordinary taps on the video so Artplayer can emit its click/control
      // events. Capture only after a long-press or horizontal seek is active.

      clearLongPressTimer();
      longPressTimerRef.current = window.setTimeout(() => {
        const currentGesture = gestureRef.current;
        if (
          !currentGesture ||
          currentGesture.pointerId !== event.pointerId ||
          currentGesture.seekActive ||
          currentGesture.verticalActive ||
          !player.playing
        ) {
          return;
        }

        captureGesturePointer(event.pointerId);
        restorePlaybackRateRef.current = player.playbackRate;
        player.playbackRate = LONG_PRESS_RATE;
        setGestureOverlay({ type: "long-press", label: `${LONG_PRESS_RATE}x 长按快进` });
      }, LONG_PRESS_DELAY_MS);
    };

    const handlePlayerClick = (event: MouseEvent) => {
      if (isInteractiveTarget(event.target)) return;

      // Artplayer's mobile click handler toggles the controls, while desktop
      // only shows them. Apply one consistent toggle after its own handler and
      // guarantee that the first tap after auto-hide always wakes the controls.
      player.controls.show = !chromeVisibleBeforePointerDown;
      syncPreviewChromeVisibility();
    };

    const handleWheel = (event: WheelEvent) => {
      const handleTweetWheel = onTweetWheelRef.current;
      if (!handleTweetWheel || isInteractiveTarget(event.target) || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      handleTweetWheel(event.deltaY);
    };

    const handlePointerMove = (event: PointerEvent) => {
      const currentGesture = gestureRef.current;
      if (!currentGesture || currentGesture.pointerId !== event.pointerId) return;

      const deltaX = event.clientX - currentGesture.startX;
      const deltaY = event.clientY - currentGesture.startY;
      const movedVertically =
        Boolean(onTweetGestureRef.current) &&
        Math.abs(deltaY) >= SEEK_ACTIVATION_DISTANCE_PX &&
        Math.abs(deltaY) > Math.abs(deltaX) * 1.15;
      const movedFarEnough = Math.abs(deltaX) >= SEEK_ACTIVATION_DISTANCE_PX && Math.abs(deltaX) > Math.abs(deltaY);
      const movedToCancelHold =
        Math.abs(deltaX) >= LONG_PRESS_CANCEL_DISTANCE_PX || Math.abs(deltaY) >= LONG_PRESS_CANCEL_DISTANCE_PX;

      if (!currentGesture.seekActive && !currentGesture.verticalActive && movedVertically) {
        currentGesture.verticalActive = true;
        captureGesturePointer(event.pointerId);
        clearLongPressTimer();
        stopFastForward();
      } else if (!currentGesture.seekActive && !currentGesture.verticalActive && movedFarEnough) {
        currentGesture.seekActive = true;
        captureGesturePointer(event.pointerId);
        clearLongPressTimer();
        stopFastForward();
      } else if (!currentGesture.seekActive && movedToCancelHold) {
        clearLongPressTimer();
      }

      if (currentGesture.verticalActive) {
        // 垂直拖动仅作为“翻帖”手势反馈，不影响横向快进。
        interactionSurface.style.transition = "none";
        interactionSurface.style.transform = `translate3d(0, ${deltaY}px, 0)`;
        interactionSurface.style.opacity = String(
          Math.max(0.58, 1 - Math.abs(deltaY) / Math.max(interactionSurface.clientHeight, 1)),
        );
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (!currentGesture.seekActive) return;

      const duration = Number.isFinite(player.duration) ? player.duration : 0;
      if (duration <= 0) return;

      const wrapperWidth = Math.max(interactionSurface.clientWidth, 1);
      const seekWindow = Math.min(Math.max(duration * 0.25, SEEK_WINDOW_MIN_SECONDS), SEEK_WINDOW_MAX_SECONDS);
      const deltaTime = clampRange((deltaX / wrapperWidth) * seekWindow, -seekWindow, seekWindow);
      const targetTime = clampTime(currentGesture.startTime + deltaTime, duration);
      const roundedDelta = Math.round(targetTime - currentGesture.startTime);
      const roundedTargetTime = Math.round(targetTime);

      currentGesture.targetTime = targetTime;
      playerVideo.currentTime = targetTime;
      event.preventDefault();
      event.stopPropagation();

      const previousSnapshot = seekOverlaySnapshotRef.current;
      if (previousSnapshot?.delta === roundedDelta && previousSnapshot.targetTime === roundedTargetTime) {
        return;
      }

      seekOverlaySnapshotRef.current = { delta: roundedDelta, targetTime: roundedTargetTime };
      setGestureOverlay({
        type: "seek",
        delta: roundedDelta,
        targetTime,
        duration,
      });
    };

    const finishGesture = (event?: PointerEvent) => {
      const currentGesture = gestureRef.current;
      if (event && currentGesture && currentGesture.pointerId !== event.pointerId) return;

      const pointerId = currentGesture?.pointerId ?? event?.pointerId;
      const seeking = currentGesture?.seekActive ?? false;
      const navigatingTweet = currentGesture?.verticalActive ?? false;
      const verticalDelta = event && currentGesture ? event.clientY - currentGesture.startY : 0;
      const verticalElapsed = currentGesture ? Math.max(performance.now() - currentGesture.startedAt, 1) : 1;

      clearLongPressTimer();
      stopFastForward();
      gestureRef.current = null;
      seekOverlaySnapshotRef.current = null;

      if (seeking) {
        setGestureOverlay(null);
      }

      if (navigatingTweet) {
        const shouldNavigate =
          Math.abs(verticalDelta) >= 72 ||
          (Math.abs(verticalDelta) >= 24 && Math.abs(verticalDelta) / verticalElapsed >= 0.55);
        interactionSurface.style.transition = window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "none"
          : "transform 180ms ease-out, opacity 180ms ease-out";
        interactionSurface.style.transform = "translate3d(0, 0, 0)";
        interactionSurface.style.opacity = "1";
        if (shouldNavigate) onTweetGestureRef.current?.(verticalDelta < 0 ? 1 : -1);
      }

      if (pointerId !== undefined && interactionSurface.hasPointerCapture(pointerId)) {
        interactionSurface.releasePointerCapture(pointerId);
      }
    };

    interactionSurface.addEventListener("pointerdown", handlePointerDown, true);
    interactionSurface.addEventListener("pointermove", handlePointerMove, true);
    interactionSurface.addEventListener("pointerup", finishGesture, true);
    interactionSurface.addEventListener("pointercancel", finishGesture, true);
    interactionSurface.addEventListener("lostpointercapture", finishGesture, true);
    interactionSurface.addEventListener("click", handlePlayerClick);
    interactionSurface.addEventListener("wheel", handleWheel, { passive: false });

    if (!initialState || !initialState.ended) {
      void player.play().catch(() => undefined);
    } else {
      player.pause();
      writePlayerState({ paused: true, ended: initialState.ended });
    }

    return () => {
      disposing = true;
      const wasPlaying = !playerVideo.paused && !playerVideo.ended;
      writePlayerState({
        paused: wasPlaying ? false : playerVideo.paused,
        ended: playerVideo.ended,
      });
      window.clearInterval(syncTimer);
      playerVideo.removeEventListener("loadedmetadata", restorePlaybackState);
      playerVideo.removeEventListener("durationchange", writePausedState);
      playerVideo.removeEventListener("timeupdate", writePausedState);
      playerVideo.removeEventListener("play", writePlayingState);
      playerVideo.removeEventListener("pause", writePausedState);
      playerVideo.removeEventListener("volumechange", writePausedState);
      playerVideo.removeEventListener("ratechange", writePausedState);
      playerVideo.removeEventListener("seeked", writePausedState);
      playerVideo.removeEventListener("ended", writePausedState);
      interactionSurface.removeEventListener("pointerdown", handlePointerDown, true);
      interactionSurface.removeEventListener("pointermove", handlePointerMove, true);
      interactionSurface.removeEventListener("pointerup", finishGesture, true);
      interactionSurface.removeEventListener("pointercancel", finishGesture, true);
      interactionSurface.removeEventListener("lostpointercapture", finishGesture, true);
      interactionSurface.removeEventListener("click", handlePlayerClick);
      interactionSurface.removeEventListener("wheel", handleWheel);
      player.off("control", handlePlayerChromeChange);
      player.off("hover", handlePlayerChromeChange);
      controlVisibilityObserver.disconnect();
      accessibilityObserver.disconnect();
      resetGestureState();
      overlayPluginApi?.destroy();
      cleanupPlayer();
    };
  }, [
    active,
    getVideoState,
    onControlToggle,
    previewUrl,
    src,
    updateVideoState,
    videoId,
  ]);

  if (!active) {
    return previewUrl ? (
      <img src={previewUrl} alt="" className="max-h-full max-w-full select-none object-contain" />
    ) : (
      <div className="flex size-full items-center justify-center bg-black text-sm text-white/70">
        点击切换到此视频后可播放
      </div>
    );
  }

  return (
    <div className="swiper-no-swiping pointer-events-none relative flex size-full touch-none select-none items-center justify-center bg-black">
      <div
        ref={containerRef}
        className="tweet-video-player flex size-full items-center justify-center overflow-hidden bg-black"
      />
      {overlayTarget
        ? createPortal(
            <>
              {overlay}
              {gestureOverlay ? (
                <div className="pointer-events-none absolute inset-x-4 top-4 flex justify-center">
                  <div className="rounded-full border border-white/15 bg-black/70 px-4 py-2 text-sm font-medium text-white shadow-lg backdrop-blur">
                    {gestureOverlay.type === "long-press"
                      ? gestureOverlay.label
                      : formatSeekOverlay(gestureOverlay.delta, gestureOverlay.targetTime, gestureOverlay.duration)}
                  </div>
                </div>
              ) : null}
            </>,
            overlayTarget,
          )
        : null}
    </div>
  );
}

function clampRange(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function clampTime(value: number, max: number) {
  return Math.min(Math.max(value, 0), max);
}

function clampVolume(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.max(value, 0), 1);
}

function getArtplayerTimeElement(player: Artplayer) {
  const directMatch = player.query<HTMLElement>(".art-control-time");
  if (directMatch) return directMatch;

  const controlsLeft = player.query<HTMLElement>(".art-controls-left");
  if (!controlsLeft) return null;
  return (
    Array.from(controlsLeft.querySelectorAll<HTMLElement>(".art-control")).find((element) =>
      /(?:\d+:)?\d{2}:\d{2}\s*\/\s*(?:\d+:)?\d{2}:\d{2}/.test(element.textContent ?? ""),
    ) ?? null
  );
}

function formatSeekOverlay(delta: number, targetTime: number, duration: number) {
  const deltaPrefix = delta > 0 ? "+" : "";
  return `${deltaPrefix}${delta}s · ${formatPlaybackClock(targetTime)} / ${formatPlaybackClock(duration)}`;
}

function brandColor() {
  const value = window.getComputedStyle(document.documentElement).getPropertyValue("--brand").trim();
  return value ? `hsl(${value})` : "#009ef7";
}
