import * as React from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiGet, type ArchiveSource, type ArchiveSubmission, type DownloadPolicy, type OperationLogEntriesResponse } from "../../../lib/api";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Select } from "../../../components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../components/ui/tabs";
import { formatDateTime } from "../../../lib/utils";
import { SourceScanHistoryTab } from "./SourceScanHistoryTab";
import { SourceTweetsTab } from "./SourceTweetsTab";
import {
  formatElapsed,
  formatHistoryState,
  formatNextRange,
  formatRunRange,
  formatScanState,
  parseRecordUrls,
  scanStatusLabel,
  scanStatusTone,
  scanTriggerLabel,
  sourceStatusTone,
  type TFunction,
} from "../utils";

type DetailActions = {
  submitRecords: (input: { sourceId: number; records: Array<{ url: string }> }) => void;
  setStatus: (input: { sourceId: number; status: "active" | "paused" }) => void;
  scan: (input: { sourceId: number; limit: number; restart?: boolean }) => void;
  submitDiscovered: (input: { sourceId: number; limit?: number }) => void;
  startHistory: (input: { sourceId: number; limit: number; restart?: boolean }) => void;
  stopHistory: (sourceId: number) => void;
  pending: {
    submit: boolean;
    status: boolean;
    scan: boolean;
    submitDiscovered: boolean;
    history: boolean;
  };
  errors: {
    submit: unknown;
    status: unknown;
    scan: unknown;
    submitDiscovered: unknown;
    history: unknown;
  };
};

export function SourceDetailPanel({
  source,
  policy,
  now,
  detailUpdatedAt,
  feedback,
  scanFeedback,
  t,
  statusLabel,
  actions,
  onManualSubmitted,
}: {
  source?: ArchiveSource;
  policy?: DownloadPolicy;
  now: number;
  detailUpdatedAt: number;
  feedback: ArchiveSubmission | null;
  scanFeedback: Record<string, unknown> | null;
  t: TFunction;
  statusLabel: (status?: string | null) => string;
  actions: DetailActions;
  onManualSubmitted: () => void;
}) {
  const scanLimit = useNumberInput("20");
  const persistedScanLimit = source ? preferredScanLimit(source, policy) : 20;

  React.useEffect(() => {
    if (!source) return;
    scanLimit.set(String(persistedScanLimit));
  }, [source?.id, persistedScanLimit]);

  if (!source) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("sources.detail")}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-fg-secondary">{t("sources.select")}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>{source.label || source.author_username || t("sources.detail")}</CardTitle>
            <p className="mt-1 break-all text-sm text-fg-secondary">{source.source_url}</p>
          </div>
          <Badge tone={sourceStatusTone(source.status)}>{statusLabel(source.status)}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="overview">
          <TabsList className="flex-wrap">
            <TabsTrigger value="overview">{t("sources.detail")}</TabsTrigger>
            <TabsTrigger value="tweets">{t("sources.recentDiscovered")}</TabsTrigger>
            <TabsTrigger value="history">{t("sources.scanHistory")}</TabsTrigger>
            <TabsTrigger value="config">{t("sources.advancedActions")}</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="space-y-4">
            <OverviewTab
              source={source}
              policy={policy}
              now={now}
              detailUpdatedAt={detailUpdatedAt}
              scanLimit={scanLimit.clamped(200)}
              t={t}
            />
            <PrimaryActions source={source} t={t} actions={actions} scanLimit={scanLimit} />
            <DownloadActions source={source} t={t} actions={actions} feedback={feedback} />
          </TabsContent>
          <TabsContent value="tweets">
            <SourceTweetsTab source={source} t={t} statusLabel={statusLabel} />
          </TabsContent>
          <TabsContent value="history">
            <SourceScanHistoryTab source={source} now={now} t={t} />
          </TabsContent>
          <TabsContent value="config" className="space-y-4">
            <AdvancedActions source={source} t={t} actions={actions} scanFeedback={scanFeedback} scanLimit={scanLimit} />
            <ManualImport
              source={source}
              t={t}
              actions={actions}
              feedback={feedback}
              onSubmitted={onManualSubmitted}
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

