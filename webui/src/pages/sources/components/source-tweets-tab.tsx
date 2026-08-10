import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import * as React from "react";
import type { ArchiveRunItem, SourceDiscoveryPageResponse, SourceDownloadSummary } from "@/lib/api";
import { useRuntimeSource } from "@/lib/runtime-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  getDebugDataValue,
  getDebugRedactProps,
  getDebugSelectionLabel,
  useDebugRedactionEnabled,
} from "@/lib/debug-redaction";
import { cn, formatDateTime } from "@/lib/utils";
import type { DetailActions } from "./source-detail-sheet/scan-actions";
import { ChevronDown, ChevronUp, FileQuestion, Film, Image, Images } from "lucide-react";
import { DEFAULT_TWEET_FILTERS, type DownloadSubmitInput, type TweetFilters } from "./source-tweet-filters";
import { SourceTweetsToolbar } from "./source-tweets-toolbar";

type DownloadFollowMode = "following" | "paused";

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = React.useState(false);

  React.useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);
    updatePreference();
    mediaQuery.addEventListener("change", updatePreference);
    return () => mediaQuery.removeEventListener("change", updatePreference);
  }, []);

  return prefersReducedMotion;
}

export function SourceTweetsTab({
  pages,
  downloads,
  sourceId,
  actions,
  isLoading,
  error,
  isFetchingNextPage,
  hasNextPage,
  onLoadMore,
  statusLabel,
  followRunId,
  followMode,
  frontierTweetId,
  onFollowRun,
  onFollowModeChange,
  onFrontierTweetChange,
  onSubmitDownload,
  filters,
  onFiltersChange,
  readonly = false,
}: {
  pages: SourceDiscoveryPageResponse[];
  downloads?: SourceDownloadSummary;
  sourceId: number;
  actions: DetailActions;
  isLoading: boolean;
  error: unknown;
  isFetchingNextPage: boolean;
  hasNextPage: boolean | undefined;
  onLoadMore: () => void;
  statusLabel: (status?: string | null) => string;
  followRunId: number | null;
  followMode: DownloadFollowMode;
  frontierTweetId: string | null;
  onFollowRun: (runId: number) => void;
  onFollowModeChange: (mode: DownloadFollowMode) => void;
  onFrontierTweetChange: (tweetId: string | null) => void;
  onSubmitDownload: (input: DownloadSubmitInput) => void;
  filters: TweetFilters;
  onFiltersChange: (filters: TweetFilters) => void;
  readonly?: boolean;
}) {
  const runtimeSource = useRuntimeSource(sourceId);
  const virtuosoRef = React.useRef<VirtuosoHandle>(null);
  const loadMoreRequestedRef = React.useRef(false);
  const pendingAutoScrollRef = React.useRef<{ tweetId: string; index: number } | null>(null);
  const autoScrollInFlightRef = React.useRef(false);
  const scrollGenerationRef = React.useRef(0);
  const flushAutoScrollRef = React.useRef<() => void>(() => undefined);
  const pendingExplicitLocateRef = React.useRef<string | null>(null);
  const skipNextAutoScrollRef = React.useRef(false);
  const prefersReducedMotion = usePrefersReducedMotion();
  const activeItemsByTweet = React.useMemo(() => {
    const items = new Map<string, OverlayRunItem>();
    for (const item of downloads?.active_run?.items ?? []) {
      items.set(item.tweet_id, {
        ...item,
        archive_run_id: downloads?.active_run?.id,
        archive_run_status: downloads?.active_run?.status,
      });
    }
    for (const [tweetId, item] of runtimeSource.itemsByTweetId) {
      const current = items.get(tweetId);
      if (!current || item.id >= current.id) items.set(tweetId, item);
    }
    return items;
  }, [downloads?.active_run, runtimeSource.itemsByTweetId]);
  const tweets = React.useMemo(
    () =>
      pages
        .flatMap((page) => page.rows)
        .filter((tweet, index, rows) => rows.findIndex((row) => row.tweet_id === tweet.tweet_id) === index)
        .map((tweet) => mergeActiveRunItem(tweet, downloads, activeItemsByTweet.get(tweet.tweet_id))),
    [activeItemsByTweet, downloads, pages],
  );
  const totalCount = pages[0]?.total_count ?? 0;
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const selectedIds = Array.from(selected);
  const selectableIds = readonly
    ? []
    : tweets
        .filter((tweet) => canQueue(tweet) || canCancel(tweet.active_item_status))
        .map((tweet) => tweet.tweet_id);
  const selectedQueueIds = tweets
    .filter((tweet) => selected.has(tweet.tweet_id) && canQueue(tweet))
    .map((tweet) => tweet.tweet_id);
  const selectedActiveIds = tweets
    .filter((tweet) => selected.has(tweet.tweet_id) && tweet.active_run_id && canCancel(tweet.active_item_status))
    .map((tweet) => tweet.tweet_id);
  const selectedActiveRunIds = Array.from(
    new Set(
      tweets
        .filter((tweet) => selected.has(tweet.tweet_id) && tweet.active_run_id && canCancel(tweet.active_item_status))
        .map((tweet) => Number(tweet.active_run_id)),
    ),
  );

  React.useEffect(() => {
    setSelected(new Set());
  }, [filters, sourceId]);

  const activeRunId = runtimeSource.activeRunId ?? downloads?.active_run?.id ?? null;
  const currentDownloadTweetId = runtimeSource.currentTweetId ?? downloads?.current_tweet_id ?? null;
  const currentTweetId = followRunId === activeRunId ? currentDownloadTweetId : null;

  React.useEffect(() => {
    if (!isFetchingNextPage) loadMoreRequestedRef.current = false;
  }, [isFetchingNextPage]);

  React.useEffect(() => {
    loadMoreRequestedRef.current = false;
  }, [currentTweetId, frontierTweetId]);

  React.useEffect(() => {
    if (!currentTweetId) return;
    const currentIndex = tweets.findIndex((tweet) => tweet.tweet_id === currentTweetId);
    if (currentIndex < 0) {
      if (followMode === "following" && hasNextPage && !isFetchingNextPage && !loadMoreRequestedRef.current) {
        loadMoreRequestedRef.current = true;
        onLoadMore();
      }
      return;
    }

    const frontierIndex = frontierTweetId
      ? tweets.findIndex((tweet) => tweet.tweet_id === frontierTweetId)
      : -1;
    if (!frontierTweetId || (frontierIndex >= 0 && currentIndex > frontierIndex)) {
      onFrontierTweetChange(currentTweetId);
    }
  }, [
    currentTweetId,
    followMode,
    frontierTweetId,
    hasNextPage,
    isFetchingNextPage,
    onFrontierTweetChange,
    onLoadMore,
    tweets,
  ]);

  const flushAutoScroll = React.useCallback(() => {
    if (followMode !== "following" || autoScrollInFlightRef.current) return;
    const target = pendingAutoScrollRef.current;
    const handle = virtuosoRef.current;
    if (!target || !handle) return;

    pendingAutoScrollRef.current = null;
    autoScrollInFlightRef.current = true;
    const generation = scrollGenerationRef.current;
    handle.scrollIntoView({
      index: target.index,
      behavior: prefersReducedMotion ? "auto" : "smooth",
      calculateViewLocation: ({ itemBottom, viewportBottom, locationParams }) =>
        itemBottom > viewportBottom ? { ...locationParams, align: "end" } : null,
      done: () => {
        if (generation !== scrollGenerationRef.current) return;
        autoScrollInFlightRef.current = false;
        if (pendingAutoScrollRef.current) {
          window.requestAnimationFrame(() => flushAutoScrollRef.current());
        }
      },
    });
  }, [followMode, prefersReducedMotion]);

  flushAutoScrollRef.current = flushAutoScroll;

  React.useEffect(() => {
    if (followMode !== "following" || !frontierTweetId) return;
    if (skipNextAutoScrollRef.current) {
      skipNextAutoScrollRef.current = false;
      return;
    }
    const index = tweets.findIndex((tweet) => tweet.tweet_id === frontierTweetId);
    if (index < 0) return;
    pendingAutoScrollRef.current = { tweetId: frontierTweetId, index };
    flushAutoScroll();
  }, [flushAutoScroll, followMode, frontierTweetId, tweets]);

  React.useEffect(() => {
    if (followMode === "following") return;
    pendingAutoScrollRef.current = null;
    scrollGenerationRef.current += 1;
    autoScrollInFlightRef.current = false;
  }, [followMode]);

  const scrollToTweet = React.useCallback(
    (tweetId: string) => {
      const index = tweets.findIndex((tweet) => tweet.tweet_id === tweetId);
      if (index < 0) return false;
      pendingAutoScrollRef.current = null;
      scrollGenerationRef.current += 1;
      autoScrollInFlightRef.current = false;
      virtuosoRef.current?.scrollToIndex({
        index,
        align: "center",
        behavior: prefersReducedMotion ? "auto" : "smooth",
      });
      return true;
    },
    [prefersReducedMotion, tweets],
  );

  React.useEffect(() => {
    const tweetId = pendingExplicitLocateRef.current;
    if (!tweetId || !scrollToTweet(tweetId)) return;
    pendingExplicitLocateRef.current = null;
  }, [scrollToTweet, tweets]);

  const handleLocateCurrent = React.useCallback(() => {
    const tweetId = currentDownloadTweetId;
    if (!activeRunId || !tweetId) return;
    skipNextAutoScrollRef.current = frontierTweetId !== tweetId;
    onFollowRun(activeRunId);
    onFrontierTweetChange(tweetId);
    if (!scrollToTweet(tweetId)) {
      pendingExplicitLocateRef.current = tweetId;
      if (hasNextPage && !isFetchingNextPage && !loadMoreRequestedRef.current) {
        loadMoreRequestedRef.current = true;
        onLoadMore();
      }
    }
  }, [
    activeRunId,
    currentDownloadTweetId,
    frontierTweetId,
    hasNextPage,
    isFetchingNextPage,
    onFollowRun,
    onFrontierTweetChange,
    onLoadMore,
    scrollToTweet,
  ]);

  const handleResumeFollowing = React.useCallback(() => {
    if (frontierTweetId) {
      skipNextAutoScrollRef.current = true;
      scrollToTweet(frontierTweetId);
    }
    onFollowModeChange("following");
  }, [frontierTweetId, onFollowModeChange, scrollToTweet]);

  const pauseFollowingForUserNavigation = React.useCallback(() => {
    if (followRunId && followMode === "following") onFollowModeChange("paused");
  }, [followMode, followRunId, onFollowModeChange]);

  const handleNavigationKey = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) {
        pauseFollowingForUserNavigation();
      }
    },
    [pauseFollowingForUserNavigation],
  );

  if (isLoading) {
    return <p className="py-4 text-sm text-fg-secondary">加载中...</p>;
  }

  if (error) {
    return <p className="py-4 text-sm text-danger">{String(error)}</p>;
  }

  if (tweets.length === 0) {
    const hasFilters =
      filters.media !== "all" || filters.download !== "all";
    return hasFilters ? (
      <div className="flex min-h-24 items-center justify-center gap-3 border-y border-border-subtle text-sm text-fg-secondary">
        <span>当前筛选没有结果</span>
        <span className="h-3 w-px bg-border-strong" />
          <Button type="button" size="sm" variant="secondary" onClick={() => onFiltersChange(DEFAULT_TWEET_FILTERS)}>
            清除筛选
          </Button>
      </div>
    ) : (
      <p className="py-4 text-sm text-fg-secondary">还没有发现记录。</p>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <SourceTweetsToolbar
        sourceId={sourceId}
        filters={filters}
        onFiltersChange={onFiltersChange}
        facets={pages[0]?.facets}
        actionCounts={pages[0]?.action_counts}
        filteredTotalCount={totalCount}
        unfilteredTotalCount={pages[0]?.unfiltered_total_count ?? totalCount}
        selectedCount={selectedIds.length}
        selectableCount={selectableIds.length}
        selectedQueueCount={selectedQueueIds.length}
        selectedActiveCount={selectedActiveIds.length}
        selectedActiveIds={selectedActiveIds}
        selectedActiveRunIds={selectedActiveRunIds}
        loadedQueueIds={tweets.filter((tweet) => canQueue(tweet)).map((tweet) => tweet.tweet_id)}
        selectedQueueIds={selectedQueueIds}
        onSelectAll={(checked) => setSelected(new Set(checked ? selectableIds : []))}
        onClearSelection={() => setSelected(new Set())}
        onSubmitDownload={onSubmitDownload}
        actions={actions}
        readonly={readonly}
        activeRunId={activeRunId}
        currentTweetId={currentDownloadTweetId}
        followRunId={followRunId}
        followMode={followMode}
        onPauseFollow={() => onFollowModeChange("paused")}
        onResumeFollow={handleResumeFollowing}
        onLocateCurrent={handleLocateCurrent}
      />
      <div
        className="min-h-0 flex-1"
        onWheelCapture={pauseFollowingForUserNavigation}
        onTouchMoveCapture={pauseFollowingForUserNavigation}
        onKeyDownCapture={handleNavigationKey}
      >
        <Virtuoso
          ref={virtuosoRef}
          className="h-full"
          data={tweets}
          computeItemKey={(_, tweet) => tweet.tweet_id}
          endReached={() => {
            if (hasNextPage && !isFetchingNextPage) onLoadMore();
          }}
          itemContent={(_, tweet) => (
            <TweetListItem
              tweet={tweet}
              sourceId={sourceId}
              selected={selected.has(tweet.tweet_id)}
              isCurrentDownload={tweet.tweet_id === currentDownloadTweetId && activeRunId !== null}
              onSelectionChange={(checked) => {
                setSelected((current) => {
                  const next = new Set(current);
                  if (checked) next.add(tweet.tweet_id);
                  else next.delete(tweet.tweet_id);
                  return next;
                });
              }}
              actions={actions}
              statusLabel={statusLabel}
              onUserInspect={pauseFollowingForUserNavigation}
              onSubmitDownload={onSubmitDownload}
              readonly={readonly}
            />
          )}
          components={{
            Footer: () => (
              <div className="py-3 text-center text-xs text-fg-secondary">
                {isFetchingNextPage
                  ? "正在加载更多..."
                  : hasNextPage
                    ? (
                      <button type="button" className="text-brand hover:underline" onClick={onLoadMore}>
                        加载更多
                      </button>
                    )
                    : `已加载全部 ${totalCount} 条记录`}
              </div>
            ),
          }}
        />
      </div>
    </div>
  );
}

