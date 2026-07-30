import { useCallback, useEffect, useRef, useState } from "react";
import Artplayer from "artplayer";
import { ExternalLink, X as CloseIcon } from "lucide-react";
import { Keyboard, Navigation, Pagination } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/react";
import type { Swiper as SwiperInstance } from "swiper/types";
import { useLocation } from "react-router-dom";
import type { PostFeedRow } from "@/lib/api";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createArtplayerCleanup } from "@/lib/artplayer-lifecycle";
import { closeDialogHistoryEntry, isDialogHistoryEntry } from "@/lib/dialog-history";
import {
  clampPlaybackTime,
  finiteOrZero,
  formatPlaybackClock,
  formatPlaybackCountdown,
  remainingPlaybackSeconds,
  type FeedVideoPlaybackSnapshot,
  type FeedVideoPlaybackStateApi,
} from "../video-playback-state";
import {
  getDebugAuthorProfileHref,
  getDebugExternalHref,
  getDebugLinkTitle,
  getDebugRedactProps,
  useDebugRedactionEnabled,
} from "@/lib/debug-redaction";
import { formatDateTime } from "@/lib/utils";
import "swiper/css";
import "swiper/css/navigation";
import "swiper/css/pagination";

const LONG_PRESS_DELAY_MS = 280;
const LONG_PRESS_RATE = 2;
const LONG_PRESS_CANCEL_DISTANCE_PX = 10;
const SEEK_ACTIVATION_DISTANCE_PX = 18;
const SEEK_WINDOW_MIN_SECONDS = 12;
const SEEK_WINDOW_MAX_SECONDS = 120;

