import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  ChevronDown,
  ChevronUp,
  ExternalLink,
  LoaderCircle,
  RotateCcw,
  X as CloseIcon,
} from "lucide-react";
import { Keyboard, Navigation, Pagination } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/react";
import type { Swiper as SwiperInstance } from "swiper/types";
import { useLocation } from "react-router-dom";
import type { PostFeedRow } from "@/lib/api";
import { PlatformHashtags } from "@/components/platform-hashtags";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PrivacyMediaPlaceholder } from "@/components/ui/privacy-media-placeholder";
import { closeDialogHistoryEntry, isDialogHistoryEntry } from "@/lib/dialog-history";
import {
  getPrivacyAuthorProfileHref,
  getPrivacyExternalHref,
  getPrivacyLinkTitle,
  getPrivacyRedactProps,
  usePrivacyRedactionEnabled,
} from "@/lib/privacy-redaction";
import { formatDateTime } from "@/lib/utils";
import type { FeedVideoPlaybackStateApi } from "../../video-playback-state";
import { PreviewImage } from "./preview-image";
import { PreviewVideo } from "./preview-video";
import "swiper/css";
import "swiper/css/navigation";
import "swiper/css/pagination";

type PostPreviewDialogProps = {
  post?: PostFeedRow | null;
  posts?: PostFeedRow[];
  activeTweetId?: string | null;
  activeIndex: number;
  historyToken: string | null;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  nextPageError?: unknown;
  endLabel?: string;
  onActiveIndexChange: (index: number) => void;
  onActiveTweetChange?: (tweetId: string) => void;
  onLoadMore?: () => void;
  onRetryLoadMore?: () => void;
  onOpenChange: (open: boolean) => void;
} & FeedVideoPlaybackStateApi;

type TweetDirection = -1 | 1;
const WHEEL_STREAM_IDLE_MS = 180;
const WHEEL_NAVIGATION_THRESHOLD = 64;