function OverviewTab({
  source,
  policy,
  now,
  detailUpdatedAt,
  scanLimit,
  t,
}: {
  source: ArchiveSource;
  policy?: DownloadPolicy;
  now: number;
  detailUpdatedAt: number;
  scanLimit: number;
  t: TFunction;
}) {
  const activeScanRun = source.scan_runs?.find((run) => run.status === "running");
  const historyEnabled = Boolean(source.cursor_state?.automation_enabled);

  return (
    <>
      {policy ? <PolicySummary policy={policy} t={t} /> : null}
      {activeScanRun ? <ActiveScan run={activeScanRun} source={source} now={now} t={t} /> : null}
      <div className="grid gap-2 rounded-lg bg-bg-muted p-3 text-sm">
        <DetailRow label={t("sources.url")} value={source.source_url || "-"} breakAll />
        <DetailRow label={t("sources.updated")} value={formatDateTime(source.updated_at)} />
        <DetailRow label={t("sources.lastSeen")} value={source.last_seen_tweet_id || "-"} />
        <DetailRow label={t("sources.discoveredTweets")} value={source.discovered_tweet_count ?? source.discovered_count ?? 0} />
        <DetailRow label={t("sources.discoveredMedia")} value={source.discovered_media_count ?? 0} />
        <DetailRow label={t("sources.unsubmitted")} value={source.unsubmitted_tweet_count ?? 0} />
        <DetailRow label={t("sources.nextRange")} value={formatNextRange(source.cursor_state, scanLimit)} />
        {source.cursor_state?.last_range_start ? (
          <DetailRow label={t("sources.lastRange")} value={`${source.cursor_state.last_range_start}-${source.cursor_state.last_range_end}`} />
        ) : null}
        <DetailRow label={t("sources.scanState")} value={formatScanState(source.cursor_state, t)} />
        <DetailRow label={t("sources.historyState")} value={formatHistoryState(source, t)} />
        {historyEnabled && source.next_scan_at ? <DetailRow label={t("sources.nextScheduled")} value={formatDateTime(source.next_scan_at)} /> : null}
        <DetailRow label={t("sources.detailRefreshed")} value={formatDateTime(new Date(detailUpdatedAt || now).toISOString())} />
      </div>
      <ScanPipelineNote source={source} policy={policy} t={t} />
      <div className="grid gap-2 rounded-lg border border-border-subtle p-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <Metric label={t("sources.scanBatches")} value={source.scan_summary?.batch_count ?? 0} />
        <Metric label={t("sources.scanAdded")} value={source.scan_summary?.added_tweet_count ?? 0} />
        <Metric label={t("sources.lastScanSuccess")} value={formatDateTime(source.scan_summary?.last_success_at)} />
        <Metric label={t("sources.lastScanError")} value={formatDateTime(source.scan_summary?.last_error_at)} />
      </div>
    </>
  );
}

function PolicySummary({ policy, t }: { policy: DownloadPolicy; t: TFunction }) {
  return (
    <div className="grid gap-2 rounded-lg border border-border-subtle p-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
      <Metric label={t("sources.policyBatch")} value={policy.queue_batch_size} />
      <Metric label={t("sources.policyDelay")} value={`${policy.downloader_sleep_min_seconds}-${policy.downloader_sleep_max_seconds}s`} />
      <Metric label={t("sources.policyEngine")} value={policy.default_download_engine} />
      <Metric
        label={t("sources.policyScan")}
        value={`${policy.source_scan_batch_size} / ${policy.source_scan_sleep_min_seconds}-${policy.source_scan_sleep_max_seconds}s`}
      />
    </div>
  );
}

function ActiveScan({
  run,
  source,
  now,
  t,
}: {
  run: NonNullable<ArchiveSource["scan_runs"]>[number];
  source: ArchiveSource;
  now: number;
  t: TFunction;
}) {
  const cursorBefore = run.cursor_before ?? source.cursor_state ?? {};
  const scanUrl = String(cursorBefore.last_scan_url || source.source_url || "-");
  const hasCursor = Boolean(cursorBefore.extractor_cursor);
  const sourcePaused = source.status === "paused" || source.cursor_state?.automation_state === "paused";

  return (
    <div className="rounded-lg border border-brand/30 bg-brand-soft p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold text-fg-primary">{t("sources.activeScanTitle")}</div>
        <Badge tone={scanStatusTone(run.status)}>{scanStatusLabel(run.status, t)}</Badge>
      </div>
      <div className="mt-2 grid gap-2 text-xs text-fg-secondary sm:grid-cols-2">
        <span>
          {t("sources.scanEngine")}: gallery-dl
        </span>
        <span>
          {t("sources.scanPhase")}: {run.progress_message || t("sources.scanPhaseCollecting")}
        </span>
        <span>
          {t("sources.scanRange")}: {formatRunRange(run.range_start, run.range_end)}
        </span>
        <span>
          {t("sources.scanRequested")}: {run.requested_limit ?? "-"}
        </span>
        <span>
          {t("sources.activeScanElapsed")}: {formatElapsed(run.started_at, now)}
        </span>
        <span>
          {t("sources.activeScanStarted")}: {formatDateTime(run.started_at)}
        </span>
        <span>
          {t("sources.activeScanMode")}: {scanTriggerLabel(run.trigger_type, t)}
        </span>
        <span>
          {t("sources.scanCursor")}: {hasCursor ? t("sources.scanCursorResume") : t("sources.scanCursorFirstPage")}
        </span>
      </div>
      <div className="mt-2 break-all rounded-md bg-bg-elevated/70 px-2 py-1 text-xs text-fg-secondary">
        {t("sources.scanTarget")}: {scanUrl}
      </div>
      {run.last_log_at ? (
        <p className="mt-2 text-xs text-fg-secondary">
          {t("sources.lastLogAt")}: {formatDateTime(run.last_log_at)}
        </p>
      ) : null}
      <ScanLogBox run={run} t={t} />
      <p className="mt-2 text-xs text-fg-secondary">{t("sources.activeScanHint")}</p>
      {sourcePaused ? <p className="mt-1 text-xs text-warning">{t("sources.activeScanPauseHint")}</p> : null}
    </div>
  );
}

