import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiGet, apiPost, type ActionResponse, type HealthDetail } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { formatDateTime } from "../lib/utils";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorState } from "../components/ui/ErrorState";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";

export function OperationsPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const [verifyLimit, setVerifyLimit] = useState("");
  const [confirmFullScan, setConfirmFullScan] = useState(false);
  const [requeueStatuses, setRequeueStatuses] = useState(["failed_retryable", "missing", "corrupt"]);
  const [requeueLimit, setRequeueLimit] = useState("");
  const [recoverTimeout, setRecoverTimeout] = useState("");
  const [exportKind, setExportKind] = useState("media");
  const [exportStatus, setExportStatus] = useState("verified");
  const [lastResult, setLastResult] = useState<ActionResponse | null>(null);
  const healthQuery = useQuery({
    queryKey: ["health-detail"],
    queryFn: () => apiGet<HealthDetail>("/api/v1/health/detail"),
    refetchInterval: 15000,
  });

  const mutation = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) => apiPost<ActionResponse>(path, body),
    onSuccess: async (result) => {
      setLastResult(result);
      await queryClient.invalidateQueries();
    },
  });

  const run = (path: string, body: Record<string, unknown> = {}) => {
    mutation.mutate({ path, body });
  };

  return (
    <div className="space-y-5">
      <SystemStatusPanel health={healthQuery.data} isError={healthQuery.isError} onRetry={() => healthQuery.refetch()} />

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("operations.requeue")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <div className="text-sm font-medium">{t("operations.requeueStatuses")}</div>
              {["failed_retryable", "missing", "corrupt", "failed_permanent"].map((status) => (
                <label key={status} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={requeueStatuses.includes(status)}
                    onChange={(event) => {
                      setRequeueStatuses((current) =>
                        event.target.checked ? [...current, status] : current.filter((item) => item !== status),
                      );
                    }}
                  />
                  {t(`common.status.${status}`)}
                </label>
              ))}
            </div>
            <Input
              placeholder={t("operations.limit")}
              inputMode="numeric"
              value={requeueLimit}
              onChange={(event) => setRequeueLimit(event.target.value)}
            />
            <Button
              type="button"
              disabled={mutation.isPending}
              onClick={() =>
                run("/api/v1/actions/requeue", {
                  statuses: requeueStatuses.length ? requeueStatuses : null,
                  limit: numberOrNull(requeueLimit),
                })
              }
            >
              {t("operations.requeue")}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("operations.recoverInterrupted")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              placeholder={t("operations.timeoutMinutes")}
              inputMode="numeric"
              value={recoverTimeout}
              onChange={(event) => setRecoverTimeout(event.target.value)}
            />
            <Button
              type="button"
              disabled={mutation.isPending}
              onClick={() =>
                run("/api/v1/actions/recover-interrupted", {
                  timeout_minutes: numberOrNull(recoverTimeout),
                })
              }
            >
              {t("operations.recover")}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("operations.export")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Select value={exportKind} onChange={(event) => setExportKind(event.target.value)}>
              <option value="media">{t("operations.exportMedia")}</option>
              <option value="failures">{t("operations.exportFailures")}</option>
              <option value="duplicates">{t("operations.exportDuplicates")}</option>
            </Select>
            <Select value={exportStatus} onChange={(event) => setExportStatus(event.target.value)}>
              <option value="verified">{t("common.status.verified")}</option>
              <option value="all">{t("common.status.all")}</option>
              <option value="downloaded">{t("common.status.downloaded")}</option>
              <option value="missing">{t("common.status.missing")}</option>
              <option value="corrupt">{t("common.status.corrupt")}</option>
            </Select>
            <Button
              type="button"
              disabled={mutation.isPending}
              onClick={() => run("/api/v1/actions/export", { kind: exportKind, status: exportStatus })}
            >
              {t("operations.exportSnapshot")}
            </Button>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>{t("operations.maintenance")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-destructive">
            {t("operations.fullScanWarning")}
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={confirmFullScan}
              onChange={(event) => setConfirmFullScan(event.target.checked)}
            />
            {t("operations.confirmFullScan")}
          </label>
          <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
            <Input
              placeholder={t("operations.verifyLimit")}
              inputMode="numeric"
              value={verifyLimit}
              onChange={(event) => setVerifyLimit(event.target.value)}
            />
            <Button
              type="button"
              variant="secondary"
              disabled={mutation.isPending || !confirmFullScan}
              onClick={() =>
                run("/api/v1/maintenance/verify", {
                  limit: numberOrNull(verifyLimit),
                  confirm_full_scan: confirmFullScan,
                })
              }
            >
              {t("operations.fullVerify")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={mutation.isPending || !confirmFullScan}
              onClick={() =>
                run("/api/v1/maintenance/backfill", {
                  confirm_full_scan: confirmFullScan,
                  normalize_files: true,
                })
              }
            >
              {t("operations.fullBackfill")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("operations.exportNote")}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("operations.result")}</CardTitle>
        </CardHeader>
        <CardContent>
          {mutation.error ? (
            <pre className="overflow-auto rounded-md bg-muted p-3 text-sm text-destructive">
              {String(mutation.error)}
            </pre>
          ) : null}
          {mutation.isPending ? <p className="text-sm text-muted-foreground">{t("operations.running")}</p> : null}
          {lastResult ? (
            <pre className="overflow-auto rounded-md bg-muted p-3 text-sm">
              {JSON.stringify(lastResult, null, 2)}
            </pre>
          ) : null}
          {!lastResult && !mutation.error && !mutation.isPending ? (
            <p className="text-sm text-muted-foreground">{t("operations.noResult")}</p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function SystemStatusPanel({
  health,
  isError,
  onRetry,
}: {
  health?: HealthDetail;
  isError: boolean;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  const queue = health?.queue;
  const sources = health?.sources;
  const worker = health?.worker;
  const latestRun = queue?.latest_run;
  const latestScan = sources?.latest_scan;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("operations.systemStatus")}</CardTitle>
      </CardHeader>
      <CardContent>
        {isError ? (
          <ErrorState title={t("operations.healthUnavailable")} onRetry={onRetry} className="py-6" />
        ) : (
          <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-3">
                <MetricBlock
                  label={t("operations.writeLock")}
                  value={worker?.write_lock_held ? t("health.writeLocked") : t("health.idle")}
                  tone={worker?.write_lock_held ? "warning" : "neutral"}
                />
                <MetricBlock
                  label={t("operations.queueBacklog")}
                  value={String((queue?.pending_items ?? 0) + (queue?.processing_items ?? 0))}
                  detail={t("operations.queueBacklogDetail", {
                    pending: queue?.pending_items ?? 0,
                    processing: queue?.processing_items ?? 0,
                  })}
                  tone={(queue?.pending_items ?? 0) || (queue?.processing_items ?? 0) ? "warning" : "neutral"}
                />
                <MetricBlock
                  label={t("operations.sourceScans")}
                  value={String(sources?.active_scan_runs ?? 0)}
                  detail={t("operations.sourceScansDetail", {
                    enabled: sources?.history_enabled_sources ?? 0,
                  })}
                  tone={sources?.active_scan_runs ? "warning" : "neutral"}
                />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <StatusSummary
                  title={t("operations.latestRun")}
                  empty={t("operations.noLatestRun")}
                  values={[
                    [t("operations.status"), textValue(latestRun?.status)],
                    [t("operations.trigger"), textValue(latestRun?.trigger_type)],
                    [t("operations.startedAt"), formatDateTime(stringOrNumber(latestRun?.started_at))],
                    [t("operations.finishedAt"), formatDateTime(stringOrNumber(latestRun?.finished_at))],
                  ]}
                />
                <StatusSummary
                  title={t("operations.latestScan")}
                  empty={t("operations.noLatestScan")}
                  values={[
                    [t("operations.status"), textValue(latestScan?.status)],
                    [t("operations.trigger"), textValue(latestScan?.trigger_type)],
                    [t("operations.sourceId"), textValue(latestScan?.source_id)],
                    [t("operations.finishedAt"), formatDateTime(stringOrNumber(latestScan?.finished_at || latestScan?.created_at))],
                  ]}
                />
              </div>
            </div>
            <RecentErrorsList errors={health?.recent_errors ?? []} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MetricBlock({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "neutral" | "warning";
}) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={tone === "warning" ? "mt-1 text-lg font-semibold text-amber-700 dark:text-amber-300" : "mt-1 text-lg font-semibold"}>
        {value}
      </div>
      {detail ? <div className="mt-1 text-xs text-muted-foreground">{detail}</div> : null}
    </div>
  );
}

function StatusSummary({ title, values, empty }: { title: string; values: Array<[string, string]>; empty: string }) {
  const hasValue = values.some(([, value]) => value !== "-");
  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-2 text-sm font-medium">{title}</div>
      {hasValue ? (
        <dl className="space-y-1 text-sm">
          {values.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="max-w-[60%] truncate text-right">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">{empty}</p>
      )}
    </div>
  );
}

function RecentErrorsList({ errors }: { errors: HealthDetail["recent_errors"] }) {
  const { t } = useI18n();
  return (
    <div className="rounded-md border border-border p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-sm font-medium">{t("operations.recentErrors")}</div>
        <Badge>{errors.length}</Badge>
      </div>
      {errors.length ? (
        <div className="space-y-2">
          {errors.map((error, index) => (
            <div key={`${textValue(error.kind)}-${textValue(error.id)}-${index}`} className="rounded-md bg-muted/40 p-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{textValue(error.kind)}</Badge>
                <span className="font-medium">{textValue(error.subject)}</span>
                <span className="text-xs text-muted-foreground">{formatDateTime(stringOrNumber(error.occurred_at))}</span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {formatError(error.error_category, error.error_message, t)}
              </div>
              {error.target_path ? (
                <Link to={error.target_path} className="mt-1 inline-flex text-xs font-medium text-primary hover:underline">
                  {t("operations.openErrorTarget")}
                </Link>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title={t("operations.noRecentErrors")} className="py-6" />
      )}
    </div>
  );
}

function textValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function stringOrNumber(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function formatError(category: string | null | undefined, message: string | null | undefined, t: (key: string) => string) {
  if (category) {
    const key = `common.error.${category}`;
    const translated = t(key);
    return translated === key ? category : translated;
  }
  return textValue(message);
}

function numberOrNull(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