export function PostPreviewDialog({
  post,
  posts,
  activeTweetId,
  activeIndex,
  historyToken,
  hasNextPage = false,
  isFetchingNextPage = false,
  nextPageError = null,
  endLabel = "已经浏览完",
  onActiveIndexChange,
  onActiveTweetChange,
  onLoadMore,
  onRetryLoadMore,
  onOpenChange,
  getVideoState,
  updateVideoState,
}: PostPreviewDialogProps) {
  const privacyRedactionEnabled = usePrivacyRedactionEnabled();
  const location = useLocation();
  const swiperRef = useRef<SwiperInstance | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const activeHistoryTokenRef = useRef<string | null>(null);
  const closingHistoryTokenRef = useRef<string | null>(null);
  const motionFrameRef = useRef<number | null>(null);
  const requestedAtPostCountRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);
  const wheelGestureRef = useRef({ accumulated: 0, locked: false, unlockTimer: null as number | null });
  const pointerGestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startedAt: number;
    startMediaIndex: number;
    axis: "pending" | "horizontal" | "vertical";
  } | null>(null);
  const availablePosts = useMemo(() => posts ?? (post ? [post] : []), [post, posts]);
  const activePost =
    (activeTweetId ? availablePosts.find((item) => item.tweet_id === activeTweetId) : null) ?? post ?? null;
  const activePostPosition = activePost
    ? availablePosts.findIndex((item) => item.tweet_id === activePost.tweet_id)
    : -1;
  const [contextExpanded, setContextExpanded] = useState(false);
  const [uiVisible, setUiVisible] = useState(true);
  const [pendingAdvance, setPendingAdvance] = useState(false);
  const [motion, setMotion] = useState({ offsetY: 0, opacity: 1, animate: true });

  const handleClose = useCallback(() => {
    if (!historyToken) {
      onOpenChange(false);
      return;
    }
    if (closingHistoryTokenRef.current === historyToken) return;
    closingHistoryTokenRef.current = historyToken;
    closeDialogHistoryEntry(historyToken, () => {
      closingHistoryTokenRef.current = null;
      onOpenChange(false);
    });
  }, [historyToken, onOpenChange]);

  useEffect(() => {
    swiperRef.current?.slideTo(activeIndex);
  }, [activeIndex]);

  useEffect(() => {
    if (!activePost) return undefined;
    const animationFrame = window.requestAnimationFrame(() => {
      swiperRef.current?.update();
      swiperRef.current?.slideTo(activeIndex, 0);
    });
    return () => window.cancelAnimationFrame(animationFrame);
  }, [activeIndex, activePost]);

  useEffect(() => {
    if (!historyToken) return undefined;
    if (isDialogHistoryEntry(location.state, historyToken)) {
      activeHistoryTokenRef.current = historyToken;
      return undefined;
    }

    // 路由 effect 观察到 token 前也可能收到快速 Escape；关闭意图与已激活
    // token 任一命中，都能在 POP 后安全退出且不提前恢复列表视频。
    if (
      activeHistoryTokenRef.current === historyToken ||
      closingHistoryTokenRef.current === historyToken
    ) {
      activeHistoryTokenRef.current = null;
      closingHistoryTokenRef.current = null;
      onOpenChange(false);
    }
    return undefined;
  }, [historyToken, location.state, onOpenChange]);

  useEffect(() => {
    setContextExpanded(false);
  }, [activePost?.tweet_id]);

  useEffect(() => {
    if (
      activePostPosition < 0 ||
      activePostPosition < availablePosts.length - 3 ||
      !hasNextPage ||
      isFetchingNextPage ||
      nextPageError ||
      !onLoadMore ||
      requestedAtPostCountRef.current === availablePosts.length
    ) {
      return;
    }
    // 靠近底部时提前请求一页，避免用户拖到底部才看到加载占位。
    requestedAtPostCountRef.current = availablePosts.length;
    onLoadMore();
  }, [
    activePostPosition,
    availablePosts.length,
    hasNextPage,
    isFetchingNextPage,
    nextPageError,
    onLoadMore,
  ]);

  useEffect(() => {
    if (requestedAtPostCountRef.current !== availablePosts.length) requestedAtPostCountRef.current = null;
  }, [availablePosts.length]);

  const transitionToTweet = useCallback(
    (tweetId: string, direction: TweetDirection) => {
      if (!onActiveTweetChange) return;
      if (motionFrameRef.current !== null) window.cancelAnimationFrame(motionFrameRef.current);
      // 翻到下一条时，先拦截紧接着可能冒泡的点击，避免触发视频控制/链接误操作。
      suppressClickRef.current = true;
      onActiveTweetChange(tweetId);
      setMotion({ offsetY: direction > 0 ? 40 : -40, opacity: 0.55, animate: false });
      motionFrameRef.current = window.requestAnimationFrame(() => {
        motionFrameRef.current = null;
        setMotion({ offsetY: 0, opacity: 1, animate: true });
      });
    },
    [onActiveTweetChange],
  );

  const moveTweet = useCallback(
    (direction: TweetDirection) => {
      if (!activePost || activePostPosition < 0 || !onActiveTweetChange) return;
      const target = availablePosts[activePostPosition + direction];
      if (target) {
        setPendingAdvance(false);
        transitionToTweet(target.tweet_id, direction);
        return;
      }

      setMotion({ offsetY: 0, opacity: 1, animate: true });
      if (direction > 0 && hasNextPage && onLoadMore) {
        setPendingAdvance(true);
        if (!isFetchingNextPage && !nextPageError) onLoadMore();
      }
    },
    [
      activePost,
      activePostPosition,
      availablePosts,
      hasNextPage,
      isFetchingNextPage,
      nextPageError,
      onActiveTweetChange,
      onLoadMore,
      transitionToTweet,
    ],
  );

  useEffect(() => {
    if (!pendingAdvance || activePostPosition < 0) return;
    const nextPost = availablePosts[activePostPosition + 1];
    if (nextPost) {
      setPendingAdvance(false);
      transitionToTweet(nextPost.tweet_id, 1);
    } else if (nextPageError || (!hasNextPage && !isFetchingNextPage)) {
      setPendingAdvance(false);
    }
  }, [
    activePostPosition,
    availablePosts,
    hasNextPage,
    isFetchingNextPage,
    nextPageError,
    pendingAdvance,
    transitionToTweet,
  ]);

  useEffect(
    () => () => {
      if (motionFrameRef.current !== null) window.cancelAnimationFrame(motionFrameRef.current);
      if (wheelGestureRef.current.unlockTimer !== null) {
        window.clearTimeout(wheelGestureRef.current.unlockTimer);
      }
    },
    [],
  );

  const resetPointerMotion = useCallback(() => {
    pointerGestureRef.current = null;
    if (swiperRef.current) swiperRef.current.allowTouchMove = true;
    setMotion({ offsetY: 0, opacity: 1, animate: true });
  }, []);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" || event.button !== 0 || isPreviewNavigationExcluded(event.target)) return;
    pointerGestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: performance.now(),
      startMediaIndex: swiperRef.current?.activeIndex ?? activeIndex,
      axis: "pending",
    };
    setMotion((current) => ({ ...current, animate: false }));
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = pointerGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;

    if (gesture.axis === "pending" && Math.max(Math.abs(deltaX), Math.abs(deltaY)) >= 10) {
      gesture.axis = Math.abs(deltaY) > Math.abs(deltaX) * 1.15 ? "vertical" : "horizontal";
      if (gesture.axis === "vertical" && swiperRef.current) swiperRef.current.allowTouchMove = false;
    }
    if (gesture.axis !== "vertical") return;

    event.preventDefault();
    suppressClickRef.current = true;
    const constrainedOffset = constrainBoundaryDrag(deltaY, activePostPosition, availablePosts.length, hasNextPage);
    const viewportHeight = Math.max(surfaceRef.current?.clientHeight ?? window.innerHeight, 1);
    setMotion({
      offsetY: constrainedOffset,
      opacity: Math.max(0.58, 1 - Math.abs(constrainedOffset) / viewportHeight),
      animate: false,
    });
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const gesture = pointerGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    const elapsed = Math.max(performance.now() - gesture.startedAt, 1);
    const verticalVelocity = Math.abs(deltaY) / elapsed;
    const shouldMoveVertically =
      gesture.axis === "vertical" &&
      (Math.abs(deltaY) >= 72 || (Math.abs(deltaY) >= 24 && verticalVelocity >= 0.55));
    pointerGestureRef.current = null;
    if (swiperRef.current) swiperRef.current.allowTouchMove = true;

    if (gesture.axis === "horizontal") {
      const horizontalVelocity = Math.abs(deltaX) / elapsed;
      const shouldMoveHorizontally =
        Math.abs(deltaX) >= 72 || (Math.abs(deltaX) >= 24 && horizontalVelocity >= 0.55);
      setMotion({ offsetY: 0, opacity: 1, animate: true });
      const mediaCount = activePost?.media.length ?? 0;
      if (!shouldMoveHorizontally || mediaCount === 0) return;

      suppressClickRef.current = true;
      const targetIndex = Math.min(
        Math.max(gesture.startMediaIndex + (deltaX < 0 ? 1 : -1), 0),
        mediaCount - 1,
      );
      const gestureSwiper = swiperRef.current;
      // Swiper 14 may consume a coalesced first move only to unlock its threshold.
      // Let its pointerup finish first, then recover only if the intended slide was not committed.
      queueMicrotask(() => {
        if (!gestureSwiper || gestureSwiper.destroyed || gestureSwiper.activeIndex === targetIndex) return;
        gestureSwiper.slideTo(targetIndex);
      });
      return;
    }

    if (shouldMoveVertically) {
      moveTweet(deltaY < 0 ? 1 : -1);
      return;
    }
    // 未达到翻页阈值时回到原位，减少误触带来的跳转。
    setMotion({ offsetY: 0, opacity: 1, animate: true });
  };

  const handleWheelDelta = useCallback(
    (deltaY: number) => {
      const wheel = wheelGestureRef.current;
      if (wheel.unlockTimer !== null) window.clearTimeout(wheel.unlockTimer);
      wheel.unlockTimer = window.setTimeout(() => {
        wheel.accumulated = 0;
        wheel.locked = false;
        wheel.unlockTimer = null;
      }, WHEEL_STREAM_IDLE_MS);
      if (wheel.locked) return;
      wheel.accumulated += deltaY;
      if (Math.abs(wheel.accumulated) < WHEEL_NAVIGATION_THRESHOLD) return;

      const direction = wheel.accumulated > 0 ? 1 : -1;
      // 只跨一次累积阈值，锁定到当前滚轮流结束，避免惯性事件连续翻帖。
      wheel.accumulated = 0;
      wheel.locked = true;
      moveTweet(direction);
    },
    [moveTweet],
  );

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (isPreviewNavigationExcluded(event.target) || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    event.preventDefault();
    handleWheelDelta(event.deltaY);
  };

  if (!activePost) return null;
  const activeMedia = activePost.media[activeIndex];
  const canMovePrevious = activePostPosition > 0;
  const canMoveNext = activePostPosition >= 0 && activePostPosition < availablePosts.length - 1;
  const canRequestNext = canMoveNext || hasNextPage;
  const showTweetNavigation = Boolean(onActiveTweetChange && (availablePosts.length > 1 || hasNextPage));
  const atLoadedEnd = activePostPosition === availablePosts.length - 1;
  const renderChromeInPlayer = activeMedia?.media_type === "video" && Boolean(activeMedia.media_url);
  const previewChrome = (
    <PreviewChrome
      post={activePost}
      privacyRedactionEnabled={privacyRedactionEnabled}
      uiVisible={uiVisible}
      contextExpanded={contextExpanded}
      onContextToggle={() => setContextExpanded((current) => !current)}
      onClose={handleClose}
    />
  );
  const tweetNavigationChrome = (
    <>
      {showTweetNavigation ? (
        <div
          data-preview-navigation-control="true"
          className="absolute right-3 top-1/2 z-[60] flex -translate-y-1/2 flex-col items-center gap-2 sm:right-5"
        >
          <button
            type="button"
            className="flex size-11 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white shadow-2 backdrop-blur transition-colors hover:bg-black/65 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:cursor-not-allowed disabled:opacity-35"
            aria-label="上一条帖子（K）"
            disabled={!canMovePrevious}
            onClick={(event) => {
              event.stopPropagation();
              moveTweet(-1);
            }}
          >
            <ChevronUp className="size-5" aria-hidden="true" />
          </button>
          <span className="rounded-full bg-black/45 px-2 py-1 text-[11px] tabular-nums text-white/75 backdrop-blur">
            {activePostPosition + 1}/{availablePosts.length}
          </span>
          <button
            type="button"
            className="flex size-11 items-center justify-center rounded-full border border-white/15 bg-black/45 text-white shadow-2 backdrop-blur transition-colors hover:bg-black/65 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:cursor-not-allowed disabled:opacity-35"
            aria-label="下一条帖子（J）"
            disabled={!canRequestNext || (isFetchingNextPage && pendingAdvance)}
            onClick={(event) => {
              event.stopPropagation();
              moveTweet(1);
            }}
          >
            {isFetchingNextPage && pendingAdvance ? (
              <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            ) : (
              <ChevronDown className="size-5" aria-hidden="true" />
            )}
          </button>
        </div>
      ) : null}

      {showTweetNavigation && atLoadedEnd && (isFetchingNextPage || nextPageError || !hasNextPage) ? (
        <div
          data-preview-navigation-control="true"
          className="pointer-events-none absolute inset-x-0 bottom-14 z-[60] flex justify-center px-16"
          aria-live="polite"
        >
          <div className="pointer-events-auto flex min-h-10 items-center gap-2 rounded-full border border-white/15 bg-black/65 px-4 py-2 text-xs text-white/85 shadow-2 backdrop-blur">
            {isFetchingNextPage ? (
              <>
                <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                正在加载更多帖子…
              </>
            ) : nextPageError ? (
              <button
                type="button"
                className="flex items-center gap-2 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                onClick={(event) => {
                  event.stopPropagation();
                  setPendingAdvance(true);
                  onRetryLoadMore?.();
                }}
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                加载失败，重试
              </button>
            ) : (
              endLabel
            )}
          </div>
        </div>
      ) : null}
    </>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && handleClose()}>
      <DialogContent
        className="left-0 top-0 h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none border-0 bg-black p-0 [&>button]:hidden"
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        onKeyDownCapture={(event) => {
          if (!showTweetNavigation || isEditableTarget(event.target) || event.defaultPrevented) return;
          const key = event.key.toLowerCase();
          if (key === "arrowup" || key === "k") {
            event.preventDefault();
            event.stopPropagation();
            moveTweet(-1);
          } else if (key === "arrowdown" || key === "j") {
            event.preventDefault();
            event.stopPropagation();
            moveTweet(1);
          }
        }}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>帖子媒体预览</DialogTitle>
          <DialogDescription>上下切换帖子，左右切换同一帖子的本地媒体。</DialogDescription>
        </DialogHeader>

        <div
          ref={surfaceRef}
          data-preview-tweet-surface="true"
          className="relative h-full min-h-0 w-full min-w-0 touch-none overflow-hidden bg-black"
          onPointerDownCapture={handlePointerDown}
          onPointerMoveCapture={handlePointerMove}
          onPointerUpCapture={handlePointerEnd}
          onPointerCancelCapture={resetPointerMotion}
          onWheelCapture={handleWheel}
        >
          <div
            className={
              motion.animate
                ? "size-full transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none"
                : "size-full"
            }
            style={{ transform: `translate3d(0, ${motion.offsetY}px, 0)`, opacity: motion.opacity }}
          >
            <Swiper
              key={activePost.tweet_id}
              className={`h-full min-h-0 w-full min-w-0 max-w-full [&_.swiper-button-next]:hidden [&_.swiper-button-prev]:hidden sm:[&_.swiper-button-next]:flex sm:[&_.swiper-button-prev]:flex ${uiVisible ? "[&_.swiper-button-next]:opacity-100 [&_.swiper-button-prev]:opacity-100 [&_.swiper-pagination]:opacity-100" : "[&_.swiper-button-next]:opacity-0 [&_.swiper-button-prev]:opacity-0 [&_.swiper-pagination]:opacity-0"} [&_.swiper-button-next]:transition-opacity [&_.swiper-button-prev]:transition-opacity [&_.swiper-pagination]:transition-opacity [&_.swiper-pagination]:duration-300 [&_.swiper-button-next]:duration-300 [&_.swiper-button-prev]:duration-300 [&_.swiper-pagination-fraction]:bottom-5 [&_.swiper-pagination-fraction]:top-auto [&_.swiper-pagination-fraction]:text-sm [&_.swiper-pagination-fraction]:text-white/60`}
              modules={[Keyboard, Navigation, Pagination]}
              initialSlide={activeIndex}
              keyboard={{ enabled: true }}
              navigation
              pagination={{ type: "fraction" }}
              observer
              observeParents
              resizeObserver
              onClick={() => {
                if (suppressClickRef.current) {
                  suppressClickRef.current = false;
                  return;
                }
                setUiVisible((visible) => !visible);
              }}
              onSwiper={(swiper) => {
                swiperRef.current = swiper;
              }}
              onSlideChange={(swiper) => onActiveIndexChange(swiper.activeIndex)}
            >
              {activePost.media.map((item, index) => (
                <SwiperSlide key={item.id}>
                  <div className="flex size-full items-center justify-center">
                    {privacyRedactionEnabled ? (
                      <PrivacyMediaPlaceholder appearance="inverse" />
                    ) : item.media_url ? (
                      item.media_type === "video" ? (
                        <PreviewVideo
                          src={item.media_url}
                          previewUrl={item.preview_url}
                          active={index === activeIndex}
                          videoId={`${activePost.tweet_id}:${item.id}`}
                          getVideoState={getVideoState}
                          updateVideoState={updateVideoState}
                          onControlToggle={setUiVisible}
                          onTweetGesture={showTweetNavigation ? moveTweet : undefined}
                          onTweetWheel={showTweetNavigation ? handleWheelDelta : undefined}
                          overlay={
                            index === activeIndex ? (
                              <>
                                {previewChrome}
                                {tweetNavigationChrome}
                              </>
                            ) : null
                          }
                        />
                      ) : (
                        <PreviewImage src={item.media_url} />
                      )
                    ) : (
                      <span className="text-sm text-white/70">媒体不可用</span>
                    )}
                  </div>
                </SwiperSlide>
              ))}
            </Swiper>
            {renderChromeInPlayer ? null : (
              <>
                {previewChrome}
                {tweetNavigationChrome}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function isPreviewNavigationExcluded(target: EventTarget | null) {
  // 触控/滑轮导航只处理画布区域；按钮、链接、输入框、播放器控制层应保留各自默认行为。
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        '[data-preview-navigation-control="true"], [data-preview-chrome="true"], .swiper-button-next, .swiper-button-prev, .swiper-pagination, .art-bottom, .art-controls, .art-settings, .art-contextmenus, .art-layer button, button, input, select, textarea, a',
      ),
    )
  );
}

function isEditableTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || Boolean(target.closest("input, textarea, select, [contenteditable='true']")))
  );
}

function constrainBoundaryDrag(offset: number, activePosition: number, postCount: number, hasNextPage: boolean) {
  // 到达列表边界时仅做柔性阻尼，防止继续拖动出现“穿透感”。
  const atStart = activePosition <= 0 && offset > 0;
  const atEnd = activePosition >= postCount - 1 && offset < 0 && !hasNextPage;
  return atStart || atEnd ? offset * 0.24 : offset;
}

function PreviewChrome({
  post,
  privacyRedactionEnabled,
  uiVisible,
  contextExpanded,
  onContextToggle,
  onClose,
}: {
  post: PostFeedRow;
  privacyRedactionEnabled: boolean;
  uiVisible: boolean;
  contextExpanded: boolean;
  onContextToggle: () => void;
  onClose: () => void;
}) {
  const authorName = post.author_display_name || post.author_username || "未知作者";
  const authorProfileHref = getPrivacyAuthorProfileHref(privacyRedactionEnabled, post.author_username);
  const tweetHref = getPrivacyExternalHref(privacyRedactionEnabled, post.tweet_url);
  const tweetText = post.tweet_text || "暂无帖子正文";

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        className={`pointer-events-auto absolute right-4 top-4 z-50 flex size-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur transition-all duration-300 hover:bg-black/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${uiVisible ? "opacity-100" : "pointer-events-none opacity-0"}`}
        aria-label="关闭预览"
      >
        <CloseIcon className="size-5" aria-hidden="true" />
      </button>

      <aside
        data-preview-chrome="true"
        className={`pointer-events-none absolute inset-x-0 top-0 z-40 bg-gradient-to-b from-black/90 via-black/60 to-transparent px-4 pb-24 pt-4 transition-all duration-300 md:px-6 ${uiVisible ? "translate-y-0 opacity-100" : "-translate-y-8 opacity-0"}`}
      >
        <div className={`${uiVisible ? "pointer-events-auto" : "pointer-events-none"} mx-auto max-w-3xl pr-12`}>
          <div className="flex items-start justify-between gap-4">
            <a
              href={authorProfileHref}
              target={authorProfileHref ? "_blank" : undefined}
              rel={authorProfileHref ? "noopener noreferrer" : undefined}
              className="flex min-w-0 flex-1 items-center gap-3 transition-opacity hover:opacity-80 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
              title={getPrivacyLinkTitle(privacyRedactionEnabled, "author", "在 X 中查看主页")}
              aria-disabled={!authorProfileHref}
              onClick={(event) => {
                if (!authorProfileHref) event.preventDefault();
                event.stopPropagation();
              }}
            >
              <Avatar className="size-10 shrink-0 border border-white/10" {...getPrivacyRedactProps(privacyRedactionEnabled)}>
                <AvatarFallback className="bg-white/20 text-white">{avatarInitials(authorName)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1" {...getPrivacyRedactProps(privacyRedactionEnabled)}>
                <p className="truncate font-semibold leading-tight text-white">{authorName}</p>
                <div className="flex items-center gap-2 text-sm text-white/70">
                  <p className="truncate">{post.author_username ? `@${post.author_username}` : "用户名未知"}</p>
                  <span aria-hidden="true">·</span>
                  <p className="shrink-0">{formatDateTime(post.published_at)}</p>
                </div>
              </div>
            </a>
            <a
              href={tweetHref}
              target={tweetHref ? "_blank" : undefined}
              rel={tweetHref ? "noopener noreferrer" : undefined}
              className="shrink-0 rounded-full p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
              title={getPrivacyLinkTitle(privacyRedactionEnabled, "tweet", "在 X 中查看此贴")}
              aria-label={getPrivacyLinkTitle(privacyRedactionEnabled, "tweet", "在 X 中查看此贴")}
              aria-disabled={!tweetHref}
              onClick={(event) => {
                if (!tweetHref) event.preventDefault();
                event.stopPropagation();
              }}
            >
              <ExternalLink className="size-5" aria-hidden="true" />
            </a>
          </div>
          <button
            type="button"
            className="mt-3 w-full cursor-pointer rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            onClick={(event) => {
              event.stopPropagation();
              onContextToggle();
            }}
            aria-expanded={contextExpanded}
            {...getPrivacyRedactProps(privacyRedactionEnabled)}
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
          <PlatformHashtags hashtags={post.hashtags ?? []} appearance="inverse" className="pointer-events-auto mt-3" />
        </div>
      </aside>
    </>
  );
}

function avatarInitials(value: string) {
  return Array.from(value.trim()).slice(0, 2).join("").toUpperCase() || "?";
}
