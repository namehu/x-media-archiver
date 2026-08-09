import { Link } from "react-router-dom";
import { Activity, AlertTriangle, Gauge, Lock, Radio, RefreshCw, ServerCog, Wrench } from "lucide-react";
import type { HealthDetail } from "../../../lib/api";
import { Badge } from "../../../components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { EmptyState } from "../../../components/ui/empty-state";
import { ErrorState } from "../../../components/ui/error-state";
import { StatCard } from "../../../components/ui/stat-card";
import { useRuntimeDiagnostics } from "../../../lib/runtime-provider";
import { formatBytes, formatDateTime } from "../../../lib/utils";
import { useRuntimeTransportDiagnostics } from "../hooks/useSystemHealth";
import { formatError, stringOrNumber, textValue } from "../utils";

type SystemStatusTabProps = {
  health?: HealthDetail;
  isError: boolean;
  onRetry: () => void;
};

export function SystemStatusTab({ health, isError, onRetry }: SystemStatusTabProps) {
  const clientRuntime = useRuntimeDiagnostics();
  const transportQuery = useRuntimeTransportDiagnostics();
  const queue = health?.queue;
  const sources = health?.sources;
  const worker = health?.worker;
  const latestRun = queue?.latest_run;
  const latestScan = sources?.latest_scan;
  const serverRuntime = transportQuery.data;
  const transportLabel = {
    websocket: "WebSocket",
    polling: "REST 轮询",
  }[clientRuntime.transport];

  if (isError) return <ErrorState title="系统状态不可用" onRetry={onRetry} />;

  return (
    <section className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard label="写操作锁" value={worker?.write_lock_held ? "写操作中" : "空闲"} icon={<Lock className="h-4 w-4" />} tone={worker?.write_lock_held ? "warning" : "success"} />
        <StatCard label="队列积压" value={(queue?.pending_items ?? 0) + (queue?.processing_items ?? 0)} detail={`待处理 ${queue?.pending_items ?? 0} · 处理中 ${queue?.processing_items ?? 0}`} icon={<Wrench className="h-4 w-4" />} tone={(queue?.pending_items ?? 0) ? "warning" : "brand"} />
        <StatCard label="来源扫描" value={sources?.active_scan_runs ?? 0} detail={`后台启用 ${sources?.history_enabled_sources ?? 0}`} icon={<Activity className="h-4 w-4" />} />
        <StatCard label="最近错误" value={health?.recent_errors.length ?? 0} icon={<AlertTriangle className="h-4 w-4" />} tone={health?.recent_errors.length ? "danger" : "success"} />
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Runtime 通道"
          value={transportLabel}
          detail={`最后关闭码 ${clientRuntime.lastCloseCode ?? "-"}`}
          icon={<Radio className="h-4 w-4" />}
          tone={clientRuntime.transport === "websocket" ? "success" : "warning"}
        />
        <StatCard
          label="客户端消息速率"
          value={`${clientRuntime.messageRatePerMinute}/分钟`}
          detail={`${clientRuntime.messagesReceived} 条 · ${formatBytes(clientRuntime.bytesReceived)} · ${clientRuntime.stateCommits} 次提交`}
          icon={<Gauge className="h-4 w-4" />}
        />
        <StatCard
          label="连接恢复"
          value={clientRuntime.reconnects}
          detail={`snapshot ${clientRuntime.snapshots} · resync ${clientRuntime.resyncs} · drop ${clientRuntime.drops}`}
          icon={<RefreshCw className="h-4 w-4" />}
          tone={clientRuntime.resyncs || clientRuntime.drops ? "warning" : "brand"}
        />
        <StatCard
          label="服务端 WS"
          value={serverRuntime?.websocket.active_connections ?? "-"}
          detail={`队列峰值 ${serverRuntime?.broker.queue_high_water ?? "-"} · drop ${serverRuntime?.websocket.dropped_events ?? "-"} · ${formatBytes(serverRuntime?.websocket.bytes_sent)}`}
          icon={<ServerCog className="h-4 w-4" />}
          tone={(serverRuntime?.websocket.dropped_events ?? 0) > 0 ? "warning" : "success"}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr_1.1fr]">
        <StatusSummary title="最近批次" empty="还没有批次记录。" values={[["状态", textValue(latestRun?.status)], ["触发", textValue(latestRun?.trigger_type)], ["开始", formatDateTime(stringOrNumber(latestRun?.started_at))], ["结束", formatDateTime(stringOrNumber(latestRun?.finished_at))]]} />
        <StatusSummary title="最近扫描" empty="还没有扫描记录。" values={[["状态", textValue(latestScan?.status)], ["触发", textValue(latestScan?.trigger_type)], ["来源 ID", textValue(latestScan?.source_id)], ["结束", formatDateTime(stringOrNumber(latestScan?.finished_at || latestScan?.created_at))]]} />
        <RecentErrorsList errors={health?.recent_errors ?? []} />
      </div>
    </section>
  );
}

function StatusSummary({ title, values, empty }: { title: string; values: Array<[string, string]>; empty: string }) {
  const hasValue = values.some(([, value]) => value !== "-");
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {hasValue ? (
          <dl className="space-y-2 text-sm">
            {values.map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt className="text-fg-secondary">{label}</dt>
                <dd className="max-w-[60%] truncate text-right font-medium text-fg-primary">{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-fg-secondary">{empty}</p>
        )}
      </CardContent>
    </Card>
  );
}

function RecentErrorsList({ errors }: { errors: HealthDetail["recent_errors"] }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-2">
          <CardTitle>最近错误</CardTitle>
          <Badge tone={errors.length ? "danger" : "secondary"}>{errors.length}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {errors.length ? (
          <div className="space-y-2">
            {errors.map((error, index) => (
              <div key={`${textValue(error.kind)}-${textValue(error.id)}-${index}`} className="rounded-md border border-border-subtle bg-bg-surface p-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{textValue(error.kind)}</Badge>
                  <span className="font-semibold text-fg-primary">{textValue(error.subject)}</span>
                  <span className="text-xs text-fg-tertiary">{formatDateTime(stringOrNumber(error.occurred_at))}</span>
                </div>
                <div className="mt-1 text-xs text-fg-secondary">{formatError(error.error_category, error.error_message)}</div>
                {error.target_path ? (
                  <Link to={error.target_path} className="mt-1 inline-flex text-xs font-semibold text-brand hover:text-brand-hover">
                    打开定位
                  </Link>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="最近没有错误。" />
        )}
      </CardContent>
    </Card>
  );
}
