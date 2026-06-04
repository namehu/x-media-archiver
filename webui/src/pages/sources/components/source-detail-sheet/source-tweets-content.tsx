import * as React from "react";
import { ChevronDown } from "lucide-react";
import type { ArchiveSourceDetail, SourceDiscoveryPageResponse, SourceScanRun } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { scanStatusLabel, scanTriggerLabel } from "@/lib/formatters";
import { cn, formatDateTime } from "@/lib/utils";
import { formatElapsed, formatRunRange, scanStatusTone } from "../../utils";
import { SourceTweetsTab } from "../source-tweets-tab";
import { ScanActions, type DetailActions } from "./scan-actions";
import type { NumberInputState } from "./use-number-input";

export function SourceTweetsContent({
  source,
  actions,
  scanFeedback,
  scanLimit,
  onOpenLog,
  data,
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
  scanLimit: NumberInputState;
  onOpenLog: (run: SourceScanRun) => void;
  data?: SourceDiscoveryPageResponse;
  isLoading: boolean;
  error: unknown;
  offset: number;
  onOffsetChange: (offset: number) => void;
  statusLabel: (status?: string | null) => string;
  now: number;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="shrink-0 space-y-4">
        <ScanActions
          source={source}
          actions={actions}
          scanFeedback={scanFeedback}
          scanLimit={scanLimit}
          onOpenLog={onOpenLog}
        />
        {source.active_scan_run ? <ActiveScan run={source.active_scan_run} source={source} now={now} /> : null}
      </div>
      <div className="min-h-0 flex-1">
        <SourceTweetsTab
          data={data}
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
