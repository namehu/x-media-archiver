import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ExternalLink, ImageOff, Loader2, Maximize2, Trash2, X } from "lucide-react";
import { Keyboard } from "swiper/modules";
import { Swiper, SwiperSlide } from "swiper/react";
import type { Swiper as SwiperInstance } from "swiper/types";
import { useLocation } from "react-router-dom";
import type { MediaRow } from "../../../lib/api";
import {
  getDebugDetailRoute,
  getDebugExternalHref,
  getDebugLinkTitle,
  getDebugMediaAlt,
  getDebugRedactProps,
  useDebugRedactionEnabled,
} from "../../../lib/debug-redaction";
import { closeDialogHistoryEntry, isDialogHistoryEntry } from "../../../lib/dialog-history";
import { mediaTypeLabel, statusLabel } from "../../../lib/formatters";
import { formatBytes, formatDateTime } from "../../../lib/utils";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import "swiper/css";

type LibraryMediaPreviewDialogProps = {
  media: MediaRow[];
  activeMediaId: number | null;
  totalCount: number;
  historyToken: string | null;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  nextPageError: unknown;
  onActiveMediaChange: (mediaId: number) => void;
  onLoadMore: () => void;
  onRetryLoadMore: () => void;
  onOpenChange: (open: boolean) => void;
  onDelete: (media: MediaRow) => void;
  onViewTweet: (route: string) => void;
};