function ScanLogBox({ run, t }: { run: NonNullable<ArchiveSource["scan_runs"]>[number]; t: TFunction }) {
  const [level, setLevel] = React.useState("");
  const levelQuery = level ? `&level=${encodeURIComponent(level)}` : "";
  const streamId = run.log_stream_id;
  const query = useQuery({
    queryKey: ["operation-log", streamId, level],
    queryFn: () => apiGet<OperationLogEntriesResponse>(`/api/v1/log-streams/${streamId}?limit=200${levelQuery}`),
    enabled: Boolean(streamId),
    refetchInterval: run.status === "running" ? 3000 : false,
  });
  const entries = query.data?.entries ?? [];
  const log = entries.map(formatLogEntry).join("\n");
  const available = query.data?.available ?? true;
  const status = query.isLoading
    ? t("sources.scanLogLoading")
    : !streamId
      ? t("sources.scanLogWaiting")
      : !available
        ? t("sources.scanLogMissing")
        : entries.length
          ? t("sources.scanLogLive")
          : t("sources.scanLogEmpty");

  return (
    <div className="mt-3 overflow-hidden rounded-md border border-border-subtle bg-bg-elevated">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-3 py-2 text-xs">
        <span className="font-semibold text-fg-primary">{t("sources.scanLog")}</span>
        <div className="flex items-center gap-2">
          <Select className="h-7 w-28 text-xs" value={level} onChange={(event) => setLevel(event.target.value)}>
            <option value="">{t("logs.levelAll")}</option>
            <option value="debug">debug</option>
            <option value="info">info</option>
            <option value="warning">warning</option>
            <option value="error">error</option>
            <option value="critical">critical</option>
          </Select>
          <span className="text-fg-secondary">{status}</span>
        </div>
      </div>
      {run.log_path ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-3 py-1 text-xs text-fg-secondary">
          <span className="break-all">{run.log_path}</span>
          {streamId ? (
            <Link to={`/operations?tab=logs&streamId=${streamId}`} className="font-semibold text-brand hover:text-brand-hover">
              {t("sources.openLogStream")}
            </Link>
          ) : null}
        </div>
      ) : null}
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-xs leading-relaxed text-fg-secondary">
        {query.error
          ? String(query.error)
          : log || (streamId ? (available ? t("sources.scanLogEmpty") : t("sources.scanLogUnavailable")) : t("sources.scanLogWaiting"))}
      </pre>
      {query.data?.is_truncated ? <div className="border-t border-warning/20 px-3 py-2 text-xs text-warning">{t("logs.truncated")}</div> : null}
    </div>
  );
}

function formatLogEntry(entry: OperationLogEntriesResponse["entries"][number]) {
  const time = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : "--:--:--";
  const message = entry.raw || entry.message;
  const stack = typeof entry.exception?.stack === "string" ? `\n${entry.exception.stack}` : "";
  return `${time} [${entry.level}] ${entry.component}: ${message}${stack}`;
}

