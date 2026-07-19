import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import * as React from "react";
import type { ArchiveRunItem, SourceDiscoveryPageResponse, SourceDownloadSummary } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, formatDateTime } from "@/lib/utils";
import type { DetailActions } from "./source-detail-sheet/scan-actions";
import { ChevronDown, ChevronUp, FileQuestion, Film, Image, Images, LocateFixed, Pause, Play } from "lucide-react";

type DownloadSubmitInput = {
  sourceId: number;
  scope: "selected" | "all_unsubmitted" | "failed";
  tweetIds?: string[];
  limit?: number;
};

type DownloadFollowMode = "following" | "paused";

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
  onFollowRun,
  onFollowModeChange,
  onSubmitDownload,
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
  onFollowRun: (runId: number) => void;
  onFollowModeChange: (mode: DownloadFollowMode) => void;
  onSubmitDownload: (input: DownloadSubmitInput) => void;
}) {
  const virtuosoRef = React.useRef<VirtuosoHandle>(null);
  const loadMoreRequestedRef = React.useRef(false);
  const activeItemsByTweet = React.useMemo(
    () => new Map((downloads?.active_run?.items ?? []).map((item) => [item.tweet_id, item])),
    [downloads?.active_run?.items],
  );
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
  const selectableIds = tweets
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
  }, [sourceId]);

  const activeRunId = downloads?.active_run?.id ?? null;
  const currentTweetId = followRunId === activeRunId ? downloads?.current_tweet_id ?? null : null;

  React.useEffect(() => {
    if (!isFetchingNextPage) loadMoreRequestedRef.current = false;
  }, [isFetchingNextPage]);

  React.useEffect(() => {
    loadMoreRequestedRef.current = false;
  }, [currentTweetId]);

  React.useEffect(() => {
    if (followMode !== "following" || !currentTweetId) return;
    const index = tweets.findIndex((tweet) => tweet.tweet_id === currentTweetId);
    if (index >= 0) {
      virtuosoRef.current?.scrollToIndex({ index, align: "center", behavior: "smooth" });
      return;
    }
    if (hasNextPage && !isFetchingNextPage && !loadMoreRequestedRef.current) {
      loadMoreRequestedRef.current = true;
      onLoadMore();
    }
  }, [currentTweetId, followMode, hasNextPage, isFetchingNextPage, onLoadMore, tweets]);

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
    return <p className="py-4 text-sm text-fg-secondary">还没有发现记录。</p>;
  }

  const hasSelection = selectedIds.length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          className={cn(
            "flex flex-1 flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
            hasSelection ? "bg-brand-soft/50 ring-1 ring-brand/20" : "bg-transparent",
          )}
        >
          <div className="flex items-center gap-2">
            <Checkbox
              checked={selectableIds.length > 0 && selectedIds.length === selectableIds.length}
              disabled={selectableIds.length === 0}
              onCheckedChange={(checked) => setSelected(new Set(checked ? selectableIds : []))}
            />
            <span className={cn("font-medium transition-colors", hasSelection ? "text-brand" : "text-fg-secondary")}>
              {hasSelection ? `已选择 ${selectedIds.length} 项` : "全选已加载可操作项"}
            </span>
          </div>

          {hasSelection && (
            <div className="flex flex-wrap items-center gap-2 animate-in fade-in zoom-in-95 duration-200">
              <Button
                type="button"
                size="sm"
                disabled={!selectedQueueIds.length || actions.pending.download}
                onClick={() => onSubmitDownload({ sourceId, scope: "selected", tweetIds: selectedQueueIds })}
              >
                下载选中 ({selectedQueueIds.length})
              </Button>
              <Button
                type="button"
                size="sm"
                variant={selectedActiveIds.length ? "outline" : "ghost"}
                className={
                  selectedActiveIds.length ? "border-danger text-danger hover:bg-danger-soft hover:text-danger" : ""
                }
                disabled={!selectedActiveIds.length || selectedActiveRunIds.length !== 1 || actions.pending.download}
                onClick={() =>
                  actions.cancelDownloadItems({ runId: selectedActiveRunIds[0], tweetIds: selectedActiveIds })
                }
              >
                取消选中
              </Button>
            </div>
          )}
          <DownloadFollowControls
            activeRunId={activeRunId}
            currentTweetId={downloads?.current_tweet_id ?? null}
            followRunId={followRunId}
            followMode={followMode}
            onFollowRun={onFollowRun}
            onFollowModeChange={onFollowModeChange}
          />
        </div>
      </div>
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
              isCurrentDownload={tweet.tweet_id === downloads?.current_tweet_id && activeRunId !== null}
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
              onSubmitDownload={onSubmitDownload}
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

