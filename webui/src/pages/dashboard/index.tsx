import { Suspense, lazy, useMemo } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  FileWarning,
  FolderOpen,
  Images,
  ListChecks,
  ShieldCheck,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiGet, type Summary } from "../../lib/api";
import { statusLabel } from "../../lib/formatters";
import { formatBytes, formatDateTime } from "../../lib/utils";
import { Badge } from "../../components/ui/badge";
import { buttonVariants } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../../components/ui/card";
import { ErrorState } from "../../components/ui/error-state";
import { ManagementPageHeader } from "../../components/ui/management-page-header";
import { Separator } from "../../components/ui/separator";
import { Skeleton } from "../../components/ui/skeleton";
import { StatCard } from "../../components/ui/stat-card";
import { StatusDot } from "../../components/ui/status-dot";

const StatusDistributionCard = lazy(() =>
  import("./components/dashboard-charts").then((module) => ({ default: module.StatusDistributionCard })),
);

export function DashboardPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["summary"],
    queryFn: () => apiGet<Summary>("/api/v1/library/summary"),
  });

  const model = useMemo(() => (data ? buildDashboardModel(data) : null), [data]);

  if (isLoading) return <DashboardSkeleton />;
  if (error || !data || !model) {
    return (
      <div className="flex flex-col gap-6">
        <ManagementPageHeader
          eyebrow="归档管理"
          title="系统概览"
          description="归档摘要暂时无法读取。"
        />
        <ErrorState title="系统概览暂不可用" detail="请确认 API 服务可用后重试。" onRetry={() => void refetch()} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <ManagementPageHeader
        eyebrow="归档管理"
        title="系统概览"
        description="先看需要关注的状态，再进入队列、失败项或媒体内容。"
        actions={
          <>
          <Link to="/queue" className={buttonVariants({ variant: "secondary", size: "sm" })}>
            查看队列
          </Link>
          <Link to="/library" className={buttonVariants({ size: "sm" })}>
            浏览媒体库
            <ArrowRight data-icon="inline-end" aria-hidden="true" />
          </Link>
          </>
        }
      />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="归档关键指标">
        <StatCard
          label="媒体资产"
          value={data.media_count.toLocaleString()}
          detail="数据库索引中的全部媒体"
          icon={<Images aria-hidden="true" />}
        />
        <StatCard
          label="失败项"
          value={data.failure_count.toLocaleString()}
          detail={data.failure_count ? "等待排查或重试" : "当前无需处理"}
          icon={<FileWarning aria-hidden="true" />}
          tone={data.failure_count ? "danger" : "success"}
        />
        <StatCard
          label="已登记 Tweet"
          value={model.statusTotal.toLocaleString()}
          detail={`${model.statusEntries.length} 种归档状态`}
          icon={<ListChecks aria-hidden="true" />}
          tone="success"
        />
        <StatCard
          label="导出文件"
          value={data.exports.length.toLocaleString()}
          detail={`合计 ${formatBytes(model.exportBytes)}`}
          icon={<Archive aria-hidden="true" />}
          tone="brand"
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-12">
        <Suspense fallback={<Skeleton className="min-h-80 xl:col-span-7" />}>
          <StatusDistributionCard
            className="xl:col-span-7"
            title="归档状态分布"
            description="按 Tweet 当前归档状态统计，便于快速识别积压与异常。"
            emptyLabel="还没有导入 Tweet。"
            entries={model.statusEntries}
          />
        </Suspense>

        <Card className="xl:col-span-5">
          <CardHeader>
            <CardTitle>运行摘要</CardTitle>
            <CardDescription>基于当前数据库摘要生成，不推测历史趋势。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col">
            {model.feed.map((item, index) => (
              <div key={item.id}>
                {index ? <Separator /> : null}
                <div className="flex gap-3 py-4 first:pt-0 last:pb-0">
                  <StatusDot status={item.tone} className="mt-1.5 shrink-0" />
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-fg-primary">{item.title}</div>
                    <div className="mt-1 text-xs leading-5 text-fg-secondary">{item.detail}</div>
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
          <CardFooter className="border-t border-border-subtle pt-4">
            <Link to="/operations" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              查看系统操作
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </Link>
          </CardFooter>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-12">
        <Card className="xl:col-span-7">
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div>
              <CardTitle>最近导出</CardTitle>
              <CardDescription>最近生成的 CSV、HTML 与数据库快照。</CardDescription>
            </div>
            <Badge tone="secondary">{data.exports.length} 个文件</Badge>
          </CardHeader>
          <CardContent>
            {data.exports.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <FolderOpen className="size-6 text-fg-tertiary" aria-hidden="true" />
                <p className="text-sm font-medium text-fg-primary">还没有导出文件</p>
                <p className="text-xs text-fg-tertiary">可前往系统操作生成新的归档快照。</p>
              </div>
            ) : (
              <div className="flex flex-col">
                {data.exports.map((file, index) => (
                  <div key={file.path}>
                    {index ? <Separator /> : null}
                    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-fg-primary">{file.name}</div>
                        <div className="mt-1 text-xs text-fg-tertiary">{formatDateTime(file.modified_at)}</div>
                      </div>
                      <Badge tone="secondary" className="shrink-0 tabular-nums">{formatBytes(file.size)}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="xl:col-span-5">
          <CardHeader>
            <div className="flex size-9 items-center justify-center rounded-lg bg-brand-soft text-brand">
              <ShieldCheck className="size-4" aria-hidden="true" />
            </div>
            <CardTitle className="mt-2">本地归档目录</CardTitle>
            <CardDescription>媒体文件的稳定落盘根目录。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <code className="rounded-lg border border-border-subtle bg-bg-surface p-3 text-xs leading-5 text-fg-secondary [overflow-wrap:anywhere]">
              {data.archive_dir}
            </code>
            <div className="flex items-start gap-2 text-xs leading-5 text-fg-tertiary">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>媒体删除仅在帖子浏览、媒体库和重复媒体中提供，并始终要求显式确认。</span>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
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
        title: `已登记 ${data.media_count.toLocaleString()} 个媒体资产`,
        detail: "包含已校验、缺失、损坏与处理中的全部状态。",
      },
      {
        id: "failure",
        tone: data.failure_count ? ("danger" as const) : ("success" as const),
        title: data.failure_count ? `${data.failure_count.toLocaleString()} 个失败项需要处理` : "失败队列当前为空",
        detail: data.failure_count ? "前往失败工作台查看原因并选择性重试。" : "当前没有报告失败的 Tweet 下载。",
      },
      {
        id: "exports",
        tone: data.exports.length ? ("success" as const) : ("idle" as const),
        title: data.exports.length ? `${data.exports.length} 个导出文件可用` : "还没有导出文件",
        detail: data.exports[0] ? `最近导出：${data.exports[0].name}` : "需要时可在系统操作中生成。",
      },
    ],
  };
}

function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <ManagementPageHeader
        eyebrow="归档管理"
        title="系统概览"
        description="正在读取归档摘要与需要关注的状态。"
        actions={<Skeleton className="h-9 w-44" />}
      />
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-32" />
        ))}
      </section>
      <section className="grid gap-4 xl:grid-cols-12">
        <Skeleton className="h-96 xl:col-span-7" />
        <Skeleton className="h-96 xl:col-span-5" />
      </section>
    </div>
  );
}
