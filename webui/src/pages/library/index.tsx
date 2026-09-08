import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Images, ListFilter } from "lucide-react";
import { toast } from "sonner";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import type { GridStateSnapshot } from "react-virtuoso";
import {
  apiGet,
  mediaQueryString,
  type MediaRow,
  type PageResponse,
} from "../../lib/api";
import { useAppScrollContainer } from "../../components/layout/app-scroll-container";
import { EmptyState } from "../../components/ui/empty-state";
import { ErrorState } from "../../components/ui/error-state";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "../../components/ui/sheet";
import { Skeleton } from "../../components/ui/skeleton";
import {
  DEFAULT_LIBRARY_FILTERS,
  LibraryFilterPanel,
  type LibraryFilters,
} from "./components/library-filter-panel";
import { LibraryResultsToolbar } from "./components/library-results-toolbar";
import { MediaGrid } from "./components/media-grid";
import { MediaDeleteDialog } from "../../components/media-delete-dialog";
import { formatDeletedBytes } from "../../lib/media-deletion";
import { getLibraryBrowseState, saveLibraryBrowseState } from "./library-browse-state";
import { BulkOrganizationDialog } from "./components/bulk-organization-dialog";
import { LibraryBatchBar } from "./components/library-batch-bar";
import { LibraryMediaPreviewDialog } from "./components/library-media-preview-dialog";
import {
  getLibraryViewPreferences,
  saveLibraryViewPreferences,
  type LibraryDensity,
  type LibrarySelectionMode,
  type LibraryViewMode,
} from "./library-view-state";
import { closeDialogHistoryEntry, createDialogHistoryEntry } from "../../lib/dialog-history";
import { useLibraryMediaDeletion } from "./use-library-media-deletion";
import { canHandleLibraryDeleteKey, hasLibraryShortcutOverlay } from "./library-delete-shortcut";
import { LibraryDeleteError } from "./components/library-delete-error";

const PAGE_SIZE = 60;
const MAX_DELETE_SELECTION = 200;

