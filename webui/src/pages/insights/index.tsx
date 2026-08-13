import { lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { Archive, Clock3, Database, FolderSearch, Tags, Users } from "lucide-react";
import { apiGet, type LibraryInsights } from "../../lib/api";
import { getDebugRedactProps, useDebugRedactionEnabled } from "../../lib/debug-redaction";
import { formatBytes } from "../../lib/utils";
import { statusLabel } from "../../lib/formatters";
import { Badge } from "../../components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { EmptyState } from "../../components/ui/empty-state";
import { ErrorState } from "../../components/ui/error-state";
import { Progress } from "../../components/ui/progress";
import { Skeleton } from "../../components/ui/skeleton";
import { StatCard } from "../../components/ui/stat-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";

const PublishedTimelineChart = lazy(() =>
  import("./components/insight-charts").then((module) => ({ default: module.PublishedTimelineChart })),
);
const ImportedTimelineChart = lazy(() =>
  import("./components/insight-charts").then((module) => ({ default: module.ImportedTimelineChart })),
);
const MediaTypeChart = lazy(() =>
  import("./components/insight-charts").then((module) => ({ default: module.MediaTypeChart })),
);

export function InsightsPage() {
  const debugRedactionEnabled = useDebugRedactionEnabled();
  const query = useQuery({
    queryKey: ["library-insights"],
    queryFn: () => apiGet<LibraryInsights>("/api/v1/library/insights"),
    retry: false,
  });

  if (query.isLoading) return <InsightsSkeleton />;
  if (query.isError || !query.data) {
    return <ErrorState title="归档洞察暂不可用" detail={String(query.error)} onRetry={() => query.refetch()} />;
  }

  const data = query.data;
  if (!data.overview.tweet_count && !data.overview.media_count) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader />
        <EmptyState
          icon={<Archive className="size-5" />}
          title="还没有可分析的归档数据"
          description="导入 Tweet 或产生媒体记录后，这里会显示基于数据库事实的只读洞察。"
        />
      </div>
    );
  }

  const organizationRate = percent(data.organization.organized_count, data.organization.total_count);
  const publishedRate = percent(data.completeness.published_at_count, data.completeness.tweet_count);
  const fileSizeRate = percent(data.completeness.media_file_size_count, data.completeness.media_count);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader />

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Tweet" value={data.overview.tweet_count.toLocaleString()} detail={`${data.overview.author_count} 位已知作者`} icon={<Archive className="size-4" />} />
        <StatCard label="媒体资产" value={data.overview.media_count.toLocaleString()} detail="数据库索引（全部状态）" icon={<Database className="size-4" />} tone="success" />
        <StatCard label="已知媒体体积" value={formatBytes(data.overview.known_media_bytes)} detail={`${fileSizeRate}% 资产有文件大小`} icon={<FolderSearch className="size-4" />} tone="warning" />
        <StatCard label="已知视频时长" value={formatDuration(data.overview.known_video_duration_ms)} detail={`${data.overview.source_count} 个未删除来源`} icon={<Clock3 className="size-4" />} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <Card>
          <CardHeader>
            <CardTitle>内容发布时间趋势</CardTitle>
            <CardDescription>按 Tweet 的真实 published_at 分月，展示最近 24 个有数据月份；不是下载活动趋势。</CardDescription>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<Skeleton className="h-72" />}>
              <PublishedTimelineChart rows={data.published_months} />
            </Suspense>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>媒体类型</CardTitle>
            <CardDescription>按媒体资产当前记录的类型统计。</CardDescription>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<Skeleton className="h-64" />}>
              <MediaTypeChart rows={data.media_types} />
            </Suspense>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>归档入库趋势</CardTitle>
          <CardDescription>按 Tweet 的 imported_at 分月，展示最近 24 个有数据月份；用于区分归档活动与内容发布时间。</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<Skeleton className="h-64" />}>
            <ImportedTimelineChart rows={data.imported_months} />
          </Suspense>
        </CardContent>
      </Card>

      <section className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>整理覆盖率</CardTitle>
            <CardDescription>标签、合集和私人备注任一存在即视为已整理；不会读取备注正文。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <CoverageRow label="任一整理" value={data.organization.organized_count} total={data.organization.total_count} />
            <CoverageRow label="带标签" value={data.organization.tagged_count} total={data.organization.total_count} />
            <CoverageRow label="加入合集" value={data.organization.collected_count} total={data.organization.total_count} />
            <CoverageRow label="带备注" value={data.organization.noted_count} total={data.organization.total_count} />
            <div className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-bg-surface px-3 py-2">
              <div className="flex items-center gap-2 text-sm font-medium text-fg-primary">
                <Tags className="size-4 text-brand" />
                当前整理覆盖
              </div>
              <Badge tone={organizationRate >= 80 ? "success" : organizationRate >= 40 ? "default" : "warning"}>{organizationRate}%</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>元数据完整率</CardTitle>
            <CardDescription>仅检查数据库字段是否存在，不扫描文件，也不校验文件内容。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <CoverageRow label="Tweet 发布时间" value={data.completeness.published_at_count} total={data.completeness.tweet_count} />
            <CoverageRow label="Tweet 作者" value={data.completeness.author_count} total={data.completeness.tweet_count} />
            <CoverageRow label="Tweet 正文" value={data.completeness.text_count} total={data.completeness.tweet_count} />
            <CoverageRow label="媒体文件大小" value={data.completeness.media_file_size_count} total={data.completeness.media_count} />
            <CoverageRow label="媒体 SHA-256" value={data.completeness.media_sha256_count} total={data.completeness.media_count} />
            <CoverageRow label="媒体尺寸" value={data.completeness.media_dimensions_count} total={data.completeness.media_count} />
            {data.completeness.video_count ? (
              <CoverageRow label="视频时长" value={data.completeness.video_duration_count} total={data.completeness.video_count} />
            ) : null}
            <div className="flex items-center justify-between gap-3 text-xs text-fg-tertiary">
              <span>发布时间可用于趋势图</span>
              <span className="tabular-nums">{publishedRate}%</span>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle>媒体空间占用最多的作者</CardTitle>
            <CardDescription>按数据库中已知 file_size 求和；未知大小不计入。</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            {data.top_authors.length ? (
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
                      <TableCell className="text-right tabular-nums">{row.tweet_count}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.media_count}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatBytes(row.known_bytes)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <EmptyState title="暂无作者空间统计" description="需要同时具备作者名和媒体资产记录。" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>来源发现状态</CardTitle>
            <CardDescription>同一 Tweet 被多个来源发现时只计一次；三项是独立快照，不代表严格的线性漏斗。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <SnapshotRow label="已发现" value={data.discovery.discovered_count} total={data.discovery.discovered_count} />
            <SnapshotRow label="由来源提交过下载" value={data.discovery.submitted_count} total={data.discovery.discovered_count} />
            <SnapshotRow label="当前已校验" value={data.discovery.verified_count} total={data.discovery.discovered_count} />
            <p className="text-xs leading-5 text-fg-tertiary">已校验 Tweet 也可能由文件导入或其他入口完成，因此不要求先存在来源下载提交记录。</p>
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>媒体状态分布</CardTitle>
          <CardDescription>所有数字来自 media_assets 当前数据库快照；页面不会触发 verify 或磁盘读取。</CardDescription>
        </CardHeader>
        <CardContent>
          {data.media_statuses.length ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {data.media_statuses.map((row) => (
                <div key={row.key} className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-bg-surface px-3 py-3">
                  <div>
                    <div className="text-sm font-medium text-fg-primary">{statusLabel(row.key)}</div>
                    <div className="mt-1 text-xs text-fg-tertiary">{formatBytes(row.known_bytes)} 已知体积</div>
                  </div>
                  <Badge tone={row.key === "verified" ? "success" : row.key.includes("fail") || row.key === "corrupt" ? "danger" : "secondary"}>{row.count.toLocaleString()}</Badge>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="暂无媒体状态" description="当前已有 Tweet，但还没有媒体资产记录。" />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PageHeader() {
  return (
    <section className="flex flex-col justify-between gap-3 md:flex-row md:items-end">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-fg-primary">归档洞察</h1>
        <p className="mt-1 text-sm text-fg-secondary">只读聚合当前数据库事实，不扫描磁盘、不访问 X、不修改归档状态。</p>
      </div>
      <Badge tone="secondary">数据库快照</Badge>
    </section>
  );
}

function CoverageRow({ label, value, total }: { label: string; value: number; total: number }) {
  const rate = percent(value, total);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="text-fg-secondary">{label}</span>
        <span className="tabular-nums font-medium text-fg-primary">{value.toLocaleString()} / {total.toLocaleString()} · {rate}%</span>
      </div>
      <Progress value={rate} aria-label={`${label} ${rate}%`} />
    </div>
  );
}

function SnapshotRow({ label, value, total }: { label: string; value: number; total: number }) {
  const rate = percent(value, total);
  return (
    <div className="flex items-center gap-3">
      <div className="flex size-9 items-center justify-center rounded-lg bg-brand-soft text-brand">
        <Users className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-fg-primary">{label}</span>
          <span className="text-sm tabular-nums text-fg-secondary">{value.toLocaleString()}</span>
        </div>
        <Progress className="mt-2" value={rate} aria-label={`${label} ${rate}%`} />
      </div>
    </div>
  );
}

function InsightsSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-36" />)}
      </div>
      <div className="grid gap-4 xl:grid-cols-[1.35fr_0.65fr]">
        <Skeleton className="h-96" />
        <Skeleton className="h-96" />
      </div>
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