export function LibraryMediaPreviewDialog({
  media,
  activeMediaId,
  totalCount,
  historyToken,
  hasNextPage,
  isFetchingNextPage,
  nextPageError,
  onActiveMediaChange,
  onLoadMore,
  onRetryLoadMore,
  onOpenChange,
  onDelete,
  onViewTweet,
}: LibraryMediaPreviewDialogProps) {
  const location = useLocation();
  const swiperRef = useRef<SwiperInstance | null>(null);
  const activeHistoryTokenRef = useRef<string | null>(null);
  const [contextExpanded, setContextExpanded] = useState(false);
  const activeIndex = useMemo(
    () => (activeMediaId === null ? -1 : media.findIndex((item) => item.id === activeMediaId)),
    [activeMediaId, media],
  );
  const activeMedia = activeIndex >= 0 ? media[activeIndex] : null;

  const handleClose = useCallback(() => {
    if (!historyToken) {
      onOpenChange(false);
      return;
    }
    closeDialogHistoryEntry(historyToken, () => onOpenChange(false));
  }, [historyToken, onOpenChange]);

  useEffect(() => {
    if (activeIndex >= 0) swiperRef.current?.slideTo(activeIndex);
  }, [activeIndex]);

  useEffect(() => {
    if (!activeMedia) return undefined;
    const frame = window.requestAnimationFrame(() => {
      swiperRef.current?.update();
      swiperRef.current?.slideTo(activeIndex, 0);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeIndex, activeMedia, media.length]);

  useEffect(() => {
    setContextExpanded(false);
  }, [activeMediaId]);

  useEffect(() => {
    if (
      activeIndex >= 0 &&
      activeIndex >= media.length - 3 &&
      hasNextPage &&
      !isFetchingNextPage &&
      !nextPageError
    ) {
      onLoadMore();
    }
  }, [activeIndex, hasNextPage, isFetchingNextPage, media.length, nextPageError, onLoadMore]);

  useEffect(() => {
    if (!activeMedia) return undefined;
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Enter") return;
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("button, a, input, textarea, select, video")) return;
      event.preventDefault();
      setContextExpanded((current) => !current);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeMedia]);

  useEffect(() => {
    if (!historyToken) return undefined;
    if (isDialogHistoryEntry(location.state, historyToken)) {
      activeHistoryTokenRef.current = historyToken;
      return undefined;
    }
    if (activeHistoryTokenRef.current === historyToken) onOpenChange(false);
    return undefined;
  }, [historyToken, location.state, onOpenChange]);

  if (!activeMedia || activeIndex < 0) return null;

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
          <DialogTitle>媒体库预览</DialogTitle>
          <DialogDescription>左右切换查看当前筛选结果中的图片和视频。</DialogDescription>
        </DialogHeader>

        <div className="relative size-full overflow-hidden bg-black">
          <Swiper
            className="size-full"
            modules={[Keyboard]}
            initialSlide={activeIndex}
            keyboard={{ enabled: true }}
            observer
            observeParents
            resizeObserver
            onSwiper={(swiper) => {
              swiperRef.current = swiper;
            }}
            onSlideChange={(swiper) => {
              const nextMedia = media[swiper.activeIndex];
              if (nextMedia) onActiveMediaChange(nextMedia.id);
              if (swiper.activeIndex >= media.length - 3 && hasNextPage && !isFetchingNextPage && !nextPageError) {
                onLoadMore();
              }
            }}
          >
            {media.map((item, index) => (
              <SwiperSlide key={item.id}>
                <PreviewMedia media={item} active={index === activeIndex} />
              </SwiperSlide>
            ))}
          </Swiper>

          <PreviewHeader
            media={activeMedia}
            expanded={contextExpanded}
            onToggleExpanded={() => setContextExpanded((current) => !current)}
            onClose={handleClose}
            onDelete={() => onDelete(activeMedia)}
            onViewTweet={onViewTweet}
          />

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute left-4 top-1/2 z-20 hidden -translate-y-1/2 rounded-full bg-black/45 text-white backdrop-blur hover:bg-black/65 hover:text-white sm:inline-flex"
            aria-label="上一项媒体"
            disabled={activeIndex <= 0}
            onClick={() => swiperRef.current?.slidePrev()}
          >
            <ChevronLeft />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute right-4 top-1/2 z-20 hidden -translate-y-1/2 rounded-full bg-black/45 text-white backdrop-blur hover:bg-black/65 hover:text-white sm:inline-flex"
            aria-label="下一项媒体"
            disabled={activeIndex >= media.length - 1 && !hasNextPage}
            onClick={() => {
              if (activeIndex >= media.length - 1 && hasNextPage) onLoadMore();
              else swiperRef.current?.slideNext();
            }}
          >
            <ChevronRight />
          </Button>

          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center gap-2 bg-gradient-to-t from-black/80 via-black/45 to-transparent px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-16 text-white">
            <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-white/75">
              <span>{activeIndex + 1} / {totalCount.toLocaleString()}</span>
              <span>·</span>
              <span>{mediaTypeLabel(activeMedia.media_type)}</span>
              <span>·</span>
              <span>{formatDimensions(activeMedia)}</span>
              <span>·</span>
              <span>{formatBytes(activeMedia.file_size)}</span>
              <Badge tone={previewStatusTone(activeMedia)}>{statusLabel(activeMedia.media_status)}</Badge>
            </div>
            {isFetchingNextPage ? (
              <span className="inline-flex items-center gap-1 text-xs text-white/70">
                <Loader2 className="size-3 animate-spin" /> 正在加载更多
              </span>
            ) : null}
            {nextPageError ? (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="pointer-events-auto"
                onClick={onRetryLoadMore}
              >
                加载失败，重试
              </Button>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PreviewHeader({
  media,
  expanded,
  onToggleExpanded,
  onClose,
  onDelete,
  onViewTweet,
}: {
  media: MediaRow;
  expanded: boolean;
  onToggleExpanded: () => void;
  onClose: () => void;
  onDelete: () => void;
  onViewTweet: (route: string) => void;
}) {
  const debugRedactionEnabled = useDebugRedactionEnabled();
  const title = media.author_display_name || media.author_username || "未知作者";
  const tweetHref = getDebugExternalHref(debugRedactionEnabled, media.tweet_url);
  const detailRoute = getDebugDetailRoute(debugRedactionEnabled, media.tweet_id);

  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/90 via-black/60 to-transparent px-4 pb-20 pt-[max(1rem,env(safe-area-inset-top))] text-white sm:px-6">
      <div className="pointer-events-auto mx-auto flex max-w-4xl flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0" {...getDebugRedactProps(debugRedactionEnabled)}>
            <p className="truncate text-sm font-semibold text-white">{title}</p>
            <p className="mt-0.5 truncate text-xs text-white/65">
              {media.author_username ? `@${media.author_username} · ` : ""}{formatDateTime(media.published_at)}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {detailRoute ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="bg-black/35 text-white backdrop-blur hover:bg-black/60 hover:text-white"
                onClick={() => onViewTweet(detailRoute)}
              >
                <Maximize2 data-icon="inline-start" />
                <span className="hidden sm:inline">Tweet 详情</span>
              </Button>
            ) : null}
            {tweetHref ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="rounded-full bg-black/35 text-white backdrop-blur hover:bg-black/60 hover:text-white"
                title={getDebugLinkTitle(debugRedactionEnabled, "tweet", "在 X 中查看")}
                aria-label="在 X 中查看"
                onClick={() => window.open(tweetHref, "_blank", "noopener,noreferrer")}
              >
                <ExternalLink />
              </Button>
            ) : null}
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="rounded-full"
              aria-label="永久删除当前媒体"
              onClick={onDelete}
            >
              <Trash2 data-icon="inline-start" />
              <span className="hidden sm:inline">删除</span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="rounded-full bg-black/35 text-white backdrop-blur hover:bg-black/60 hover:text-white"
              aria-label="关闭预览"
              onClick={onClose}
            >
              <X />
            </Button>
          </div>
        </div>
        <button
          type="button"
          className="max-w-3xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          aria-expanded={expanded}
          onClick={onToggleExpanded}
          {...getDebugRedactProps(debugRedactionEnabled)}
        >
          <p className={expanded ? "whitespace-pre-wrap text-sm leading-relaxed text-white" : "line-clamp-2 whitespace-pre-wrap text-sm leading-relaxed text-white"}>
            {media.tweet_text || "暂无 Tweet 文本"}
          </p>
        </button>
      </div>
    </header>
  );
}

function PreviewMedia({ media, active }: { media: MediaRow; active: boolean }) {
  const debugRedactionEnabled = useDebugRedactionEnabled();
  const alt = getDebugMediaAlt(
    debugRedactionEnabled,
    media.tweet_text || media.author_display_name || mediaTypeLabel(media.media_type),
  );

  return (
    <div className="flex size-full items-center justify-center bg-black px-3 pb-20 pt-24 sm:px-16 sm:pb-24 sm:pt-28">
      {media.media_url ? (
        isVideoMedia(media) ? (
          active ? (
            <video
              key={media.id}
              className="max-h-full max-w-full bg-black"
              src={media.media_url}
              poster={media.preview_url || undefined}
              controls
              playsInline
              autoPlay
              preload="metadata"
            />
          ) : media.preview_url ? (
            <img className="max-h-full max-w-full object-contain" src={media.preview_url} alt={alt} />
          ) : null
        ) : (
          <img className="max-h-full max-w-full select-none object-contain" src={media.media_url} alt={alt} />
        )
      ) : (
        <div className="relative flex size-full max-h-[70vh] max-w-4xl items-center justify-center overflow-hidden rounded-xl border border-white/15 bg-white/5">
          {media.preview_url ? (
            <img className="absolute inset-0 size-full object-contain opacity-35 blur-sm" src={media.preview_url} alt="" />
          ) : null}
          <div className="relative flex max-w-md flex-col items-center gap-3 px-6 text-center text-white">
            <ImageOff className="size-8 text-white/70" />
            <p className="font-semibold">主媒体不可预览</p>
            <p className="text-sm text-white/65">
              {media.error_message || `当前文件状态：${statusLabel(media.media_status)}`}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function isVideoMedia(media: MediaRow) {
  return media.media_type === "video" || Boolean(media.media_url?.match(/\.(mp4|mov|m4v|webm)(\?|$)/i));
}

function formatDimensions(media: MediaRow) {
  return media.width && media.height ? `${media.width} × ${media.height}` : "尺寸未知";
}

function previewStatusTone(media: MediaRow) {
  if (media.media_status === "verified" || media.media_status === "downloaded") return "success" as const;
  if (media.media_status === "corrupt") return "danger" as const;
  return "warning" as const;
}
