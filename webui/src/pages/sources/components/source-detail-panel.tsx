import * as React from "react";
import { Link } from "react-router-dom";
import { ExternalLink, HelpCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  apiGet,
  type ArchiveSourceDetail,
  type ArchiveSubmission,
  type DownloadPolicy,
  type OperationLogEntriesResponse,
  type SourceScanRun,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { scanStatusLabel, scanTriggerLabel } from "@/lib/formatters";
import { formatDateTime } from "@/lib/utils";
import { useSourceDiscovered, useSourceScanRuns } from "../hooks/useSourceDetail";
import { SourceScanHistoryTab } from "./source-scan-history-tab";
import { SourceTweetsTab } from "./source-tweets-tab";
import {
  formatElapsed,
  formatHistoryState,
  formatNextRange,
  formatRunRange,
  formatScanState,
  parseRecordUrls,
  scanStatusTone,
  sourceStatusTone,
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
  open,
  onOpenChange,
  source,
  policy,
  now,
  detailUpdatedAt,
  feedback,
  scanFeedback,
  statusLabel,
  actions,
  onManualSubmitted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source?: ArchiveSourceDetail;
  policy?: DownloadPolicy;
  now: number;
  detailUpdatedAt: number;
  feedback: ArchiveSubmission | null;
  scanFeedback: Record<string, unknown> | null;
  statusLabel: (status?: string | null) => string;
  actions: DetailActions;
  onManualSubmitted: () => void;
}) {
  const scanLimit = useNumberInput("20");
  const [activeTab, setActiveTab] = React.useState("tweets");
  const [tweetsOffset, setTweetsOffset] = React.useState(0);
  const [historyOffset, setHistoryOffset] = React.useState(0);
  const persistedScanLimit = source ? preferredScanLimit(source, policy) : 20;
  const discoveredQuery = useSourceDiscovered(source?.id ?? null, tweetsOffset, activeTab === "tweets");
  const scanRunsQuery = useSourceScanRuns(
    source?.id ?? null,
    historyOffset,
    activeTab === "history",
    source?.active_scan_run?.status === "running",
  );

  React.useEffect(() => {
    if (!source) return;
    scanLimit.set(String(persistedScanLimit));
  }, [source?.id, persistedScanLimit]);

  React.useEffect(() => {
    setActiveTab("tweets");
    setTweetsOffset(0);
    setHistoryOffset(0);
  }, [source?.id]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="h-dvh w-[min(100vw,780px)] overflow-hidden p-0">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex h-full min-h-0 flex-col">
          <SheetHeader className="mb-0 shrink-0 gap-4 px-6 pb-0 pt-6 pr-12">
            <SheetTitle className="sr-only">
              {source?.label || source?.author_username || "来源详情"}
            </SheetTitle>
            {source ? (
              <SourceHeader
                source={source}
                policy={policy}
                now={now}
                detailUpdatedAt={detailUpdatedAt}
                scanLimit={scanLimit.clamped(200)}
                statusLabel={statusLabel}
              />
            ) : (
              <p className="py-4 text-sm text-fg-secondary">选择一个来源。</p>
            )}
            <TabsList className="flex-wrap">
              <TabsTrigger value="tweets">最近发现的 Tweet</TabsTrigger>
              <TabsTrigger value="history">扫描历史（最近 20 批）</TabsTrigger>
              <TabsTrigger value="config">高级扫描操作</TabsTrigger>
            </TabsList>
          </SheetHeader>
          <TabsContent
            value="tweets"
            className="min-h-0 flex-1 overflow-hidden px-6 pb-6 pt-4 data-[state=active]:flex data-[state=active]:flex-col"
          >
            <div className="flex min-h-0 flex-1 flex-col gap-4">
              {source ? (
                <div className="shrink-0 space-y-4">
                  <PrimaryActions source={source} actions={actions} scanLimit={scanLimit} />
                  <AdvancedActions source={source} actions={actions} scanFeedback={scanFeedback} scanLimit={scanLimit} />
                </div>
              ) : null}
              <div className="min-h-0 flex-1">
                <SourceTweetsTab
                  data={discoveredQuery.data}
                  isLoading={discoveredQuery.isLoading}
                  error={discoveredQuery.error}
                  offset={tweetsOffset}
                  onOffsetChange={setTweetsOffset}
                  statusLabel={statusLabel}
                />
              </div>
            </div>
          </TabsContent>
          <TabsContent
            value="history"
            className="min-h-0 flex-1 overflow-hidden px-6 pb-6 pt-4 data-[state=active]:flex data-[state=active]:flex-col"
          >
            <div className="relative flex min-h-0 flex-1 flex-col border-l-2 border-border-subtle pl-0">
              <SourceScanHistoryTab
                data={scanRunsQuery.data}
                isLoading={scanRunsQuery.isLoading}
                error={scanRunsQuery.error}
                offset={historyOffset}
                onOffsetChange={setHistoryOffset}
                now={now}
              />
            </div>
          </TabsContent>
          <TabsContent
            value="config"
            className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4 data-[state=active]:block"
          >
            {source ? (
              <div className="space-y-4">
                <DownloadActions source={source} actions={actions} feedback={feedback} />
                <ManualImport source={source} actions={actions} feedback={feedback} onSubmitted={onManualSubmitted} />
              </div>
            ) : null}
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

function SourceHeader({
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
            <DetailRow
              label="详情刷新"
              value={formatDateTime(new Date(detailUpdatedAt || now).toISOString())}
            />
            <DetailRow label="累计新增 Tweet" value={source.scan_summary?.added_tweet_count ?? 0} />
            <DetailRow
              label="最近成功扫描"
              value={formatDateTime(source.scan_summary?.last_success_at)}
            />
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

function ActiveScan({
  run,
  source,
  now,
}: {
  run: SourceScanRun;
  source: ArchiveSourceDetail;
  now: number;
}) {
  const cursorBefore = run.cursor_before ?? source.cursor_state ?? {};
  const scanUrl = String(cursorBefore.last_scan_url || source.source_url || "-");
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
        <span>
          当前阶段: {run.progress_message || "等待 gallery-dl 枚举并返回"}
        </span>
        <span>
          范围: {formatRunRange(run.range_start, run.range_end)}
        </span>
        <span>
          请求 Tweet 数: {run.requested_limit ?? "-"}
        </span>
        <span>
          已运行: {formatElapsed(run.started_at, now)}
        </span>
        <span>
          开始时间: {formatDateTime(run.started_at)}
        </span>
        <span>
          触发方式: {scanTriggerLabel(run.trigger_type)}
        </span>
        <span>
          Cursor: {hasCursor ? "续扫上一页" : "从第一页开始"}
        </span>
      </div>
      <div className="mt-2 break-all rounded-md bg-bg-elevated/70 px-2 py-1 text-xs text-fg-secondary">
        实际扫描 URL: {scanUrl}
      </div>
      {run.last_log_at ? (
        <p className="mt-2 text-xs text-fg-secondary">
          最近日志: {formatDateTime(run.last_log_at)}
        </p>
      ) : null}
      <ScanLogBox run={run} />
      <p className="mt-2 text-xs text-fg-secondary">扫描批次会等 gallery-dl 完整返回后一次性解析和落库；运行期间发现数保持 0 是正常现象。</p>
      {sourcePaused ? <p className="mt-1 text-xs text-warning">已收到暂停状态；当前 gallery-dl 批次会先结束，系统不会再调度下一批。</p> : null}
    </div>
  );
}

function ScanLogBox({ run }: { run: SourceScanRun }) {
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
    ? "加载日志"
    : !streamId
      ? "等待 gallery-dl 输出日志..."
      : !available
        ? "日志文件不可用"
        : entries.length
          ? "实时刷新"
          : "等待输出";

  return (
    <div className="mt-3 overflow-hidden rounded-md border border-border-subtle bg-bg-elevated">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle px-3 py-2 text-xs">
        <span className="font-semibold text-fg-primary">gallery-dl 实时日志</span>
        <div className="flex items-center gap-2">
          <Select className="h-7 w-28 text-xs" value={level} onChange={(event) => setLevel(event.target.value)}>
            <option value="">全部级别</option>
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
            <Link
              to={`/operations?tab=logs&streamId=${streamId}`}
              className="font-semibold text-brand hover:text-brand-hover"
            >
              在日志管理中打开
            </Link>
          ) : null}
        </div>
      ) : null}
      <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words px-3 py-2 font-mono text-xs leading-relaxed text-fg-secondary">
        {query.error
          ? String(query.error)
          : log ||
            (streamId
              ? available
                ? "等待输出"
                : "日志文件不存在或已被清理，不影响扫描批次记录。"
              : "等待 gallery-dl 输出日志...")}
      </pre>
      {query.data?.is_truncated ? (
        <div className="border-t border-warning/20 px-3 py-2 text-xs text-warning">日志已达到大小上限，后续详细输出已截断。</div>
      ) : null}
    </div>
  );
}

