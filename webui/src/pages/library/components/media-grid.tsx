import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  type CSSProperties,
  type HTMLAttributes,
} from "react";
import { ExternalLink, Film, Maximize2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { VirtuosoGrid, type GridComponents, type GridStateSnapshot } from "react-virtuoso";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Checkbox } from "../../../components/ui/checkbox";
import { MediaThumbnail } from "../../../components/ui/media-thumbnail";
import { useAppScrollContainer } from "../../../components/layout/app-scroll-container";
import type { MediaRow } from "../../../lib/api";
import {
  getDebugDetailRoute,
  getDebugExternalHref,
  getDebugLinkTitle,
  getDebugMediaAlt,
  getDebugRedactProps,
  getDebugSelectionLabel,
  useDebugRedactionEnabled,
} from "../../../lib/debug-redaction";
import { mediaTypeLabel, statusLabel } from "../../../lib/formatters";
import { cn, formatBytes, formatDateTime } from "../../../lib/utils";
import type { LibraryDensity, LibrarySelectionMode, LibraryViewMode } from "../library-view-state";

type MediaGridProps = {
  rows: MediaRow[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  nextPageError: unknown;
  restoreStateFrom: GridStateSnapshot | null;
  onLoadMore: () => void;
  onRetryLoadMore: () => void;
  onStateChanged: (state: GridStateSnapshot) => void;
  selectedIds: Set<number>;
  selectedTweetIds: Set<string>;
  selectionMode: LibrarySelectionMode | null;
  viewMode: LibraryViewMode;
  density: LibraryDensity;
  onToggleSelected: (row: MediaRow) => void;
  onPreview: (row: MediaRow) => void;
};

type MediaGridContext = Pick<
  MediaGridProps,
  "hasNextPage" | "isFetchingNextPage" | "nextPageError" | "onLoadMore" | "onRetryLoadMore" | "viewMode" | "density"
> & { scrollParent: HTMLElement };

export function MediaGrid({
  rows,
  hasNextPage,
  isFetchingNextPage,
  nextPageError,
  restoreStateFrom,
  onLoadMore,
  onRetryLoadMore,
  onStateChanged,
  selectedIds,
  selectedTweetIds,
  selectionMode,
  viewMode,
  density,
  onToggleSelected,
  onPreview,
}: MediaGridProps) {
  const scrollParent = useAppScrollContainer();
  const loadMorePendingRef = useRef(false);

  useEffect(() => {
    if (!isFetchingNextPage) loadMorePendingRef.current = false;
  }, [isFetchingNextPage]);

  const requestLoadMore = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage || nextPageError || loadMorePendingRef.current) return;
    loadMorePendingRef.current = true;
    onLoadMore();
  }, [hasNextPage, isFetchingNextPage, nextPageError, onLoadMore]);

  if (!scrollParent) return null;

  return (
    <VirtuosoGrid
      customScrollParent={scrollParent}
      data={rows}
      context={{
        hasNextPage,
        isFetchingNextPage,
        nextPageError,
        onLoadMore: requestLoadMore,
        onRetryLoadMore,
        scrollParent,
        viewMode,
        density,
      }}
      components={gridComponents}
      computeItemKey={mediaItemKey}
      endReached={requestLoadMore}
      itemContent={(_, row) => {
        const selected =
          selectionMode === "organize" ? selectedTweetIds.has(row.tweet_id) : selectedIds.has(row.id);
        const commonProps = {
          row,
          selected,
          selectionMode,
          onToggleSelected,
          onPreview,
        };
        return viewMode === "media" ? <MediaWallTile {...commonProps} /> : <MediaDetailCard {...commonProps} />;
      }}
      restoreStateFrom={restoreStateFrom}
      stateChanged={onStateChanged}
    />
  );
}

type GridListComponentProps = HTMLAttributes<HTMLDivElement> & {
  context: MediaGridContext;
  style?: CSSProperties;
};

const GridList = forwardRef<HTMLDivElement, GridListComponentProps>(
  ({ context, style, children, className, ...props }, ref) => (
    <div
      ref={ref}
      style={style}
      className={cn(
        "grid items-start",
        context.viewMode === "details" && "grid-cols-1 divide-y divide-border-subtle",
        context.viewMode === "media" &&
          context.density === "compact" &&
          "grid-cols-3 gap-1 sm:grid-cols-[repeat(auto-fill,minmax(112px,1fr))]",
        context.viewMode === "media" &&
          context.density === "standard" &&
          "grid-cols-3 gap-1 sm:grid-cols-[repeat(auto-fill,minmax(156px,1fr))]",
        context.viewMode === "media" &&
          context.density === "comfortable" &&
          "grid-cols-2 gap-1 sm:grid-cols-[repeat(auto-fill,minmax(220px,1fr))]",
        className,
      )}
      data-library-view={context.viewMode}
      data-library-density={context.density}
      {...props}
    >
      {children}
    </div>
  ),
);
GridList.displayName = "GridList";

