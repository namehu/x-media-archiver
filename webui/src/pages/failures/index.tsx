import { useMemo, useState } from "react";
import { AlertTriangle, Bug, ChevronDown, ExternalLink, RefreshCw } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { ColumnDef } from "@tanstack/react-table";
import { apiGet, apiPost, type ActionResponse, type FailureRow, type PageResponse } from "../../lib/api";
import { errorLabel, statusLabel } from "../../lib/formatters";
import { formatDateTime } from "../../lib/utils";
import { Badge, type BadgeProps } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Checkbox } from "../../components/ui/checkbox";
import { DataTable } from "../../components/ui/data-table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { EmptyState } from "../../components/ui/empty-state";
import { ErrorState } from "../../components/ui/error-state";
import { Pagination } from "../../components/ui/pagination";
import { Skeleton } from "../../components/ui/skeleton";
import { StatCard } from "../../components/ui/stat-card";
import {
  getDebugDetailLinkLabel,
  getDebugDetailRoute,
  getDebugRedactProps,
  getDebugSelectionLabel,
  useDebugRedactionEnabled,
} from "../../lib/debug-redaction";

const PAGE_SIZE = 100;
const REQUEUE_STATUSES = ["failed_retryable", "missing", "corrupt", "failed_permanent"];

export function FailuresPage() {
  const debugRedactionEnabled = useDebugRedactionEnabled();
  const queryClient = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["failures", offset],
    queryFn: () => apiGet<PageResponse<FailureRow>>(`/api/v1/library/failures?limit=${PAGE_SIZE}&offset=${offset}`),
  });

  const rows = data?.rows ?? [];
  const model = useMemo(() => buildFailureModel(rows, data?.total_count ?? 0), [rows, data?.total_count]);
  const selectedCount = selectedIds.size;
  const pageIds = useMemo(() => rows.map((row) => row.tweet_id), [rows]);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const requeueMutation = useMutation({
    mutationFn: (limit: number | null) =>
      apiPost<ActionResponse>("/api/v1/actions/requeue", {
        statuses: REQUEUE_STATUSES,
        limit,
      }),
    onSuccess: async () => {
      setSelectedIds(new Set());
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["failures"] }),
        queryClient.invalidateQueries({ queryKey: ["archive-runs"] }),
        queryClient.invalidateQueries({ queryKey: ["summary"] }),
      ]);
    },
  });

  const columns = useMemo<ColumnDef<FailureRow>[]>(
    () => [
      {
        id: "select",
        header: () => (
          <Checkbox
            checked={allPageSelected}
            aria-label="全部状态"
            onCheckedChange={(checked) => {
              setSelectedIds((current) => {
                const next = new Set(current);
                if (checked) pageIds.forEach((id) => next.add(id));
                else pageIds.forEach((id) => next.delete(id));
                return next;
              });
            }}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={selectedIds.has(row.original.tweet_id)}
            aria-label={getDebugSelectionLabel(debugRedactionEnabled, row.original.tweet_id)}
            onClick={(event) => event.stopPropagation()}
            onCheckedChange={(checked) => {
              setSelectedIds((current) => {
                const next = new Set(current);
                if (checked) next.add(row.original.tweet_id);
                else next.delete(row.original.tweet_id);
                return next;
              });
            }}
          />
        ),
      },
      {
        header: "Tweet",
        cell: ({ row }) => <FailureTweetCell row={row.original} />,
      },
      {
        header: "状态",
        cell: ({ row }) => (
          <Badge tone={failureTone(row.original.latest_error_category || row.original.tweet_status)}>
            {errorLabel(row.original.latest_error_category) !== "-"
              ? errorLabel(row.original.latest_error_category)
              : statusLabel(row.original.tweet_status)}
          </Badge>
        ),
      },
      {
        header: "引擎",
        cell: ({ row }) => <span className="text-fg-secondary">{row.original.latest_engine || "-"}</span>,
      },
      {
        header: "重试次数",
        cell: ({ row }) => <span className="tabular-nums">{row.original.retry_count ?? 0}</span>,
      },
      {
        header: "完成时间",
        cell: ({ row }) => <span className="whitespace-nowrap text-fg-secondary">{formatDateTime(row.original.latest_finished_at)}</span>,
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => <FailureActions row={row.original} />,
      },
    ],
    [allPageSelected, debugRedactionEnabled, errorLabel, pageIds, selectedIds],
  );

  if (isLoading) return <FailuresSkeleton />;
  if (error) return <ErrorState title="API 不可用" detail={String(error)} onRetry={() => void refetch()} />;

  return (
    <div className="space-y-5">
      <section className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-fg-primary">失败队列</h1>
          <p className="mt-1 text-sm text-fg-secondary">需要排查或重试</p>
        </div>
        <Button
          type="button"
          variant={selectedCount ? "default" : "outline"}
          disabled={requeueMutation.isPending || rows.length === 0}
          onClick={() => requeueMutation.mutate(selectedCount || PAGE_SIZE)}
        >
          <RefreshCw className="h-4 w-4" />
          重新入队
          {selectedCount ? <span className="tabular-nums">{selectedCount}</span> : null}
        </Button>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="失败队列"
          value={model.total.toLocaleString()}
          detail={`第 ${data?.total_count ? offset + 1 : 0}-${Math.min(offset + (data?.count ?? 0), data?.total_count ?? 0)} 项，共 ${data?.total_count ?? 0} 项`}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={model.total ? "danger" : "success"}
          sparklineData={model.sparkline}
        />
        <StatCard
          label="可重试失败"
          value={model.retryable.toLocaleString()}
          detail="重试永久失败项"
          icon={<RefreshCw className="h-4 w-4" />}
          tone={model.retryable ? "warning" : "success"}
        />
        <StatCard
          label={model.topCategory.label}
          value={model.topCategory.count.toLocaleString()}
          detail="最近错误"
          icon={<Bug className="h-4 w-4" />}
          tone={model.topCategory.count ? "danger" : "brand"}
        />
        <StatCard
          label="重试次数"
          value={model.retryTotal.toLocaleString()}
          detail="最近尝试"
          icon={<ChevronDown className="h-4 w-4" />}
          tone={model.retryTotal ? "warning" : "brand"}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader>
            <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
              <div>
                <CardTitle>最近错误</CardTitle>
                <CardDescription>打开 Failures 页面查看可重试项。</CardDescription>
              </div>
              {data ? (
                <Pagination
                  offset={offset}
                  count={data.count}
                  totalCount={data.total_count}
                  pageSize={PAGE_SIZE}
                  onOffsetChange={(next) => {
                    setSelectedIds(new Set());
                    setOffset(next);
                  }}
                  label="第 {start}-{end} 项，共 {total} 项"
                />
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {requeueMutation.error ? (
              <div className="rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-danger">{String(requeueMutation.error)}</div>
            ) : null}
            {rows.length ? (
              <DataTable columns={columns} data={rows} />
            ) : (
              <EmptyState icon={<AlertTriangle className="h-5 w-5" />} title="没有失败项。" description="暂无失败项" />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>调试详情</CardTitle>
            <CardDescription>最近错误</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {model.clusters.length ? (
              model.clusters.map((cluster) => (
                <div key={cluster.label} className="rounded-lg border border-border-subtle bg-bg-surface p-3">
                  <div className="flex items-center justify-between gap-3">
                    <Badge tone={failureTone(cluster.label)}>{cluster.label}</Badge>
                    <span className="text-sm font-semibold tabular-nums text-fg-primary">{cluster.count}</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-bg-muted">
                    <div className="h-full rounded-full bg-danger" style={{ width: `${cluster.percent}%` }} />
                  </div>
                </div>
              ))
            ) : (
              <p className="rounded-lg border border-border-subtle bg-bg-surface p-4 text-sm text-fg-secondary">最近没有错误。</p>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function FailureTweetCell({ row }: { row: FailureRow }) {
  const debugRedactionEnabled = useDebugRedactionEnabled();
  const detailRoute = getDebugDetailRoute(debugRedactionEnabled, row.tweet_id);
  return (
    <div className="min-w-0">
      {detailRoute ? (
        <Link className="font-semibold text-brand hover:text-brand-hover" to={detailRoute} {...getDebugRedactProps(debugRedactionEnabled)}>
          {row.tweet_id}
        </Link>
      ) : (
        <span className="font-semibold text-fg-tertiary">{getDebugDetailLinkLabel(debugRedactionEnabled)}</span>
      )}
      <div className="mt-1 truncate text-xs text-fg-secondary" {...getDebugRedactProps(debugRedactionEnabled)}>
        @{row.author_username || "-"}
      </div>
      {row.latest_error_message || row.last_error ? (
        <div className="mt-2 line-clamp-2 max-w-xl rounded-md border border-danger/20 bg-danger/10 px-2 py-1 text-xs text-danger">
          {row.latest_error_message || row.last_error}
        </div>
      ) : null}
    </div>
  );
}

function FailureActions({ row }: { row: FailureRow }) {
  const debugRedactionEnabled = useDebugRedactionEnabled();
  const detailRoute = getDebugDetailRoute(debugRedactionEnabled, row.tweet_id);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" onClick={(event) => event.stopPropagation()}>
          结果
          <ChevronDown className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {detailRoute ? (
          <DropdownMenuItem asChild>
            <Link to={detailRoute}>
              <ExternalLink className="mr-2 h-4 w-4" />
              Tweet 详情
            </Link>
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem disabled>
            <ExternalLink className="mr-2 h-4 w-4" />
            {getDebugDetailLinkLabel(debugRedactionEnabled)}
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function FailuresSkeleton() {
  return (
    <div className="space-y-5">
      <section>
        <h1 className="text-2xl font-bold tracking-tight text-fg-primary">失败队列</h1>
        <p className="mt-1 text-sm text-fg-secondary">正在加载失败项</p>
      </section>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-32 rounded-lg" />
        ))}
      </div>
      <Card>
        <CardContent className="space-y-2 p-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-14" />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function buildFailureModel(rows: FailureRow[], total: number) {
  const counts = new Map<string, number>();
  let retryable = 0;
  let retryTotal = 0;
  for (const row of rows) {
    const label = row.latest_error_category || row.last_error || row.tweet_status || "-";
    counts.set(label, (counts.get(label) ?? 0) + 1);
    retryTotal += row.retry_count ?? 0;
    if (row.tweet_status === "failed_retryable") retryable += 1;
  }
  const clusters = [...counts.entries()]
    .map(([label, count]) => ({ label, count, percent: rows.length ? Math.max(6, Math.round((count / rows.length) * 100)) : 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);
  return {
    total,
    retryable,
    retryTotal,
    clusters,
    topCategory: clusters[0] ?? { label: "-", count: 0, percent: 0 },
    sparkline: rows.slice(0, 12).map((row) => Math.max(1, row.retry_count ?? 1)),
  };
}

function failureTone(value?: string | null): BadgeProps["tone"] {
  if (!value) return "secondary";
  if (value.includes("retryable") || value.includes("rate_limited")) return "warning";
  if (value.includes("failed") || value.includes("error") || value.includes("auth") || value.includes("invalid")) return "danger";
  return "secondary";
}
