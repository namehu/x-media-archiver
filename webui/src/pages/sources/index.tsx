import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { apiGet, type ArchiveSubmission, type HealthDetail } from "@/lib/api";
import { statusLabel } from "@/lib/formatters";
import { CreateSource } from "./components/create-source";
import { SourceDetailPanel } from "./components/source-detail-sheet";
import { SourcesList } from "./components/sources-list";
import { useDownloadPolicy, useSourceDetail } from "./hooks/useSourceDetail";
import { useSourceActions } from "./hooks/useSourceScan";
import { useCreateSource, useDeleteSource, useReorderSources, useSourcesQuery } from "./hooks/useSourcesQuery";
import type { SourceDeletedFilter, SourceSortBy } from "./utils";

export function SourcesPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedSourceId, setSelectedSourceId] = useState<number | null>(null);
  const [sourceTypeFilter, setSourceTypeFilter] = useState("");
  const [sourceDeletedFilter, setSourceDeletedFilter] = useState<SourceDeletedFilter>("active");
  const [sortBy, setSortBy] = useState<SourceSortBy>("manual_order");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [feedback, setFeedback] = useState<ArchiveSubmission | null>(null);
  const [scanFeedback, setScanFeedback] = useState<Record<string, unknown> | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [createResetKey, setCreateResetKey] = useState(0);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);

  const includeDeletedDetail = sourceDeletedFilter !== "active";
  const sourcesQuery = useSourcesQuery(sourceTypeFilter, sourceDeletedFilter, sortBy, sortDirection);
  const detailQuery = useSourceDetail(selectedSourceId, includeDeletedDetail);
  const policyQuery = useDownloadPolicy();
  const healthQuery = useQuery({
    queryKey: ["health-detail"],
    queryFn: () => apiGet<HealthDetail>("/api/v1/health/detail"),
    enabled: detailSheetOpen,
    refetchInterval: detailSheetOpen ? 15000 : false,
  });
  const selected = detailQuery.data;
  const activeScanRun = selected?.active_scan_run;
  const downloadQueue = healthQuery.data?.queue;
  const hasDownloadQueueWork = Boolean(
    downloadQueue &&
      (
        downloadQueue.pending_items +
        downloadQueue.processing_items +
        downloadQueue.retryable_failed_items +
        downloadQueue.queued_runs +
        downloadQueue.running_runs
      ) > 0,
  );

  const refresh = async (sourceId?: number) => {
    if (sourceId) setSelectedSourceId(sourceId);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["sources"] }),
      queryClient.invalidateQueries({ queryKey: sourceId ? ["source", sourceId] : ["source"] }),
      queryClient.invalidateQueries({ queryKey: sourceId ? ["source-discovered", sourceId] : ["source-discovered"] }),
      queryClient.invalidateQueries({ queryKey: sourceId ? ["source-downloads", sourceId] : ["source-downloads"] }),
      queryClient.invalidateQueries({ queryKey: sourceId ? ["source-scan-runs", sourceId] : ["source-scan-runs"] }),
      queryClient.invalidateQueries({ queryKey: ["archive-runs"] }),
    ]);
  };

  const createMutation = useCreateSource(async (source) => {
    setCreateResetKey((key) => key + 1);
    setCreateDialogOpen(false);
    await refresh(source.id);
  });

  const deleteMutation = useDeleteSource(async () => {
    setDetailSheetOpen(false);
    setSelectedSourceId(null);
    setFeedback(null);
    setScanFeedback(null);
    setSearchParams({});
    await Promise.all([
      refresh(),
      queryClient.invalidateQueries({ queryKey: ["health-detail"] }),
    ]);
    toast.success("来源已删除，历史记录和本地媒体已保留。");
  });

  const actions = useSourceActions({
    selectedSourceId,
    onFeedback: setFeedback,
    onScanFeedback: setScanFeedback,
    onRefresh: refresh,
  });

  const sourcesData = useMemo(() => {
    const pages = sourcesQuery.data?.pages ?? [];
    const rows = pages.flatMap((page) => page.rows);
    const firstPage = pages[0];
    return {
      rows,
      count: rows.length,
      total_count: firstPage?.total_count ?? 0,
      limit: firstPage?.limit ?? 50,
      offset: 0,
    };
  }, [sourcesQuery.data]);

  const reorderMutation = useReorderSources(async () => {
    await queryClient.invalidateQueries({ queryKey: ["sources"] });
  });

  useEffect(() => {
    const sourceId = Number(searchParams.get("sourceId"));
    if (Number.isFinite(sourceId) && sourceId > 0) {
      setSelectedSourceId(sourceId);
      setDetailSheetOpen(true);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!activeScanRun) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeScanRun?.id]);

  const selectSource = (sourceId: number) => {
    setFeedback(null);
    setScanFeedback(null);
    deleteMutation.reset();
    setSelectedSourceId(sourceId);
    setDetailSheetOpen(true);
    setSearchParams({ sourceId: String(sourceId) });
  };

  const closeDetail = () => {
    deleteMutation.reset();
    setDetailSheetOpen(false);
    setSelectedSourceId(null);
    setSearchParams({});
  };

  return (
    <div className="space-y-5">
      <SourcesList
        data={sourcesData}
        selectedSourceId={selectedSourceId}
        typeFilter={sourceTypeFilter}
        deletedFilter={sourceDeletedFilter}
        sortBy={sortBy}
        sortDirection={sortDirection}
        onTypeFilterChange={setSourceTypeFilter}
        onDeletedFilterChange={setSourceDeletedFilter}
        onSortChange={(nextSortBy, nextSortDirection) => {
          setSortBy(nextSortBy);
          setSortDirection(nextSortDirection);
        }}
        onSelectSource={selectSource}
        onAddClick={() => setCreateDialogOpen(true)}
        onPin={(sourceId, isPinned) => actions.pinMutation.mutate({ sourceId, isPinned })}
        pinPendingSourceId={actions.pinMutation.isPending ? actions.pinMutation.variables?.sourceId : undefined}
        canReorder={sourceDeletedFilter === "active" && sortBy === "manual_order"}
        isLoading={sourcesQuery.isLoading}
        isFetchingNextPage={sourcesQuery.isFetchingNextPage}
        hasNextPage={Boolean(sourcesQuery.hasNextPage)}
        error={sourcesQuery.error}
        reorderPending={reorderMutation.isPending}
        onLoadMore={() => sourcesQuery.fetchNextPage()}
        onRetryLoadMore={() => sourcesQuery.fetchNextPage()}
        onReorder={(sourceIds) => reorderMutation.mutateAsync(sourceIds)}
      />

      {/* 新增来源弹窗 */}
      <CreateSource
        open={createDialogOpen}
        isPending={createMutation.isPending}
        error={createMutation.error}
        resetKey={createResetKey}
        onCreate={(input) => createMutation.mutate(input)}
        onOpenChange={setCreateDialogOpen}
      />

      <SourceDetailPanel
        open={detailSheetOpen}
        onOpenChange={(open) => {
          if (!open) closeDetail();
        }}
        source={selected}
        policy={policyQuery.data}
        hasDownloadQueueWork={hasDownloadQueueWork}
        now={now}
        detailUpdatedAt={detailQuery.dataUpdatedAt}
        feedback={feedback}
        scanFeedback={scanFeedback}
        statusLabel={statusLabel}
        actions={{
          submitRecords: actions.submitMutation.mutate,
          setStatus: actions.statusMutation.mutate,
          startSession: actions.scanSessionMutation.mutate,
          pauseSession: actions.pauseScanSessionMutation.mutate,
          resumeSession: actions.resumeScanSessionMutation.mutate,
          submitDiscovered: actions.submitDiscoveredMutation.mutate,
          submitDownload: actions.sourceDownloadMutation.mutateAsync,
          pauseDownload: actions.pauseDownloadMutation.mutate,
          resumeDownload: actions.resumeDownloadMutation.mutateAsync,
          stopDownload: actions.stopDownloadMutation.mutate,
          cancelDownloadItems: actions.cancelDownloadItemsMutation.mutate,
          stopHistory: actions.stopHistoryScanMutation.mutate,
          deleteSource: deleteMutation.mutate,
          pending: {
            submit: actions.submitMutation.isPending,
            status: actions.statusMutation.isPending,
            submitDiscovered: actions.submitDiscoveredMutation.isPending,
            download:
              actions.sourceDownloadMutation.isPending ||
              actions.pauseDownloadMutation.isPending ||
              actions.resumeDownloadMutation.isPending ||
              actions.stopDownloadMutation.isPending ||
              actions.cancelDownloadItemsMutation.isPending,
            history:
              actions.scanSessionMutation.isPending ||
              actions.pauseScanSessionMutation.isPending ||
              actions.resumeScanSessionMutation.isPending ||
              actions.stopHistoryScanMutation.isPending,
            deleteSource: deleteMutation.isPending,
          },
          errors: {
            submit: actions.submitMutation.error,
            status: actions.statusMutation.error,
            submitDiscovered: actions.submitDiscoveredMutation.error,
            download:
              actions.sourceDownloadMutation.error ||
              actions.pauseDownloadMutation.error ||
              actions.resumeDownloadMutation.error ||
              actions.stopDownloadMutation.error ||
              actions.cancelDownloadItemsMutation.error,
            history:
              actions.scanSessionMutation.error ||
              actions.pauseScanSessionMutation.error ||
              actions.resumeScanSessionMutation.error ||
              actions.stopHistoryScanMutation.error,
            deleteSource: deleteMutation.error,
          },
        }}
        onManualSubmitted={() => setFeedback(null)}
      />
    </div>
  );
}