function mergeActiveRunItem(
  tweet: TweetRow,
  downloads?: SourceDownloadSummary,
  item?: ArchiveRunItem,
): TweetRow {
  const activeRun = downloads?.active_run;
  if (!activeRun || !item) return tweet;
  return {
    ...tweet,
    active_run_id: activeRun.id,
    active_item_id: item.id,
    active_item_status: item.status,
    active_run_status: activeRun.status,
    cancel_requested: item.cancel_requested,
    downloaded_bytes: item.downloaded_bytes,
    total_bytes: item.total_bytes,
    speed_bps: item.speed_bps,
    progress_message: item.progress_message,
    last_progress_at: item.last_progress_at,
  };
}

function DownloadFollowControls({
  activeRunId,
  currentTweetId,
  followRunId,
  followMode,
  onFollowRun,
  onFollowModeChange,
}: {
  activeRunId: number | null;
  currentTweetId: string | null;
  followRunId: number | null;
  followMode: DownloadFollowMode;
  onFollowRun: (runId: number) => void;
  onFollowModeChange: (mode: DownloadFollowMode) => void;
}) {
  if (followRunId && followRunId !== activeRunId) {
    return <Badge tone="secondary">等待 Run #{followRunId} 开始</Badge>;
  }
  if (followRunId && followRunId === activeRunId) {
    return (
      <div className="flex items-center gap-2">
        <Badge tone={followMode === "following" ? "default" : "warning"}>
          {followMode === "following" ? (currentTweetId ? "正在跟随" : "等待当前下载项") : "跟随已暂停"}
        </Badge>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => onFollowModeChange(followMode === "following" ? "paused" : "following")}
        >
          {followMode === "following" ? (
            <Pause data-icon="inline-start" />
          ) : (
            <Play data-icon="inline-start" />
          )}
          {followMode === "following" ? "暂停跟随" : "继续跟随"}
        </Button>
      </div>
    );
  }
  if (activeRunId && currentTweetId) {
    return (
      <Button type="button" size="sm" variant="ghost" onClick={() => onFollowRun(activeRunId)}>
        <LocateFixed data-icon="inline-start" />
        定位当前项
      </Button>
    );
  }
  return null;
}

function canQueue(tweet: TweetRow) {
  if (tweet.active_item_status) return false;
  if (["verified", "downloaded", "skipped"].includes(String(tweet.download_status))) return false;
  return true;
}

function canCancel(status?: string | null) {
  return status === "pending" || status === "blocked" || status === "failed_retryable" || status === "processing";
}