type TweetRow = SourceDiscoveryPageResponse["rows"][number];
type OverlayRunItem = ArchiveRunItem & {
  archive_run_id?: number | null;
  archive_run_status?: string | null;
  source_id?: number | null;
};

function mergeActiveRunItem(
  tweet: TweetRow,
  downloads?: SourceDownloadSummary,
  item?: OverlayRunItem,
): TweetRow {
  const activeRun = downloads?.active_run;
  if (!item) return tweet;
  return {
    ...tweet,
    active_run_id: item.archive_run_id ?? activeRun?.id ?? null,
    active_item_id: item.id,
    active_item_status: item.status,
    active_run_status: item.archive_run_status ?? activeRun?.status ?? null,
    cancel_requested: item.cancel_requested,
    downloaded_bytes: item.downloaded_bytes,
    total_bytes: item.total_bytes,
    speed_bps: item.speed_bps,
    progress_message: item.progress_message,
    last_progress_at: item.last_progress_at,
  };
}

function canQueue(tweet: TweetRow) {
  if (tweet.active_item_status && canCancel(tweet.active_item_status)) return false;
  if (["verified", "downloaded", "skipped"].includes(String(tweet.download_status))) return false;
  if (["verified", "downloaded", "skipped_verified", "linked_pending"].includes(String(tweet.active_item_status))) return false;
  return true;
}

