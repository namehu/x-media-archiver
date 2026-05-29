import { useMemo, useState } from "react";
import { Files, Gauge, GitCompare, HardDrive, Image as ImageIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiGet, type DuplicatesResponse, type MediaRow } from "../lib/api";
import { useFormatters, useI18n } from "../lib/i18n";
import { formatBytes } from "../lib/utils";
import { Badge } from "../components/ui-next/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui-next/card";
import { EmptyState } from "../components/ui-next/empty-state";
import { ErrorState } from "../components/ui-next/error-state";
import { MediaThumbnail } from "../components/ui-next/media-thumbnail";
import { Pagination } from "../components/ui-next/pagination";
import { Skeleton } from "../components/ui-next/skeleton";
import { StatCard } from "../components/ui-next/stat-card";

const PAGE_SIZE = 100;

export function DuplicatesPage() {
  const { t } = useI18n();
  const { mediaTypeLabel } = useFormatters();
  const [offset, setOffset] = useState(0);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["duplicates", offset],
    queryFn: () => apiGet<DuplicatesResponse>(`/api/v1/library/duplicates?limit=${PAGE_SIZE}&offset=${offset}`),
  });

  const rows = data?.rows ?? [];
  const model = useMemo(() => buildDuplicateModel(rows, data?.duplicate_groups ?? 0), [rows, data?.duplicate_groups]);

  if (isLoading) return <DuplicatesSkeleton />;
  if (error) return <ErrorState title={t("common.apiUnavailable")} detail={String(error)} onRetry={() => void refetch()} />;

  return (
    <div className="space-y-5">
      <section className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-fg-primary">{t("duplicates.title")}</h1>
          <p className="mt-1 text-sm text-fg-secondary">
            {model.groupCount.toLocaleString()} {t("duplicates.groups")} · {model.fileCount.toLocaleString()} {t("duplicates.files")}
          </p>
        </div>
        {data ? (
          <Pagination
            offset={offset}
            count={data.count}
            totalCount={data.total_count}
            pageSize={PAGE_SIZE}
            onOffsetChange={setOffset}
            label={t("common.pagination.range")}
          />
        ) : null}
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t("operations.resultField.duplicateGroups")}
          value={model.groupCount.toLocaleString()}
          detail={t("duplicates.title")}
          icon={<GitCompare className="h-4 w-4" />}
          tone={model.groupCount ? "warning" : "success"}
          sparklineData={model.groupSizes}
        />
        <StatCard
          label={t("duplicates.files")}
          value={model.fileCount.toLocaleString()}
          detail={t("common.pagination.range", {
            start: data?.total_count ? offset + 1 : 0,
            end: Math.min(offset + (data?.count ?? 0), data?.total_count ?? 0),
            total: data?.total_count ?? 0,
          })}
          icon={<Files className="h-4 w-4" />}
          tone="brand"
        />
        <StatCard
          label={t("operations.resultField.checked")}
          value={formatBytes(model.duplicateBytes)}
          detail={t("operations.resultField.path")}
          icon={<HardDrive className="h-4 w-4" />}
          tone={model.duplicateBytes ? "warning" : "brand"}
        />
        <StatCard
          label={t("common.media.media")}
          value={model.dominantMediaType ? mediaTypeLabel(model.dominantMediaType) : "-"}
          detail={model.dominantMediaTypeCount ? `${model.dominantMediaTypeCount} ${t("duplicates.files")}` : t("duplicates.empty")}
          icon={<ImageIcon className="h-4 w-4" />}
          tone="brand"
        />
      </section>

      {model.groups.length ? (
        <section className="space-y-4">
          {model.groups.map((group) => (
            <DuplicateGroupCard key={group.sha256} group={group} mediaTypeLabel={mediaTypeLabel} />
          ))}
          {data && data.rows.length > 0 ? (
            <Pagination
              offset={offset}
              count={data.count}
              totalCount={data.total_count}
              pageSize={PAGE_SIZE}
              onOffsetChange={setOffset}
              label={t("common.pagination.range")}
            />
          ) : null}
        </section>
      ) : (
        <EmptyState icon={<GitCompare className="h-5 w-5" />} title={t("duplicates.empty")} description={t("dashboard.trendClean")} />
      )}
    </div>
  );
}

