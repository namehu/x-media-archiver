import { forwardRef, useCallback, useEffect, useRef, type CSSProperties, type HTMLAttributes } from "react";
import { ExternalLink } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { VirtuosoGrid, type GridComponents, type GridStateSnapshot } from "react-virtuoso";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Checkbox } from "../../../components/ui/checkbox";
import { Card, CardContent } from "../../../components/ui/card";
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
  onToggleSelected: (row: MediaRow) => void;
};

type MediaGridContext = Pick<
  MediaGridProps,
  "hasNextPage" | "isFetchingNextPage" | "nextPageError" | "onLoadMore" | "onRetryLoadMore"
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
  onToggleSelected,
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
      }}
      components={gridComponents}
      computeItemKey={mediaItemKey}
      endReached={requestLoadMore}
      itemContent={(_, row) => (
        <MediaCard row={row} selected={selectedIds.has(row.id)} onToggleSelected={onToggleSelected} />
      )}
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
  ({ context: _context, style, children, ...props }, ref) => (
    <div
      ref={ref}
      style={{
        ...style,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
        gap: "0.75rem",
      }}
      className="items-start"
      {...props}
    >
      {children}
    </div>
  ),
);
GridList.displayName = "GridList";

type GridItemComponentProps = HTMLAttributes<HTMLDivElement> & { context: MediaGridContext };

const GridItem = ({ context: _context, children, ...props }: GridItemComponentProps) => (
  <div className="min-w-0" {...props}>
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

function MediaCard({
  row,
  selected,
  onToggleSelected,
}: {
  row: MediaRow;
  selected: boolean;
  onToggleSelected: (row: MediaRow) => void;
}) {
  const navigate = useNavigate();
  const debugRedactionEnabled = useDebugRedactionEnabled();
  const title = row.author_display_name || row.author_username || "未知作者";
  const tweetText = row.tweet_text || "暂无 Tweet 文本";
  const tweetHref = getDebugExternalHref(debugRedactionEnabled, row.tweet_url);
  const statusTone = row.media_status === "verified" || row.media_status === "downloaded" ? "success" : "warning";
  const detailRoute = getDebugDetailRoute(debugRedactionEnabled, row.tweet_id);
  const openTweet = () => {
    if (detailRoute) navigate(detailRoute);
  };

  return (
    <Card
      className={cn(
        "group relative cursor-pointer overflow-hidden hover:border-border-strong hover:shadow-2",
        selected && "border-brand ring-2 ring-brand/20",
      )}
      onClick={openTweet}
    >
      <div
        className="absolute left-2 top-2 z-10 rounded-md bg-bg-elevated/90 p-1 shadow-1"
        onClick={(event) => event.stopPropagation()}
      >
        <Checkbox
          aria-label={getDebugSelectionLabel(debugRedactionEnabled, `选择媒体 ${row.id}`)}
          checked={selected}
          onCheckedChange={() => onToggleSelected(row)}
        />
      </div>
      <MediaThumbnail
        src={row.preview_url}
        mediaType={row.media_type}
        alt={getDebugMediaAlt(debugRedactionEnabled, row.tweet_text || title)}
        className="rounded-none"
        onClick={detailRoute ? openTweet : undefined}
      />
      <CardContent className="flex flex-col gap-2.5 p-3">
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

        <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs text-fg-tertiary">
          <MetaItem label="类型" value={mediaTypeLabel(row.media_type)} />
          <MetaItem label="大小" value={formatBytes(row.file_size)} />
          <MetaItem label="发布" value={formatDateTime(row.published_at)} className="col-span-2" />
        </div>

        {tweetHref ? (
          <div className="flex items-center justify-end gap-3 border-t border-border-subtle pt-2.5">
            <a
              className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:text-brand-hover"
              href={tweetHref}
              target="_blank"
              rel="noreferrer"
              title={getDebugLinkTitle(debugRedactionEnabled, "tweet", "打开")}
              onClick={(e) => e.stopPropagation()}
            >
              打开
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        ) : null}
      </CardContent>
    </Card>
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
