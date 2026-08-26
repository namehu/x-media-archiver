import { lazy, Suspense, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Archive } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { apiGet, type InsightDistribution, type LibraryInsights } from "@/lib/api";
import { getDebugRedactProps, useDebugRedactionEnabled } from "@/lib/debug-redaction";
import { statusLabel } from "@/lib/formatters";
import { formatBytes } from "@/lib/utils";

const PublishedTimelineChart = lazy(() =>
  import("./components/insight-charts").then((module) => ({ default: module.PublishedTimelineChart })),
);
const ImportedTimelineChart = lazy(() =>
  import("./components/insight-charts").then((module) => ({ default: module.ImportedTimelineChart })),
);

export function InsightsPage() {
  const debugRedactionEnabled = useDebugRedactionEnabled();
  const query = useQuery({
    queryKey: ["library-insights"],
    queryFn: () => apiGet<LibraryInsights>("/api/v1/library/insights"),
    retry: false,
  });

  return (
    <div className="min-h-full">
      <main className="mx-auto min-h-full max-w-[1120px] border-x border-border-subtle bg-bg-base">
        <PageHeader />
        {query.isLoading ? <InsightsSkeleton /> : null}
        {query.isError || !query.data ? (
          <div className="p-4 sm:p-6">
            <ErrorState title="归档洞察暂不可用" detail={String(query.error)} onRetry={() => void query.refetch()} />
          </div>
        ) : null}
        {query.data && !query.data.overview.tweet_count && !query.data.overview.media_count ? (
          <div className="p-4 sm:p-6">
            <EmptyState
              icon={<Archive aria-hidden="true" />}
              title="还没有可分析的归档数据"
              description="导入 Tweet 或产生媒体记录后，这里会显示基于数据库事实的只读洞察。"
            />
          </div>
        ) : null}
        {query.data && (query.data.overview.tweet_count > 0 || query.data.overview.media_count > 0) ? (
          <InsightsContent data={query.data} debugRedactionEnabled={debugRedactionEnabled} />
        ) : null}
      </main>
    </div>
  );
}

