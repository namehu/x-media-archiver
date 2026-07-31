import { useEffect, useRef, useState } from "react";
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
}: {
  src: string;
  previewUrl?: string | null;
  active: boolean;
  videoId: string;
  onControlToggle?: React.Dispatch<React.SetStateAction<boolean>>;
} & FeedVideoPlaybackStateApi) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const restorePlaybackRateRef = useRef<number | null>(null);
  const seekOverlaySnapshotRef = useRef<{ delta: number; targetTime: number } | null>(null);
  const gestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startTime: number;
    targetTime: number;
    seekActive: boolean;
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

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const container = containerRef.current;
    if (!active || !src || !wrapper || !container) {
      return undefined;
    }

    const initialState = getVideoState(videoId);
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
      ...(previewUrl ? { poster: previewUrl } : {}),
    });

    const cleanupPlayer = createArtplayerCleanup(player, container, { bindFullscreenHistory: false });
    const playerVideo = player.video;
    let restoredPlaybackState = !initialState;
    let disposing = false;

    const enterLockedWebFullscreen = () => {
      if (disposing || player.fullscreen || player.fullscreenWeb) return;
      player.fullscreenWeb = true;
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

    player.on("control", (show: boolean) => {
      if (onControlToggle) {
        onControlToggle(show);
      }
    });

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

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== -1 && event.button !== 0) return;
      if (isInteractiveTarget(event.target)) return;

      gestureRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startTime: player.currentTime,
        targetTime: player.currentTime,
        seekActive: false,
      };

      try {
        wrapper.setPointerCapture(event.pointerId);
      } catch {
        // Ignore browsers that reject pointer capture for synthetic sequences.
      }

      clearLongPressTimer();
      longPressTimerRef.current = window.setTimeout(() => {
        const currentGesture = gestureRef.current;
        if (
          !currentGesture ||
          currentGesture.pointerId !== event.pointerId ||
          currentGesture.seekActive ||
          !player.playing
        ) {
          return;
        }

        restorePlaybackRateRef.current = player.playbackRate;
        player.playbackRate = LONG_PRESS_RATE;
        setGestureOverlay({ type: "long-press", label: `${LONG_PRESS_RATE}x 长按快进` });
      }, LONG_PRESS_DELAY_MS);
    };

    const handlePointerMove = (event: PointerEvent) => {
      const currentGesture = gestureRef.current;
      if (!currentGesture || currentGesture.pointerId !== event.pointerId) return;

      const deltaX = event.clientX - currentGesture.startX;
      const deltaY = event.clientY - currentGesture.startY;
      const movedFarEnough = Math.abs(deltaX) >= SEEK_ACTIVATION_DISTANCE_PX && Math.abs(deltaX) > Math.abs(deltaY);
      const movedToCancelHold =
        Math.abs(deltaX) >= LONG_PRESS_CANCEL_DISTANCE_PX || Math.abs(deltaY) >= LONG_PRESS_CANCEL_DISTANCE_PX;

      if (!currentGesture.seekActive && movedFarEnough) {
        currentGesture.seekActive = true;
        clearLongPressTimer();
        stopFastForward();
      } else if (!currentGesture.seekActive && movedToCancelHold) {
        clearLongPressTimer();
      }

      if (!currentGesture.seekActive) return;

      const duration = Number.isFinite(player.duration) ? player.duration : 0;
      if (duration <= 0) return;

      const wrapperWidth = Math.max(wrapper.clientWidth, 1);
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

      clearLongPressTimer();
      stopFastForward();
      gestureRef.current = null;
      seekOverlaySnapshotRef.current = null;

      if (seeking) {
        setGestureOverlay(null);
      }

      if (pointerId !== undefined && wrapper.hasPointerCapture(pointerId)) {
        wrapper.releasePointerCapture(pointerId);
      }
    };

    wrapper.addEventListener("pointerdown", handlePointerDown, true);
    wrapper.addEventListener("pointermove", handlePointerMove, true);
    wrapper.addEventListener("pointerup", finishGesture, true);
    wrapper.addEventListener("pointercancel", finishGesture, true);
    wrapper.addEventListener("lostpointercapture", finishGesture, true);

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
      wrapper.removeEventListener("pointerdown", handlePointerDown, true);
      wrapper.removeEventListener("pointermove", handlePointerMove, true);
      wrapper.removeEventListener("pointerup", finishGesture, true);
      wrapper.removeEventListener("pointercancel", finishGesture, true);
      wrapper.removeEventListener("lostpointercapture", finishGesture, true);
      resetGestureState();
      cleanupPlayer();
    };
  }, [active, getVideoState, onControlToggle, previewUrl, src, updateVideoState, videoId]);

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
    <div
      ref={wrapperRef}
      className="swiper-no-swiping relative flex size-full touch-none select-none items-center justify-center bg-black"
    >
      <div
        ref={containerRef}
        className="tweet-video-player flex size-full items-center justify-center overflow-hidden bg-black"
      />
      {gestureOverlay ? (
        <div className="pointer-events-none absolute inset-x-4 top-4 flex justify-center">
          <div className="rounded-full border border-white/15 bg-black/70 px-4 py-2 text-sm font-medium text-white shadow-lg backdrop-blur">
            {gestureOverlay.type === "long-press"
              ? gestureOverlay.label
              : formatSeekOverlay(gestureOverlay.delta, gestureOverlay.targetTime, gestureOverlay.duration)}
          </div>
        </div>
      ) : null}
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
