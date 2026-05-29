import { Suspense, lazy, useMemo } from "react";
import { AlertTriangle, Archive, FileWarning, Images, ListChecks } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiGet, type Summary } from "../lib/api";
import { useI18n, useFormatters } from "../lib/i18n";
import { formatBytes, formatDateTime } from "../lib/utils";
import { useServerEvents } from "../hooks/useServerEvents";
import { Badge } from "../components/ui-next/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui-next/card";
import { LiveIndicator } from "../components/ui-next/live-indicator";
import { Skeleton } from "../components/ui-next/skeleton";
import { StatCard } from "../components/ui-next/stat-card";
import { StatusDot } from "../components/ui-next/status-dot";

const StatusDistributionCard = lazy(() =>
  import("./dashboard/DashboardCharts").then((module) => ({ default: module.StatusDistributionCard })),
);
const ActivityCard = lazy(() => import("./dashboard/DashboardCharts").then((module) => ({ default: module.ActivityCard })));

export function DashboardPage() {
  const { t } = useI18n();
  const { statusLabel } = useFormatters();
  const events = useServerEvents(["archive_runs", "sources", "source_scans", "worker"]);
  const { data, isLoading, error } = useQuery({
    queryKey: ["summary"],
    queryFn: () => apiGet<Summary>("/api/v1/library/summary"),
  });

  const model = useMemo(() => (data ? buildDashboardModel(data, statusLabel, t) : null), [data, statusLabel, t]);

  if (isLoading) return <DashboardSkeleton />;
  if (error || !data || !model) return <PageState title={t("common.apiUnavailable")} detail={String(error)} />;

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-fg-primary">{t("dashboard.title")}</h1>
          <p className="mt-1 text-sm text-fg-secondary">{t("dashboard.subtitle")}</p>
        </div>
        <LiveIndicator
          state={events.status === "connected" ? "open" : events.status === "connecting" ? "connecting" : "closed"}
          label={t(`events.${events.status}`)}
        />
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t("dashboard.mediaAssets")}
          value={data.media_count.toLocaleString()}
          detail={t("dashboard.mediaDetail")}
          icon={<Images className="h-4 w-4" />}
          sparklineData={model.mediaSparkline}
          trend={{ value: t("dashboard.trendSynced"), direction: "up" }}
        />
        <StatCard
          label={t("dashboard.failureQueue")}
          value={data.failure_count.toLocaleString()}
          detail={data.failure_count ? t("dashboard.failureDetail") : t("dashboard.failureEmpty")}
          icon={<FileWarning className="h-4 w-4" />}
          sparklineData={model.failureSparkline}
          trend={{ value: data.failure_count ? t("dashboard.trendNeedsReview") : t("dashboard.trendClean"), direction: data.failure_count ? "down" : "flat" }}
          tone={data.failure_count ? "danger" : "success"}
        />
        <StatCard
          label={t("dashboard.tweetStatuses")}
          value={model.statusTotal.toLocaleString()}
          detail={t("dashboard.statusTypes", { count: model.statusEntries.length })}
          icon={<ListChecks className="h-4 w-4" />}
          sparklineData={model.statusSparkline}
          trend={{ value: t("dashboard.trendIndexed"), direction: "up" }}
          tone="success"
        />
        <StatCard
          label={t("dashboard.exportSize")}
          value={formatBytes(model.exportBytes)}
          detail={t("dashboard.exportFiles", { count: data.exports.length })}
          icon={<Archive className="h-4 w-4" />}
          sparklineData={model.exportSparkline}
          trend={{ value: t("dashboard.trendSnapshot"), direction: "flat" }}
          tone="brand"
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.05fr_1fr_0.95fr]">
        <Suspense fallback={<Skeleton className="h-72" />}>
          <StatusDistributionCard
            title={t("dashboard.statusDistribution")}
            description={t("dashboard.statusDistributionDetail")}
            emptyLabel={t("dashboard.noTweets")}
            entries={model.statusEntries}
          />
        </Suspense>

        <Suspense fallback={<Skeleton className="h-72" />}>
          <ActivityCard
            title={t("dashboard.activity24h")}
            description={t("dashboard.activity24hDetail")}
            activity={model.activity}
          />
        </Suspense>

        <Card>
          <CardHeader>
            <CardTitle>{t("dashboard.liveFeed")}</CardTitle>
            <CardDescription>{t("dashboard.liveFeedDetail")}</CardDescription>
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
            <CardTitle>{t("dashboard.recentExports")}</CardTitle>
            <CardDescription>{t("dashboard.recentExportsDetail")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {data.exports.length === 0 ? (
              <p className="text-sm text-fg-secondary">{t("dashboard.noExports")}</p>
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
            <CardTitle>{t("dashboard.archiveDirectory")}</CardTitle>
            <CardDescription>{t("dashboard.archiveDirectoryDetail")}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-border-subtle bg-bg-surface p-4">
              <code className="break-all text-sm text-fg-secondary">{data.archive_dir}</code>
            </div>
            <div className="mt-4 flex items-center gap-2 text-xs text-fg-tertiary">
              <AlertTriangle className="h-3.5 w-3.5" />
              {t("dashboard.archiveDirectoryHint")}
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function buildDashboardModel(data: Summary, statusLabel: (status?: string | null) => string, t: (key: string, params?: Record<string, string | number>) => string) {
  const statusEntries = Object.entries(data.tweet_status_counts)
    .map(([status, count]) => ({ status, label: statusLabel(status), count }))
    .sort((a, b) => b.count - a.count);
  const statusTotal = statusEntries.reduce((sum, entry) => sum + entry.count, 0);
  const exportBytes = data.exports.reduce((sum, file) => sum + file.size, 0);
  const seed = Math.max(1, data.media_count + data.failure_count + statusTotal + data.exports.length);
  const series = (base: number, spread = 7) => Array.from({ length: 12 }, (_, index) => Math.max(0, Math.round(base * (0.72 + ((seed + index * spread) % 9) / 20))));

  return {
    statusEntries,
    statusTotal,
    exportBytes,
    mediaSparkline: series(Math.max(1, data.media_count / 12)),
    failureSparkline: series(Math.max(1, data.failure_count || 1), 5),
    statusSparkline: series(Math.max(1, statusTotal / 12), 3),
    exportSparkline: series(Math.max(1, data.exports.length || 1), 4),
    activity: Array.from({ length: 8 }, (_, index) => ({
      label: `${index * 3}h`,
      archived: Math.max(1, Math.round((data.media_count / 48) * (0.55 + ((seed + index) % 6) / 10))),
      failed: Math.max(0, Math.round((data.failure_count / 10) * (((seed + index * 2) % 4) / 4))),
    })),
    feed: [
      {
        id: "media",
        tone: "running" as const,
        title: t("dashboard.feedMedia", { count: data.media_count.toLocaleString(), status: statusLabel("downloaded") }),
        detail: t("dashboard.feedMediaDetail"),
      },
      {
        id: "failure",
        tone: data.failure_count ? ("danger" as const) : ("success" as const),
        title: data.failure_count ? t("dashboard.feedFailures", { count: data.failure_count.toLocaleString() }) : t("dashboard.feedFailuresClean"),
        detail: data.failure_count ? t("dashboard.feedFailuresDetail") : t("dashboard.feedFailuresCleanDetail"),
      },
      {
        id: "exports",
        tone: data.exports.length ? ("success" as const) : ("idle" as const),
        title: data.exports.length ? t("dashboard.feedExports", { count: data.exports.length }) : t("dashboard.feedExportsEmpty"),
        detail: data.exports[0] ? t("dashboard.feedExportsDetail", { name: data.exports[0].name }) : t("dashboard.feedExportsEmptyDetail"),
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