function ScanPipelineNote({ source, policy, t }: { source: ArchiveSource; policy?: DownloadPolicy; t: TFunction }) {
  const historyEnabled = Boolean(source.cursor_state?.automation_enabled);
  if (!historyEnabled && !source.scan_runs?.length) return null;
  const scanDelay = policy
    ? `${policy.source_scan_sleep_min_seconds}-${policy.source_scan_sleep_max_seconds}s`
    : t("common.none");

  return (
    <div className="rounded-lg border border-border-subtle bg-bg-surface p-3 text-xs text-fg-secondary">
      <div className="font-semibold text-fg-primary">{t("sources.scanPipelineTitle")}</div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <span>{t("sources.scanPipelineStep1")}</span>
        <span>{t("sources.scanPipelineStep2")}</span>
        <span>{t("sources.scanPipelineStep3")}</span>
        <span>{t("sources.scanPipelineStep4", { delay: scanDelay })}</span>
      </div>
      <p className="mt-2">{t("sources.pauseSemantics")}</p>
    </div>
  );
}

function PrimaryActions({
  source,
  t,
  actions,
  scanLimit,
}: {
  source: ArchiveSource;
  t: TFunction;
  actions: DetailActions;
  scanLimit: NumberInputState;
}) {
  const historyEnabled = Boolean(source.cursor_state?.automation_enabled);
  const canStart = !actions.pending.history && !(historyEnabled && source.status === "active");

  return (
    <ActionBlock title={t("sources.primaryActions")} hint={t("sources.historyHint")}>
      <Input className="w-28" type="number" min={1} max={200} value={scanLimit.value} onChange={scanLimit.onChange} />
      <Button
        type="button"
        disabled={!canStart}
        onClick={() => actions.startHistory({ sourceId: source.id, limit: scanLimit.clamped(200) })}
      >
        {historyEnabled ? t("sources.historyContinue") : t("sources.historyStart")}
      </Button>
      <Button
        type="button"
        variant="secondary"
        disabled={actions.pending.status || source.status === "paused" || !historyEnabled}
        onClick={() => actions.setStatus({ sourceId: source.id, status: "paused" })}
      >
        {t("sources.pauseHistory")}
      </Button>
      {source.status === "paused" ? (
        <Button
          type="button"
          variant="secondary"
          disabled={actions.pending.status}
          onClick={() => actions.setStatus({ sourceId: source.id, status: "active" })}
        >
          {t("sources.resume")}
        </Button>
      ) : null}
      {actions.errors.history || actions.errors.status ? <ErrorLine error={actions.errors.history || actions.errors.status} /> : null}
    </ActionBlock>
  );
}

function DownloadActions({
  source,
  t,
  actions,
  feedback,
}: {
  source: ArchiveSource;
  t: TFunction;
  actions: DetailActions;
  feedback: ArchiveSubmission | null;
}) {
  const submitLimit = useNumberInput("20");
  const canSubmit = (source.unsubmitted_tweet_count || 0) > 0 && !actions.pending.submitDiscovered;

  return (
    <ActionBlock title={t("sources.downloadActions")} hint={t("sources.downloadHint")}>
      <Input className="w-28" type="number" min={1} max={500} value={submitLimit.value} onChange={submitLimit.onChange} />
      <Button
        type="button"
        variant="secondary"
        disabled={!canSubmit}
        onClick={() => actions.submitDiscovered({ sourceId: source.id, limit: submitLimit.clamped(500) })}
      >
        {t("sources.submitUnqueued")}
      </Button>
      {actions.errors.submitDiscovered ? <ErrorLine error={actions.errors.submitDiscovered} /> : null}
      {feedback ? <FeedbackLine feedback={feedback} t={t} /> : null}
    </ActionBlock>
  );
}

function AdvancedActions({
  source,
  t,
  actions,
  scanFeedback,
  scanLimit,
}: {
  source: ArchiveSource;
  t: TFunction;
  actions: DetailActions;
  scanFeedback: Record<string, unknown> | null;
  scanLimit: NumberInputState;
}) {
  const historyEnabled = Boolean(source.cursor_state?.automation_enabled);
  const canScan = source.status !== "paused" && !actions.pending.scan;

  return (
    <ActionBlock title={t("sources.advancedActions")} hint={t("sources.advancedHint")}>
      <Input className="w-28" type="number" min={1} max={200} value={scanLimit.value} onChange={scanLimit.onChange} />
      <Button type="button" variant="secondary" disabled={!canScan} onClick={() => actions.scan({ sourceId: source.id, limit: scanLimit.clamped(200) })}>
        {t("sources.scanNext")}
      </Button>
      <Button
        type="button"
        variant="secondary"
        disabled={!canScan}
        onClick={() => actions.scan({ sourceId: source.id, limit: scanLimit.clamped(200), restart: true })}
      >
        {t("sources.scanLatest")}
      </Button>
      <Button
        type="button"
        variant="secondary"
        disabled={!historyEnabled || actions.pending.history}
        onClick={() => actions.stopHistory(source.id)}
      >
        {t("sources.historyStop")}
      </Button>
      {actions.errors.scan ? <ErrorLine error={actions.errors.scan} /> : null}
      {scanFeedback ? (
        <p className="basis-full rounded-lg bg-bg-muted p-3 text-sm text-fg-primary">
          {t("sources.scanFeedback", {
            discovered: Number(scanFeedback.discovered_count || 0),
            fresh: Number(scanFeedback.new_discovered_count || 0),
            duplicate: Number(scanFeedback.duplicate_count || 0),
            state: scanFeedback.completed ? t("sources.scanCompleted") : "",
          })}
        </p>
      ) : null}
    </ActionBlock>
  );
}

