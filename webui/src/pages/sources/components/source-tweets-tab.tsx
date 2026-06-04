import { Virtuoso } from "react-virtuoso";
import * as React from "react";
import type { SourceDiscoveryPageResponse } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Pagination } from "@/components/ui/pagination";
import { Progress } from "@/components/ui/progress";
import { formatDateTime } from "@/lib/utils";
import { formatDiscoveredMedia } from "../utils";
import type { DetailActions } from "./source-detail-sheet/scan-actions";

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
  const selectableIds = tweets.filter((tweet) => canQueue(tweet) || canCancel(tweet.active_item_status)).map((tweet) => tweet.tweet_id);
  const selectedQueueIds = tweets.filter((tweet) => selected.has(tweet.tweet_id) && canQueue(tweet)).map((tweet) => tweet.tweet_id);
  const selectedActiveIds = tweets
    .filter((tweet) => selected.has(tweet.tweet_id) && tweet.active_run_id && canCancel(tweet.active_item_status))
    .map((tweet) => tweet.tweet_id);
  const selectedActiveRunIds = Array.from(new Set(tweets
    .filter((tweet) => selected.has(tweet.tweet_id) && tweet.active_run_id && canCancel(tweet.active_item_status))
    .map((tweet) => Number(tweet.active_run_id))));

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
          <div className="pb-2">
            <div className="rounded-lg border border-border-subtle bg-bg-surface p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 flex-1 gap-3">
                  <Checkbox
                    className="mt-1"
                    checked={selected.has(tweet.tweet_id)}
                    disabled={!canQueue(tweet) && !canCancel(tweet.active_item_status)}
                    onCheckedChange={(checked) => {
                      setSelected((current) => {
                        const next = new Set(current);
                        if (checked) next.add(tweet.tweet_id);
                        else next.delete(tweet.tweet_id);
                        return next;
                      });
                    }}
                  />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="whitespace-pre-wrap break-words text-sm leading-6 text-fg-primary">
                    {tweet.text || "暂无 Tweet 文本"}
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-fg-secondary">
                    {formatDiscoveredMedia(tweet.raw_payload)}
                  </div>
                  <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-fg-secondary">
                    <span>{tweet.tweet_id}</span>
                    <span>{formatDateTime(tweet.discovered_at)}</span>
                    <span>{tweet.active_run_id ? `下载 Run #${tweet.active_run_id}` : tweet.archive_run_id ? `历史 Run #${tweet.archive_run_id}` : "未入队"}</span>
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
                      onClick={() => actions.cancelDownloadItems({ runId: tweet.active_run_id as number, tweetIds: [tweet.tweet_id] })}
                    >
                      取消
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
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
    <div className="rounded-md border border-border-subtle bg-bg-muted/60 p-2">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge tone={progressTone(activeStatus || tweet.download_status)}>
            {activeStatus ? statusLabel(activeStatus) : statusLabel(tweet.download_status)}
          </Badge>
          {tweet.cancel_requested ? <Badge tone="warning">取消请求中</Badge> : null}
          <span className="min-w-0 break-words text-xs text-fg-secondary">{message}</span>
        </div>
        <span className="text-xs tabular-nums text-fg-secondary">{percent == null ? "估算中" : `${percent}%`}</span>
      </div>
      <Progress value={percent ?? (isActive ? 8 : 0)} className={isActive && percent == null ? "opacity-70" : ""} />
      <div className="mt-2 grid gap-x-3 gap-y-1 text-xs text-fg-secondary sm:grid-cols-3">
        <span>已下载: {formatBytes(downloaded)}</span>
        <span>总大小: {total > 0 ? formatBytes(total) : "未知"}</span>
        <span>速度: {formatBytes(tweet.speed_bps)}/s</span>
      </div>
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