type GridItemComponentProps = HTMLAttributes<HTMLDivElement> & { context: MediaGridContext };

const GridItem = ({ context: _context, children, className, ...props }: GridItemComponentProps) => (
  <div className={cn("min-w-0", className)} {...props}>
    {children}
  </div>
);

const gridComponents: GridComponents<MediaGridContext> = {
  List: GridList,
  Item: GridItem,
  Footer: MediaGridFooter,
};

function MediaGridFooter({ context }: { context: MediaGridContext }) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !context.hasNextPage || context.isFetchingNextPage || context.nextPageError) return undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && context.scrollParent.scrollTop > 0) context.onLoadMore();
      },
      { root: context.scrollParent, rootMargin: "0px 0px 400px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [context]);

  let content: React.ReactNode;
  if (context.nextPageError) {
    content = (
      <div className="flex flex-col items-center gap-2 py-5 text-center text-sm text-fg-secondary">
        <span>加载更多媒体失败，已加载的内容会继续保留。</span>
        <Button type="button" variant="outline" size="sm" onClick={context.onRetryLoadMore}>
          重试
        </Button>
      </div>
    );
  } else if (context.isFetchingNextPage) {
    content = <p className="py-5 text-center text-sm text-fg-secondary">正在加载更多...</p>;
  } else if (context.hasNextPage) {
    content = <p className="py-5 text-center text-sm text-fg-tertiary">继续下拉加载更多</p>;
  } else {
    content = <p className="py-5 text-center text-sm text-fg-tertiary">已显示全部媒体</p>;
  }
  return <div ref={sentinelRef}>{content}</div>;
}

function mediaItemKey(index: number, row: MediaRow) {
  return [row.tweet_id, row.media_index ?? "none", row.local_path || row.media_url || index].join(":");
}

type MediaItemProps = {
  row: MediaRow;
  selected: boolean;
  selectionMode: LibrarySelectionMode | null;
  onToggleSelected: (row: MediaRow) => void;
  onPreview: (row: MediaRow) => void;
};

function MediaWallTile({ row, selected, selectionMode, onToggleSelected, onPreview }: MediaItemProps) {
  const debugRedactionEnabled = useDebugRedactionEnabled();
  const title = row.author_display_name || row.author_username || "未知作者";
  const isSelectable = selectionMode !== null;

  return (
    <article
      className={cn(
        "group relative min-w-0 overflow-hidden bg-bg-muted",
        selected && "ring-2 ring-inset ring-brand",
      )}
    >
      {isSelectable ? (
        <div className="absolute right-1 top-1 z-10 flex size-10 items-center justify-center rounded-full bg-bg-elevated/90 shadow-1 backdrop-blur">
          <Checkbox
            aria-label={getDebugSelectionLabel(
              debugRedactionEnabled,
              selectionMode === "organize" ? `选择 Tweet ${row.tweet_id}` : `选择媒体 ${row.id}`,
            )}
            checked={selected}
            onCheckedChange={() => onToggleSelected(row)}
          />
        </div>
      ) : null}
      <MediaThumbnail
        src={row.preview_url || row.media_url}
        mediaType={row.media_type}
        alt={getDebugMediaAlt(debugRedactionEnabled, row.tweet_text || title)}
        ariaLabel={
          isSelectable
            ? getDebugSelectionLabel(
                debugRedactionEnabled,
                selectionMode === "organize" ? `切换选择 Tweet ${row.tweet_id}` : `切换选择媒体 ${row.id}`,
              )
            : getDebugMediaAlt(debugRedactionEnabled, row.tweet_text || title)
        }
        className="rounded-none"
        fit="cover"
        aspect="square"
        showTypeBadge={false}
        onClick={isSelectable ? () => onToggleSelected(row) : () => onPreview(row)}
      />
      {!isSelectable && isVideoMedia(row) && row.duration_ms ? (
        <Badge className="absolute right-2 top-2 shadow-1" tone="secondary">
          <Film aria-hidden="true" />
          {formatMediaDuration(row.duration_ms)}
        </Badge>
      ) : null}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent px-2 pb-2 pt-8 text-white opacity-0 transition duration-fast group-hover:opacity-100 group-focus-within:opacity-100">
        <span className="truncate text-xs font-semibold" {...getDebugRedactProps(debugRedactionEnabled)}>
          {title}
        </span>
        <span className="shrink-0 text-[11px] text-white/80">{formatDimensions(row)}</span>
      </div>
    </article>
  );
}

