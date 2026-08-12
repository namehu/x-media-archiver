import { Suspense, lazy, useMemo } from "react";
import { AlertTriangle, Archive, FileWarning, Images, ListChecks } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiGet, type Summary } from "../../lib/api";
import { statusLabel } from "../../lib/formatters";
import { formatBytes, formatDateTime } from "../../lib/utils";
import { useServerEvents } from "../../hooks/useServerEvents";
import { Badge } from "../../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { LiveIndicator } from "../../components/ui/live-indicator";
import { Skeleton } from "../../components/ui/skeleton";
import { StatCard } from "../../components/ui/stat-card";
import { StatusDot } from "../../components/ui/status-dot";

const StatusDistributionCard = lazy(() =>
  import("./components/dashboard-charts").then((module) => ({ default: module.StatusDistributionCard })),
);

export function DashboardPage() {
  const events = useServerEvents(["archive_runs", "sources", "source_scans", "worker"]);
  const { data, isLoading, error } = useQuery({
    queryKey: ["summary"],
    queryFn: () => apiGet<Summary>("/api/v1/library/summary"),
  });

  const model = useMemo(() => (data ? buildDashboardModel(data) : null), [data]);

  if (isLoading) return <DashboardSkeleton />;
  if (error || !data || !model) return <PageState title="API 不可用" detail={String(error)} />;

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-fg-primary">仪表盘</h1>
          <p className="mt-1 text-sm text-fg-secondary">归档队列、媒体库与来源扫描的当前状态总览。</p>
        </div>
        <LiveIndicator
          state={
            events.transport === "websocket" && events.status === "connected"
              ? "open"
              : events.transport === "websocket" &&
                  (events.status === "connecting" || events.status === "reconnecting" || events.status === "resyncing")
                ? "connecting"
                : "closed"
          }
          label={eventLabel(events.status, events.transport)}
        />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="媒体资产"
          value={data.media_count.toLocaleString()}
          detail="数据库索引（全部状态）"
          icon={<Images className="h-4 w-4" />}
        />
        <StatCard
          label="失败队列"
          value={data.failure_count.toLocaleString()}
          detail={data.failure_count ? "需要排查或重试" : "暂无失败项"}
          icon={<FileWarning className="h-4 w-4" />}
          tone={data.failure_count ? "danger" : "success"}
        />
        <StatCard
          label="Tweet 状态数"
          value={model.statusTotal.toLocaleString()}
          detail={`${model.statusEntries.length} 种状态`}
          icon={<ListChecks className="h-4 w-4" />}
          tone="success"
        />
        <StatCard
          label="导出快照"
          value={formatBytes(model.exportBytes)}
          detail={`${data.exports.length} 个文件`}
          icon={<Archive className="h-4 w-4" />}
          tone="brand"
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Suspense fallback={<Skeleton className="h-72" />}>
          <StatusDistributionCard
            title="状态分布"
            description="按 Tweet 当前归档状态统计。"
            emptyLabel="还没有导入 Tweet。"
            entries={model.statusEntries}
          />
        </Suspense>

        <Card>
          <CardHeader>
            <CardTitle>库状态摘要</CardTitle>
            <CardDescription>来自当前 REST 摘要；实时连接状态显示在页头。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {model.feed.map((item) => (
              <div key={item.id} className="flex gap-3 rounded-md border border-border-subtle bg-bg-surface p-3">
                <StatusDot status={item.tone} className="mt-1" />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-fg-primary">{item.title}</div>
                  <div className="mt-1 text-xs text-fg-secondary">{item.detail}</div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle>最近导出</CardTitle>
            <CardDescription>最近生成的 CSV 与数据库快照。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.exports.length === 0 ? (
              <p className="text-sm text-fg-secondary">未找到导出文件。</p>
            ) : (
              data.exports.map((file) => (
                <div key={file.path} className="flex items-center justify-between gap-4 rounded-md border border-border-subtle bg-bg-surface px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-fg-primary">{file.name}</div>
                    <div className="mt-1 text-xs text-fg-tertiary">{formatDateTime(file.modified_at)}</div>
                  </div>
                  <Badge tone="default">{formatBytes(file.size)}</Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>归档目录</CardTitle>
            <CardDescription>媒体文件稳定落盘根目录。</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-border-subtle bg-bg-surface p-4">
              <code className="break-all text-sm text-fg-secondary">{data.archive_dir}</code>
            </div>
            <div className="mt-4 flex items-center gap-2 text-xs text-fg-tertiary">
              <AlertTriangle className="h-3.5 w-3.5" />
              媒体删除仅在帖子浏览、媒体库和重复媒体中提供，并始终要求显式确认。
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function eventLabel(status: string, transport: "websocket" | "polling") {
  if (transport === "polling") {
    return status === "connected" ? "REST 快照轮询" : "REST 快照轮询不可用";
  }
  switch (status) {
    case "connected":
      return "实时事件已连接";
    case "connecting":
      return "正在连接实时事件";
    case "reconnecting":
      return "实时事件正在重连";
    case "resyncing":
      return "正在同步运行态快照";
    case "stale":
      return "实时事件无新消息，使用降级刷新";
    default:
      return "实时事件离线，使用轮询刷新";
  }
}

function buildDashboardModel(data: Summary) {
  const statusEntries = Object.entries(data.tweet_status_counts)
    .map(([status, count]) => ({ status, label: statusLabel(status), count }))
    .sort((a, b) => b.count - a.count);
  const statusTotal = statusEntries.reduce((sum, entry) => sum + entry.count, 0);
  const exportBytes = data.exports.reduce((sum, file) => sum + file.size, 0);

  return {
    statusEntries,
    statusTotal,
    exportBytes,
    feed: [
      {
        id: "media",
        tone: "running" as const,
        title: `数据库登记了 ${data.media_count.toLocaleString()} 个媒体资产`,
        detail: "计数包含已校验、缺失、损坏、处理中等全部状态。",
      },
      {
        id: "failure",
        tone: data.failure_count ? ("danger" as const) : ("success" as const),
        title: data.failure_count ? `${data.failure_count.toLocaleString()} 个失败项需要复查` : "失败队列为空",
        detail: data.failure_count ? "打开 Failures 页面查看可重试项。" : "当前没有报告失败的 Tweet 下载。",
      },
      {
        id: "exports",
        tone: data.exports.length ? ("success" as const) : ("idle" as const),
        title: data.exports.length ? `${data.exports.length} 个导出快照可用` : "暂无导出快照",
        detail: data.exports[0] ? `最新：${data.exports[0].name}` : "需要时可在 Operations 里生成。",
      },
    ],
  };
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-12 w-80" />
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-36" />
        ))}
      </section>
      <section className="grid gap-4 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-72" />
        ))}
      </section>
    </div>
  );
}

function PageState({ title, detail }: { title: string; detail?: string }) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="font-semibold text-fg-primary">{title}</div>
        {detail ? <p className="mt-2 text-sm text-fg-secondary">{detail}</p> : null}
      </CardContent>
    </Card>
  );
}