function InsightsContent({ data, debugRedactionEnabled }: { data: LibraryInsights; debugRedactionEnabled: boolean }) {
  const fileSizeRate = percent(data.completeness.media_file_size_count, data.completeness.media_count);
  const organizationRate = percent(data.organization.organized_count, data.organization.total_count);

  return (
    <div>
      <section className="border-b border-border-subtle px-4 py-6 sm:px-6 lg:px-8" aria-labelledby="overview-heading">
        <div className="max-w-2xl">
          <h2 id="overview-heading" className="text-lg font-bold text-fg-primary">当前归档</h2>
          <p className="mt-1 text-sm leading-6 text-fg-secondary">
            只读聚合数据库事实，不扫描磁盘、不访问 X，也不会修改归档状态。
          </p>
        </div>
        <dl className="mt-6 grid grid-cols-2 gap-x-5 gap-y-6 lg:grid-cols-4">
          <OverviewMetric label="Tweet" value={data.overview.tweet_count.toLocaleString()} detail={`${data.overview.author_count} 位已知作者`} />
          <OverviewMetric label="媒体资产" value={data.overview.media_count.toLocaleString()} detail="全部数据库状态" />
          <OverviewMetric label="已知媒体体积" value={formatBytes(data.overview.known_media_bytes)} detail={`${fileSizeRate}% 资产记录了大小`} />
          <OverviewMetric label="已知视频时长" value={formatDuration(data.overview.known_video_duration_ms)} detail={`${data.overview.source_count} 个未删除来源`} />
        </dl>
      </section>

      <section className="border-b border-border-subtle px-4 py-6 sm:px-6 lg:px-8" aria-labelledby="timeline-heading">
        <div>
          <h2 id="timeline-heading" className="text-lg font-bold text-fg-primary">内容时间</h2>
          <p className="mt-1 text-sm leading-6 text-fg-secondary">发布时间与入库时间分开呈现，避免把历史内容误读成近期活跃。</p>
        </div>
        <div className="mt-6 grid gap-8 xl:grid-cols-[1.35fr_0.85fr]">
          <InsightBlock
            title="内容发布时间趋势"
            description="按 Tweet 的真实 published_at 分月，展示最近 24 个有数据月份；不是下载活动趋势。"
          >
            <Suspense fallback={<Skeleton className="h-72 w-full" />}>
              <PublishedTimelineChart rows={data.published_months} />
            </Suspense>
          </InsightBlock>
          <InsightBlock
            title="归档入库趋势"
            description="按 imported_at 分月，用来观察内容进入本地归档的节奏。"
          >
            <Suspense fallback={<Skeleton className="h-72 w-full" />}>
              <ImportedTimelineChart rows={data.imported_months} />
            </Suspense>
          </InsightBlock>
        </div>
      </section>

      <section className="grid border-b border-border-subtle xl:grid-cols-2">
        <InsightSection title="媒体类型" description="按媒体资产当前记录的类型统计。" className="xl:border-r">
          <DistributionRows rows={data.media_types} labelForKey={mediaTypeLabel} emptyText="暂无媒体类型统计" />
        </InsightSection>
        <InsightSection
          title="整理覆盖率"
          description="自定义标签、合集和私人备注任一存在即视为已整理；不会读取备注正文。"
        >
          <div className="flex flex-col gap-4">
            <CoverageRow label="任一整理" value={data.organization.organized_count} total={data.organization.total_count} />
            <CoverageRow label="带自定义标签" value={data.organization.tagged_count} total={data.organization.total_count} />
            <CoverageRow label="加入合集" value={data.organization.collected_count} total={data.organization.total_count} />
            <CoverageRow label="带备注" value={data.organization.noted_count} total={data.organization.total_count} />
            <div className="flex items-center justify-between gap-3 border-t border-border-subtle pt-4">
              <span className="text-sm font-semibold text-fg-primary">当前整理覆盖</span>
              <Badge tone={organizationRate >= 80 ? "success" : organizationRate >= 40 ? "default" : "warning"}>
                {organizationRate}%
              </Badge>
            </div>
          </div>
        </InsightSection>
      </section>

      <InsightSection
        title="元数据完整率"
        description="仅检查数据库字段是否存在，不扫描文件，也不校验文件内容。"
        className="border-b"
      >
        <div className="grid gap-x-10 gap-y-4 md:grid-cols-2">
          <CoverageRow label="Tweet 发布时间" value={data.completeness.published_at_count} total={data.completeness.tweet_count} />
          <CoverageRow label="Tweet 作者" value={data.completeness.author_count} total={data.completeness.tweet_count} />
          <CoverageRow label="Tweet 正文" value={data.completeness.text_count} total={data.completeness.tweet_count} />
          <CoverageRow label="媒体文件大小" value={data.completeness.media_file_size_count} total={data.completeness.media_count} />
          <CoverageRow label="媒体 SHA-256" value={data.completeness.media_sha256_count} total={data.completeness.media_count} />
          <CoverageRow label="媒体尺寸" value={data.completeness.media_dimensions_count} total={data.completeness.media_count} />
          {data.completeness.video_count ? (
            <CoverageRow label="视频时长" value={data.completeness.video_duration_count} total={data.completeness.video_count} />
          ) : null}
        </div>
      </InsightSection>

      <section className="grid border-b border-border-subtle xl:grid-cols-[1.15fr_0.85fr]">
        <InsightSection
          title="媒体空间占用最多的作者"
          description="按数据库中已知 file_size 求和；未知大小不计入。"
          className="min-w-0 xl:border-r"
        >
          {data.top_authors.length ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>作者</TableHead>
                    <TableHead className="text-right">Tweet</TableHead>
                    <TableHead className="text-right">媒体</TableHead>
                    <TableHead className="text-right">已知体积</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody {...getDebugRedactProps(debugRedactionEnabled)}>
                  {data.top_authors.map((row) => (
                    <TableRow key={row.author_username}>
                      <TableCell className="font-medium">@{row.author_username}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.tweet_count.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.media_count.toLocaleString()}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatBytes(row.known_bytes)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <EmptyState title="暂无作者空间统计" description="需要同时具备作者名和媒体资产记录。" />
          )}
        </InsightSection>
        <InsightSection
          title="来源发现状态"
          description="三项是独立数据库快照，不代表严格的线性漏斗。"
        >
          <div className="flex flex-col gap-4">
            <CoverageRow label="已发现" value={data.discovery.discovered_count} total={data.discovery.discovered_count} />
            <CoverageRow label="由来源提交过下载" value={data.discovery.submitted_count} total={data.discovery.discovered_count} />
            <CoverageRow label="当前已校验" value={data.discovery.verified_count} total={data.discovery.discovered_count} />
            <p className="text-xs leading-5 text-fg-tertiary">
              已校验 Tweet 也可能由文件导入或其他入口完成，因此不要求先存在来源下载提交记录。
            </p>
          </div>
        </InsightSection>
      </section>

      <InsightSection
        title="媒体状态分布"
        description="所有数字来自 media_assets 当前数据库快照；页面不会触发 verify 或磁盘读取。"
      >
        {data.media_statuses.length ? (
          <div className="grid gap-x-8 sm:grid-cols-2 xl:grid-cols-4">
            {data.media_statuses.map((row) => (
              <div key={row.key} className="flex items-center justify-between gap-3 border-b border-border-subtle py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-fg-primary">{statusLabel(row.key)}</p>
                  <p className="mt-0.5 text-xs tabular-nums text-fg-tertiary">{formatBytes(row.known_bytes)} 已知体积</p>
                </div>
                <Badge tone={statusTone(row.key)}>{row.count.toLocaleString()}</Badge>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="暂无媒体状态" description="当前已有 Tweet，但还没有媒体资产记录。" />
        )}
      </InsightSection>
    </div>
  );
}

function PageHeader() {
  return (
    <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border-subtle bg-bg-base/95 px-4 backdrop-blur sm:px-6 lg:px-8">
      <h1 className="truncate text-xl font-bold tracking-tight text-fg-primary">归档洞察</h1>
      <Badge tone="secondary">数据库快照</Badge>
    </header>
  );
}

function OverviewMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-fg-tertiary">{label}</dt>
      <dd className="mt-1 truncate text-2xl font-bold tracking-tight tabular-nums text-fg-primary sm:text-3xl">{value}</dd>
      <dd className="mt-1 truncate text-xs text-fg-secondary">{detail}</dd>
    </div>
  );
}

function InsightBlock({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <h3 className="text-sm font-bold text-fg-primary">{title}</h3>
      <p className="mt-1 min-h-10 text-xs leading-5 text-fg-tertiary">{description}</p>
      <div className="mt-3">{children}</div>
    </div>
  );
}

function InsightSection({
  title,
  description,
  className = "",
  children,
}: {
  title: string;
  description: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`px-4 py-6 sm:px-6 lg:px-8 ${className}`}>
      <h2 className="text-lg font-bold text-fg-primary">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-fg-secondary">{description}</p>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function DistributionRows({
  rows,
  labelForKey,
  emptyText,
}: {
  rows: InsightDistribution[];
  labelForKey: (key: string) => string;
  emptyText: string;
}) {
  if (!rows.length) return <EmptyState title={emptyText} description="媒体资产入库后会在这里汇总。" />;
  const maxCount = Math.max(...rows.map((row) => row.count), 1);

  return (
    <div className="flex flex-col gap-4">
      {rows.map((row) => {
        const width = Math.round((row.count / maxCount) * 100);
        return (
          <div key={row.key}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="font-medium text-fg-primary">{labelForKey(row.key)}</span>
              <span className="tabular-nums text-fg-secondary">
                {row.count.toLocaleString()} · {formatBytes(row.known_bytes)}
              </span>
            </div>
            <Progress className="mt-2 h-2" value={width} aria-label={`${labelForKey(row.key)} ${row.count} 项`} />
          </div>
        );
      })}
    </div>
  );
}

function CoverageRow({ label, value, total }: { label: string; value: number; total: number }) {
  const rate = percent(value, total);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="text-fg-secondary">{label}</span>
        <span className="shrink-0 tabular-nums font-medium text-fg-primary">
          {value.toLocaleString()} / {total.toLocaleString()} · {rate}%
        </span>
      </div>
      <Progress className="mt-2 h-1.5" value={rate} aria-label={`${label} ${rate}%`} />
    </div>
  );
}