function formatLogEntry(entry: OperationLogEntriesResponse["entries"][number]) {
  const time = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : "--:--:--";
  const message = entry.raw || entry.message;
  const stack = typeof entry.exception?.stack === "string" ? `\n${entry.exception.stack}` : "";
  return `${time} [${entry.level}] ${entry.component}: ${message}${stack}`;
}

function ScanPipelineNote({ source, policy }: { source: ArchiveSourceDetail; policy?: DownloadPolicy }) {
  const [open, setOpen] = React.useState(false);
  const historyEnabled = Boolean(source.cursor_state?.automation_enabled);
  if (!historyEnabled && !source.active_scan_run) return null;
  const scanDelay = policy
    ? `${policy.source_scan_sleep_min_seconds}-${policy.source_scan_sleep_max_seconds}s`
    : "无";

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
          <p className="mt-2">暂停扫描只暂停后续自动调度，不强制终止已经启动的 gallery-dl 子进程；该批结束后会保留 cursor 与发现记录。</p>
        </div>
      ) : null}
    </div>
  );
}

function PrimaryActions({
  source,
  actions,
  scanLimit,
}: {
  source: ArchiveSourceDetail;
  actions: DetailActions;
  scanLimit: NumberInputState;
}) {
  const historyEnabled = Boolean(source.cursor_state?.automation_enabled);
  const canStart = !actions.pending.history && !(historyEnabled && source.status === "active");

  return (
    <ActionBlock title="来源扫描" hint="后台使用下载器原生 cursor 续扫，只发现并记录 Tweet，不会自动提交下载；每批可能需要数分钟，下载队列有任务时扫描会等待。">
      <Input className="w-28" type="number" min={1} max={200} value={scanLimit.value} onChange={scanLimit.onChange} />
      <Button
        type="button"
        disabled={!canStart}
        onClick={() => actions.startHistory({ sourceId: source.id, limit: scanLimit.clamped(200) })}
      >
        {historyEnabled ? "继续历史扫描" : "开始历史扫描"}
      </Button>
      <Button
        type="button"
        variant="secondary"
        disabled={actions.pending.status || source.status === "paused" || !historyEnabled}
        onClick={() => actions.setStatus({ sourceId: source.id, status: "paused" })}
      >
        暂停扫描
      </Button>
      {source.status === "paused" ? (
        <Button
          type="button"
          variant="secondary"
          disabled={actions.pending.status}
          onClick={() => actions.setStatus({ sourceId: source.id, status: "active" })}
        >
          恢复
        </Button>
      ) : null}
      {actions.errors.history || actions.errors.status ? (
        <ErrorLine error={actions.errors.history || actions.errors.status} />
      ) : null}
    </ActionBlock>
  );
}

