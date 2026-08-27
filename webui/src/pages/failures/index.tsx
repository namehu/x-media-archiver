import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Ban, Bug, FileWarning, RefreshCw, RotateCcw } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { Link, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import type {
  ActionResponse,
  FailureActionResult,
  FailurePageResponse,
  FailureRow,
} from "@/lib/api";
import { apiGet, apiPost } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DataTable } from "@/components/ui/data-table";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { ManagementPageHeader } from "@/components/ui/management-page-header";
import { Pagination } from "@/components/ui/pagination";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/ui/stat-card";
import {
  getDebugDetailLinkLabel,
  getDebugDetailRoute,
  getDebugRedactProps,
  getDebugSelectionLabel,
  useDebugRedactionEnabled,
} from "@/lib/debug-redaction";
import { errorLabel, statusLabel } from "@/lib/formatters";
import { formatDateTime } from "@/lib/utils";
import {
  ConfirmFailureActionDialog,
  IgnoreFailureDialog,
  type IgnoreFailureInput,
} from "./components/failure-action-dialogs";
import {
  FailureFilters,
  type FailureDisposition,
  type FailureSort,
} from "./components/failure-filters";
import { FailureHistoryDialog } from "./components/failure-history-dialog";
import { FailureRowActions } from "./components/failure-row-actions";
import { FAILURE_REASON_LABELS, FAILURE_SKIP_REASON_LABELS } from "./failure-labels";

const PAGE_SIZE = 100;

