import { useMemo, useState } from "react";
import { Activity, AlertTriangle, Clock3, FileInput, ListFilter, RefreshCw, Search, UploadCloud } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, type ArchiveRun, type ArchiveRunDetail, type ArchiveRunPageResponse, type ArchiveSubmission } from "../lib/api";
import { useFormatters, useI18n } from "../lib/i18n";
import { formatDateTime } from "../lib/utils";
import { useServerEvents } from "../hooks/useServerEvents";
import { Badge, type BadgeProps } from "../components/ui-next/badge";
import { Button } from "../components/ui-next/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui-next/card";
import { ErrorState } from "../components/ui-next/error-state";
import { Input } from "../components/ui-next/input";
import { LiveIndicator } from "../components/ui-next/live-indicator";
import { Pagination } from "../components/ui-next/pagination";
import { ProgressRing } from "../components/ui-next/progress-ring";
import { Skeleton } from "../components/ui-next/skeleton";
import { StatCard } from "../components/ui-next/stat-card";
import { StatusDot } from "../components/ui-next/status-dot";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui-next/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui-next/tabs";

type ParsedLine = {
  line: number;
  value: string;
  url?: string;
  tweetId?: string;
  status: "valid" | "duplicate" | "invalid";
};

type QueueTab = "all" | "running" | "completed" | "failed";

const PAGE_SIZE = 50;

const TAB_TO_QUERY: Record<QueueTab, { status: string; failedOnly: boolean }> = {
  all: { status: "", failedOnly: false },
  running: { status: "running", failedOnly: false },
  completed: { status: "completed", failedOnly: false },
  failed: { status: "", failedOnly: true },
};

