import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import type { ArchiveSubmission } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { statusLabel } from "@/lib/formatters";
import { useRuntime } from "@/lib/runtime-provider";
import { CreateSource } from "./components/create-source";
import { SourceScheduleDialog } from "./components/source-schedule-dialog";
import { SourceScheduleManager } from "./components/source-schedule-manager";
import { SourceDetailPanel } from "./components/source-detail-sheet";
import { SourceTaskCenter, taskStatusLabel, taskTypeLabel } from "./components/source-task-center";
import { SourcesList } from "./components/sources-list";
import { useSourceBulkWorkflow } from "./hooks/use-source-bulk-workflow";
import { useDownloadPolicy, useSourceDetail } from "./hooks/useSourceDetail";
import { useSourceActions } from "./hooks/useSourceScan";
import { useCreateSource, useDeleteSource, useReorderSources, useSourcesQuery } from "./hooks/useSourcesQuery";
import type { SourceDeletedFilter, SourceOperationalFilter, SourceSortBy } from "./utils";

export function SourcesPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedSourceId, setSelectedSourceId] = useState<number | null>(null);
  const [sourceTypeFilter, setSourceTypeFilter] = useState("");
  const [sourceDeletedFilter, setSourceDeletedFilter] = useState<SourceDeletedFilter>("active");
  const [sortBy, setSortBy] = useState<SourceSortBy>("manual_order");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [searchText, setSearchText] = useState("");
  const [operationalFilter, setOperationalFilter] = useState<SourceOperationalFilter>("");
  const [feedback, setFeedback] = useState<ArchiveSubmission | null>(null);
  const [scanFeedback, setScanFeedback] = useState<Record<string, unknown> | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [createResetKey, setCreateResetKey] = useState(0);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  const downloadQueue = useRuntime((state) => state.queue);

  const includeDeletedDetail = sourceDeletedFilter !== "active";
  const sourcesQuery = useSourcesQuery(
    sourceTypeFilter,
    sourceDeletedFilter,
    sortBy,
    sortDirection,
    searchText,
    operationalFilter,
  );
  const detailQuery = useSourceDetail(selectedSourceId, includeDeletedDetail);
  const policyQuery = useDownloadPolicy();
  const selected = detailQuery.data;
  const activeScanRun = selected?.active_scan_run;
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

  const bulk = useSourceBulkWorkflow({
    totalCount: sourcesData.total_count,
    sourceTypeFilter,
    sourceDeletedFilter,
    sortBy,
    sortDirection,
    searchText,
    operationalFilter,
  });
  const latestTask = bulk.tasks.latest;

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
      {latestTask ? (
        <Alert>
          <AlertTitle className="flex flex-wrap items-center justify-between gap-2">
            <span>{taskTypeLabel(latestTask.task_type)} · {taskStatusLabel(latestTask.status)}</span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                bulk.tasks.setSelectedTaskId(latestTask.id);
                bulk.tasks.setCenterOpen(true);
              }}
            >
              查看任务
            </Button>
          </AlertTitle>
          <AlertDescription>
            <div className="flex flex-col gap-2">
              <div className="flex justify-between gap-3 text-xs text-fg-secondary">
                <span>已完成 {latestTask.settled_count} / {latestTask.total_count}</span>
                <span className="tabular-nums">{Math.round(latestTask.progress * 100)}%</span>
              </div>
              <Progress value={Math.round(latestTask.progress * 100)} />
            </div>
          </AlertDescription>
        </Alert>
      ) : null}
      <SourcesList
        data={sourcesData}
        selectedSourceId={selectedSourceId}
        typeFilter={sourceTypeFilter}
        deletedFilter={sourceDeletedFilter}
        sortBy={sortBy}
        sortDirection={sortDirection}
        searchText={searchText}
        operationalFilter={operationalFilter}
        selectedSourceIds={bulk.selection.selectedSourceIds}
        selectAllFiltered={bulk.selection.selectAllFiltered}
        excludedSourceIds={bulk.selection.excludedSourceIds}
        selectionCount={bulk.selection.count}
        onTypeFilterChange={setSourceTypeFilter}
        onDeletedFilterChange={setSourceDeletedFilter}
        onSearchTextChange={setSearchText}
        onOperationalFilterChange={setOperationalFilter}
        onSortChange={(nextSortBy, nextSortDirection) => {
          setSortBy(nextSortBy);
          setSortDirection(nextSortDirection);
        }}
        onSelectSource={selectSource}
        onToggleSource={bulk.selection.toggleSource}
        onToggleAllFiltered={bulk.selection.toggleAllFiltered}
        onClearSelection={bulk.selection.clear}
        onBulkAction={(action) => void bulk.tasks.submit(action)}
        onSchedule={bulk.schedules.openCreate}
        onManageSchedules={() => bulk.schedules.setManagerOpen(true)}
        onOpenTasks={bulk.tasks.open}
        onAddClick={() => setCreateDialogOpen(true)}
        onPin={(sourceId, isPinned) => actions.pinMutation.mutate({ sourceId, isPinned })}
        pinPendingSourceId={actions.pinMutation.isPending ? actions.pinMutation.variables?.sourceId : undefined}
        canReorder={sourceDeletedFilter === "active" && sortBy === "manual_order"}
        isLoading={sourcesQuery.isLoading}
        isFetchingNextPage={sourcesQuery.isFetchingNextPage}
        hasNextPage={Boolean(sourcesQuery.hasNextPage)}
        error={sourcesQuery.error}
        reorderPending={reorderMutation.isPending}
        bulkPending={bulk.tasks.createPending}
        onLoadMore={() => sourcesQuery.fetchNextPage()}
        onRetryLoadMore={() => sourcesQuery.fetchNextPage()}
        onReorder={(sourceIds) => reorderMutation.mutateAsync(sourceIds)}
      />

      <SourceTaskCenter
        open={bulk.tasks.centerOpen}
        onOpenChange={bulk.tasks.setCenterOpen}
        tasks={bulk.tasks.rows}
        selectedTask={bulk.tasks.selectedTask}
        selectedTaskId={bulk.tasks.selectedTaskId}
        loading={bulk.tasks.detailLoading}
        controlPending={bulk.tasks.controlPending}
        retryPending={bulk.tasks.retryPending}
        onSelectTask={bulk.tasks.setSelectedTaskId}
        onControl={(taskId, action) => bulk.tasks.control({ taskId, action })}
        onRetry={bulk.tasks.retry}
      />

      <SourceScheduleDialog
        open={bulk.schedules.dialogOpen}
        onOpenChange={bulk.schedules.setDialogOpen}
        selectedCount={bulk.selection.count}
        pending={bulk.schedules.createPending}
        error={bulk.schedules.createError}
        onCreate={bulk.schedules.create}
      />

      <SourceScheduleManager
        open={bulk.schedules.managerOpen}
        onOpenChange={bulk.schedules.setManagerOpen}
        policies={bulk.schedules.policies}
        loading={bulk.schedules.loading}
        pending={bulk.schedules.updatePending || bulk.schedules.deletePending}
        onToggle={bulk.schedules.toggle}
        onDelete={bulk.schedules.delete}
      />

      <AlertDialog
        open={bulk.confirmation.open}
        onOpenChange={(open) => {
          bulk.confirmation.setOpen(open);
          if (!open) bulk.confirmation.clearPendingAction();
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认创建大型下载任务？</AlertDialogTitle>
            <AlertDialogDescription>
              当前选择预计包含超过 500 条待下载 Tweet。任务会持续在后台运行，并按来源公平轮转；已完成内容不会重新下载。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={bulk.confirmation.clearPendingAction}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulk.tasks.createPending || bulk.tasks.retryPending}
              onClick={(event) => {
                event.preventDefault();
                void bulk.confirmation.confirm();
              }}
            >
              确认并加入队列
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