function DownloadActions({
  source,
  actions,
  feedback,
}: {
  source: ArchiveSourceDetail;
  actions: DetailActions;
  feedback: ArchiveSubmission | null;
}) {
  const submitLimit = useNumberInput("20");
  const canSubmit = (source.unsubmitted_tweet_count || 0) > 0 && !actions.pending.submitDiscovered;

  return (
    <ActionBlock title="提交下载" hint="仅将已经发现的 Tweet 提交给下载队列，不会继续扫描来源。">
      <Input
        className="w-28"
        type="number"
        min={1}
        max={500}
        value={submitLimit.value}
        onChange={submitLimit.onChange}
      />
      <Button
        type="button"
        variant="secondary"
        disabled={!canSubmit}
        onClick={() => actions.submitDiscovered({ sourceId: source.id, limit: submitLimit.clamped(500) })}
      >
        提交未入队发现项
      </Button>
      {actions.errors.submitDiscovered ? <ErrorLine error={actions.errors.submitDiscovered} /> : null}
      {feedback ? <FeedbackLine feedback={feedback} /> : null}
    </ActionBlock>
  );
}

function AdvancedActions({
  source,
  actions,
  scanFeedback,
  scanLimit,
}: {
  source: ArchiveSourceDetail;
  actions: DetailActions;
  scanFeedback: Record<string, unknown> | null;
  scanLimit: NumberInputState;
}) {
  const historyEnabled = Boolean(source.cursor_state?.automation_enabled);
  const canScan = source.status !== "paused" && !actions.pending.scan;

  return (
    <ActionBlock title="高级扫描操作" hint="单批扫描用于测试或排障；从最新补扫用于后续检查新发布内容；停止会关闭自动任务但保留游标和已发现记录。">
      <Input className="w-28" type="number" min={1} max={200} value={scanLimit.value} onChange={scanLimit.onChange} />
      <Button
        type="button"
        variant="secondary"
        disabled={!canScan}
        onClick={() => actions.scan({ sourceId: source.id, limit: scanLimit.clamped(200) })}
      >
        扫描下一批
      </Button>
      <Button
        type="button"
        variant="secondary"
        disabled={!canScan}
        onClick={() => actions.scan({ sourceId: source.id, limit: scanLimit.clamped(200), restart: true })}
      >
        从最新补扫
      </Button>
      <Button
        type="button"
        variant="secondary"
        disabled={!historyEnabled || actions.pending.history}
        onClick={() => actions.stopHistory(source.id)}
      >
        停止历史扫描
      </Button>
      {actions.errors.scan ? <ErrorLine error={actions.errors.scan} /> : null}
      {scanFeedback ? (
        <p className="basis-full rounded-lg bg-bg-muted p-3 text-sm text-fg-primary">
          本次扫描记录 {Number(scanFeedback.discovered_count || 0)} 条 Tweet，其中 {Number(scanFeedback.new_discovered_count || 0)} 条为新发现、{Number(scanFeedback.duplicate_count || 0)} 条已存在，尚未提交下载。{scanFeedback.completed ? "可能已到结尾" : ""}
        </p>
      ) : null}
    </ActionBlock>
  );
}

