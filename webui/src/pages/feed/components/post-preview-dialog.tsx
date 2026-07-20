import { useEffect, useRef, useState } from "react";
import Artplayer from "artplayer";
import { ExternalLink } from "lucide-react";
import { Keyboard, Navigation, Pagination } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/react";
import type { Swiper as SwiperInstance } from "swiper/types";
import type { PostFeedRow } from "@/lib/api";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { createArtplayerCleanup } from "@/lib/artplayer-lifecycle";
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
  onActiveIndexChange,
  onOpenChange,
}: {
  post: PostFeedRow | null;
  activeIndex: number;
  onActiveIndexChange: (index: number) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const debugRedactionEnabled = useDebugRedactionEnabled();
  const swiperRef = useRef<SwiperInstance | null>(null);
  const [contextExpanded, setContextExpanded] = useState(false);

  useEffect(() => {
    swiperRef.current?.slideTo(activeIndex);
  }, [activeIndex]);

  if (!post) return null;
  const authorName = post.author_display_name || post.author_username || "未知作者";
  const authorProfileHref = getDebugAuthorProfileHref(debugRedactionEnabled, post.author_username);
  const tweetHref = getDebugExternalHref(debugRedactionEnabled, post.tweet_url);
  const tweetText = post.tweet_text || "暂无帖子正文";

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="left-0 top-0 grid h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden rounded-none border-0 bg-black p-0 md:grid-cols-[minmax(0,1fr)_360px] md:grid-rows-1 [&>button]:bg-black/60 [&>button]:text-white [&>button]:hover:bg-black/80">
        <DialogHeader className="sr-only">
          <DialogTitle>帖子媒体预览</DialogTitle>
          <DialogDescription>左右切换查看同一帖子的本地媒体。</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 min-w-0 bg-black">
          <Swiper
            key={post.tweet_id}
            className="size-full [&_.swiper-button-next]:hidden [&_.swiper-button-prev]:hidden sm:[&_.swiper-button-next]:flex sm:[&_.swiper-button-prev]:flex"
            modules={[Keyboard, Navigation, Pagination]}
            initialSlide={activeIndex}
            keyboard={{ enabled: true }}
            navigation
            pagination={{ type: "fraction" }}
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
                      <PreviewVideo src={item.media_url} previewUrl={item.preview_url} active={index === activeIndex} />
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
        </div>
        <aside className="max-h-[36dvh] overflow-y-auto border-t border-white/15 bg-black p-4 md:max-h-none md:border-l md:border-t-0 md:p-5">
          <div className="flex items-start justify-between gap-4">
            <a
              href={authorProfileHref}
              target={authorProfileHref ? "_blank" : undefined}
              rel={authorProfileHref ? "noopener noreferrer" : undefined}
              className="flex min-w-0 flex-1 items-start gap-3 transition-opacity hover:opacity-80"
              title={getDebugLinkTitle(debugRedactionEnabled, "author", "在 X 中查看主页")}
              aria-disabled={!authorProfileHref}
              onClick={(event) => {
                if (!authorProfileHref) event.preventDefault();
              }}
            >
              <Avatar className="size-10 shrink-0 border border-white/10" {...getDebugRedactProps(debugRedactionEnabled)}>
                <AvatarFallback className="bg-white/20 text-white">{avatarInitials(authorName)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1" {...getDebugRedactProps(debugRedactionEnabled)}>
                <p className="truncate font-semibold text-white">{authorName}</p>
                <p className="truncate text-sm text-white/60">
                  {post.author_username ? `@${post.author_username}` : "用户名未知"}
                </p>
              </div>
            </a>
            <a
              href={tweetHref}
              target={tweetHref ? "_blank" : undefined}
              rel={tweetHref ? "noopener noreferrer" : undefined}
              className="shrink-0 rounded-full p-2 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
              title={getDebugLinkTitle(debugRedactionEnabled, "tweet", "在 X 中查看此贴")}
              aria-disabled={!tweetHref}
              onClick={(event) => {
                if (!tweetHref) event.preventDefault();
              }}
            >
              <ExternalLink className="size-5" />
            </a>
          </div>
          <button
            type="button"
            className="mt-4 w-full text-left outline-none"
            onClick={() => setContextExpanded((current) => !current)}
            {...getDebugRedactProps(debugRedactionEnabled)}
          >
            <p
              className={
                contextExpanded
                  ? "whitespace-pre-wrap text-[15px] leading-relaxed text-white/90"
                  : "line-clamp-3 whitespace-pre-wrap text-[15px] leading-relaxed text-white/90"
              }
            >
              {tweetText}
            </p>
          </button>
          <p className="mt-4 text-xs text-white/50">{formatDateTime(post.published_at)}</p>
        </aside>
      </DialogContent>
    </Dialog>
  );
}

function avatarInitials(value: string) {
  return Array.from(value.trim()).slice(0, 2).join("").toUpperCase() || "?";
}

function PreviewVideo({ src, previewUrl, active }: { src: string; previewUrl?: string | null; active: boolean }) {
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

    const player = new Artplayer({
      container,
      url: src,
      autoSize: true,
      fullscreen: true,
      fullscreenWeb: true,
      setting: true,
      playbackRate: true,
      aspectRatio: true,
      playsInline: true,
      gesture: false,
      fastForward: false,
      theme: brandColor(),
      moreVideoAttr: {
        preload: "none",
        playsInline: true,
      },
      ...(previewUrl ? { poster: previewUrl } : {}),
    });

    const cleanupPlayer = createArtplayerCleanup(player, container);

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
      player.currentTime = targetTime;
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

    void player.play().catch(() => undefined);

    return () => {
      wrapper.removeEventListener("pointerdown", handlePointerDown, true);
      wrapper.removeEventListener("pointermove", handlePointerMove, true);
      wrapper.removeEventListener("pointerup", finishGesture, true);
      wrapper.removeEventListener("pointercancel", finishGesture, true);
      wrapper.removeEventListener("lostpointercapture", finishGesture, true);
      resetGestureState();
      cleanupPlayer();
    };
  }, [active, previewUrl, src]);

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
      <div ref={containerRef} className="tweet-video-player h-full w-full overflow-hidden bg-black" />
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

function formatSeekOverlay(delta: number, targetTime: number, duration: number) {
  const deltaPrefix = delta > 0 ? "+" : "";
  return `${deltaPrefix}${delta}s · ${formatClock(targetTime)} / ${formatClock(duration)}`;
}

function formatClock(value: number) {
  const totalSeconds = Math.max(0, Math.floor(value));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
  }

  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function brandColor() {
  const value = window.getComputedStyle(document.documentElement).getPropertyValue("--brand").trim();
  return value ? `hsl(${value})` : "#009ef7";
}