export function ArchiveQueuePage() {
  const { t } = useI18n();
  const { statusLabel, errorLabel, triggerLabel } = useFormatters();
  const queryClient = useQueryClient();
  const events = useServerEvents(["archive_runs", "worker"]);
  const [urls, setUrls] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<ArchiveSubmission | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<QueueTab>("all");
  const [tweetFilter, setTweetFilter] = useState("");
  const [offset, setOffset] = useState(0);

  const preview = useMemo(() => parseUrlInput(urls), [urls]);
  const validRecords = useMemo(
    () =>
      preview.rows
        .filter((row) => row.status === "valid" && row.url)
        .map((row) => ({ url: row.url as string })),
    [preview.rows],
  );
  const activeQuery = TAB_TO_QUERY[activeTab];
  const runsQuery = useQuery({
    queryKey: ["archive-runs", activeQuery.status, tweetFilter, activeQuery.failedOnly, offset],
    queryFn: () =>
      apiGet<ArchiveRunPageResponse>(
        `/api/v1/archive-runs?${runQueryString(activeQuery.status, tweetFilter, activeQuery.failedOnly, PAGE_SIZE, offset)}`,
      ),
    refetchInterval: 15000,
  });
  const detailQuery = useQuery({
    queryKey: ["archive-run", selectedRunId],
    queryFn: () => apiGet<ArchiveRunDetail>(`/api/v1/archive-runs/${selectedRunId}`),
    enabled: selectedRunId !== null,
    refetchInterval: 15000,
  });

  const queueModel = useMemo(() => buildQueueModel(runsQuery.data?.rows ?? []), [runsQuery.data?.rows]);

  const refresh = async (runId?: number) => {
    if (runId) setSelectedRunId(runId);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["archive-runs"] }),
      queryClient.invalidateQueries({ queryKey: ["archive-run"] }),
      queryClient.invalidateQueries({ queryKey: ["summary"] }),
      queryClient.invalidateQueries({ queryKey: ["media"] }),
      queryClient.invalidateQueries({ queryKey: ["failures"] }),
    ]);
  };
  const submitMutation = useMutation({
    mutationFn: (records: Array<{ url: string } & Record<string, unknown>>) =>
      apiPost<ArchiveSubmission>("/api/v1/archive-runs", { trigger_type: "webui", records }),
    onSuccess: async (result) => {
      setFeedback(result);
      setParseError(null);
      setUrls("");
      setActiveTab("running");
      setOffset(0);
      await refresh(result.run_id);
    },
  });
  const retryMutation = useMutation({
    mutationFn: (runId: number) => apiPost<ArchiveSubmission>(`/api/v1/archive-runs/${runId}/retry`, {}),
    onSuccess: async (result) => {
      setFeedback(result);
      setActiveTab("running");
      setOffset(0);
      await refresh(result.run_id);
    },
  });

  const pending = submitMutation.isPending || retryMutation.isPending;
  const canSubmit = validRecords.length > 0 && preview.invalidCount === 0 && !pending;
  const submitUrls = () => {
    if (canSubmit) submitMutation.mutate(validRecords);
  };
  const liveState = events.status === "connected" ? "open" : events.status === "connecting" ? "connecting" : "closed";
  const hasActiveFilters = activeTab !== "all" || tweetFilter.trim();

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-fg-primary">{t("nav.queue")}</h1>
          <p className="mt-1 text-sm text-fg-secondary">{t("queue.submitTitle")} · {t("queue.runs")} · {t("queue.detail")}</p>
        </div>
        <LiveIndicator state={liveState} label={t(`events.${events.status}`)} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.25fr_0.75fr]">
        <QueueHero
          progress={queueModel.progress}
          activeRun={queueModel.activeRun}
          statusLabel={statusLabel}
          triggerLabel={triggerLabel}
          totalCount={runsQuery.data?.total_count ?? 0}
        />
        <SubmitPanel
          urls={urls}
          setUrls={setUrls}
          preview={preview}
          canSubmit={canSubmit}
          pending={pending}
          submitUrls={submitUrls}
          feedback={feedback}
          parseError={parseError}
          setFeedback={setFeedback}
          setParseError={setParseError}
          submitError={submitMutation.error}
          retryError={retryMutation.error}
          statusLabel={statusLabel}
        />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t("queue.runs")}
          value={(runsQuery.data?.total_count ?? 0).toLocaleString()}
          detail={t("common.pagination.range", {
            start: runsQuery.data?.total_count ? offset + 1 : 0,
            end: Math.min(offset + (runsQuery.data?.count ?? 0), runsQuery.data?.total_count ?? 0),
            total: runsQuery.data?.total_count ?? 0,
          })}
          icon={<Activity className="h-4 w-4" />}
          sparklineData={queueModel.sparkline}
        />
        <StatCard
          label={statusLabel("running")}
          value={queueModel.runningCount.toLocaleString()}
          detail={queueModel.runningCount ? t("events.connected") : t("health.idle")}
          icon={<RefreshCw className="h-4 w-4" />}
          trend={{ value: queueModel.runningCount ? statusLabel("running") : t("health.idle"), direction: queueModel.runningCount ? "up" : "flat" }}
        />
        <StatCard
          label={statusLabel("failed")}
          value={queueModel.failedCount.toLocaleString()}
          detail={queueModel.failedCount ? t("failures.title") : t("failures.empty")}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={queueModel.failedCount ? "danger" : "success"}
        />
        <StatCard
          label={t("queue.lastAttempt")}
          value={queueModel.latestRun ? `#${queueModel.latestRun.id}` : "-"}
          detail={queueModel.latestRun ? formatDateTime(queueModel.latestRun.started_at) : t("queue.empty")}
          icon={<Clock3 className="h-4 w-4" />}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
        <Card className="overflow-hidden">
          <CardHeader className="gap-4">
            <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
              <div>
                <CardTitle>{t("queue.runs")}</CardTitle>
                <CardDescription>
                  {t("queue.filterStatus")} · {t("queue.searchTweet")} · {t("queue.onlyFailed")}
                </CardDescription>
              </div>
              {hasActiveFilters ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setActiveTab("all");
                    setTweetFilter("");
                    setOffset(0);
                  }}
                >
                  {t("queue.clearFilters")}
                </Button>
              ) : null}
            </div>
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <Tabs
                value={activeTab}
                onValueChange={(value) => {
                  setActiveTab(value as QueueTab);
                  setOffset(0);
                }}
              >
                <TabsList>
                  <TabsTrigger value="all">{t("common.status.all")}</TabsTrigger>
                  <TabsTrigger value="running">{statusLabel("running")}</TabsTrigger>
                  <TabsTrigger value="completed">{statusLabel("completed")}</TabsTrigger>
                  <TabsTrigger value="failed">{statusLabel("failed")}</TabsTrigger>
                </TabsList>
              </Tabs>
              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative min-w-0 sm:w-64">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-tertiary" />
                  <Input
                    className="pl-9"
                    placeholder={t("queue.searchTweet")}
                    value={tweetFilter}
                    onChange={(event) => {
                      setOffset(0);
                      setTweetFilter(event.target.value);
                    }}
                  />
                </div>
                <Button
                  type="button"
                  variant={activeTab === "failed" ? "default" : "outline"}
                  onClick={() => {
                    setActiveTab(activeTab === "failed" ? "all" : "failed");
                    setOffset(0);
                  }}
                >
                  <ListFilter className="h-4 w-4" />
                  {t("queue.onlyFailed")}
                </Button>
              </div>
            </div>
          </CardHeader>
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as QueueTab)}>
            {(["all", "running", "completed", "failed"] as QueueTab[]).map((tab) => (
              <TabsContent key={tab} value={tab} className="pt-0">
                <CardContent className="space-y-4">
                  {runsQuery.isLoading ? (
                    <QueueTableSkeleton />
                  ) : runsQuery.error ? (
                    <ErrorState title={t("common.apiUnavailable")} detail={String(runsQuery.error)} />
                  ) : (
                    <RunTable
                      runs={runsQuery.data?.rows ?? []}
                      selectedRunId={selectedRunId}
                      onSelect={setSelectedRunId}
                      statusLabel={statusLabel}
                      triggerLabel={triggerLabel}
                    />
                  )}
                  {runsQuery.data ? (
                    <Pagination
                      offset={offset}
                      count={runsQuery.data.count}
                      totalCount={runsQuery.data.total_count}
                      pageSize={PAGE_SIZE}
                      onOffsetChange={setOffset}
                      label={t("common.pagination.range")}
                    />
                  ) : null}
                </CardContent>
              </TabsContent>
            ))}
          </Tabs>
        </Card>

        <RunDetailPanel
          run={detailQuery.data}
          isLoading={detailQuery.isLoading}
          error={detailQuery.error}
          pending={pending}
          onRetry={(runId) => retryMutation.mutate(runId)}
          statusLabel={statusLabel}
          errorLabel={errorLabel}
        />
      </section>
    </div>
  );
}