function TweetDownloadProgress({ tweet }: { tweet: TweetRow }) {
  const activeStatus = tweet.active_item_status;
  const downloaded = Number(tweet.downloaded_bytes || tweet.downloaded_media_bytes || 0);
  const total = Number(tweet.total_bytes || tweet.downloaded_media_bytes || 0);
  const percent = progressPercent(tweet, downloaded, total);
  const isActive = Boolean(activeStatus);
  const message = tweet.progress_message || defaultProgressMessage(tweet);

  return (
    <div className="flex flex-col gap-1.5 pt-1">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {tweet.cancel_requested ? <Badge tone="warning">取消请求中</Badge> : null}
          <span className="min-w-0 break-words text-fg-secondary">{message}</span>
        </div>
        {(total > 0 || downloaded > 0 || isActive || percent !== null) && (
          <div className="flex items-center gap-3 text-fg-secondary tabular-nums">
            {downloaded > 0 || total > 0 ? (
              <span>
                {formatBytes(downloaded)} {total > 0 ? `/ ${formatBytes(total)}` : ""}
              </span>
            ) : null}
            {Boolean(tweet.speed_bps) && <span>{formatBytes(tweet.speed_bps)}/s</span>}
            <span>{percent == null ? "估算中" : `${percent}%`}</span>
          </div>
        )}
      </div>
      {(isActive || percent !== null) && (
        <Progress
          value={percent ?? (isActive ? 8 : 0)}
          className={`h-1.5 ${isActive && percent == null ? "opacity-70" : ""}`}
        />
      )}
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
  if (!tweet.active_item_status && !tweet.archive_run_id) return "还没有加入下载任务";
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

function TweetText({ text }: { text?: string | null }) {
  const [expanded, setExpanded] = React.useState(false);

  if (!text) {
    return <div className="text-sm leading-6 text-fg-secondary italic">暂无 Tweet 文本</div>;
  }

  const isLong = text.length > 100 || (text.match(/\n/g) || []).length > 1;

  return (
    <div className="space-y-1">
      <div
        className={`break-words text-sm leading-6 text-fg-primary ${expanded ? "whitespace-pre-wrap" : "line-clamp-2"}`}
      >
        {text}
      </div>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
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
  onSubmitDownload,
}: {
  tweet: TweetRow;
  sourceId: number;
  selected: boolean;
  isCurrentDownload: boolean;
  onSelectionChange: (checked: boolean) => void;
  actions: DetailActions;
  statusLabel: (status?: string | null) => string;
  onSubmitDownload: (input: DownloadSubmitInput) => void;
}) {
  return (
    <div className="pb-2">
      <div
        aria-current={isCurrentDownload ? "true" : undefined}
        className={cn(
          "rounded-lg border bg-bg-surface p-3 transition-colors",
          isCurrentDownload
            ? "border-brand ring-1 ring-brand/20"
            : "border-border-subtle hover:border-border-strong",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 gap-3">
            <Checkbox
              className="mt-1"
              checked={selected}
              disabled={!canQueue(tweet) && !canCancel(tweet.active_item_status)}
              onCheckedChange={onSelectionChange}
            />
            <div className="min-w-0 flex-1 space-y-3">
              <TweetText text={tweet.text} />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-fg-secondary">
                <TweetMediaInfo payload={tweet.raw_payload} />
                <span className="h-3 w-px bg-border-strong" />
                <span className="font-mono">{tweet.tweet_id}</span>
                <span className="h-3 w-px bg-border-strong" />
                <span>{formatDateTime(tweet.discovered_at)}</span>
                <span className="h-3 w-px bg-border-strong" />
                <span className="flex items-center gap-1">
                  {tweet.active_run_id ? (
                    <>
                      <span className="relative flex h-2 w-2">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-75"></span>
                        <span className="relative inline-flex h-2 w-2 rounded-full bg-brand"></span>
                      </span>
                      下载 Run #{tweet.active_run_id}
                    </>
                  ) : tweet.archive_run_id ? (
                    `历史 Run #${tweet.archive_run_id}`
                  ) : (
                    "未入队"
                  )}
                </span>
              </div>
              <TweetDownloadProgress tweet={tweet} />
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2 whitespace-nowrap text-center">
            <SourceTweetStatusBadge status={tweet.download_status} statusLabel={statusLabel} />
            {tweet.active_item_status ? (
              <SourceTweetStatusBadge status={tweet.active_item_status} statusLabel={statusLabel} tone="secondary" />
            ) : null}
            {canQueue(tweet) ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={actions.pending.download}
                onClick={() => onSubmitDownload({ sourceId, scope: "selected", tweetIds: [tweet.tweet_id] })}
              >
                下载
              </Button>
            ) : canCancel(tweet.active_item_status) && tweet.active_run_id ? (
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

function sourceTweetStatusDescription(status?: string | null) {
  switch (status) {
    case "pending":
      return "尚未完成下载与文件校验；如未创建下载任务，可点击“下载”。";
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
      return "这是该 Tweet 当前的归档处理状态。";
  }
}
