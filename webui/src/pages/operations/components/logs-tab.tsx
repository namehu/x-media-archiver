import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "../../../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Select } from "../../../components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../../components/ui/table";
import { apiGet, type OperationLogEntriesResponse, type OperationLogStreamsPageResponse, type OperationLogStream } from "../../../lib/api";
import { formatDateTime } from "../../../lib/utils";

type LogsTabProps = {
  initialStreamId?: number | null;
};

const PAGE_SIZE = 50;

export function LogsTab({ initialStreamId }: LogsTabProps) {
  const [level, setLevel] = React.useState("");
  const [sourceId, setSourceId] = React.useState("");
  const [scanRunId, setScanRunId] = React.useState(initialStreamId ? "" : "");
  const [keyword, setKeyword] = React.useState("");
  const [selectedStreamId, setSelectedStreamId] = React.useState<number | null>(initialStreamId ?? null);
  const queryString = buildLogStreamsQuery({ level, sourceId, scanRunId, keyword });
  const streamsQuery = useQuery({
    queryKey: ["operation-log-streams", queryString],
    queryFn: () => apiGet<OperationLogStreamsPageResponse>(`/api/v1/log-streams?limit=${PAGE_SIZE}${queryString}`),
    refetchInterval: 10000,
  });
  const selectedStream = streamsQuery.data?.rows.find((stream) => stream.id === selectedStreamId) ?? null;

  React.useEffect(() => {
    if (initialStreamId) setSelectedStreamId(initialStreamId);
  }, [initialStreamId]);

  return (
    <section className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,0.85fr)]">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>日志查询</CardTitle>
            <Badge tone="secondary">{streamsQuery.data?.total_count ?? 0}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 md:grid-cols-4">
            <Select value={level} onChange={(event) => setLevel(event.target.value)}>
              <option value="">全部级别</option>
              <option value="debug">debug</option>
              <option value="info">info</option>
              <option value="warning">warning</option>
              <option value="error">error</option>
              <option value="critical">critical</option>
            </Select>
            <Input value={sourceId} onChange={(event) => setSourceId(event.target.value)} placeholder="来源 ID" />
            <Input value={scanRunId} onChange={(event) => setScanRunId(event.target.value)} placeholder="扫描批次 ID" />
            <Input value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="关键字" />
          </div>
          <div className="overflow-hidden rounded-md border border-border-subtle">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>关联对象</TableHead>
                  <TableHead>最近级别</TableHead>
                  <TableHead>最近消息</TableHead>
                  <TableHead>行数</TableHead>
                  <TableHead>更新时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(streamsQuery.data?.rows ?? []).map((stream) => (
                  <TableRow
                    key={stream.id}
                    className={stream.id === selectedStreamId ? "bg-brand-soft" : undefined}
                    onClick={() => setSelectedStreamId(stream.id)}
                  >
                    <TableCell>
                      <button type="button" className="text-left font-semibold text-brand hover:text-brand-hover">
                        {stream.scope_type} #{stream.scope_id}
                      </button>
                      <div className="text-xs text-fg-secondary">{stream.log_path}</div>
                    </TableCell>
                    <TableCell>
                      <LogLevelBadge level={stream.last_level} />
                    </TableCell>
                    <TableCell className="max-w-md truncate">{stream.last_message || "-"}</TableCell>
                    <TableCell>{stream.line_count}</TableCell>
                    <TableCell>{formatDateTime(stream.last_log_at || stream.created_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {streamsQuery.isError ? <p className="text-sm text-danger">{String(streamsQuery.error)}</p> : null}
        </CardContent>
      </Card>
      <LogStreamDetail streamId={selectedStreamId} stream={selectedStream} />
    </section>
  );
}

function LogStreamDetail({ streamId, stream }: { streamId: number | null; stream: OperationLogStream | null }) {
  const [level, setLevel] = React.useState("");
  const query = useQuery({
    queryKey: ["operation-log", streamId, level],
    queryFn: () =>
      apiGet<OperationLogEntriesResponse>(
        `/api/v1/log-streams/${streamId}?limit=300${level ? `&level=${encodeURIComponent(level)}` : ""}`,
      ),
    enabled: Boolean(streamId),
    refetchInterval: stream && !stream.closed_at ? 3000 : false,
  });
  const entries = query.data?.entries ?? [];
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>日志详情</CardTitle>
          <Select className="w-32" value={level} onChange={(event) => setLevel(event.target.value)}>
            <option value="">全部级别</option>
            <option value="debug">debug</option>
            <option value="info">info</option>
            <option value="warning">warning</option>
            <option value="error">error</option>
            <option value="critical">critical</option>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {stream ? (
          <div className="grid gap-2 rounded-md bg-bg-muted p-3 text-xs text-fg-secondary">
            <span>{stream.log_path}</span>
            <span>
              大小: {formatBytes(stream.byte_size)} · 行数: {stream.line_count}
            </span>
            {stream.is_truncated ? <span className="text-warning">日志已达到大小上限，后续详细输出已截断。</span> : null}
          </div>
        ) : (
          <p className="text-sm text-fg-secondary">选择一个日志流查看详情。</p>
        )}
        {query.data?.available === false ? <p className="text-sm text-warning">日志文件不存在或已被清理，索引记录仍可用于审计。</p> : null}
        <pre className="max-h-[34rem] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border-subtle bg-bg-elevated p-3 font-mono text-xs leading-relaxed text-fg-secondary">
          {query.error
            ? String(query.error)
            : entries.length
              ? entries.map(formatLogEntry).join("\n")
              : streamId
                ? "没有匹配的日志行。"
                : "选择一个日志流查看详情。"}
        </pre>
      </CardContent>
    </Card>
  );
}

function LogLevelBadge({ level }: { level?: string | null }) {
  if (!level) return <Badge tone="secondary">-</Badge>;
  if (level === "error" || level === "critical") return <Badge tone="danger">{level}</Badge>;
  if (level === "warning") return <Badge tone="warning">{level}</Badge>;
  return <Badge tone="secondary">{level}</Badge>;
}

function buildLogStreamsQuery(filters: { level: string; sourceId: string; scanRunId: string; keyword: string }) {
  const params = new URLSearchParams();
  params.set("scope_type", "source_scan");
  if (filters.level) params.set("level", filters.level);
  if (filters.sourceId.trim()) params.set("source_id", filters.sourceId.trim());
  if (filters.scanRunId.trim()) params.set("scan_run_id", filters.scanRunId.trim());
  if (filters.keyword.trim()) params.set("keyword", filters.keyword.trim());
  const text = params.toString();
  return text ? `&${text}` : "";
}

function formatLogEntry(entry: OperationLogEntriesResponse["entries"][number]) {
  const time = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : "--:--:--";
  const stack = typeof entry.exception?.stack === "string" ? `\n${entry.exception.stack}` : "";
  return `${time} [${entry.level}] ${entry.component}: ${entry.raw || entry.message}${stack}`;
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
