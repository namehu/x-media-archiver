import * as React from "react";
import { ExternalLink } from "lucide-react";
import type { ArchiveSourceDetail, DownloadPolicy, SourceScanRun } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { scanStatusLabel, scanTriggerLabel } from "@/lib/formatters";
import { formatDateTime } from "@/lib/utils";
import {
  formatElapsed,
  formatHistoryState,
  formatNextRange,
  formatRunRange,
  formatScanState,
  scanStatusTone,
  sourceStatusTone,
} from "../../utils";
import { DetailRow } from "./detail-row";
import { Metric } from "./metric";

export function SourceHeader({
  source,
  policy,
  now,
  detailUpdatedAt,
  scanLimit,
  statusLabel,
}: {
  source: ArchiveSourceDetail;
  policy?: DownloadPolicy;
  now: number;
  detailUpdatedAt: number;
  scanLimit: number;
  statusLabel: (status?: string | null) => string;
}) {
  const activeScanRun = source.active_scan_run;
  const historyEnabled = Boolean(source.cursor_state?.automation_enabled);

  return (
    <div className="space-y-3">
      {activeScanRun ? <ActiveScan run={activeScanRun} source={source} now={now} /> : null}

      <div className="grid gap-2 rounded-lg bg-bg-muted p-3 text-sm">
        <DetailRow label="更新时间" value={formatDateTime(source.updated_at)} />
        <DetailRow label="下一批范围" value={formatNextRange(source.cursor_state, scanLimit)} />
        <DetailRow label="扫描状态" value={formatScanState(source.cursor_state)} />
        <DetailRow label="历史扫描任务" value={formatHistoryState(source)} />
        {historyEnabled && source.next_scan_at ? (
          <DetailRow label="下次自动扫描" value={formatDateTime(source.next_scan_at)} />
        ) : null}
        <DetailRow label="最近发现" value={source.last_seen_tweet_id || "-"} />
        {source.cursor_state?.last_range_start ? (
          <DetailRow
            label="上次扫描范围"
            value={`${source.cursor_state.last_range_start}-${source.cursor_state.last_range_end}`}
          />
        ) : null}
        <DetailRow label="详情刷新" value={formatDateTime(new Date(detailUpdatedAt || now).toISOString())} />
        <DetailRow label="累计新增 Tweet" value={source.scan_summary?.added_tweet_count ?? 0} />
        <DetailRow label="最近成功扫描" value={formatDateTime(source.scan_summary?.last_success_at)} />
        <DetailRow label="最近扫描错误" value={formatDateTime(source.scan_summary?.last_error_at)} />
      </div>

      <ScanPipelineNote />
    </div>
  );
}

function ActiveScan({ run, source, now }: { run: SourceScanRun; source: ArchiveSourceDetail; now: number }) {
  const cursorBefore = run.cursor_before ?? source.cursor_state ?? {};
  const hasCursor = Boolean(cursorBefore.extractor_cursor);
  const sourcePaused = source.status === "paused" || source.cursor_state?.automation_state === "paused";

  return (
    <div className="rounded-lg border border-brand/30 bg-brand-soft p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold text-fg-primary">当前批次正在扫描</div>
        <Badge tone={scanStatusTone(run.status)}>{scanStatusLabel(run.status)}</Badge>
      </div>
      <div className="mt-2 grid gap-2 text-xs text-fg-secondary sm:grid-cols-2">
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
    </div>
  );
}

function ScanPipelineNote() {
  return (
    <div className="grid gap-2 rounded-lg bg-bg-muted p-3 text-sm" text-fg-secondary>
      <h3>
        <span>批次底层流程</span>
      </h3>
      <div className="grid gap-2">
        <span>1. 读取来源 cursor 与下一批范围。</span>
        <span>2. 下载队列忙时先记录等待，不发起扫描。</span>
        <span>3. 下载队列空闲时调用 gallery-dl 枚举当前批次。</span>
        <span>4. 子进程完整返回后解析、去重、落库，再等待 延迟时间 后调度下一批。</span>
      </div>
      <p className="mt-2">
        暂停扫描只暂停后续自动调度，不强制终止已经启动的 gallery-dl 子进程；该批结束后会保留 cursor 与发现记录。
      </p>
    </div>
  );
}
