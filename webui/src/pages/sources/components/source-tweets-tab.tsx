import { Virtuoso } from "react-virtuoso";
import * as React from "react";
import type { SourceDiscoveryPageResponse } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Pagination } from "@/components/ui/pagination";
import { Progress } from "@/components/ui/progress";
import { formatDateTime } from "@/lib/utils";
import type { DetailActions } from "./source-detail-sheet/scan-actions";
import { ChevronDown, ChevronUp, FileQuestion, Film, Image, Images } from "lucide-react";

const PAGE_SIZE = 50;

export function SourceTweetsTab({
  data,
  sourceId,
  actions,
  isLoading,
  error,
  offset,
  onOffsetChange,
  statusLabel,
}: {
  data?: SourceDiscoveryPageResponse;
  sourceId: number;
  actions: DetailActions;
  isLoading: boolean;
  error: unknown;
  offset: number;
  onOffsetChange: (offset: number) => void;
  statusLabel: (status?: string | null) => string;
}) {
  const tweets = data?.rows ?? [];
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
  }, [offset, data?.rows]);

  if (isLoading) {
    return <p className="py-4 text-sm text-fg-secondary">加载中...</p>;
  }

  if (error) {
    return <p className="py-4 text-sm text-danger">{String(error)}</p>;
  }

  if (tweets.length === 0) {
    return <p className="py-4 text-sm text-fg-secondary">还没有发现记录。</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border-subtle bg-bg-surface px-3 py-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Checkbox
            checked={selectableIds.length > 0 && selectedIds.length === selectableIds.length}
            disabled={selectableIds.length === 0}
            onCheckedChange={(checked) => setSelected(new Set(checked ? selectableIds : []))}
          />
          <span className="text-fg-secondary">已选 {selectedIds.length} 个可下载 Tweet</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            disabled={!selectedQueueIds.length || actions.pending.download}
            onClick={() => actions.submitDownload({ sourceId, scope: "selected", tweetIds: selectedQueueIds })}
          >
            下载选中
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={!selectedActiveIds.length || selectedActiveRunIds.length !== 1 || actions.pending.download}
            onClick={() => actions.cancelDownloadItems({ runId: selectedActiveRunIds[0], tweetIds: selectedActiveIds })}
          >
            取消选中
          </Button>
        </div>
      </div>
      {data ? (
        <Pagination
          offset={offset}
          count={data.count}
          totalCount={data.total_count}
          pageSize={PAGE_SIZE}
          onOffsetChange={onOffsetChange}
          label="第 {start}-{end} 项，共 {total} 项"
        />
      ) : null}
      <Virtuoso
        className="min-h-0 flex-1"
        style={{ height: "100%" }}
        data={tweets}
        itemContent={(_, tweet) => (
          <TweetListItem
            tweet={tweet}
            sourceId={sourceId}
            selected={selected.has(tweet.tweet_id)}
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
          />
        )}
      />
    </div>
  );
}

type TweetRow = SourceDiscoveryPageResponse["rows"][number];

function canQueue(tweet: TweetRow) {
  if (tweet.active_item_status) return false;
  if (["verified", "downloaded", "skipped"].includes(String(tweet.download_status))) return false;
  return true;
}

function canCancel(status?: string | null) {
  return status === "pending" || status === "blocked" || status === "failed_retryable" || status === "processing";
}

function TweetDownloadProgress({
  tweet,
  statusLabel,
}: {
  tweet: TweetRow;
  statusLabel: (status?: string | null) => string;
}) {
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
          <Badge tone={progressTone(activeStatus || tweet.download_status)}>
            {activeStatus ? statusLabel(activeStatus) : statusLabel(tweet.download_status)}
          </Badge>
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

function progressTone(status?: string | null): "default" | "secondary" | "warning" | "danger" | "success" {
  if (status === "processing" || status === "downloading") return "default";
  if (status === "verified" || status === "downloaded" || status === "skipped_verified") return "success";
  if (status === "blocked" || status === "paused" || status === "failed_retryable") return "warning";
  if (status === "failed" || status === "failed_permanent" || status === "cancelled") return "danger";
  return "secondary";
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
  onSelectionChange,
  actions,
  statusLabel,
}: {
  tweet: TweetRow;
  sourceId: number;
  selected: boolean;
  onSelectionChange: (checked: boolean) => void;
  actions: DetailActions;
  statusLabel: (status?: string | null) => string;
}) {
  return (
    <div className="pb-2">
      <div className="rounded-lg border border-border-subtle bg-bg-surface p-3 transition-colors hover:border-border-strong">
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
              <TweetDownloadProgress tweet={tweet} statusLabel={statusLabel} />
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2 whitespace-nowrap text-center">
            <Badge>{statusLabel(tweet.download_status)}</Badge>
            {tweet.active_item_status ? <Badge tone="secondary">{statusLabel(tweet.active_item_status)}</Badge> : null}
            {canQueue(tweet) ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={actions.pending.download}
                onClick={() => actions.submitDownload({ sourceId, scope: "selected", tweetIds: [tweet.tweet_id] })}
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