function ManualImport({
  source,
  actions,
  feedback,
  onSubmitted,
}: {
  source: ArchiveSourceDetail;
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
    <ActionBlock title="手动粘贴 Tweet URL">
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
        提交发现结果
      </Button>
      {actions.errors.submit ? <ErrorLine error={actions.errors.submit} /> : null}
      {feedback ? <FeedbackLine feedback={feedback} /> : null}
    </ActionBlock>
  );
}

function ActionBlock({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-lg border border-border-subtle p-3">
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-semibold text-fg-primary">{title}</span>
        {hint ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="text-fg-tertiary hover:text-fg-secondary focus:outline-none">
                <HelpCircle className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">{hint}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
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

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-fg-secondary">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function ErrorLine({ error }: { error: unknown }) {
  return <p className="basis-full text-sm text-danger">{String(error)}</p>;
}

function FeedbackLine({ feedback }: { feedback: ArchiveSubmission }) {
  return (
    <p className="basis-full rounded-lg bg-bg-muted p-3 text-sm text-fg-primary">
      Run #{feedback.run_id} · {feedback.tasks.queued_count} 个已入队 · {feedback.tasks.skipped_verified_count} 个已归档 · {feedback.tasks.linked_pending_count} 个已有任务
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

function preferredScanLimit(source: ArchiveSourceDetail, policy?: DownloadPolicy) {
  const candidates = [
    source.cursor_state?.automation_limit,
    source.cursor_state?.last_limit,
    source.active_scan_run?.requested_limit,
    policy?.source_scan_batch_size,
    20,
  ];
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value >= 1) return Math.min(200, Math.floor(value));
  }
  return 20;
}