export function LibraryPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const queryClient = useQueryClient();
  const scrollParent = useAppScrollContainer();
  const [restoredState] = useState(() =>
    navigationType === "POP" ? getLibraryBrowseState(location.key) : undefined,
  );
  const [initialPreferences] = useState(getLibraryViewPreferences);
  const initialViewMode = restoredState?.viewMode ?? initialPreferences.viewMode;
  const [filters, setFilters] = useState<LibraryFilters>(
    () => restoredState?.filters ?? { ...DEFAULT_LIBRARY_FILTERS },
  );
  const [submitted, setSubmitted] = useState<LibraryFilters>(
    () => restoredState?.submittedFilters ?? { ...DEFAULT_LIBRARY_FILTERS },
  );
  const [viewMode, setViewMode] = useState<LibraryViewMode>(initialViewMode);
  const [density, setDensity] = useState<LibraryDensity>(restoredState?.density ?? initialPreferences.density);
  const [restoreGridState, setRestoreGridState] = useState<GridStateSnapshot | null>(
    restoredState?.gridStates[initialViewMode] ?? null,
  );
  const [gridVersion, setGridVersion] = useState(0);
  const [filtersSheetOpen, setFiltersSheetOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [selectedTweetIds, setSelectedTweetIds] = useState<Set<string>>(() => new Set());
  const [selectionMode, setSelectionMode] = useState<LibrarySelectionMode | null>(null);
  const [bulkDialogOpen, setBulkDialogOpen] = useState(false);
  const [preview, setPreview] = useState<{ mediaId: number; historyToken: string } | null>(null);
  const [deletedMediaIds, setDeletedMediaIds] = useState<Set<number>>(() => new Set());
  const filtersRef = useRef(filters);
  const submittedRef = useRef(submitted);
  const viewModeRef = useRef(viewMode);
  const densityRef = useRef(density);
  const gridStatesRef = useRef<Partial<Record<LibraryViewMode, GridStateSnapshot>>>(
    restoredState?.gridStates ?? {},
  );
  const scrollTopsRef = useRef<Partial<Record<LibraryViewMode, number>>>(restoredState?.scrollTops ?? {});
  const pendingScrollTopRef = useRef<number | null>(restoredState?.scrollTops[initialViewMode] ?? null);
  filtersRef.current = filters;
  submittedRef.current = submitted;
  viewModeRef.current = viewMode;
  densityRef.current = density;

  const draftFilterCount = useMemo(() => countActiveFilters(filters), [filters]);
  const query = useMemo(() => libraryMediaQueryString(submitted), [submitted]);
  const mediaQuery = useInfiniteQuery({
    queryKey: ["media", query],
    queryFn: ({ pageParam }) => {
      const pageQuery = libraryMediaQueryString(submitted, {
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
  const loadedRows = useMemo(
    () => mediaQuery.data?.pages.flatMap((page) => page.rows) ?? [],
    [mediaQuery.data],
  );
  const rows = useMemo(
    () => loadedRows.filter((row) => !deletedMediaIds.has(row.id)),
    [deletedMediaIds, loadedRows],
  );
  const totalCount = mediaQuery.data?.pages[0]?.total_count ?? 0;
  const selectedRows = useMemo(() => rows.filter((row) => selectedIds.has(row.id)), [rows, selectedIds]);
  const selectedBytes = useMemo(
    () => selectedRows.reduce((total, row) => total + (row.file_size ?? 0), 0),
    [selectedRows],
  );

  const exitSelectionMode = useCallback(() => {
    setSelectedIds(new Set());
    setSelectedTweetIds(new Set());
    setSelectionMode(null);
  }, []);

  const closePreviewAfterDelete = useCallback(() => {
    if (!preview) return;
    const token = preview.historyToken;
    closeDialogHistoryEntry(token, () => setPreview(null));
  }, [preview]);

  const deletion = useLibraryMediaDeletion(async (response, completedTarget) => {
    const deletedIds = new Set(completedTarget.rows.map((row) => row.id));
    const updatePreview = completedTarget.kind === "preview" &&
      completedTarget.previewHistoryToken === preview?.historyToken &&
      preview && deletedIds.has(preview.mediaId);
    const previewIndex = preview ? rows.findIndex((row) => row.id === preview.mediaId) : -1;
    const nextPreview =
      updatePreview && previewIndex >= 0
        ? rows.slice(previewIndex + 1).find((row) => !deletedIds.has(row.id)) ??
          [...rows.slice(0, previewIndex)].reverse().find((row) => !deletedIds.has(row.id)) ??
          null
        : null;

    setDeletedMediaIds((current) => new Set([...current, ...deletedIds]));
    if (completedTarget.kind === "selection") exitSelectionMode();
    if (updatePreview) {
      if (nextPreview) {
        setPreview((current) => (current ? { ...current, mediaId: nextPreview.id } : current));
      } else {
        closePreviewAfterDelete();
      }
    }

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["media"] }),
      queryClient.invalidateQueries({ queryKey: ["tweet"] }),
      queryClient.invalidateQueries({ queryKey: ["summary"] }),
      queryClient.invalidateQueries({ queryKey: ["failures"] }),
      queryClient.invalidateQueries({ queryKey: ["duplicates"] }),
      queryClient.invalidateQueries({ queryKey: ["source-discovered"] }),
    ]);
    toast.success(
      `已删除 ${response.result.deleted_media_count} 项媒体，释放 ${formatDeletedBytes(response.result.deleted_bytes)}`,
      {
        id: "library-media-delete-success",
        position: "bottom-center",
        duration: 1500,
        style: { pointerEvents: "none" },
      },
    );
  });

  useEffect(() => {
    saveLibraryViewPreferences({ viewMode, density });
  }, [density, viewMode]);

  useEffect(
    () => () => {
      if (scrollParent) scrollTopsRef.current[viewModeRef.current] = scrollParent.scrollTop;
      saveLibraryBrowseState(location.key, {
        filters: filtersRef.current,
        submittedFilters: submittedRef.current,
        gridStates: gridStatesRef.current,
        scrollTops: scrollTopsRef.current,
        viewMode: viewModeRef.current,
        density: densityRef.current,
      });
    },
    [location.key, scrollParent],
  );

  useEffect(() => {
    if (!mediaQuery.data || !scrollParent || pendingScrollTopRef.current === null) return undefined;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const target = pendingScrollTopRef.current;
        if (target === null) return;
        scrollParent.scrollTo(0, target);
        pendingScrollTopRef.current = null;
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
    };
  }, [gridVersion, mediaQuery.data, scrollParent]);

  useEffect(() => {
    if (!selectionMode || preview || bulkDialogOpen || deletion.dialogOpen || deletion.pending) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || hasLibraryShortcutOverlay()) return;
      event.preventDefault();
      exitSelectionMode();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [bulkDialogOpen, deletion.dialogOpen, deletion.pending, exitSelectionMode, preview, selectionMode]);

  useEffect(() => {
    const availableIds = new Set(rows.map((row) => row.id));
    const availableTweetIds = new Set(rows.map((row) => row.tweet_id));
    setSelectedIds((current) => filterSet(current, availableIds));
    setSelectedTweetIds((current) => filterSet(current, availableTweetIds));
  }, [rows]);

  const resetGridAndQuery = useCallback(
    (nextFilters: LibraryFilters) => {
      const nextQuery = libraryMediaQueryString(nextFilters);
      gridStatesRef.current = {};
      scrollTopsRef.current = {};
      pendingScrollTopRef.current = null;
      setRestoreGridState(null);
      setGridVersion((version) => version + 1);
      setDeletedMediaIds(new Set());
      void queryClient.resetQueries({ queryKey: ["media", nextQuery], exact: true });
    },
    [queryClient],
  );

  const applyFilters = () => {
    const nextFilters = { ...filters };
    exitSelectionMode();
    resetGridAndQuery(nextFilters);
    setSubmitted(nextFilters);
  };

  const resetFilters = () => {
    const nextFilters = { ...DEFAULT_LIBRARY_FILTERS };
    exitSelectionMode();
    resetGridAndQuery(nextFilters);
    setFilters(nextFilters);
    setSubmitted(nextFilters);
  };

  const toggleSelected = useCallback(
    (row: MediaRow) => {
      if (selectionMode === "organize") {
        setSelectedTweetIds((current) => {
          const next = new Set(current);
          if (next.has(row.tweet_id)) next.delete(row.tweet_id);
          else if (next.size >= MAX_DELETE_SELECTION) toast.error("单次最多选择 200 条 Tweet。");
          else next.add(row.tweet_id);
          return next;
        });
        return;
      }
      if (selectionMode === "delete") {
        setSelectedIds((current) => {
          const next = new Set(current);
          if (next.has(row.id)) next.delete(row.id);
          else if (next.size >= MAX_DELETE_SELECTION) toast.error("单次最多选择 200 个媒体项。");
          else next.add(row.id);
          return next;
        });
      }
    },
    [selectionMode],
  );

  const startSelectionMode = (mode: LibrarySelectionMode) => {
    setFiltersSheetOpen(false);
    setSelectedIds(new Set());
    setSelectedTweetIds(new Set());
    setSelectionMode(mode);
  };

  const selectLoaded = () => {
    if (selectionMode === "organize") {
      const allTweetIds = Array.from(new Set(rows.map((row) => row.tweet_id)));
      setSelectedTweetIds(new Set(allTweetIds.slice(0, MAX_DELETE_SELECTION)));
      if (allTweetIds.length > MAX_DELETE_SELECTION) toast.info("已选择前 200 条已加载 Tweet。");
      return;
    }
    if (selectionMode === "delete") {
      const ids = rows.slice(0, MAX_DELETE_SELECTION).map((row) => row.id);
      setSelectedIds(new Set(ids));
      if (rows.length > MAX_DELETE_SELECTION) toast.info("已选择前 200 个已加载媒体项。");
    }
  };

  const deleteSelection = () => {
    deletion.requestDelete({ kind: "selection", rows: selectedRows });
  };

  const deletePreviewMedia = (row: MediaRow) => {
    deletion.requestDelete({ kind: "preview", rows: [row], previewHistoryToken: preview?.historyToken });
  };

  useEffect(() => {
    if (deletion.pending || deletion.dialogOpen || filtersSheetOpen || bulkDialogOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!canHandleLibraryDeleteKey(event, Boolean(preview))) return;
      const targetRows = preview ? rows.filter((row) => row.id === preview.mediaId)
        : selectionMode === "delete" ? selectedRows : [];
      if (!targetRows.length) return;
      event.preventDefault();
      deletion.requestDelete({
        kind: preview ? "preview" : "selection",
        rows: targetRows,
        previewHistoryToken: preview?.historyToken,
      });
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [bulkDialogOpen, deletion, filtersSheetOpen, preview, rows, selectedRows, selectionMode]);

  const openPreview = (row: MediaRow) => {
    if (scrollParent) scrollTopsRef.current[viewMode] = scrollParent.scrollTop;
    saveLibraryBrowseState(location.key, {
      filters: filtersRef.current,
      submittedFilters: submittedRef.current,
      gridStates: gridStatesRef.current,
      scrollTops: scrollTopsRef.current,
      viewMode,
      density: densityRef.current,
    });
    const dialogEntry = createDialogHistoryEntry(location.state);
    void navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { state: dialogEntry.state, flushSync: true },
    );
    setPreview({ mediaId: row.id, historyToken: dialogEntry.token });
  };

  const handleViewModeChange = (nextViewMode: LibraryViewMode) => {
    if (nextViewMode === viewMode) return;
    if (scrollParent) scrollTopsRef.current[viewMode] = scrollParent.scrollTop;
    pendingScrollTopRef.current = scrollTopsRef.current[nextViewMode] ?? 0;
    setViewMode(nextViewMode);
    setRestoreGridState(gridStatesRef.current[nextViewMode] ?? null);
    setGridVersion((version) => version + 1);
    setFiltersSheetOpen(false);
  };

  const handleDensityChange = (nextDensity: LibraryDensity) => {
    if (nextDensity === density) return;
    if (scrollParent) scrollTopsRef.current[viewMode] = scrollParent.scrollTop;
    pendingScrollTopRef.current = scrollTopsRef.current[viewMode] ?? 0;
    setDensity(nextDensity);
    setRestoreGridState(gridStatesRef.current[viewMode] ?? null);
    setGridVersion((version) => version + 1);
  };

  const toggleFilters = () => {
    setFiltersSheetOpen((current) => !current);
  };

  const handleGridStateChanged = useCallback(
    (state: GridStateSnapshot) => {
      gridStatesRef.current[viewMode] = state;
      if (scrollParent) scrollTopsRef.current[viewMode] = scrollParent.scrollTop;
      saveLibraryBrowseState(location.key, {
        filters: filtersRef.current,
        submittedFilters: submittedRef.current,
        gridStates: gridStatesRef.current,
        scrollTops: scrollTopsRef.current,
        viewMode,
        density: densityRef.current,
      });
    },
    [location.key, scrollParent, viewMode],
  );

  return (
    <div className="min-h-full">
      <section className="min-h-full border-x border-border-subtle bg-bg-base">
        <LibraryResultsToolbar
          activeFilterCount={countActiveFilters(submitted)}
          loadedCount={rows.length}
          totalCount={totalCount}
          selectedCount={selectionMode === "organize" ? selectedTweetIds.size : selectedIds.size}
          selectionMode={selectionMode}
          viewMode={viewMode}
          density={density}
          filtersOpen={filtersSheetOpen}
          onSelectLoaded={selectLoaded}
          onClearSelection={() => {
            if (selectionMode === "organize") setSelectedTweetIds(new Set());
            else setSelectedIds(new Set());
          }}
          onExitSelection={exitSelectionMode}
          onStartSelection={startSelectionMode}
          onViewModeChange={handleViewModeChange}
          onDensityChange={handleDensityChange}
          onToggleFilters={toggleFilters}
        />

        {mediaQuery.isLoading ? <LibrarySkeleton viewMode={viewMode} /> : null}
        {deletion.error && !deletion.dialogOpen && !preview ? (
          <div className="p-4">
            <LibraryDeleteError error={deletion.error} onRetry={deletion.retry} />
          </div>
        ) : null}
        {mediaQuery.error && !mediaQuery.data ? (
          <div className="p-4 sm:p-5">
            <ErrorState
              title="媒体加载失败"
              detail={String(mediaQuery.error)}
              onRetry={() => void mediaQuery.refetch()}
            />
          </div>
        ) : null}

        {mediaQuery.data && rows.length ? (
          <MediaGrid
            key={`${query}:${viewMode}:${density}:${gridVersion}`}
            rows={rows}
            hasNextPage={Boolean(mediaQuery.hasNextPage)}
            isFetchingNextPage={mediaQuery.isFetchingNextPage}
            nextPageError={mediaQuery.isFetchNextPageError ? mediaQuery.error : null}
            restoreStateFrom={restoreGridState}
            onLoadMore={() => void mediaQuery.fetchNextPage()}
            onRetryLoadMore={() => void mediaQuery.fetchNextPage()}
            onStateChanged={handleGridStateChanged}
            selectedIds={selectedIds}
            selectedTweetIds={selectedTweetIds}
            selectionMode={selectionMode}
            viewMode={viewMode}
            density={density}
            onToggleSelected={toggleSelected}
            onPreview={openPreview}
          />
        ) : null}
        {mediaQuery.data && !rows.length ? (
          <div className="p-4 sm:p-5">
            <EmptyState
              icon={<ListFilter />}
              title="当前筛选条件下没有媒体"
              description="调整作者、正文、文件状态或媒体类型后再试。"
            />
          </div>
        ) : null}
      </section>

      <Sheet open={filtersSheetOpen} onOpenChange={setFiltersSheetOpen}>
        <SheetContent className="w-[min(92vw,420px)] overflow-y-auto p-5 sm:p-6">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <Images className="size-5" aria-hidden="true" />
              筛选媒体
            </SheetTitle>
            <SheetDescription>按作者、正文、文件状态或媒体类型收窄当前媒体墙。</SheetDescription>
          </SheetHeader>
          <fieldset className="flex min-h-0 flex-1 border-0 p-0" disabled={Boolean(selectionMode)}>
            <legend className="sr-only">媒体筛选</legend>
            <LibraryFilterPanel
              filters={filters}
              activeCount={draftFilterCount}
              onFiltersChange={setFilters}
              onApply={() => {
                applyFilters();
                setFiltersSheetOpen(false);
              }}
              onReset={resetFilters}
            />
          </fieldset>
        </SheetContent>
      </Sheet>

      {selectionMode ? (
        <LibraryBatchBar
          mode={selectionMode}
          count={selectionMode === "organize" ? selectedTweetIds.size : selectedIds.size}
          estimatedBytes={selectedBytes}
          onCancel={exitSelectionMode}
          pending={deletion.pending}
          onDelete={deleteSelection}
          onOrganize={() => setBulkDialogOpen(true)}
        />
      ) : null}
      <LibraryMediaPreviewDialog
        media={rows}
        activeMediaId={preview?.mediaId ?? null}
        totalCount={totalCount}
        historyToken={preview?.historyToken ?? null}
        hasNextPage={Boolean(mediaQuery.hasNextPage)}
        isFetchingNextPage={mediaQuery.isFetchingNextPage}
        nextPageError={mediaQuery.isFetchNextPageError ? mediaQuery.error : null}
        deletePending={deletion.pending}
        deleteError={!deletion.dialogOpen ? deletion.error : null}
        deleteDialogOpen={deletion.dialogOpen}
        onRetryDelete={deletion.retry}
        onActiveMediaChange={(mediaId) => setPreview((current) => (current ? { ...current, mediaId } : current))}
        onLoadMore={() => void mediaQuery.fetchNextPage()}
        onRetryLoadMore={() => void mediaQuery.fetchNextPage()}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
        onDelete={deletePreviewMedia}
        onViewTweet={(route) => {
          setPreview(null);
          void navigate(route, { replace: true });
        }}
      />
      <MediaDeleteDialog
        open={deletion.dialogOpen}
        count={deletion.target?.rows.length ?? 0}
        estimatedBytes={deletion.target?.rows.reduce((total, row) => total + (row.file_size ?? 0), 0) ?? 0}
        pending={deletion.pending}
        error={deletion.error}
        targetMedia={deletion.target?.kind === "preview" ? deletion.target.rows[0] : null}
        skipConfirmation={deletion.skipConfirmation}
        onSkipConfirmationChange={deletion.setSkipConfirmation}
        onOpenChange={deletion.onDialogOpenChange}
        onConfirm={deletion.confirmDelete}
      />
      <BulkOrganizationDialog
        tweetIds={Array.from(selectedTweetIds)}
        open={bulkDialogOpen}
        onOpenChange={setBulkDialogOpen}
        onCompleted={exitSelectionMode}
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

function libraryMediaQueryString(filters: LibraryFilters, pagination: Record<string, string> = {}) {
  return mediaQueryString({
    author_username: filters.author,
    text: filters.text,
    media_status: filters.media_status,
    media_type: filters.media_type,
    ...pagination,
  });
}

function LibrarySkeleton({ viewMode }: { viewMode: LibraryViewMode }) {
  if (viewMode === "details") {
    return (
      <div className="flex flex-col divide-y divide-border-subtle" aria-label="正在加载媒体详情">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:gap-4 sm:px-5">
            <Skeleton className="aspect-video w-full shrink-0 rounded-xl sm:w-52" />
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <Skeleton className="h-4 w-40 max-w-full" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-1 sm:grid-cols-[repeat(auto-fill,minmax(156px,1fr))]" aria-label="正在加载媒体">
      {Array.from({ length: 18 }).map((_, index) => (
        <Skeleton key={index} className="aspect-square rounded-none" />
      ))}
    </div>
  );
}

function filterSet<T>(current: Set<T>, available: Set<T>) {
  const next = new Set([...current].filter((value) => available.has(value)));
  if (next.size === current.size && [...next].every((value) => current.has(value))) return current;
  return next;
}
