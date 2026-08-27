import * as React from "react";
import { ChevronDown } from "lucide-react";
import type { ArchiveSourceDetail, SourceDiscoveryPageResponse, SourceDownloadSummary, SourceScanRun } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { getDebugRedactProps, useDebugRedactionEnabled } from "@/lib/debug-redaction";
import { scanStatusLabel, scanTriggerLabel } from "@/lib/formatters";
import { useRuntimeSource } from "@/lib/runtime-provider";
import { cn, formatDateTime } from "@/lib/utils";
import { formatElapsed, formatRunRange, scanStatusTone } from "../../utils";
import { SourceTweetsTab } from "../source-tweets-tab";
import { ScanActions, type DetailActions } from "./scan-actions";
import { ActionBlock } from "./action-block";
import type { DownloadSubmitInput, TweetFilters } from "../source-tweet-filters";

type DownloadFollowMode = "following" | "paused";

export function SourceOverviewContent({
  source,
  actions,
  scanFeedback,
  scanLimit,
  hasDownloadQueueWork,
  onOpenLog,
  downloads,
  statusLabel,
  now,
  readonly = false,
}: {
  source: ArchiveSourceDetail;
  actions: DetailActions;
  scanFeedback: Record<string, unknown> | null;
  scanLimit: number;
  hasDownloadQueueWork: boolean;
  onOpenLog: (run: SourceScanRun) => void;
  downloads?: SourceDownloadSummary;
  statusLabel: (status?: string | null) => string;
  now: number;
  readonly?: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="grid overflow-hidden rounded-xl border border-border-subtle bg-bg-surface sm:grid-cols-2 xl:grid-cols-4">
        <OverviewMetric label="已发现 Tweet" value={source.discovered_tweet_count ?? source.discovered_count ?? 0} />
        <OverviewMetric label="媒体预估" value={source.discovered_media_count ?? 0} />
        <OverviewMetric label="待提交下载" value={source.unsubmitted_tweet_count ?? 0} tone={(source.unsubmitted_tweet_count ?? 0) > 0 ? "warning" : undefined} />
        <OverviewMetric label="扫描批次" value={source.scan_summary?.batch_count ?? source.scan_batch_count ?? 0} />
      </div>

      {readonly ? (
        <Alert>
          <AlertTitle>此来源处于只读状态</AlertTitle>
          <AlertDescription>发现记录、下载状态和扫描历史仍然保留；重新新增相同 URL 可以恢复来源。</AlertDescription>
        </Alert>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          <ScanActions
            source={source}
            actions={actions}
            scanFeedback={scanFeedback}
            scanLimit={scanLimit}
            hasDownloadQueueWork={hasDownloadQueueWork}
            onOpenLog={onOpenLog}
          />
          <SourceDownloadPanel
            sourceId={source.id}
            downloads={downloads}
            actions={actions}
            statusLabel={statusLabel}
            onResumeDownload={(runId) => void actions.resumeDownload(runId).catch(() => undefined)}
          />
        </div>
      )}

      {source.active_scan_run ? <ActiveScan run={source.active_scan_run} source={source} now={now} /> : null}

      {source.error_message ? (
        <Alert variant="destructive">
          <AlertTitle>最近一次来源操作失败</AlertTitle>
          <AlertDescription>{source.error_message}</AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

function OverviewMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warning";
}) {
  return (
    <div className="border-b border-border-subtle px-4 py-4 last:border-b-0 sm:border-b-0 sm:border-r sm:[&:nth-child(2)]:border-r-0 xl:[&:nth-child(2)]:border-r xl:last:border-r-0">
      <p className="text-xs font-medium text-fg-secondary">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums text-fg-primary", tone === "warning" && "text-warning")}>
        {value}
      </p>
    </div>
  );
}

export function SourceTweetsContent({
  source,
  actions,
  pages,
  downloads,
  isLoading,
  error,
  isFetchingNextPage,
  hasNextPage,
  onLoadMore,
  statusLabel,
  filters,
  onFiltersChange,
  readonly = false,
}: {
  source: ArchiveSourceDetail;
  actions: DetailActions;
  pages: SourceDiscoveryPageResponse[];
  downloads?: SourceDownloadSummary;
  isLoading: boolean;
  error: unknown;
  isFetchingNextPage: boolean;
  hasNextPage: boolean | undefined;
  onLoadMore: () => void;
  statusLabel: (status?: string | null) => string;
  filters: TweetFilters;
  onFiltersChange: (filters: TweetFilters) => void;
  readonly?: boolean;
}) {
  const [followRunId, setFollowRunId] = React.useState<number | null>(null);
  const [followMode, setFollowMode] = React.useState<DownloadFollowMode>("following");
  const [frontierTweetId, setFrontierTweetId] = React.useState<string | null>(null);

  React.useEffect(() => {
    setFollowRunId(null);
    setFollowMode("following");
    setFrontierTweetId(null);
  }, [source.id]);

  React.useEffect(() => {
    if (!followRunId || !downloads) return;
    const trackedRun = downloads.recent_runs.find((run) => run.id === followRunId);
    if (trackedRun && !["queued", "running", "blocked", "paused"].includes(trackedRun.status)) {
      setFollowRunId(null);
      setFollowMode("following");
      setFrontierTweetId(null);
    }
  }, [downloads, followRunId]);

  const submitDownloadAndFollow = React.useCallback(
    (input: DownloadSubmitInput) => {
      void actions
        .submitDownload(input)
        .then((result) => {
          if (result.run_id) {
            setFollowRunId(result.run_id);
            setFollowMode("following");
            setFrontierTweetId(null);
          }
        })
        .catch(() => undefined);
    },
    [actions],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border-subtle bg-bg-surface">
      {readonly ? (
        <Alert className="mb-4 shrink-0">
          <AlertTitle>已删除来源只读查看</AlertTitle>
          <AlertDescription>可以查看发现记录和下载状态，不能继续提交下载。</AlertDescription>
        </Alert>
      ) : null}
      <div className="min-h-0 flex-1">
        <SourceTweetsTab
          pages={pages}
          downloads={downloads}
          sourceId={source.id}
          actions={actions}
          isLoading={isLoading}
          error={error}
          isFetchingNextPage={isFetchingNextPage}
          hasNextPage={hasNextPage}
          onLoadMore={onLoadMore}
          statusLabel={statusLabel}
          followRunId={followRunId}
          followMode={followMode}
          frontierTweetId={frontierTweetId}
          onFollowRun={(runId) => {
            setFollowRunId(runId);
            setFollowMode("following");
          }}
          onFollowModeChange={setFollowMode}
          onFrontierTweetChange={setFrontierTweetId}
          onSubmitDownload={submitDownloadAndFollow}
          filters={filters}
          onFiltersChange={onFiltersChange}
          readonly={readonly}
        />
      </div>
    </div>
  );
}

function SourceDownloadPanel({
  sourceId,
  downloads,
  actions,
  statusLabel,
  onResumeDownload,
}: {
  sourceId: number;
  downloads?: SourceDownloadSummary;
  actions: DetailActions;
  statusLabel: (status?: string | null) => string;
  onResumeDownload: (runId: number) => void;
}) {
  const debugRedactionEnabled = useDebugRedactionEnabled();
  const runtimeSource = useRuntimeSource(sourceId);
  const active =
    downloads?.active_run ??
    (runtimeSource.activeRunId
      ? ({
          id: runtimeSource.activeRunId,
          status: runtimeSource.activeRunStatus || "running",
          items: runtimeSource.activeItems,
        } as unknown as SourceDownloadSummary["active_run"])
      : null);
  const paused = downloads?.paused_runs ?? [];
  const blocked = downloads?.blocked_runs ?? [];
  const runningItem =
    runtimeSource.currentItem ??
    ((runtimeSource.currentTweetId ?? downloads?.current_tweet_id)
      ? active?.items.find((item) => item.tweet_id === (runtimeSource.currentTweetId ?? downloads?.current_tweet_id))
      : undefined) ?? active?.items.find((item) => item.status === "processing");
  const counts = downloads?.active_counts;
  const waitingCount = (counts?.pending_count ?? 0) + (counts?.blocked_count ?? 0);
  const speedBps = runtimeSource.speedBps ?? downloads?.speed_bps;
  const downloadedBytes = runtimeSource.downloadedBytes || downloads?.downloaded_bytes;

  return (
    <ActionBlock title="下载工作台" contentClassName="flex flex-1 flex-col justify-between gap-3 text-sm">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {active ? <Badge>{statusLabel(active.status)}</Badge> : null}
          {paused.length ? <Badge tone="warning">暂停 {paused.length}</Badge> : null}
          {blocked.length ? <Badge tone="secondary">等待 {blocked.length}</Badge> : null}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-fg-secondary">
          <span className="flex items-center gap-1.5">
            <span
              className={cn("size-1.5 rounded-full", active ? "animate-pulse bg-brand" : "bg-fg-tertiary")}
            ></span>
            {active ? `Run #${active.id}` : "空闲"}
          </span>
          {active ? (
            <>
              <span>处理 {counts?.settled_count ?? 0}/{counts?.total_count ?? 0}</span>
              <span>处理中 {counts?.processing_count ?? 0}</span>
              <span>等待 {waitingCount}</span>
              <span>重试 {counts?.failed_retryable_count ?? 0}</span>
              <span>失败 {counts?.failed_permanent_count ?? 0}</span>
            </>
          ) : null}
          {speedBps ? <span>{formatBytes(speedBps)}/s</span> : null}
          {downloadedBytes ? <span>{formatBytes(downloadedBytes)}</span> : null}
        </div>
        {runningItem ? (
          <p
            data-testid="download-current-item"
            className="mt-2 truncate text-xs text-fg-secondary"
            {...getDebugRedactProps(debugRedactionEnabled)}
          >
            <span className="font-mono">{runningItem.tweet_id}</span>:{" "}
            {runningItem.progress_message || "下载器处理中"}
          </p>
        ) : null}
        {paused.length ? (
          <p className="mt-2 text-xs text-warning">继续下载只会恢复暂停 Run，新发现的推文需手动点击下载。</p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        {active?.status === "running" || active?.status === "queued" ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={actions.pending.download}
            onClick={() => actions.pauseDownload(active.id)}
          >
            暂停下载
          </Button>
        ) : null}
        {paused[0] ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={actions.pending.download}
            onClick={() => onResumeDownload(paused[0].id)}
          >
            继续下载
          </Button>
        ) : null}
        {active || paused[0] ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={actions.pending.download}
            onClick={() => actions.stopDownload((active ?? paused[0]).id)}
          >
            停止下载
          </Button>
        ) : null}
      </div>
      {actions.errors.download ? <p className="mt-2 text-xs text-danger">{String(actions.errors.download)}</p> : null}
    </ActionBlock>
  );
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

function ActiveScan({ run, source, now }: { run: SourceScanRun; source: ArchiveSourceDetail; now: number }) {
  const [open, setOpen] = React.useState(true);
  const cursorBefore = run.cursor_before ?? source.cursor_state ?? {};
  const hasCursor = Boolean(cursorBefore.extractor_cursor);
  const sourcePaused = source.status === "paused" || source.cursor_state?.automation_state === "paused";

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border border-brand/30 bg-brand-soft text-sm">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 p-3 text-left">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-semibold text-fg-primary">当前批次正在扫描</span>
          <Badge tone={scanStatusTone(run.status)}>{scanStatusLabel(run.status)}</Badge>
        </span>
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 text-fg-secondary transition-transform", open ? "rotate-180" : "")}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3">
        <div className="grid gap-2 text-xs text-fg-secondary sm:grid-cols-2">
          <span>扫描引擎: gallery-dl</span>
          <span>当前阶段: {run.progress_message || "等待 gallery-dl 枚举并返回"}</span>
          <span>范围: {formatRunRange(run.range_start, run.range_end)}</span>
          <span>请求 Tweet 数: {run.requested_limit ?? "-"}</span>
          <span>已运行: {formatElapsed(run.started_at, now)}</span>
          <span>开始时间: {formatDateTime(run.started_at)}</span>
          <span>触发方式: {scanTriggerLabel(run.trigger_type)}</span>
          <span>Cursor: {hasCursor ? "续扫上一页" : "从第一页开始"}</span>
        </div>
        <p className="mt-2 text-xs text-fg-secondary">
          扫描批次会等 gallery-dl 完整返回后一次性解析和落库；运行期间发现数保持 0 是正常现象。
        </p>
        {sourcePaused ? (
          <p className="mt-1 text-xs text-warning">
            已收到暂停状态；当前 gallery-dl 批次会先结束，系统不会再调度下一批。
          </p>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}
