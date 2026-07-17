import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Grid2X2, ListFilter, SlidersHorizontal } from "lucide-react";
import { toast } from "sonner";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigationType } from "react-router-dom";
import type { GridStateSnapshot } from "react-virtuoso";
import {
  apiDelete,
  apiGet,
  mediaQueryString,
  type MediaRow,
  type PageResponse,
} from "../../lib/api";
import { Card, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { EmptyState } from "../../components/ui/empty-state";
import { ErrorState } from "../../components/ui/error-state";
import { Skeleton } from "../../components/ui/skeleton";
import {
  DEFAULT_LIBRARY_FILTERS,
  LibraryFilterPanel,
  type LibraryFilters,
} from "./components/library-filter-panel";
import { LibraryResultsToolbar } from "./components/library-results-toolbar";
import { MediaGrid } from "./components/media-grid";
import { MediaDeleteDialog } from "../../components/media-delete-dialog";
import { MediaSelectionBar } from "../../components/media-selection-bar";
import {
  formatDeletedBytes,
  mediaDeleteErrorMessage,
  type MediaDeleteResponse,
} from "../../lib/media-deletion";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../../components/ui/collapsible";
import { Button } from "../../components/ui/button";
import { getLibraryBrowseState, saveLibraryBrowseState } from "./library-browse-state";

const PAGE_SIZE = 60;
const MAX_DELETE_SELECTION = 200;

export function LibraryPage() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const queryClient = useQueryClient();
  const [restoredState] = useState(() =>
    navigationType === "POP" ? getLibraryBrowseState(location.key) : undefined,
  );
  const [filters, setFilters] = useState<LibraryFilters>(
    () => restoredState?.filters ?? { ...DEFAULT_LIBRARY_FILTERS },
  );
  const [submitted, setSubmitted] = useState<LibraryFilters>(
    () => restoredState?.submittedFilters ?? { ...DEFAULT_LIBRARY_FILTERS },
  );
  const [restoreGridState, setRestoreGridState] = useState<GridStateSnapshot | null>(
    restoredState?.gridState ?? null,
  );
  const [gridVersion, setGridVersion] = useState(0);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteOperationId, setDeleteOperationId] = useState<string | null>(null);
  const filtersRef = useRef(filters);
  const submittedRef = useRef(submitted);
  const gridStateRef = useRef<GridStateSnapshot | null>(restoreGridState);
  filtersRef.current = filters;
  submittedRef.current = submitted;
  const draftFilterCount = useMemo(() => countActiveFilters(filters), [filters]);
  const query = useMemo(() => mediaQueryString(submitted), [submitted]);
  const mediaQuery = useInfiniteQuery({
    queryKey: ["media", query],
    queryFn: ({ pageParam }) => {
      const pageQuery = mediaQueryString({
        ...submitted,
        limit: String(PAGE_SIZE),
        offset: String(pageParam),
      });
      return apiGet<PageResponse<MediaRow>>(`/api/v1/library/media?${pageQuery}`);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.offset + lastPage.count;
      return lastPage.count > 0 && nextOffset < lastPage.total_count ? nextOffset : undefined;
    },
    gcTime: Infinity,
    refetchOnMount: restoredState ? false : true,
  });
  const rows = useMemo(() => mediaQuery.data?.pages.flatMap((page) => page.rows) ?? [], [mediaQuery.data]);
  const totalCount = mediaQuery.data?.pages[0]?.total_count ?? 0;
  const selectedRows = useMemo(() => rows.filter((row) => selectedIds.has(row.id)), [rows, selectedIds]);
  const selectedBytes = useMemo(
    () => selectedRows.reduce((total, row) => total + (row.file_size ?? 0), 0),
    [selectedRows],
  );
  const deleteMutation = useMutation({
    mutationFn: (operationId: string) =>
      apiDelete<MediaDeleteResponse>("/api/v1/library/media", {
        body: {
          operation_id: operationId,
          media_ids: Array.from(selectedIds),
          confirm_physical_delete: true,
        },
      }),
    onSuccess: async (response) => {
      setDeleteDialogOpen(false);
      setDeleteOperationId(null);
      setSelectedIds(new Set());
      gridStateRef.current = null;
      setRestoreGridState(null);
      setGridVersion((version) => version + 1);
      await Promise.all([
        queryClient.resetQueries({ queryKey: ["media"] }),
        queryClient.invalidateQueries({ queryKey: ["tweet"] }),
        queryClient.invalidateQueries({ queryKey: ["summary"] }),
        queryClient.invalidateQueries({ queryKey: ["failures"] }),
        queryClient.invalidateQueries({ queryKey: ["duplicates"] }),
        queryClient.invalidateQueries({ queryKey: ["source-discovered"] }),
      ]);
      toast.success(
        `已删除 ${response.result.deleted_media_count} 项媒体，释放 ${formatDeletedBytes(response.result.deleted_bytes)}`,
      );
    },
  });

  useEffect(
    () => () => {
      saveLibraryBrowseState(location.key, {
        filters: filtersRef.current,
        submittedFilters: submittedRef.current,
        gridState: gridStateRef.current,
      });
    },
    [location.key],
  );

  const resetGridAndQuery = useCallback(
    (nextFilters: LibraryFilters) => {
      const nextQuery = mediaQueryString(nextFilters);
      gridStateRef.current = null;
      setRestoreGridState(null);
      setGridVersion((version) => version + 1);
      void queryClient.resetQueries({ queryKey: ["media", nextQuery], exact: true });
    },
    [queryClient],
  );

  const applyFilters = () => {
    const nextFilters = { ...filters };
    setSelectedIds(new Set());
    resetGridAndQuery(nextFilters);
    setSubmitted(nextFilters);
  };

  const resetFilters = () => {
    const nextFilters = { ...DEFAULT_LIBRARY_FILTERS };
    setSelectedIds(new Set());
    resetGridAndQuery(nextFilters);
    setFilters(nextFilters);
    setSubmitted(nextFilters);
  };

  const toggleSelected = useCallback((row: MediaRow) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(row.id)) {
        next.delete(row.id);
      } else if (next.size >= MAX_DELETE_SELECTION) {
        toast.error("单次最多选择 200 个媒体项。");
      } else {
        next.add(row.id);
      }
      return next;
    });
  }, []);

  const selectLoaded = () => {
    const ids = rows.slice(0, MAX_DELETE_SELECTION).map((row) => row.id);
    setSelectedIds(new Set(ids));
    if (rows.length > MAX_DELETE_SELECTION) toast.info("已选择前 200 个已加载媒体项。");
  };

  const openDeleteDialog = () => {
    deleteMutation.reset();
    setDeleteOperationId(crypto.randomUUID());
    setDeleteDialogOpen(true);
  };

  const handleGridStateChanged = useCallback(
    (state: GridStateSnapshot) => {
      gridStateRef.current = state;
      saveLibraryBrowseState(location.key, {
        filters: filtersRef.current,
        submittedFilters: submittedRef.current,
        gridState: state,
      });
    },
    [location.key],
  );

  return (
    <div className="flex flex-col gap-4 sm:gap-5">
      <section className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-fg-primary">媒体库</h1>
          <p className="mt-1 text-sm text-fg-secondary">按作者、文本、状态快速收敛本地已归档媒体。</p>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="lg:hidden">
          <Collapsible open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
            <CollapsibleTrigger asChild>
              <Button type="button" variant="secondary" className="w-full justify-between">
                <span className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4" />筛选媒体</span>
                <span className="text-xs text-fg-secondary">{draftFilterCount ? `${draftFilterCount} 项条件` : "默认条件"}</span>
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-3">
              <LibraryFilterPanel
                filters={filters}
                activeCount={draftFilterCount}
                onFiltersChange={setFilters}
                onApply={() => {
                  applyFilters();
                  setMobileFiltersOpen(false);
                }}
                onReset={resetFilters}
              />
            </CollapsibleContent>
          </Collapsible>
        </div>
        <aside className="hidden min-w-0 lg:block">
          <LibraryFilterPanel
            filters={filters}
            activeCount={draftFilterCount}
            onFiltersChange={setFilters}
            onApply={applyFilters}
            onReset={resetFilters}
          />
        </aside>

        <main className="flex min-w-0 flex-col gap-4">
          {mediaQuery.isLoading ? <LibrarySkeleton /> : null}
          {mediaQuery.error && !mediaQuery.data ? (
            <ErrorState title="API 不可用" detail={String(mediaQuery.error)} onRetry={() => void mediaQuery.refetch()} />
          ) : null}

          {mediaQuery.data ? (
            <>
              <LibraryResultsToolbar
                filters={submitted}
                loadedCount={rows.length}
                totalCount={totalCount}
                onReset={resetFilters}
                selectedCount={selectedIds.size}
                onSelectLoaded={selectLoaded}
                onClearSelection={() => setSelectedIds(new Set())}
              />
              {rows.length ? (
                <MediaGrid
                  key={`${query}:${gridVersion}`}
                  rows={rows}
                  hasNextPage={Boolean(mediaQuery.hasNextPage)}
                  isFetchingNextPage={mediaQuery.isFetchingNextPage}
                  nextPageError={mediaQuery.isFetchNextPageError ? mediaQuery.error : null}
                  restoreStateFrom={restoreGridState}
                  onLoadMore={() => void mediaQuery.fetchNextPage()}
                  onRetryLoadMore={() => void mediaQuery.fetchNextPage()}
                  onStateChanged={handleGridStateChanged}
                  selectedIds={selectedIds}
                  onToggleSelected={toggleSelected}
                />
              ) : (
                <EmptyState icon={<ListFilter className="h-5 w-5" />} title="当前筛选条件下没有媒体。" />
              )}
            </>
          ) : null}
        </main>
      </section>
      <MediaSelectionBar
        count={selectedIds.size}
        estimatedBytes={selectedBytes}
        onClear={() => setSelectedIds(new Set())}
        onDelete={openDeleteDialog}
      />
      <MediaDeleteDialog
        open={deleteDialogOpen}
        count={selectedIds.size}
        estimatedBytes={selectedBytes}
        pending={deleteMutation.isPending}
        error={deleteMutation.error ? mediaDeleteErrorMessage(deleteMutation.error) : null}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open);
          if (!open) setDeleteOperationId(null);
        }}
        onConfirm={() => {
          if (deleteOperationId) deleteMutation.mutate(deleteOperationId);
        }}
      />
    </div>
  );
}

function countActiveFilters(filters: LibraryFilters) {
  let count = 0;
  if (filters.author.trim()) count += 1;
  if (filters.text.trim()) count += 1;
  if (filters.media_status !== DEFAULT_LIBRARY_FILTERS.media_status) count += 1;
  if (filters.media_type) count += 1;
  return count;
}

function LibrarySkeleton() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
      {Array.from({ length: 8 }).map((_, index) => (
        <Card key={index} className="overflow-hidden">
          <Skeleton className="aspect-video rounded-none" />
          <CardHeader>
            <div className="flex items-center gap-2">
              <Grid2X2 className="h-4 w-4 text-brand" />
              <CardTitle className="text-base">Loading</CardTitle>
            </div>
            <CardDescription>Media preview</CardDescription>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}
