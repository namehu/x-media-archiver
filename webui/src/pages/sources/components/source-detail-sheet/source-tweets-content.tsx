import * as React from "react";
import { ChevronDown } from "lucide-react";
import type { ArchiveSourceDetail, SourceDiscoveryPageResponse, SourceDownloadSummary, SourceScanRun } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { scanStatusLabel, scanTriggerLabel } from "@/lib/formatters";
import { cn, formatDateTime } from "@/lib/utils";
import { formatElapsed, formatRunRange, scanStatusTone } from "../../utils";
import { SourceTweetsTab } from "../source-tweets-tab";
import { ScanActions, type DetailActions } from "./scan-actions";
import { ActionBlock } from "./action-block";

export function SourceTweetsContent({
  source,
  actions,
  scanFeedback,
  scanLimit,
  onOpenLog,
  data,
  downloads,
  isLoading,
  error,
  offset,
  onOffsetChange,
  statusLabel,
  now,
}: {
  source: ArchiveSourceDetail;
  actions: DetailActions;
  scanFeedback: Record<string, unknown> | null;
  scanLimit: number;
  onOpenLog: (run: SourceScanRun) => void;
  data?: SourceDiscoveryPageResponse;
  downloads?: SourceDownloadSummary;
  isLoading: boolean;
  error: unknown;
  offset: number;
  onOffsetChange: (offset: number) => void;
  statusLabel: (status?: string | null) => string;
  now: number;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="shrink-0">
        <div className="grid gap-4 lg:grid-cols-2">
          <ScanActions
            source={source}
            actions={actions}
            scanFeedback={scanFeedback}
            scanLimit={scanLimit}
            onOpenLog={onOpenLog}
          />
          <SourceDownloadPanel source={source} downloads={downloads} actions={actions} statusLabel={statusLabel} />
        </div>
        {source.active_scan_run ? (
          <div className="mt-4">
            <ActiveScan run={source.active_scan_run} source={source} now={now} />
          </div>
        ) : null}
      </div>
      <div className="min-h-0 flex-1">
        <SourceTweetsTab
          data={data}
          sourceId={source.id}
          actions={actions}
          isLoading={isLoading}
          error={error}
          offset={offset}
          onOffsetChange={onOffsetChange}
          statusLabel={statusLabel}
        />
      </div>
    </div>
  );
}

function SourceDownloadPanel({
  source,
  downloads,
  actions,
  statusLabel,
}: {
  source: ArchiveSourceDetail;
  downloads?: SourceDownloadSummary;
  actions: DetailActions;
  statusLabel: (status?: string | null) => string;
}) {
  const active = downloads?.active_run;
  const paused = downloads?.paused_runs ?? [];
  const blocked = downloads?.blocked_runs ?? [];
  const runningItem = active?.items.find((item) => item.status === "processing");
  const totalItems = active?.items.length ?? 0;
  const doneItems =
    active?.items.filter((item) =>
      ["verified", "skipped_verified", "failed_permanent", "cancelled"].includes(item.status),
    ).length ?? 0;
  const progress = totalItems ? Math.round((doneItems / totalItems) * 100) : 0;
  const hasUnsubmitted = (source.unsubmitted_tweet_count ?? 0) > 0;

  return (
    <ActionBlock title="下载工作台" contentClassName="flex flex-1 flex-col justify-between gap-3 text-sm">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          {active ? <Badge>{statusLabel(active.status)}</Badge> : null}
          {paused.length ? <Badge tone="warning">暂停 {paused.length}</Badge> : null}
          {blocked.length ? <Badge tone="secondary">等待 {blocked.length}</Badge> : null}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-fg-secondary">
          <span className="flex items-center gap-1.5">
            <span
              className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-brand animate-pulse" : "bg-fg-tertiary")}
            ></span>
            {active ? `Run #${active.id}` : "空闲"}
          </span>
          <span>{formatBytes(downloads?.speed_bps)}/s</span>
          <span>
            进度: {progress}% ({doneItems}/{totalItems})
          </span>
          <span>等待: {(downloads?.pending_count ?? 0) + (downloads?.blocked_count ?? 0)}</span>
          <span>失败: {downloads?.failed_count ?? 0}</span>
        </div>
        {runningItem ? (
          <p className="mt-2 truncate text-xs text-fg-secondary">
            <span className="font-mono">{runningItem.tweet_id}</span>: {runningItem.progress_message || "下载器处理中"}
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
            onClick={() => actions.resumeDownload(paused[0].id)}
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
        <Button
          type="button"
          size="sm"
          disabled={!hasUnsubmitted || actions.pending.download}
          onClick={() => actions.submitDownload({ sourceId: source.id, scope: "all_unsubmitted" })}
        >
          下载新发现
        </Button>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={actions.pending.download}
          onClick={() => actions.submitDownload({ sourceId: source.id, scope: "failed" })}
        >
          重试失败
        </Button>
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
