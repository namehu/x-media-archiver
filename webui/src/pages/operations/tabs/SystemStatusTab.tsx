import { Link } from "react-router-dom";
import { Activity, AlertTriangle, Lock, Wrench } from "lucide-react";
import type { HealthDetail } from "../../../lib/api";
import { Badge } from "../../../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { EmptyState } from "../../../components/ui/empty-state";
import { ErrorState } from "../../../components/ui/error-state";
import { StatCard } from "../../../components/ui/stat-card";
import { useI18n } from "../../../lib/i18n";
import { formatDateTime } from "../../../lib/utils";
import { formatError, stringOrNumber, textValue } from "../utils";

type SystemStatusTabProps = {
  health?: HealthDetail;
  isError: boolean;
  onRetry: () => void;
};

export function SystemStatusTab({ health, isError, onRetry }: SystemStatusTabProps) {
  const { t } = useI18n();
  const queue = health?.queue;
  const sources = health?.sources;
  const worker = health?.worker;
  const latestRun = queue?.latest_run;
  const latestScan = sources?.latest_scan;

  if (isError) return <ErrorState title={t("operations.healthUnavailable")} onRetry={onRetry} />;

  return (
    <section className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t("operations.writeLock")} value={worker?.write_lock_held ? t("health.writeLocked") : t("health.idle")} icon={<Lock className="h-4 w-4" />} tone={worker?.write_lock_held ? "warning" : "success"} />
        <StatCard label={t("operations.queueBacklog")} value={(queue?.pending_items ?? 0) + (queue?.processing_items ?? 0)} detail={t("operations.queueBacklogDetail", { pending: queue?.pending_items ?? 0, processing: queue?.processing_items ?? 0 })} icon={<Wrench className="h-4 w-4" />} tone={(queue?.pending_items ?? 0) ? "warning" : "brand"} />
        <StatCard label={t("operations.sourceScans")} value={sources?.active_scan_runs ?? 0} detail={t("operations.sourceScansDetail", { enabled: sources?.history_enabled_sources ?? 0 })} icon={<Activity className="h-4 w-4" />} />
        <StatCard label={t("operations.recentErrors")} value={health?.recent_errors.length ?? 0} icon={<AlertTriangle className="h-4 w-4" />} tone={health?.recent_errors.length ? "danger" : "success"} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr_1.1fr]">
        <StatusSummary title={t("operations.latestRun")} empty={t("operations.noLatestRun")} values={[[t("operations.status"), textValue(latestRun?.status)], [t("operations.trigger"), textValue(latestRun?.trigger_type)], [t("operations.startedAt"), formatDateTime(stringOrNumber(latestRun?.started_at))], [t("operations.finishedAt"), formatDateTime(stringOrNumber(latestRun?.finished_at))]]} />
        <StatusSummary title={t("operations.latestScan")} empty={t("operations.noLatestScan")} values={[[t("operations.status"), textValue(latestScan?.status)], [t("operations.trigger"), textValue(latestScan?.trigger_type)], [t("operations.sourceId"), textValue(latestScan?.source_id)], [t("operations.finishedAt"), formatDateTime(stringOrNumber(latestScan?.finished_at || latestScan?.created_at))]]} />
        <RecentErrorsList errors={health?.recent_errors ?? []} />
      </div>
    </section>
  );
}

function StatusSummary({ title, values, empty }: { title: string; values: Array<[string, string]>; empty: string }) {
  const hasValue = values.some(([, value]) => value !== "-");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {hasValue ? (
          <dl className="space-y-2 text-sm">
            {values.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt className="text-fg-secondary">{label}</dt>
                <dd className="max-w-[60%] truncate text-right font-medium text-fg-primary">{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-fg-secondary">{empty}</p>
        )}
      </CardContent>
    </Card>
  );
}

function RecentErrorsList({ errors }: { errors: HealthDetail["recent_errors"] }) {
  const { t } = useI18n();

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>{t("operations.recentErrors")}</CardTitle>
          <Badge tone={errors.length ? "danger" : "secondary"}>{errors.length}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {errors.length ? (
          <div className="space-y-2">
            {errors.map((error, index) => (
              <div key={`${textValue(error.kind)}-${textValue(error.id)}-${index}`} className="rounded-md border border-border-subtle bg-bg-surface p-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{textValue(error.kind)}</Badge>
                  <span className="font-semibold text-fg-primary">{textValue(error.subject)}</span>
                  <span className="text-xs text-fg-tertiary">{formatDateTime(stringOrNumber(error.occurred_at))}</span>
                </div>
                <div className="mt-1 text-xs text-fg-secondary">{formatError(error.error_category, error.error_message, t)}</div>
                {error.target_path ? (
                  <Link to={error.target_path} className="mt-1 inline-flex text-xs font-semibold text-brand hover:text-brand-hover">
                    {t("operations.openErrorTarget")}
                  </Link>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title={t("operations.noRecentErrors")} />
        )}
      </CardContent>
    </Card>
  );
}
