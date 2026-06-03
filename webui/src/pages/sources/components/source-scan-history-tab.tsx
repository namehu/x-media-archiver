import { Virtuoso } from "react-virtuoso";
import type { SourceScanRunsPageResponse } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { formatDateTime } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { formatElapsed, formatRunRange, scanStatusLabel, scanStatusTone, scanTriggerLabel } from "../utils";

const PAGE_SIZE = 20;

export function SourceScanHistoryTab({
  data,
  isLoading,
  error,
  offset,
  onOffsetChange,
  now,
}: {
  data?: SourceScanRunsPageResponse;
  isLoading: boolean;
  error: unknown;
  offset: number;
  onOffsetChange: (offset: number) => void;
  now: number;
}) {
  const { t } = useI18n();
  const runs = data?.rows ?? [];

  if (isLoading) {
    return <p className="py-4 pl-5 text-sm text-fg-secondary">{t("common.loading")}</p>;
  }

  if (error) {
    return <p className="py-4 pl-5 text-sm text-danger">{String(error)}</p>;
  }

  if (runs.length === 0) {
    return <p className="py-4 text-sm text-fg-secondary">{t("sources.noScanHistory")}</p>;
  }

  return (
    <div className="flex h-[calc(100vh-390px)] min-h-[300px] flex-col gap-3 pl-5">
      {data ? (
        <Pagination
          offset={offset}
          count={data.count}
          totalCount={data.total_count}
          pageSize={PAGE_SIZE}
          onOffsetChange={onOffsetChange}
          label={t("common.pagination.range")}
        />
      ) : null}
      <Virtuoso
        className="min-h-0 flex-1"
        data={runs}
        itemContent={(_, run) => (
          <div className="relative pb-4">
            {/* 时间轴竖线由父容器 before 伪元素提供，节点用绝对定位圆点 */}
            <div
              className={[
                "absolute left-0 top-1.5 h-2.5 w-2.5 rounded-full border-2 bg-bg-surface",
                run.status === "running" ? "animate-breathe border-brand" : "border-border-strong",
              ].join(" ")}
            />
            <div className="text-xs text-fg-secondary">
              {run.status === "running"
                ? t("sources.activeScanElapsedValue", { elapsed: formatElapsed(run.started_at, now) })
                : formatDateTime(run.finished_at || run.created_at)}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <Badge>{scanTriggerLabel(run.trigger_type, t)}</Badge>
              <Badge tone={scanStatusTone(run.status)}>{scanStatusLabel(run.status, t)}</Badge>
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-fg-secondary">
              <span>
                {t("sources.scanRange")}: {formatRunRange(run.range_start, run.range_end)}
              </span>
              <span>
                {t("sources.scanFound")}: {run.discovered_tweet_count}
              </span>
              <span>
                {t("sources.scanNew")}: {run.new_tweet_count}
              </span>
              <span>
                {t("sources.scanDuplicate")}: {run.duplicate_tweet_count}
              </span>
              <span>
                {t("sources.scanMedia")}: {run.discovered_media_count}
              </span>
            </div>
            {run.error_message ? (
              <p className="mt-1.5 break-words text-xs text-danger">
                {run.error_category || t("sources.scanFailed")}: {run.error_message}
              </p>
            ) : null}
            {run.progress_message ? (
              <p className="mt-1.5 break-words text-xs text-fg-secondary">
                {t("sources.scanLastLog")}: {run.progress_message}
              </p>
            ) : null}
          </div>
        )}
      />
    </div>
  );
}
