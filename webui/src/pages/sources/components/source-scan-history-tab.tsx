import { Virtuoso } from "react-virtuoso";
import type { SourceScanRun } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/utils";
import { scanStatusLabel, scanTriggerLabel } from "@/lib/formatters";
import { formatElapsed, formatRunRange, scanStatusTone } from "../utils";

export function SourceScanHistoryTab({
  runs,
  isLoading,
  isFetchingNextPage,
  hasNextPage,
  error,
  onLoadMore,
  now,
}: {
  runs: SourceScanRun[];
  isLoading: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  error: unknown;
  onLoadMore: () => void;
  now: number;
}) {
  if (isLoading) {
    return <p className="py-4 text-sm text-fg-secondary">加载中...</p>;
  }

  if (error) {
    return <p className="py-4 text-sm text-danger">{String(error)}</p>;
  }

  if (runs.length === 0) {
    return <p className="py-4 text-sm text-fg-secondary">还没有扫描批次记录。</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <Virtuoso
        className="min-h-0 flex-1"
        style={{ height: "100%" }}
        data={runs}
        endReached={() => {
          if (hasNextPage && !isFetchingNextPage) onLoadMore();
        }}
        components={{
          Footer: () =>
            isFetchingNextPage ? (
              <p className="py-2 text-center text-xs text-fg-secondary">正在加载更多记录...</p>
            ) : hasNextPage ? (
              <p className="py-2 text-center text-xs text-fg-tertiary">继续下拉加载更多</p>
            ) : (
              <p className="py-2 text-center text-xs text-fg-tertiary">已显示全部扫描记录</p>
            ),
        }}
        itemContent={(index, run) => (
          <div className="relative pb-6 pl-6">
            {/* 时间轴竖线 */}
            {(index !== runs.length - 1 || hasNextPage) && (
              <div className="absolute bottom-[-8px] left-[4px] top-3 w-[2px] bg-border-subtle" />
            )}
            {/* 节点圆点 */}
            <div
              className={[
                "absolute left-0 top-1.5 z-10 h-2.5 w-2.5 rounded-full border-2 bg-bg-surface",
                run.status === "running" ? "animate-breathe border-brand" : "border-border-strong",
              ].join(" ")}
            />
            <div className="flex flex-col gap-1.5">
              <div className="text-xs font-medium text-fg-secondary">
                {run.status === "running"
                  ? `已运行 ${formatElapsed(run.started_at, now)}`
                  : formatDateTime(run.finished_at || run.created_at)}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{scanTriggerLabel(run.trigger_type)}</Badge>
                <Badge tone={scanStatusTone(run.status)}>{scanStatusLabel(run.status)}</Badge>
              </div>
              <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-secondary">
                <span>
                  范围: <span className="text-fg-primary">{formatRunRange(run.range_start, run.range_end)}</span>
                </span>
                <span>
                  发现: <span className="text-fg-primary">{run.discovered_tweet_count}</span>
                </span>
                <span>
                  新增: <span className="text-fg-primary">{run.new_tweet_count}</span>
                </span>
                <span>
                  已存在: <span className="text-fg-primary">{run.duplicate_tweet_count}</span>
                </span>
                <span>
                  媒体预估: <span className="text-fg-primary">{run.discovered_media_count}</span>
                </span>
              </div>
              {run.error_message ? (
                <div className="mt-1 rounded-md border border-danger/20 bg-danger/5 p-2 text-xs text-danger">
                  <span className="font-semibold">{run.error_category || "失败"}:</span> {run.error_message}
                </div>
              ) : null}
              {run.progress_message ? (
                <div className="mt-1 rounded-md border border-border-subtle bg-bg-muted/50 p-2 text-xs text-fg-secondary">
                  <span className="font-semibold">最近日志:</span> {run.progress_message}
                </div>
              ) : null}
            </div>
          </div>
        )}
      />
    </div>
  );
}