function DuplicateGroupCard({
  group,
  mediaTypeLabel,
}: {
  group: DuplicateGroup;
  mediaTypeLabel: (mediaType?: string | null) => string;
}) {
  const { t } = useI18n();
  const primary = group.rows[0];
  const compareRows = group.rows.slice(0, 4);
  const extraCount = Math.max(0, group.rows.length - compareRows.length);

  return (
    <Card className="overflow-hidden hover:border-border-strong hover:shadow-2">
      <CardHeader className="gap-3">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2">
              <Badge tone="warning">{group.displayCount} {t("duplicates.files")}</Badge>
              <span className="break-all font-mono text-sm font-semibold text-fg-primary">{group.shortHash}</span>
            </CardTitle>
            <CardDescription className="mt-1 break-all">{group.sha256}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone="secondary">{formatBytes(group.totalSize)}</Badge>
            <Badge tone="default">{mediaTypeLabel(primary?.media_type)}</Badge>
          </div>
        </div>
        <HashMatchBar count={group.displayCount} max={group.maxCount} />
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-4">
          {compareRows.map((row, index) => (
            <DuplicateMediaCard key={`${row.tweet_id}-${row.media_index ?? index}-${index}`} row={row} index={index} />
          ))}
        </div>
        {extraCount ? (
          <div className="rounded-lg border border-border-subtle bg-bg-surface p-3 text-sm text-fg-secondary">
            +{extraCount} {t("duplicates.files")}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DuplicateMediaCard({ row, index }: { row: MediaRow; index: number }) {
  const { t } = useI18n();
  const { mediaTypeLabel } = useFormatters();
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-border-subtle bg-bg-surface transition duration-fast hover:border-border-strong">
      <MediaThumbnail src={row.media_url} mediaType={row.media_type} alt={row.tweet_text || row.tweet_id} className="rounded-b-none" />
      <div className="space-y-3 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase text-fg-tertiary">
              {t("common.media.media")} #{index + 1}
            </div>
            <Link className="mt-1 block truncate text-sm font-semibold text-brand hover:text-brand-hover" to={`/tweets/${row.tweet_id}`}>
              {t("duplicates.tweetDetail")}
            </Link>
          </div>
          <Badge tone="secondary">{mediaTypeLabel(row.media_type)}</Badge>
        </div>
        <div className="grid gap-2 text-xs text-fg-secondary">
          <div className="flex items-center justify-between gap-3">
            <span>{t("operations.resultField.rows")}</span>
            <span className="tabular-nums text-fg-primary">{formatBytes(row.file_size)}</span>
          </div>
          <div className="min-w-0 break-all rounded-md bg-bg-elevated px-2 py-1 font-mono text-[11px] text-fg-tertiary">
            {row.local_path || row.media_relative_path || "-"}
          </div>
        </div>
      </div>
    </div>
  );
}

function HashMatchBar({ count, max }: { count: number; max: number }) {
  const { t } = useI18n();
  const percent = max ? Math.max(10, Math.round((count / max) * 100)) : 0;
  return (
    <div className="rounded-lg border border-border-subtle bg-bg-surface p-3">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs font-medium text-fg-secondary">
        <span className="inline-flex items-center gap-1">
          <Gauge className="h-3.5 w-3.5 text-brand" />
          SHA-256
        </span>
        <span>
          {count} / {max || count} {t("duplicates.files")}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-bg-muted">
        <div className="h-full rounded-full bg-brand" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function DuplicatesSkeleton() {
  const { t } = useI18n();
  return (
    <div className="space-y-5">
      <section>
        <h1 className="text-2xl font-bold tracking-tight text-fg-primary">{t("duplicates.title")}</h1>
        <p className="mt-1 text-sm text-fg-secondary">{t("duplicates.loading")}</p>
      </section>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-32 rounded-lg" />
        ))}
      </div>
      {Array.from({ length: 3 }).map((_, index) => (
        <Card key={index}>
          <CardContent className="space-y-4 p-4">
            <Skeleton className="h-12" />
            <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-4">
              {Array.from({ length: 4 }).map((__, childIndex) => (
                <Skeleton key={childIndex} className="aspect-video rounded-lg" />
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

type DuplicateGroup = {
  sha256: string;
  shortHash: string;
  rows: MediaRow[];
  displayCount: number;
  totalSize: number;
  maxCount: number;
};

function buildDuplicateModel(rows: MediaRow[], duplicateGroups: number) {
  const groupsByHash = new Map<string, MediaRow[]>();
  const mediaTypeCounts = new Map<string, number>();
  let duplicateBytes = 0;
  for (const row of rows) {
    const sha = row.sha256 || "-";
    const group = groupsByHash.get(sha) ?? [];
    group.push(row);
    groupsByHash.set(sha, group);
    if (row.media_type) mediaTypeCounts.set(row.media_type, (mediaTypeCounts.get(row.media_type) ?? 0) + 1);
    duplicateBytes += row.file_size ?? 0;
  }
  const maxCount = Math.max(0, ...rows.map((row) => row.duplicate_count ?? 0), ...[...groupsByHash.values()].map((group) => group.length));
  const groups = [...groupsByHash.entries()]
    .map(([sha256, groupRows]) => ({
      sha256,
      shortHash: sha256 === "-" ? "-" : `${sha256.slice(0, 10)}...${sha256.slice(-8)}`,
      rows: groupRows,
      displayCount: Math.max(groupRows[0]?.duplicate_count ?? groupRows.length, groupRows.length),
      totalSize: groupRows.reduce((sum, row) => sum + (row.file_size ?? 0), 0),
      maxCount,
    }))
    .sort((a, b) => b.displayCount - a.displayCount);
  const [dominantMediaType, dominantMediaTypeCount = 0] = [...mediaTypeCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];

  return {
    groups,
    groupCount: duplicateGroups || groups.length,
    fileCount: rows.length,
    duplicateBytes,
    dominantMediaType,
    dominantMediaTypeCount,
    groupSizes: groups.map((group) => group.displayCount).slice(0, 12),
  };
}
