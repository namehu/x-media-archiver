import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiGet, type OperationLogEntriesResponse, type SourceScanRun } from "@/lib/api";
import { scanTriggerLabel, scanStatusLabel } from "@/lib/formatters";
import { Select } from "@/components/ui/select";

function formatLogEntry(entry: OperationLogEntriesResponse["entries"][number]) {
  const time = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : "--:--:--";
  const message = entry.raw || entry.message;
  const stack = typeof entry.exception?.stack === "string" ? `\n${entry.exception.stack}` : "";
  return `${time} [${entry.level}] ${entry.component}: ${message}${stack}`;
}

export function ScanLogBox({ run }: { run: SourceScanRun }) {
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
        <div className="border-t border-warning/20 px-3 py-2 text-xs text-warning">
          日志已达到大小上限，后续详细输出已截断。
        </div>
      ) : null}
    </div>
  );
}