export function FailuresPage() {
  const debugRedactionEnabled = useDebugRedactionEnabled();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [ignoreIds, setIgnoreIds] = useState<string[]>([]);
  const [retryConfirmIds, setRetryConfirmIds] = useState<string[]>([]);
  const [restoreConfirmIds, setRestoreConfirmIds] = useState<string[]>([]);
  const [historyTweetId, setHistoryTweetId] = useState<string | null>(null);

  const disposition = parseDisposition(searchParams.get("disposition"));
  const status = searchParams.get("status") ?? "";
  const errorCategory = searchParams.get("error_category") ?? "";
  const search = searchParams.get("search") ?? "";
  const sort = parseSort(searchParams.get("sort"));
  const offset = parseOffset(searchParams.get("offset"));
  const queryString = buildFailureQuery({ disposition, status, errorCategory, search, sort, offset });
  const query = useQuery({
    queryKey: ["failures", disposition, status, errorCategory, search, sort, offset],
    queryFn: () => apiGet<FailurePageResponse>(`/api/v1/library/failures?${queryString}`),
  });

  const rows = query.data?.rows ?? [];
  const pageIds = useMemo(() => rows.map((row) => row.tweet_id), [rows]);
  const selectedRows = useMemo(() => rows.filter((row) => selectedIds.has(row.tweet_id)), [rows, selectedIds]);
  const selectedOpenIds = selectedRows.filter((row) => row.disposition === "open").map((row) => row.tweet_id);
  const selectedIgnoredIds = selectedRows.filter((row) => row.disposition === "ignored").map((row) => row.tweet_id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const somePageSelected = pageIds.some((id) => selectedIds.has(id));

  useEffect(() => {
    setSelectedIds((current) => {
      const visible = new Set(pageIds);
      const next = new Set([...current].filter((id) => visible.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [pageIds]);

  const invalidateFailureData = async () => {
    setSelectedIds(new Set());
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["failures"] }),
      queryClient.invalidateQueries({ queryKey: ["failure-actions"] }),
      queryClient.invalidateQueries({ queryKey: ["archive-runs"] }),
      queryClient.invalidateQueries({ queryKey: ["summary"] }),
    ]);
  };

  const handleActionSuccess = async (label: string, response: ActionResponse) => {
    const result = response.result as FailureActionResult;
    const skipped = result.skipped_count
      ? `，跳过 ${result.skipped_count} 项${formatSkipReasons(result.skip_reasons)}`
      : "";
    toast.success(`${label} ${result.succeeded_count} 项${skipped}`);
    setIgnoreIds([]);
    setRetryConfirmIds([]);
    setRestoreConfirmIds([]);
    await invalidateFailureData();
  };

  const retryMutation = useMutation({
    mutationFn: (tweetIds: string[]) =>
      apiPost<ActionResponse>("/api/v1/library/failures/retry", { tweet_ids: tweetIds }),
    onSuccess: (response) => handleActionSuccess("已重新入队", response),
  });
  const ignoreMutation = useMutation({
    mutationFn: (input: IgnoreFailureInput) =>
      apiPost<ActionResponse>("/api/v1/library/failures/ignore", {
        tweet_ids: input.tweetIds,
        reason: input.reason,
        note: input.note,
      }),
    onSuccess: (response) => handleActionSuccess("已忽略", response),
  });
  const restoreMutation = useMutation({
    mutationFn: (tweetIds: string[]) =>
      apiPost<ActionResponse>("/api/v1/library/failures/restore", { tweet_ids: tweetIds }),
    onSuccess: (response) => handleActionSuccess("已恢复", response),
  });
  const actionPending = retryMutation.isPending || ignoreMutation.isPending || restoreMutation.isPending;
  const actionError = retryMutation.error || ignoreMutation.error || restoreMutation.error;
  const clearActionErrors = () => {
    retryMutation.reset();
    ignoreMutation.reset();
    restoreMutation.reset();
  };
  const retryItems = (tweetIds: string[]) => {
    clearActionErrors();
    retryMutation.mutate(tweetIds);
  };
  const ignoreItems = (input: IgnoreFailureInput) => {
    clearActionErrors();
    ignoreMutation.mutate(input);
  };
  const restoreItems = (tweetIds: string[]) => {
    clearActionErrors();
    restoreMutation.mutate(tweetIds);
  };

  const updateFilter = (key: "status" | "error_category" | "sort" | "search", value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value && !(key === "sort" && value === "recent")) next.set(key, value);
    else next.delete(key);
    next.delete("offset");
    setSelectedIds(new Set());
    setSearchParams(next, { replace: true });
  };

  const updateDisposition = (value: FailureDisposition) => {
    const next = new URLSearchParams(searchParams);
    if (value === "open") next.delete("disposition");
    else next.set("disposition", value);
    next.delete("offset");
    setSelectedIds(new Set());
    setSearchParams(next, { replace: true });
  };

  const resetFilters = () => {
    setSelectedIds(new Set());
    setSearchParams({}, { replace: true });
  };

  const updateOffset = (nextOffset: number) => {
    const next = new URLSearchParams(searchParams);
    if (nextOffset) next.set("offset", String(nextOffset));
    else next.delete("offset");
    setSelectedIds(new Set());
    setSearchParams(next, { replace: true });
  };

  useEffect(() => {
    const totalCount = query.data?.total_count;
    if (query.isFetching || totalCount === undefined || offset === 0 || offset < totalCount) return;
    const lastOffset = totalCount > 0 ? Math.floor((totalCount - 1) / PAGE_SIZE) * PAGE_SIZE : 0;
    const next = new URLSearchParams(searchParams);
    if (lastOffset) next.set("offset", String(lastOffset));
    else next.delete("offset");
    setSelectedIds(new Set());
    setSearchParams(next, { replace: true });
  }, [offset, query.data?.total_count, query.isFetching, searchParams, setSearchParams]);

  const columns = useMemo<ColumnDef<FailureRow>[]>(
    () => [
      {
        id: "select",
        header: () => (
          <Checkbox
            checked={allPageSelected ? true : somePageSelected ? "indeterminate" : false}
            aria-label="选择本页全部失败项"
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
        cell: ({ row }) => {
          const item = row.original;
          const detailRoute = getDebugDetailRoute(debugRedactionEnabled, item.tweet_id);
          return (
            <div className="min-w-[280px] max-w-xl">
              <div className="flex flex-wrap items-center gap-2">
                {detailRoute ? (
                  <Link className="font-semibold text-brand hover:text-brand-hover" to={detailRoute} {...getDebugRedactProps(debugRedactionEnabled)}>
                    {item.tweet_id}
                  </Link>
                ) : (
                  <span className="font-semibold text-fg-tertiary">{getDebugDetailLinkLabel(debugRedactionEnabled)}</span>
                )}
                {item.disposition === "ignored" ? <Badge tone="secondary">已忽略</Badge> : null}
              </div>
              <div className="mt-1 truncate text-xs text-fg-secondary" {...getDebugRedactProps(debugRedactionEnabled)}>
                @{item.author_username || "-"}
              </div>
              {item.latest_error_message || item.last_error ? (
                <div className="mt-2 line-clamp-2 rounded-md border border-danger/20 bg-danger/10 px-2 py-1 text-xs text-danger">
                  {item.latest_error_message || item.last_error}
                </div>
              ) : null}
              {item.disposition === "ignored" ? (
                <div className="mt-2 text-xs text-fg-tertiary">
                  {item.ignore_reason ? `原因：${FAILURE_REASON_LABELS[item.ignore_reason] ?? item.ignore_reason}` : "未填写忽略原因"}
                  {item.ignored_at ? ` · ${formatDateTime(item.ignored_at)}` : ""}
                </div>
              ) : null}
            </div>
          );
        },
      },
      {
        header: "失败状态",
        cell: ({ row }) => <Badge tone={failureTone(row.original.tweet_status)}>{statusLabel(row.original.tweet_status)}</Badge>,
      },
      {
        header: "错误分类",
        cell: ({ row }) => (
          <Badge tone={failureTone(row.original.latest_error_category || row.original.last_error)}>
            {errorLabel(row.original.latest_error_category || row.original.last_error)}
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
        header: "失败时间",
        cell: ({ row }) => <span className="whitespace-nowrap text-fg-secondary">{formatDateTime(row.original.failure_at)}</span>,
      },
      {
        id: "actions",
        header: "操作",
        cell: ({ row }) => (
          <FailureRowActions
            row={row.original}
            pending={actionPending}
            onRetry={(tweetId) => retryItems([tweetId])}
            onIgnore={(tweetId) => setIgnoreIds([tweetId])}
            onRestore={(tweetId) => restoreItems([tweetId])}
            onHistory={setHistoryTweetId}
          />
        ),
      },
    ],
    [
      actionPending,
      allPageSelected,
      debugRedactionEnabled,
      pageIds,
      retryMutation,
      restoreMutation,
      selectedIds,
      somePageSelected,
    ],
  );

  if (query.isLoading) return <FailuresSkeleton />;
  if (query.error) {
    return (
      <div className="flex flex-col gap-5">
        <ManagementPageHeader
          eyebrow="异常处理"
          title="失败工作台"
          description="失败项暂时无法读取。"
        />
        <ErrorState title="失败项不可用" detail={String(query.error)} onRetry={() => void query.refetch()} />
      </div>
    );
  }

  const data = query.data;
  const aggregates = data?.aggregates;
  const categories = data?.error_categories ?? [];
  const topCategories = categories.slice(0, 5);
  const selectedCount = selectedIds.size;

  return (
    <div className="flex flex-col gap-5">
      <ManagementPageHeader
        eyebrow="异常处理"
        title="失败工作台"
        description="按失败原因快速定位问题；所有写操作只作用于明确选中的 Tweet。"
        actions={
          <Button type="button" variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>
            <RefreshCw data-icon="inline-start" />
            {query.isFetching ? "正在刷新…" : "刷新"}
          </Button>
        }
      />

      <FailureFilters
        disposition={disposition}
        status={status}
        errorCategory={errorCategory}
        search={search}
        sort={sort}
        openCount={data?.disposition_counts.open_count ?? 0}
        ignoredCount={data?.disposition_counts.ignored_count ?? 0}
        categories={categories}
        onDispositionChange={updateDisposition}
        onFilterChange={updateFilter}
        onReset={resetFilters}
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="当前范围"
          value={(aggregates?.total_count ?? 0).toLocaleString()}
          detail={`${data?.disposition_counts.open_count ?? 0} 个待处理 · ${data?.disposition_counts.ignored_count ?? 0} 个已忽略`}
          icon={<AlertTriangle className="size-4" />}
          tone={aggregates?.total_count ? "danger" : "success"}
        />
        <StatCard
          label="可重试失败"
          value={(aggregates?.retryable_count ?? 0).toLocaleString()}
          detail={`累计重试 ${aggregates?.retry_total ?? 0} 次`}
          icon={<RefreshCw className="size-4" />}
          tone={aggregates?.retryable_count ? "warning" : "success"}
        />
        <StatCard
          label="永久失败"
          value={(aggregates?.permanent_count ?? 0).toLocaleString()}
          detail="需要人工判断是否再次尝试"
          icon={<Bug className="size-4" />}
          tone={aggregates?.permanent_count ? "danger" : "success"}
        />
        <StatCard
          label="文件损坏"
          value={(aggregates?.corrupt_count ?? 0).toLocaleString()}
          detail="重新下载可能修复文件"
          icon={<FileWarning className="size-4" />}
          tone={aggregates?.corrupt_count ? "danger" : "success"}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="min-w-0">
          <CardHeader>
            <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-center">
              <div>
                <CardTitle>{disposition === "open" ? "待处理失败" : disposition === "ignored" ? "已忽略失败" : "全部失败"}</CardTitle>
                <CardDescription>所有写操作均精确作用于当前勾选的 Tweet。</CardDescription>
              </div>
              {data ? (
                <Pagination
                  offset={offset}
                  count={data.count}
                  totalCount={data.total_count}
                  pageSize={PAGE_SIZE}
                  onOffsetChange={updateOffset}
                  label="第 {start}-{end} 项，共 {total} 项"
                />
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {actionError ? (
              <Alert variant="destructive">
                <AlertTitle>操作失败</AlertTitle>
                <AlertDescription>{String(actionError)}</AlertDescription>
              </Alert>
            ) : null}

            {selectedCount ? (
              <div className="flex flex-col justify-between gap-3 rounded-lg border border-brand/20 bg-brand-soft p-3 sm:flex-row sm:items-center">
                <div className="text-sm font-medium text-fg-primary">
                  已选择本页 <span className="tabular-nums">{selectedCount}</span> 项
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" disabled={actionPending} onClick={() => setRetryConfirmIds([...selectedIds])}>
                    <RefreshCw data-icon="inline-start" />
                    批量重试
                  </Button>
                  {selectedOpenIds.length ? (
                    <Button type="button" size="sm" variant="outline" disabled={actionPending} onClick={() => setIgnoreIds(selectedOpenIds)}>
                      <Ban data-icon="inline-start" />
                      忽略 {selectedOpenIds.length} 项
                    </Button>
                  ) : null}
                  {selectedIgnoredIds.length ? (
                    <Button type="button" size="sm" variant="outline" disabled={actionPending} onClick={() => setRestoreConfirmIds(selectedIgnoredIds)}>
                      <RotateCcw data-icon="inline-start" />
                      恢复 {selectedIgnoredIds.length} 项
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {rows.length ? (
              <DataTable columns={columns} data={rows} stickyActionColumn />
            ) : (
              <EmptyState
                icon={<AlertTriangle className="size-5" />}
                title={disposition === "ignored" ? "没有已忽略项" : "没有待处理失败项"}
                description="调整筛选条件，或等待新的失败记录。"
              />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>错误分布</CardTitle>
            <CardDescription>按当前筛选范围聚合，不受分页影响。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {topCategories.length ? (
              topCategories.map((category, index) => (
                <div
                  key={category.error_category}
                  className={index ? "border-t border-border-subtle pt-3" : undefined}
                >
                  <div className="flex items-center justify-between gap-3">
                    <Badge tone={failureTone(category.error_category)}>{errorLabel(category.error_category)}</Badge>
                    <span className="text-sm font-semibold tabular-nums text-fg-primary">{category.count}</span>
                  </div>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-bg-muted">
                    <div
                      className="h-full rounded-full bg-danger"
                      style={{ width: `${Math.max(6, Math.round((category.count / Math.max(aggregates?.total_count ?? 1, 1)) * 100))}%` }}
                    />
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-fg-secondary">当前范围没有错误。</p>
            )}
          </CardContent>
        </Card>
      </section>

      <IgnoreFailureDialog
        tweetIds={ignoreIds}
        pending={ignoreMutation.isPending}
        onOpenChange={(open) => !open && setIgnoreIds([])}
        onConfirm={ignoreItems}
      />
      <ConfirmFailureActionDialog
        open={retryConfirmIds.length > 0}
        title="批量立即重试"
        description={`将为 ${retryConfirmIds.length} 个失败项创建新的手动运行，并立即产生下载请求。`}
        confirmLabel="确认重试"
        pending={retryMutation.isPending}
        onOpenChange={(open) => !open && setRetryConfirmIds([])}
        onConfirm={() => retryItems(retryConfirmIds)}
      />
      <ConfirmFailureActionDialog
        open={restoreConfirmIds.length > 0}
        title="批量恢复失败项"
        description={`将 ${restoreConfirmIds.length} 个已忽略项恢复为待处理；此操作不会自动下载。`}
        confirmLabel="确认恢复"
        pending={restoreMutation.isPending}
        onOpenChange={(open) => !open && setRestoreConfirmIds([])}
        onConfirm={() => restoreItems(restoreConfirmIds)}
      />
      <FailureHistoryDialog tweetId={historyTweetId} onOpenChange={(open) => !open && setHistoryTweetId(null)} />
    </div>
  );
}

function FailuresSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <ManagementPageHeader
        eyebrow="异常处理"
        title="失败工作台"
        description="正在加载失败项与处置状态。"
      />
      <Skeleton className="h-32 rounded-lg" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-32 rounded-lg" />)}
      </div>
      <Skeleton className="h-96 rounded-lg" />
    </div>
  );
}

function buildFailureQuery({
  disposition,
  status,
  errorCategory,
  search,
  sort,
  offset,
}: {
  disposition: FailureDisposition;
  status: string;
  errorCategory: string;
  search: string;
  sort: FailureSort;
  offset: number;
}) {
  const params = new URLSearchParams({ disposition, sort, limit: String(PAGE_SIZE), offset: String(offset) });
  if (status) params.append("status", status);
  if (errorCategory) params.set("error_category", errorCategory);
  if (search) params.set("search", search);
  return params.toString();
}

function parseDisposition(value: string | null): FailureDisposition {
  return value === "ignored" || value === "all" ? value : "open";
}

function parseSort(value: string | null): FailureSort {
  return value === "oldest" || value === "retries" ? value : "recent";
}

function parseOffset(value: string | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed / PAGE_SIZE) * PAGE_SIZE : 0;
}

function formatSkipReasons(reasons: Record<string, number>) {
  const values = Object.entries(reasons).map(([reason, count]) => `${FAILURE_SKIP_REASON_LABELS[reason] ?? reason} ${count}`);
  return values.length ? `（${values.join("、")}）` : "";
}

function failureTone(value?: string | null): BadgeProps["tone"] {
  if (!value) return "secondary";
  if (value.includes("retryable") || value.includes("rate_limited")) return "warning";
  if (value.includes("failed") || value.includes("error") || value.includes("auth") || value.includes("invalid") || value.includes("corrupt")) return "danger";
  return "secondary";
}