function canCancel(status?: string | null) {
  return status === "pending" || status === "blocked" || status === "failed_retryable" || status === "processing";
}

function TweetDownloadProgress({ tweet }: { tweet: TweetRow }) {
  if (!tweet.active_item_status && !tweet.archive_run_id) return null;
  const activeStatus = tweet.active_item_status;
  const downloaded = Number(tweet.downloaded_bytes || tweet.downloaded_media_bytes || 0);
  const total = Number(tweet.total_bytes || tweet.downloaded_media_bytes || 0);
  const percent = progressPercent(tweet, downloaded, total);
  const isActive = Boolean(activeStatus);
  const message = tweet.progress_message || defaultProgressMessage(tweet);

  return (
    <div data-download-progress className="flex flex-col gap-1.5 pt-1 text-xs">
      <div className="flex h-4 min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {tweet.cancel_requested ? <Badge tone="warning">取消请求中</Badge> : null}
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} className="min-w-0 flex-1 truncate text-fg-secondary">
                {message}
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-sm">{message}</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="grid h-4 grid-cols-3 items-center gap-2 text-fg-secondary tabular-nums">
        <span className="truncate" title="已下载 / 总大小">
          {downloaded > 0 || total > 0
            ? `${formatBytes(downloaded)}${total > 0 ? ` / ${formatBytes(total)}` : ""}`
            : "—"}
        </span>
        <span className="truncate text-center" title="当前速度">
          {tweet.speed_bps ? `${formatBytes(tweet.speed_bps)}/s` : "—"}
        </span>
        <span className="text-right" title="下载进度">
          {percent == null ? (isActive ? "估算中" : "—") : `${percent}%`}
        </span>
      </div>
      <Progress
        value={percent ?? (isActive ? 8 : 0)}
        className={cn("h-1.5", !isActive && percent === null && "opacity-0", isActive && percent === null && "opacity-70")}
      />
    </div>
  );
}