function ManualImport({
  source,
  t,
  actions,
  feedback,
  onSubmitted,
}: {
  source: ArchiveSource;
  t: TFunction;
  actions: DetailActions;
  feedback: ArchiveSubmission | null;
  onSubmitted: () => void;
}) {
  const recordUrls = useTextInput("");
  const records = parseRecordUrls(recordUrls.value);
  const canSubmit = records.length > 0 && !actions.pending.submit;

  React.useEffect(() => {
    if (feedback) recordUrls.set("");
  }, [feedback?.run_id]);

  return (
    <ActionBlock title={t("sources.manualImport")}>
      <textarea
        className="min-h-24 w-full resize-y rounded-md border border-border-strong bg-bg-elevated px-3 py-2 text-sm text-fg-primary outline-none transition duration-fast placeholder:text-fg-tertiary focus-visible:ring-2 focus-visible:ring-brand/50"
        placeholder="https://x.com/user/status/123"
        value={recordUrls.value}
        onChange={recordUrls.onChange}
      />
      <Button
        type="button"
        disabled={!canSubmit}
        onClick={() => {
          actions.submitRecords({ sourceId: source.id, records });
          onSubmitted();
        }}
      >
        {t("sources.submitDiscovered")}
      </Button>
      {actions.errors.submit ? <ErrorLine error={actions.errors.submit} /> : null}
      {feedback ? <FeedbackLine feedback={feedback} t={t} /> : null}
    </ActionBlock>
  );
}

function ActionBlock({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-lg border border-border-subtle p-3">
      <div className="text-sm font-semibold text-fg-primary">{title}</div>
      <div className="flex flex-wrap gap-2">{children}</div>
      {hint ? <p className="text-xs text-fg-secondary">{hint}</p> : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs text-fg-secondary">{label}</div>
      <div className="text-fg-primary">{value}</div>
    </div>
  );
}

function DetailRow({ label, value, breakAll }: { label: string; value: React.ReactNode; breakAll?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-fg-secondary">{label}</span>
      <span className={breakAll ? "break-all text-right" : "text-right"}>{value}</span>
    </div>
  );
}

function ErrorLine({ error }: { error: unknown }) {
  return <p className="basis-full text-sm text-danger">{String(error)}</p>;
}

function FeedbackLine({ feedback, t }: { feedback: ArchiveSubmission; t: TFunction }) {
  return (
    <p className="basis-full rounded-lg bg-bg-muted p-3 text-sm text-fg-primary">
      {t("sources.submitFeedback", {
        runId: feedback.run_id,
        queued: feedback.tasks.queued_count,
        skipped: feedback.tasks.skipped_verified_count,
        linked: feedback.tasks.linked_pending_count,
      })}
    </p>
  );
}

function useNumberInput(initial: string) {
  const input = useTextInput(initial);
  return {
    value: input.value,
    set: input.set,
    onChange: input.onChange,
    clamped: (max: number) => Math.max(1, Math.min(max, Number(input.value) || 20)),
  };
}

type NumberInputState = ReturnType<typeof useNumberInput>;

function useTextInput(initial: string) {
  const [value, setValue] = React.useState(initial);
  return {
    value,
    set: setValue,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setValue(event.target.value),
  };
}

function preferredScanLimit(source: ArchiveSource, policy?: DownloadPolicy) {
  const candidates = [
    source.cursor_state?.automation_limit,
    source.cursor_state?.last_limit,
    source.scan_runs?.[0]?.requested_limit,
    policy?.source_scan_batch_size,
    20,
  ];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value >= 1) return Math.min(200, Math.floor(value));
  }
  return 20;
}