function InsightsSkeleton() {
  return (
    <div>
      <section className="border-b border-border-subtle px-4 py-6 sm:px-6 lg:px-8">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="mt-3 h-4 w-full max-w-xl" />
        <div className="mt-6 grid grid-cols-2 gap-6 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="flex flex-col gap-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-8 w-28 max-w-full" />
              <Skeleton className="h-3 w-24 max-w-full" />
            </div>
          ))}
        </div>
      </section>
      <section className="px-4 py-6 sm:px-6 lg:px-8">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="mt-3 h-4 w-full max-w-lg" />
        <div className="mt-6 grid gap-8 xl:grid-cols-[1.35fr_0.85fr]">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
      </section>
    </div>
  );
}

function percent(value: number, total: number) {
  if (!total) return 0;
  return Math.min(100, Math.round((value / total) * 100));
}

function formatDuration(value: number) {
  if (!value) return "-";
  const totalMinutes = Math.round(value / 60000);
  if (totalMinutes < 60) return `${totalMinutes} 分钟`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`;
}

function mediaTypeLabel(value: string) {
  if (value === "photo") return "图片";
  if (value === "video") return "视频";
  return "未知";
}

function statusTone(key: string): "success" | "danger" | "secondary" {
  if (key === "verified") return "success";
  if (key.includes("fail") || key === "corrupt") return "danger";
  return "secondary";
}