function progressPercent(tweet: TweetRow, downloaded: number, total: number) {
  const status = tweet.active_item_status || tweet.download_status;
  if (["verified", "downloaded", "skipped", "skipped_verified"].includes(String(status))) return 100;
  if (["cancelled", "failed_permanent"].includes(String(status))) return 0;
  if (total > 0) return Math.max(0, Math.min(100, Math.round((downloaded / total) * 100)));
  if (status === "processing" || status === "downloading") return null;
  if (status === "pending" || status === "blocked" || status === "failed_retryable") return 0;
  return null;
}

function defaultProgressMessage(tweet: TweetRow) {
  const status = tweet.active_item_status || tweet.download_status;
  if (!tweet.active_item_status && !tweet.archive_run_id) return "等待下载";
  if (status === "blocked") return "等待前序下载任务完成";
  if (status === "pending") return "等待 worker 认领";
  if (status === "processing" || status === "downloading") return "下载器处理中";
  if (status === "verified") return "已下载并校验";
  if (status === "downloaded") return "已下载，等待校验";
  if (status === "cancelled") return "已取消";
  return statusLabelFallback(status);
}

function statusLabelFallback(status?: string | null) {
  return status ? String(status) : "等待下载";
}

function formatBytes(value?: number | null) {
  if (!value || value <= 0) return "-";
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function TweetMediaInfo({ payload }: { payload: any }) {
  const count = Number(payload?.media_count || 0);
  const types = new Set(payload?.media_types || []);

  if (!count) {
    return (
      <span className="flex items-center gap-1">
        <FileQuestion className="h-3.5 w-3.5" />
        未知媒体
      </span>
    );
  }

  if (types.has("photo") && types.has("video")) {
    return (
      <span className="flex items-center gap-1 text-blue-500">
        <Images className="h-3.5 w-3.5" />
        图片/视频 {count}
      </span>
    );
  }
  if (types.has("video")) {
    return (
      <span className="flex items-center gap-1 text-purple-500">
        <Film className="h-3.5 w-3.5" />
        视频 {count}
      </span>
    );
  }
  if (types.has("photo")) {
    return (
      <span className="flex items-center gap-1 text-emerald-500">
        <Image className="h-3.5 w-3.5" />
        图片 {count}
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1">
      <Images className="h-3.5 w-3.5" />
      媒体 {count}
    </span>
  );
}

function TweetText({ text, onUserInspect }: { text?: string | null; onUserInspect: () => void }) {
  const debugRedactionEnabled = useDebugRedactionEnabled();
  const [expanded, setExpanded] = React.useState(false);
  const displayText = text || "暂无 Tweet 文本";

  if (!text && !debugRedactionEnabled) {
    return <div className="text-sm leading-6 text-fg-secondary italic">暂无 Tweet 文本</div>;
  }

  const isLong = displayText.length > 100 || (displayText.match(/\n/g) || []).length > 1;

  return (
    <div className="flex flex-col gap-1">
      <div
        className={cn(
          "break-words text-sm leading-6 text-fg-primary",
          expanded ? "whitespace-pre-wrap" : "line-clamp-2",
        )}
        {...getDebugRedactProps(debugRedactionEnabled)}
      >
        {displayText}
      </div>
      {isLong && (
        <button
          type="button"
          onClick={() => {
            onUserInspect();
            setExpanded(!expanded);
          }}
          className="flex items-center gap-0.5 text-xs text-brand hover:underline"
        >
          {expanded ? (
            <>
              收起 <ChevronUp className="h-3 w-3" />
            </>
          ) : (
            <>
              展开 <ChevronDown className="h-3 w-3" />
            </>
          )}
        </button>
      )}
    </div>
  );
}

function TweetListItem({
  tweet,
  sourceId,
  selected,
  isCurrentDownload,
  onSelectionChange,
  actions,
  statusLabel,
  onUserInspect,
  onSubmitDownload,
  readonly = false,
}: {
  tweet: TweetRow;
  sourceId: number;
  selected: boolean;
  isCurrentDownload: boolean;
  onSelectionChange: (checked: boolean) => void;
  actions: DetailActions;
  statusLabel: (status?: string | null) => string;
  onUserInspect: () => void;
  onSubmitDownload: (input: DownloadSubmitInput) => void;
  readonly?: boolean;
}) {
  const debugRedactionEnabled = useDebugRedactionEnabled();
  return (
    <div className="pb-2">
      <div
        aria-current={isCurrentDownload ? "true" : undefined}
        data-tweet-id={getDebugDataValue(debugRedactionEnabled, tweet.tweet_id)}
        className={cn(
          "rounded-lg border bg-bg-surface p-3 transition-colors",
          isCurrentDownload
            ? "border-brand ring-1 ring-brand/20"
            : "border-border-subtle hover:border-border-strong",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 gap-3">
            {!readonly ? (
              <Checkbox
                className="mt-1"
                checked={selected}
                aria-label={getDebugSelectionLabel(debugRedactionEnabled, tweet.tweet_id)}
                disabled={!canQueue(tweet) && !canCancel(tweet.active_item_status)}
                onCheckedChange={onSelectionChange}
              />
            ) : null}
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <TweetText text={tweet.text} onUserInspect={onUserInspect} />
              <div
                className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-fg-secondary"
                {...getDebugRedactProps(debugRedactionEnabled)}
              >
                <TweetMediaInfo payload={tweet.raw_payload} />
                <span className="h-3 w-px bg-border-strong" />
                <span className="font-mono">{tweet.tweet_id}</span>
                <span className="h-3 w-px bg-border-strong" />
                <span>{formatDateTime(tweet.discovered_at)}</span>
              </div>
              <TweetDownloadProgress tweet={tweet} />
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2 whitespace-nowrap text-center">
            <RunStateBadge tweet={tweet} />
            <SourceTweetStatusBadge
              status={tweet.active_item_status || tweet.download_status}
              statusLabel={statusLabel}
              tone={tweet.active_item_status ? "secondary" : undefined}
            />
            {!readonly && canQueue(tweet) ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={actions.pending.download}
                onClick={() => onSubmitDownload({ sourceId, scope: "selected", tweetIds: [tweet.tweet_id] })}
              >
                下载
              </Button>
            ) : !readonly && canCancel(tweet.active_item_status) && tweet.active_run_id ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={actions.pending.download}
                onClick={() =>
                  actions.cancelDownloadItems({ runId: tweet.active_run_id as number, tweetIds: [tweet.tweet_id] })
                }
              >
                取消
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

function SourceTweetStatusBadge({
  status,
  statusLabel,
  tone,
}: {
  status?: string | null;
  statusLabel: (status?: string | null) => string;
  tone?: "default" | "secondary" | "success" | "warning" | "danger";
}) {
  const isVerified = status === "verified";
  const label = isVerified ? "已完成" : statusLabel(status);
  const description = sourceTweetStatusDescription(status);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} aria-label={`${label}：${description}`}>
          <Badge tone={tone}>{label}</Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">{description}</TooltipContent>
    </Tooltip>
  );
}

function RunStateBadge({ tweet }: { tweet: TweetRow }) {
  if (tweet.active_run_id) {
    return <Badge tone="secondary">Run #{tweet.active_run_id}</Badge>;
  }
  if (canQueue(tweet)) {
    return <Badge tone="secondary">待下载</Badge>;
  }
  return null;
}

function sourceTweetStatusDescription(status?: string | null) {
  switch (status) {
    case "pending":
      return "尚未完成下载与文件校验；可点击“下载缺失项”补齐。";
    case "processing":
    case "downloading":
      return "下载任务正在处理，完成后会自动校验本地文件。";
    case "verified":
      return "媒体已下载到本地，并已确认文件存在且校验值匹配。";
    case "downloaded":
      return "媒体文件已下载到本地，但尚未完成完整性校验。";
    case "blocked":
      return "正在等待同一来源的前序下载任务结束。";
    case "failed_retryable":
      return "本次下载失败，系统稍后可以重试。";
    case "failed_permanent":
      return "下载失败且已达到重试上限，需要人工处理。";
    case "cancelled":
      return "下载任务已取消，未完成的媒体不会继续处理。";
    case "missing":
      return "校验时未找到本地媒体文件。";
    case "corrupt":
      return "本地媒体文件与记录的校验值不一致。";
    default:
      return "这是该 Tweet 当前的下载状态。";
  }
}