export function PostPreviewDialog({
  post,
  activeIndex,
  historyToken,
  onActiveIndexChange,
  onOpenChange,
  getVideoState,
  updateVideoState,
}: {
  post: PostFeedRow | null;
  activeIndex: number;
  historyToken: string | null;
  onActiveIndexChange: (index: number) => void;
  onOpenChange: (open: boolean) => void;
} & FeedVideoPlaybackStateApi) {
  const debugRedactionEnabled = useDebugRedactionEnabled();
  const location = useLocation();
  const swiperRef = useRef<SwiperInstance | null>(null);
  const activeHistoryTokenRef = useRef<string | null>(null);
  const [contextExpanded, setContextExpanded] = useState(false);
  const [uiVisible, setUiVisible] = useState(true);

  const handleClose = useCallback(() => {
    if (!historyToken) {
      onOpenChange(false);
      return;
    }

    closeDialogHistoryEntry(historyToken, () => onOpenChange(false));
  }, [historyToken, onOpenChange]);

  useEffect(() => {
    swiperRef.current?.slideTo(activeIndex);
  }, [activeIndex]);

  useEffect(() => {
    if (!post) return undefined;

    const animationFrame = window.requestAnimationFrame(() => {
      swiperRef.current?.update();
      swiperRef.current?.slideTo(activeIndex, 0);
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [activeIndex, post]);

  useEffect(() => {
    if (!historyToken) return undefined;

    if (isDialogHistoryEntry(location.state, historyToken)) {
      activeHistoryTokenRef.current = historyToken;
      return undefined;
    }

    // Opening the dialog updates local state before React Router publishes the
    // pushed location. Only treat a missing token as a close after this dialog
    // has observed its own history entry, which is what happens on Back.
    if (activeHistoryTokenRef.current === historyToken) {
      onOpenChange(false);
    }
    return undefined;
  }, [historyToken, location.state, onOpenChange]);

  useEffect(() => {
    setContextExpanded(false);
  }, [post?.tweet_id]);

  if (!post) return null;
  const authorName = post.author_display_name || post.author_username || "未知作者";
  const authorProfileHref = getDebugAuthorProfileHref(debugRedactionEnabled, post.author_username);
  const tweetHref = getDebugExternalHref(debugRedactionEnabled, post.tweet_url);
  const tweetText = post.tweet_text || "暂无帖子正文";

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <DialogContent className="left-0 top-0 h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none border-0 bg-black p-0 [&>button]:hidden">
        <DialogHeader className="sr-only">
          <DialogTitle>帖子媒体预览</DialogTitle>
          <DialogDescription>左右切换查看同一帖子的本地媒体。</DialogDescription>
        </DialogHeader>

        {/* 关闭按钮 */}
        <button
          type="button"
          onClick={handleClose}
          className={`absolute right-4 top-4 z-50 flex size-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur transition-all duration-300 hover:bg-black/60 ${uiVisible ? "opacity-100" : "opacity-0 pointer-events-none"}`}
          aria-label="关闭预览"
        >
          <CloseIcon className="size-5" />
        </button>

        <div className="relative h-full min-h-0 w-full min-w-0 overflow-hidden bg-black">
          <Swiper
            key={post.tweet_id}
            className={`h-full min-h-0 w-full min-w-0 max-w-full [&_.swiper-button-next]:hidden [&_.swiper-button-prev]:hidden sm:[&_.swiper-button-next]:flex sm:[&_.swiper-button-prev]:flex ${uiVisible ? "[&_.swiper-button-next]:opacity-100 [&_.swiper-button-prev]:opacity-100 [&_.swiper-pagination]:opacity-100" : "[&_.swiper-button-next]:opacity-0 [&_.swiper-button-prev]:opacity-0 [&_.swiper-pagination]:opacity-0"} [&_.swiper-button-next]:transition-opacity [&_.swiper-button-prev]:transition-opacity [&_.swiper-pagination]:transition-opacity [&_.swiper-pagination]:duration-300 [&_.swiper-button-next]:duration-300 [&_.swiper-button-prev]:duration-300 [&_.swiper-pagination-fraction]:top-auto [&_.swiper-pagination-fraction]:bottom-5 [&_.swiper-pagination-fraction]:text-white/60 [&_.swiper-pagination-fraction]:text-sm`}
            modules={[Keyboard, Navigation, Pagination]}
            initialSlide={activeIndex}
            keyboard={{ enabled: true }}
            navigation
            pagination={{ type: "fraction" }}
            observer
            observeParents
            resizeObserver
            onClick={() => setUiVisible((v) => !v)}
            onSwiper={(swiper) => {
              swiperRef.current = swiper;
            }}
            onSlideChange={(swiper) => onActiveIndexChange(swiper.activeIndex)}
          >
            {post.media.map((item, index) => (
              <SwiperSlide key={item.id}>
                <div className="flex size-full items-center justify-center">
                  {item.media_url ? (
                    item.media_type === "video" ? (
                      <PreviewVideo
                        src={item.media_url}
                        previewUrl={item.preview_url}
                        active={index === activeIndex}
                        videoId={`${post.tweet_id}:${item.id}`}
                        getVideoState={getVideoState}
                        updateVideoState={updateVideoState}
                        onControlToggle={setUiVisible}
                      />
                    ) : (
                      <img src={item.media_url} alt="" className="max-h-full max-w-full select-none object-contain" />
                    )
                  ) : (
                    <span className="text-sm text-white/70">媒体不可用</span>
                  )}
                </div>
              </SwiperSlide>
            ))}
          </Swiper>

          {/* 顶部悬浮信息流 */}
          <aside
            className={`pointer-events-none absolute top-0 left-0 right-0 z-40 bg-gradient-to-b from-black/90 via-black/60 to-transparent pt-4 pb-24 px-4 md:px-6 transition-all duration-300 ${uiVisible ? "translate-y-0 opacity-100" : "-translate-y-8 opacity-0"}`}
          >
            <div className="pointer-events-auto mx-auto max-w-3xl">
              <div className="flex items-start justify-between gap-4">
                <a
                  href={authorProfileHref}
                  target={authorProfileHref ? "_blank" : undefined}
                  rel={authorProfileHref ? "noopener noreferrer" : undefined}
                  className="flex min-w-0 flex-1 items-center gap-3 transition-opacity hover:opacity-80"
                  title={getDebugLinkTitle(debugRedactionEnabled, "author", "在 X 中查看主页")}
                  aria-disabled={!authorProfileHref}
                  onClick={(event) => {
                    if (!authorProfileHref) event.preventDefault();
                    event.stopPropagation();
                  }}
                >
                  <Avatar
                    className="size-10 shrink-0 border border-white/10"
                    {...getDebugRedactProps(debugRedactionEnabled)}
                  >
                    <AvatarFallback className="bg-white/20 text-white">{avatarInitials(authorName)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1" {...getDebugRedactProps(debugRedactionEnabled)}>
                    <p className="truncate font-semibold text-white leading-tight">{authorName}</p>
                    <div className="flex items-center gap-2 text-sm text-white/70">
                      <p className="truncate">{post.author_username ? `@${post.author_username}` : "用户名未知"}</p>
                      <span>·</span>
                      <p className="shrink-0">{formatDateTime(post.published_at)}</p>
                    </div>
                  </div>
                </a>
                <a
                  href={tweetHref}
                  target={tweetHref ? "_blank" : undefined}
                  rel={tweetHref ? "noopener noreferrer" : undefined}
                  className="shrink-0 rounded-full p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                  title={getDebugLinkTitle(debugRedactionEnabled, "tweet", "在 X 中查看此贴")}
                  aria-disabled={!tweetHref}
                  onClick={(event) => {
                    if (!tweetHref) event.preventDefault();
                    event.stopPropagation();
                  }}
                >
                  <ExternalLink className="size-5" />
                </a>
              </div>
              <button
                type="button"
                className="mt-3 w-full text-left outline-none cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  setContextExpanded((current) => !current);
                }}
                {...getDebugRedactProps(debugRedactionEnabled)}
              >
                <p
                  className={
                    contextExpanded
                      ? "whitespace-pre-wrap text-[15px] leading-relaxed text-white drop-shadow-md"
                      : "line-clamp-2 whitespace-pre-wrap text-[15px] leading-relaxed text-white drop-shadow-md"
                  }
                >
                  {tweetText}
                </p>
              </button>
            </div>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function avatarInitials(value: string) {
  return Array.from(value.trim()).slice(0, 2).join("").toUpperCase() || "?";
}

function PreviewVideo({
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

    // 监听 Artplayer 控制栏的显示与隐藏事件，同步外部 UI
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
  }, [active, getVideoState, previewUrl, src, updateVideoState, videoId]);

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
      className="swiper-no-swiping relative flex size-full touch-none items-center justify-center bg-black select-none"
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
