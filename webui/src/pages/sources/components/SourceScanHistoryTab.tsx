import type { ArchiveSource } from "../../../lib/api";
import { Badge } from "../../../components/ui/badge";
import { formatDateTime } from "../../../lib/utils";
import { formatElapsed, formatRunRange, scanStatusLabel, scanStatusTone, scanTriggerLabel, type TFunction } from "../utils";

export function SourceScanHistoryTab({ source, now, t }: { source: ArchiveSource; now: number; t: TFunction }) {
  const runs = source.scan_runs ?? [];

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-fg-primary">{t("sources.scanHistory")}</h3>
      <div className="space-y-2">
        {runs.map((run) => (
          <div key={run.id} className="rounded-lg border border-border-subtle bg-bg-surface p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{scanTriggerLabel(run.trigger_type, t)}</Badge>
                <Badge tone={scanStatusTone(run.status)}>{scanStatusLabel(run.status, t)}</Badge>
              </div>
              <span className="text-xs text-fg-secondary">
                {run.status === "running"
                  ? t("sources.activeScanElapsedValue", { elapsed: formatElapsed(run.started_at, now) })
                  : formatDateTime(run.finished_at || run.created_at)}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-secondary">
              <span>
                {t("sources.scanRange")}: {formatRunRange(run.range_start, run.range_end)}
              </span>
              <span>
                {t("sources.activeScanStarted")}: {formatDateTime(run.started_at)}
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
              <p className="mt-2 break-words text-xs text-danger">
                {run.error_category || t("sources.scanFailed")}: {run.error_message}
              </p>
            ) : null}
          </div>
        ))}
        {runs.length === 0 ? <p className="text-sm text-fg-secondary">{t("sources.noScanHistory")}</p> : null}
      </div>
    </div>
  );
}