function QueueHero({
  progress,
  activeRun,
  statusLabel,
  triggerLabel,
  totalCount,
}: {
  progress: number;
  activeRun?: ArchiveRun;
  statusLabel: (status?: string | null) => string;
  triggerLabel: (trigger?: string | null) => string;
  totalCount: number;
}) {
  const { t } = useI18n();
  return (
    <Card className="overflow-hidden border-brand/20 bg-gradient-to-br from-brand-soft via-bg-elevated to-bg-surface">
      <CardContent className="grid gap-6 p-6 md:grid-cols-[auto_1fr] md:items-center">
        <div className="flex justify-center md:block">
          <ProgressRing value={progress} size={112} strokeWidth={9} />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={activeRun ? statusTone(activeRun.status) : "secondary"}>{activeRun ? statusLabel(activeRun.status) : t("health.idle")}</Badge>
            <span className="text-xs font-medium text-fg-tertiary">
              {totalCount.toLocaleString()} {t("queue.runs")}
            </span>
          </div>
          <h2 className="mt-3 text-2xl font-bold tracking-tight text-fg-primary">
            {activeRun ? t("queue.run", { id: activeRun.id }) : t("queue.empty")}
          </h2>
          <p className="mt-2 text-sm text-fg-secondary">
            {activeRun ? `${triggerLabel(activeRun.trigger_type)} · ${formatDateTime(activeRun.started_at)}` : t("queue.selectRun")}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function SubmitPanel({
  urls,
  setUrls,
  preview,
  canSubmit,
  pending,
  submitUrls,
  feedback,
  parseError,
  setFeedback,
  setParseError,
  submitError,
  retryError,
  statusLabel,
}: {
  urls: string;
  setUrls: (value: string) => void;
  preview: ReturnType<typeof parseUrlInput>;
  canSubmit: boolean;
  pending: boolean;
  submitUrls: () => void;
  feedback: ArchiveSubmission | null;
  parseError: string | null;
  setFeedback: (value: ArchiveSubmission | null) => void;
  setParseError: (value: string | null) => void;
  submitError: Error | null;
  retryError: Error | null;
  statusLabel: (status?: string | null) => string;
}) {
  const { t } = useI18n();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("queue.submitTitle")}</CardTitle>
        <CardDescription>{t("queue.inputPreview")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <textarea
          className="min-h-28 w-full resize-y rounded-lg border border-border-strong bg-bg-elevated px-3 py-2 text-sm text-fg-primary outline-none transition duration-fast placeholder:text-fg-tertiary focus-visible:ring-2 focus-visible:ring-brand/50"
          placeholder="https://x.com/user/status/123"
          value={urls}
          onChange={(event) => setUrls(event.target.value)}
        />
        <div className="grid gap-2 sm:grid-cols-2">
          <Button type="button" disabled={!canSubmit} onClick={submitUrls}>
            <UploadCloud className="h-4 w-4" />
            {t("queue.submitUrls")}
          </Button>
          <label className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-border-strong bg-transparent px-4 text-sm font-medium text-fg-primary transition duration-fast hover:bg-bg-muted focus-within:ring-2 focus-within:ring-brand/50">
            <FileInput className="h-4 w-4" />
            TXT / JSONL
            <input
              className="sr-only"
              type="file"
              accept=".txt,.jsonl"
              disabled={pending}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                try {
                  setUrls(parseFileToText(file.name, await file.text()));
                  setFeedback(null);
                  setParseError(null);
                } catch (error) {
                  setFeedback(null);
                  setParseError(`${t("queue.fileParseError")}: ${String(error)}`);
                } finally {
                  event.target.value = "";
                }
              }}
            />
          </label>
        </div>

        <InputPreview preview={preview} />
        {preview.invalidCount > 0 ? <p className="text-sm text-danger">{t("queue.submitDisabledByInvalid")}</p> : null}
        {urls.trim() && preview.validCount === 0 ? <p className="text-sm text-fg-secondary">{t("queue.noValidUrls")}</p> : null}
        {parseError || submitError || retryError ? (
          <p className="text-sm text-danger">{parseError || String(submitError || retryError)}</p>
        ) : null}
        {feedback ? (
          <div className="rounded-lg border border-brand/20 bg-brand-soft p-3 text-sm text-fg-primary">
            {t("queue.feedback", {
              runId: feedback.run_id,
              status: statusLabel(feedback.status),
              queued: feedback.tasks.queued_count,
              skipped: feedback.tasks.skipped_verified_count,
              linked: feedback.tasks.linked_pending_count,
            })}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function RunTable({
  runs,
  selectedRunId,
  onSelect,
  statusLabel,
  triggerLabel,
}: {
  runs: ArchiveRun[];
  selectedRunId: number | null;
  onSelect: (id: number) => void;
  statusLabel: (status?: string | null) => string;
  triggerLabel: (trigger?: string | null) => string;
}) {
  const { t } = useI18n();
  if (runs.length === 0) return <p className="rounded-lg border border-border-subtle bg-bg-surface p-4 text-sm text-fg-secondary">{t("queue.empty")}</p>;

  return (
    <div className="overflow-hidden rounded-lg border border-border-subtle">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("operations.resultField.runId")}</TableHead>
            <TableHead>{t("operations.status")}</TableHead>
            <TableHead>{t("operations.trigger")}</TableHead>
            <TableHead>{t("operations.startedAt")}</TableHead>
            <TableHead className="text-right">{t("queue.metric.failed")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => (
            <TableRow
              key={run.id}
              className={selectedRunId === run.id ? "bg-brand-soft hover:bg-brand-soft" : "cursor-pointer bg-bg-elevated"}
              onClick={() => onSelect(run.id)}
            >
              <TableCell>
                <button
                  type="button"
                  className="font-semibold text-brand outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelect(run.id);
                  }}
                >
                  #{run.id}
                </button>
              </TableCell>
              <TableCell>
                <div className="inline-flex items-center gap-2">
                  <StatusDot status={statusDot(run.status)} />
                  <Badge tone={statusTone(run.status)}>{statusLabel(run.status)}</Badge>
                </div>
              </TableCell>
              <TableCell className="text-fg-secondary">{triggerLabel(run.trigger_type)}</TableCell>
              <TableCell className="whitespace-nowrap text-fg-secondary">{formatDateTime(run.started_at)}</TableCell>
              <TableCell className="text-right tabular-nums">{run.result?.tasks?.failed_count ?? "-"}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function RunDetailPanel({
  run,
  isLoading,
  error,
  pending,
  onRetry,
  statusLabel,
  errorLabel,
}: {
  run?: ArchiveRunDetail;
  isLoading: boolean;
  error: Error | null;
  pending: boolean;
  onRetry: (runId: number) => void;
  statusLabel: (status?: string | null) => string;
  errorLabel: (error?: string | null) => string;
}) {
  const { t } = useI18n();
  return (
    <Card className="min-h-[520px]">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>{t("queue.detail")}</CardTitle>
            <CardDescription>{run ? t("queue.run", { id: run.id }) : t("queue.selectRun")}</CardDescription>
          </div>
          {run ? <Badge tone={statusTone(run.status)}>{statusLabel(run.status)}</Badge> : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : error ? (
          <ErrorState title={t("common.apiUnavailable")} detail={String(error)} />
        ) : run ? (
          <>
            <RunSummary run={run} />
            <div className="max-h-[560px] space-y-2 overflow-auto pr-1">
              {run.items.map((item) => (
                <div key={item.id} className="rounded-lg border border-border-subtle bg-bg-surface p-3 transition duration-fast hover:border-border-strong">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="break-all text-sm font-semibold text-fg-primary">{item.tweet_id}</div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-fg-secondary">
                        <span>
                          {t("tweet.retryCount")}: <span className="tabular-nums">{item.retry_count}</span>
                        </span>
                        {item.last_attempt_at ? <span>{t("queue.lastAttempt")}: {formatDateTime(item.last_attempt_at)}</span> : null}
                        {item.next_attempt_at ? <span>{t("queue.nextAttempt")}: {formatDateTime(item.next_attempt_at)}</span> : null}
                      </div>
                    </div>
                    <Badge tone={statusTone(item.status)}>{statusLabel(item.status)}</Badge>
                  </div>
                  {item.error_category || item.error_message ? (
                    <div className="mt-2 rounded-md border border-danger/20 bg-danger/10 px-2 py-1 text-xs text-danger">
                      {errorLabel(item.error_category || item.error_message)}
                    </div>
                  ) : null}
                  {item.attempts?.length ? (
                    <div className="mt-3 space-y-1 text-xs text-fg-secondary">
                      <div className="font-semibold text-fg-primary">{t("queue.itemAttempts")}</div>
                      {item.attempts.map((attempt) => (
                        <div key={attempt.id} className="rounded-md bg-bg-elevated px-2 py-1">
                          {attempt.engine || "-"} · {statusLabel(attempt.status)} · {errorLabel(attempt.error_category || attempt.error_message)} ·{" "}
                          {formatDateTime(attempt.finished_at)}
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
            {hasFailure(run) ? (
              <Button type="button" variant="secondary" disabled={pending} onClick={() => onRetry(run.id)}>
                <RefreshCw className="h-4 w-4" />
                {t("queue.retryFailed")}
              </Button>
            ) : null}
          </>
        ) : (
          <p className="rounded-lg border border-border-subtle bg-bg-surface p-4 text-sm text-fg-secondary">{t("queue.selectRun")}</p>
        )}
      </CardContent>
    </Card>
  );
}

function InputPreview({ preview }: { preview: ReturnType<typeof parseUrlInput> }) {
  const { t } = useI18n();
  if (preview.totalLines === 0) return null;
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-surface p-3 text-sm">
      <div className="mb-2 font-semibold text-fg-primary">{t("queue.inputPreview")}</div>
      <div className="grid gap-2 sm:grid-cols-4">
        <Metric label={t("queue.totalLines")} value={preview.totalLines} />
        <Metric label={t("queue.validUrls")} value={preview.validCount} />
        <Metric label={t("queue.duplicateUrls")} value={preview.duplicateCount} />
        <Metric label={t("queue.invalidLines")} value={preview.invalidCount} />
      </div>
      {preview.invalid.length ? <LineList title={t("queue.invalidLineList")} rows={preview.invalid} /> : null}
      {preview.duplicates.length ? <LineList title={t("queue.duplicateLineList")} rows={preview.duplicates} /> : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between gap-3 rounded-md border border-border-subtle bg-bg-elevated px-3 py-2">
      <span className="text-fg-secondary">{label}</span>
      <span className="font-semibold tabular-nums text-fg-primary">{value}</span>
    </div>
  );
}

function LineList({ title, rows }: { title: string; rows: ParsedLine[] }) {
  return (
    <div className="mt-3 space-y-1">
      <div className="text-xs font-semibold text-danger">{title}</div>
      {rows.slice(0, 5).map((row) => (
        <div key={`${row.line}-${row.value}`} className="break-all text-xs text-fg-secondary">
          #{row.line}: {row.value}
        </div>
      ))}
    </div>
  );
}

function QueueTableSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 6 }).map((_, index) => (
        <Skeleton key={index} className="h-12" />
      ))}
    </div>
  );
}

function buildQueueModel(runs: ArchiveRun[]) {
  const activeRun = runs.find((run) => run.status === "running" || run.status === "queued") ?? runs[0];
  const runningCount = runs.filter((run) => run.status === "running" || run.status === "queued").length;
  const completedCount = runs.filter((run) => run.status === "completed" || run.status === "completed_with_failures").length;
  const failedCount = runs.filter((run) => run.status === "failed" || run.status === "completed_with_failures").length;
  const progress = activeRun ? progressForRun(activeRun) : 0;
  return {
    activeRun,
    latestRun: runs[0],
    runningCount,
    completedCount,
    failedCount,
    progress,
    sparkline: runs.slice(0, 12).reverse().map((run) => Math.max(1, progressForRun(run))),
  };
}

function progressForRun(run: ArchiveRun) {
  if (run.status === "completed") return 100;
  if (run.status === "completed_with_failures" || run.status === "failed") return 100;
  const tasks = run.result?.tasks;
  if (!tasks) return run.status === "running" ? 32 : 8;
  const total = tasks.queued_count + tasks.skipped_verified_count + tasks.linked_pending_count + tasks.verified_count + tasks.failed_count;
  if (!total) return run.status === "running" ? 32 : 8;
  const done = tasks.skipped_verified_count + tasks.linked_pending_count + tasks.verified_count + tasks.failed_count;
  return Math.round((done / total) * 100);
}

function statusDot(status?: string | null): "running" | "success" | "warning" | "danger" | "idle" {
  if (status === "running" || status === "queued" || status === "processing" || status === "downloading") return "running";
  if (status === "completed" || status === "verified" || status === "downloaded" || status === "skipped_verified" || status === "linked_pending") return "success";
  if (status === "completed_with_failures" || status === "failed_retryable") return "warning";
  if (status === "failed" || status === "failed_permanent") return "danger";
  return "idle";
}

function statusTone(status?: string | null): BadgeProps["tone"] {
  const dot = statusDot(status);
  if (dot === "running") return "default";
  if (dot === "success") return "success";
  if (dot === "warning") return "warning";
  if (dot === "danger") return "danger";
  return "secondary";
}

function parseUrlInput(value: string) {
  const seen = new Set<string>();
  const rows: ParsedLine[] = value
    .split(/\r?\n/)
    .map((line, index) => ({ line: index + 1, value: line.trim() }))
    .filter((line) => line.value && !line.value.startsWith("#"))
    .map((line) => {
      const tweetId = extractTweetId(line.value);
      if (!tweetId) return { ...line, status: "invalid" as const };
      if (seen.has(tweetId)) return { ...line, url: line.value, tweetId, status: "duplicate" as const };
      seen.add(tweetId);
      return { ...line, url: line.value, tweetId, status: "valid" as const };
    });
  const invalid = rows.filter((row) => row.status === "invalid");
  const duplicates = rows.filter((row) => row.status === "duplicate");
  return {
    rows,
    invalid,
    duplicates,
    totalLines: rows.length,
    validCount: rows.filter((row) => row.status === "valid").length,
    duplicateCount: duplicates.length,
    invalidCount: invalid.length,
  };
}

function extractTweetId(url: string) {
  return url.match(/(?:twitter\.com|x\.com)\/[^/\s]+\/status\/(\d+)/i)?.[1] ?? null;
}

function parseFileToText(filename: string, text: string) {
  if (!filename.toLowerCase().endsWith(".jsonl")) return text;
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const record = JSON.parse(line) as { url?: string };
      if (!record.url) throw new Error("missing url");
      return record.url;
    })
    .join("\n");
}

function runQueryString(status: string, tweetId: string, failedOnly: boolean, limit: number, offset: number) {
  const search = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (status) search.set("run_status", status);
  if (tweetId.trim()) search.set("tweet_id", tweetId.trim());
  if (failedOnly) search.set("failed_only", "true");
  return search.toString();
}

function hasFailure(run: ArchiveRunDetail) {
  return run.items.some((item) => item.status === "failed_permanent");
}

function RunSummary({ run }: { run: ArchiveRunDetail }) {
  const { t } = useI18n();
  const tasks = run.result?.tasks;
  if (!tasks) return <Badge>{t("queue.legacy")}</Badge>;
  const metrics = [
    [t("queue.metric.queued"), tasks.queued_count],
    [t("queue.metric.skipped"), tasks.skipped_verified_count],
    [t("queue.metric.linked"), tasks.linked_pending_count],
    [t("queue.metric.verified"), tasks.verified_count],
    [t("queue.metric.failed"), tasks.failed_count],
  ];
  return (
    <div className="grid gap-2 rounded-lg border border-border-subtle bg-bg-surface p-3 sm:grid-cols-2">
      {metrics.map(([label, value]) => (
        <div className="flex justify-between gap-3 text-sm" key={label}>
          <span className="text-fg-secondary">{label}</span>
          <span className="font-semibold tabular-nums text-fg-primary">{value}</span>
        </div>
      ))}
    </div>
  );
}
