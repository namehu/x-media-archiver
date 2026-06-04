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
  const [showAllDetails, setShowAllDetails] = React.useState(false);

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <Badge tone={sourceStatusTone(source.status)}>{statusLabel(source.status)}</Badge>
          <div className="min-w-0">
            <h2 className="text-xl font-semibold text-fg-primary">
              {source.label || source.author_username || "来源详情"}
            </h2>
            {source.source_url ? (
              <a
                className="mt-0.5 inline-flex min-w-0 items-center gap-1 break-all text-sm text-brand hover:text-brand-hover"
                href={source.source_url}
                target="_blank"
                rel="noreferrer"
              >
                <span className="break-all">{source.source_url}</span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0" />
              </a>
            ) : (
              <p className="mt-0.5 text-sm text-fg-secondary">无</p>
            )}
          </div>
        </div>
        <button
          type="button"
          className="shrink-0 rounded-md px-2 py-1 text-xs font-semibold text-brand hover:bg-bg-muted hover:text-brand-hover"
          onClick={() => setShowAllDetails((v) => !v)}
        >
          {showAllDetails ? "收起来源信息" : "展开更多来源信息"}
        </button>
      </div>

      {activeScanRun ? <ActiveScan run={activeScanRun} source={source} now={now} /> : null}

      {showAllDetails ? (
        <div className="grid gap-2 rounded-lg bg-bg-muted p-3 text-sm">
          <>
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
            {policy ? <PolicySummary policy={policy} /> : null}
            <ScanPipelineNote source={source} policy={policy} />
          </>
        </div>
      ) : null}
    </div>
  );
}

function PolicySummary({ policy }: { policy: DownloadPolicy }) {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="rounded-lg border border-border-subtle text-sm">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-semibold text-fg-primary hover:bg-bg-muted"
        onClick={() => setOpen((v) => !v)}
      >
        <span>下载每轮数量</span>
        <span className="text-xs text-fg-tertiary">{open ? "▲" : "▼"}</span>
      </button>
      {open ? (
        <div className="grid gap-2 border-t border-border-subtle p-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="下载每轮数量" value={policy.queue_batch_size} />
          <Metric
            label="下载随机延迟"
            value={`${policy.downloader_sleep_min_seconds}-${policy.downloader_sleep_max_seconds}s`}
          />
          <Metric label="默认下载器" value={policy.default_download_engine} />
          <Metric
            label="扫描每批 Tweet / 间隔"
            value={`${policy.source_scan_batch_size} / ${policy.source_scan_sleep_min_seconds}-${policy.source_scan_sleep_max_seconds}s`}
          />
        </div>
      ) : null}
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

function ScanPipelineNote({ source, policy }: { source: ArchiveSourceDetail; policy?: DownloadPolicy }) {
  const [open, setOpen] = React.useState(false);
  const historyEnabled = Boolean(source.cursor_state?.automation_enabled);
  if (!historyEnabled && !source.active_scan_run) return null;
  const scanDelay = policy ? `${policy.source_scan_sleep_min_seconds}-${policy.source_scan_sleep_max_seconds}s` : "无";

  return (
    <div className="rounded-lg border border-border-subtle text-xs">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-left font-semibold text-fg-primary hover:bg-bg-muted"
        onClick={() => setOpen((v) => !v)}
      >
        <span>批次底层流程</span>
        <span className="text-fg-tertiary">{open ? "▲" : "▼"}</span>
      </button>
      {open ? (
        <div className="border-t border-border-subtle p-3 text-fg-secondary">
          <div className="grid gap-2 sm:grid-cols-2">
            <span>1. 读取来源 cursor 与下一批范围。</span>
            <span>2. 下载队列忙时先记录等待，不发起扫描。</span>
            <span>3. 下载队列空闲时调用 gallery-dl 枚举当前批次。</span>
            <span>{`4. 子进程完整返回后解析、去重、落库，再等待 ${scanDelay} 后调度下一批。`}</span>
          </div>
          <p className="mt-2">
            暂停扫描只暂停后续自动调度，不强制终止已经启动的 gallery-dl 子进程；该批结束后会保留 cursor 与发现记录。
          </p>
        </div>
      ) : null}
    </div>
  );
}