function MediaDetailCard({ row, selected, selectionMode, onToggleSelected, onPreview }: MediaItemProps) {
  const navigate = useNavigate();
  const debugRedactionEnabled = useDebugRedactionEnabled();
  const title = row.author_display_name || row.author_username || "未知作者";
  const tweetText = row.tweet_text || "暂无 Tweet 文本";
  const tweetHref = getDebugExternalHref(debugRedactionEnabled, row.tweet_url);
  const statusTone = row.media_status === "verified" || row.media_status === "downloaded" ? "success" : "warning";
  const detailRoute = getDebugDetailRoute(debugRedactionEnabled, row.tweet_id);
  const isSelectable = selectionMode !== null;
  const selectionLabel = getDebugSelectionLabel(
    debugRedactionEnabled,
    selectionMode === "organize" ? `选择 Tweet ${row.tweet_id}` : `选择媒体 ${row.id}`,
  );

  return (
    <article
      className={cn(
        "group relative flex min-w-0 flex-col gap-3 px-4 py-4 transition duration-fast hover:bg-bg-muted/50 sm:flex-row sm:gap-4 sm:px-5",
        selected && "bg-brand-soft",
      )}
    >
      {isSelectable ? (
        <button
          type="button"
          className="absolute right-3 top-3 z-10 flex size-10 items-center justify-center rounded-full bg-bg-elevated/90 shadow-1 backdrop-blur transition hover:bg-bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          aria-label={selectionLabel}
          aria-pressed={selected}
          onClick={() => onToggleSelected(row)}
        >
          <Checkbox
            aria-hidden="true"
            tabIndex={-1}
            checked={selected}
          />
        </button>
      ) : null}
      <div className="w-full shrink-0 sm:w-52">
        <MediaThumbnail
          src={row.preview_url || row.media_url}
          mediaType={row.media_type}
          alt={getDebugMediaAlt(debugRedactionEnabled, row.tweet_text || title)}
          ariaLabel={getDebugMediaAlt(debugRedactionEnabled, row.tweet_text || title)}
          className="rounded-xl"
          fit="cover"
          showTypeBadge={false}
          onClick={
            isSelectable
              ? (event) => {
                  event.stopPropagation();
                  onToggleSelected(row);
                }
              : () => onPreview(row)
          }
        />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <div className="flex items-start justify-between gap-3" {...getDebugRedactProps(debugRedactionEnabled)}>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-fg-primary">{title}</div>
            <div className="mt-0.5 truncate text-xs text-fg-tertiary">@{row.author_username || "-"}</div>
          </div>
          <Badge tone={statusTone}>{statusLabel(row.media_status)}</Badge>
        </div>

        <p
          className="line-clamp-2 min-h-9 text-xs leading-relaxed text-fg-secondary"
          {...getDebugRedactProps(debugRedactionEnabled)}
        >
          {tweetText}
        </p>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-fg-tertiary">
          <MetaItem label="类型" value={mediaTypeLabel(row.media_type)} />
          <MetaItem label="尺寸" value={formatDimensions(row)} />
          <MetaItem label="大小" value={formatBytes(row.file_size)} />
          <MetaItem label="发布" value={formatDateTime(row.published_at)} />
        </div>

        {!isSelectable ? <div className="mt-auto flex flex-wrap items-center justify-end gap-1 pt-1">
          {detailRoute ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-label={`查看 Tweet ${row.tweet_id} 详情`}
              onClick={(event) => {
                event.stopPropagation();
                navigate(detailRoute);
              }}
            >
              <Maximize2 data-icon="inline-start" />
              查看详情
            </Button>
          ) : null}
          {tweetHref ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              title={getDebugLinkTitle(debugRedactionEnabled, "tweet", "在 X 中查看")}
              onClick={(event) => {
                event.stopPropagation();
                window.open(tweetHref, "_blank", "noopener,noreferrer");
              }}
            >
              <ExternalLink data-icon="inline-start" />
              在 X 中查看
            </Button>
          ) : null}
        </div> : null}
      </div>
    </article>
  );
}

function MetaItem({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <span className="text-fg-tertiary">{label}</span>
      <span className="ml-1 font-medium text-fg-secondary">{value}</span>
    </div>
  );
}

function formatDimensions(row: MediaRow) {
  if (row.width && row.height) return `${row.width}×${row.height}`;
  return formatBytes(row.file_size);
}

function formatMediaDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function isVideoMedia(row: MediaRow) {
  return row.media_type === "video" || Boolean(row.media_url?.match(/\.(mp4|mov|m4v|webm)(\?|$)/i));
}
