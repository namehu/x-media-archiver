import { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, X as CloseIcon } from "lucide-react";
import { Keyboard, Navigation, Pagination } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/react";
import type { Swiper as SwiperInstance } from "swiper/types";
import { useLocation } from "react-router-dom";
import type { PostFeedRow } from "@/lib/api";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { closeDialogHistoryEntry, isDialogHistoryEntry } from "@/lib/dialog-history";
import type { FeedVideoPlaybackStateApi } from "../../video-playback-state";
import {
  getDebugAuthorProfileHref,
  getDebugExternalHref,
  getDebugLinkTitle,
  getDebugRedactProps,
  useDebugRedactionEnabled,
} from "@/lib/debug-redaction";
import { formatDateTime } from "@/lib/utils";
import { PreviewImage } from "./preview-image";
import { PreviewVideo } from "./preview-video";
import "swiper/css";
import "swiper/css/navigation";
import "swiper/css/pagination";

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
      <DialogContent
        className="left-0 top-0 h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 overflow-hidden rounded-none border-0 bg-black p-0 [&>button]:hidden"
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader className="sr-only">
          <DialogTitle>帖子媒体预览</DialogTitle>
          <DialogDescription>左右切换查看同一帖子的本地媒体。</DialogDescription>
        </DialogHeader>

        <button
          type="button"
          onClick={handleClose}
          className={`absolute right-4 top-4 z-50 flex size-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur transition-all duration-300 hover:bg-black/60 ${uiVisible ? "opacity-100" : "pointer-events-none opacity-0"}`}
          aria-label="关闭预览"
        >
          <CloseIcon className="size-5" />
        </button>

        <div className="relative h-full min-h-0 w-full min-w-0 overflow-hidden bg-black">
          <Swiper
            key={post.tweet_id}
            className={`h-full min-h-0 w-full min-w-0 max-w-full [&_.swiper-button-next]:hidden [&_.swiper-button-prev]:hidden sm:[&_.swiper-button-next]:flex sm:[&_.swiper-button-prev]:flex ${uiVisible ? "[&_.swiper-button-next]:opacity-100 [&_.swiper-button-prev]:opacity-100 [&_.swiper-pagination]:opacity-100" : "[&_.swiper-button-next]:opacity-0 [&_.swiper-button-prev]:opacity-0 [&_.swiper-pagination]:opacity-0"} [&_.swiper-button-next]:transition-opacity [&_.swiper-button-prev]:transition-opacity [&_.swiper-pagination]:transition-opacity [&_.swiper-pagination]:duration-300 [&_.swiper-button-next]:duration-300 [&_.swiper-button-prev]:duration-300 [&_.swiper-pagination-fraction]:bottom-5 [&_.swiper-pagination-fraction]:top-auto [&_.swiper-pagination-fraction]:text-sm [&_.swiper-pagination-fraction]:text-white/60`}
            modules={[Keyboard, Navigation, Pagination]}
            initialSlide={activeIndex}
            keyboard={{ enabled: true }}
            navigation
            pagination={{ type: "fraction" }}
            observer
            observeParents
            resizeObserver
            onClick={() => setUiVisible((visible) => !visible)}
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
                      <PreviewImage src={item.media_url} />
                    )
                  ) : (
                    <span className="text-sm text-white/70">媒体不可用</span>
                  )}
                </div>
              </SwiperSlide>
            ))}
          </Swiper>

          <aside
            className={`pointer-events-none absolute left-0 right-0 top-0 z-40 bg-gradient-to-b from-black/90 via-black/60 to-transparent px-4 pb-24 pt-4 transition-all duration-300 md:px-6 ${uiVisible ? "translate-y-0 opacity-100" : "-translate-y-8 opacity-0"}`}
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
                    <p className="truncate font-semibold leading-tight text-white">{authorName}</p>
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
                className="mt-3 w-full cursor-pointer text-left outline-none"
                onClick={(event) => {
                  event.stopPropagation();
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
