import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ApiError, type SourceBulkTaskType } from "@/lib/api";
import {
  useControlSourceBulkTask,
  useCreateSourceBulkTask,
  useCreateSourceSchedulePolicy,
  useDeleteSourceSchedulePolicy,
  useRetrySourceBulkTask,
  useSourceBulkTaskDetail,
  useSourceBulkTasks,
  useSourceSchedulePolicies,
  useUpdateSourceSchedulePolicy,
  type SourceBulkSelection,
  type SourceSchedulePolicyInput,
} from "./use-source-bulk-tasks";
import type { SourceDeletedFilter, SourceOperationalFilter, SourceSortBy } from "../utils";

type SourceBulkWorkflowOptions = {
  totalCount: number;
  sourceTypeFilter: string;
  sourceDeletedFilter: SourceDeletedFilter;
  sortBy: SourceSortBy;
  sortDirection: "asc" | "desc";
  searchText: string;
  operationalFilter: SourceOperationalFilter;
};

export function useSourceBulkWorkflow({
  totalCount,
  sourceTypeFilter,
  sourceDeletedFilter,
  sortBy,
  sortDirection,
  searchText,
  operationalFilter,
}: SourceBulkWorkflowOptions) {
  const [selectedSourceIds, setSelectedSourceIds] = useState<Set<number>>(() => new Set());
  const [excludedSourceIds, setExcludedSourceIds] = useState<Set<number>>(() => new Set());
  const [selectAllFiltered, setSelectAllFiltered] = useState(false);
  const [taskCenterOpen, setTaskCenterOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [scheduleManagerOpen, setScheduleManagerOpen] = useState(false);
  const [largeDownloadConfirmOpen, setLargeDownloadConfirmOpen] = useState(false);
  const [pendingBulkAction, setPendingBulkAction] = useState<SourceBulkTaskType | null>(null);
  const [pendingRetryTaskId, setPendingRetryTaskId] = useState<number | null>(null);

  const bulkTasksQuery = useSourceBulkTasks();
  const taskDetailQuery = useSourceBulkTaskDetail(selectedTaskId, taskCenterOpen);
  const createBulkTaskMutation = useCreateSourceBulkTask((task) => {
    setSelectedTaskId(task.id);
    setTaskCenterOpen(true);
    clearSelection();
    toast.success("批量任务已创建，将在后台继续执行。");
  });
  const controlBulkTaskMutation = useControlSourceBulkTask();
  const retryBulkTaskMutation = useRetrySourceBulkTask((task) => {
    setLargeDownloadConfirmOpen(false);
    setPendingRetryTaskId(null);
    setSelectedTaskId(task.id);
    setTaskCenterOpen(true);
    toast.success("已为失败来源创建重试任务。");
  });
  const createScheduleMutation = useCreateSourceSchedulePolicy(() => {
    setScheduleDialogOpen(false);
    clearSelection();
    toast.success("定时策略已创建并分配给所选来源。");
  });
  const schedulePoliciesQuery = useSourceSchedulePolicies();
  const updateScheduleMutation = useUpdateSourceSchedulePolicy();
  const deleteScheduleMutation = useDeleteSourceSchedulePolicy();

  const selectionCount = selectAllFiltered
    ? Math.max(0, totalCount - excludedSourceIds.size)
    : selectedSourceIds.size;
  const latestTask = bulkTasksQuery.data?.rows[0];

  useEffect(() => {
    setSelectedSourceIds(new Set());
    setExcludedSourceIds(new Set());
    setSelectAllFiltered(false);
  }, [sourceTypeFilter, sourceDeletedFilter, sortBy, sortDirection, searchText, operationalFilter]);

  function clearSelection() {
    setSelectedSourceIds(new Set());
    setExcludedSourceIds(new Set());
    setSelectAllFiltered(false);
  }

  function toggleSource(sourceId: number, selected: boolean) {
    if (selectAllFiltered) {
      setExcludedSourceIds((current) => {
        const next = new Set(current);
        if (selected) next.delete(sourceId);
        else next.add(sourceId);
        return next;
      });
      return;
    }
    setSelectedSourceIds((current) => {
      const next = new Set(current);
      if (selected) next.add(sourceId);
      else next.delete(sourceId);
      return next;
    });
  }

  function toggleAllFiltered(selected: boolean) {
    setSelectAllFiltered(selected);
    setSelectedSourceIds(new Set());
    setExcludedSourceIds(new Set());
  }

  function sourceSelection(): SourceBulkSelection {
    if (!selectAllFiltered) return { source_ids: Array.from(selectedSourceIds) };
    return {
      source_filter: {
        source_type: sourceTypeFilter || undefined,
        deleted: sourceDeletedFilter,
        sort_by: sortBy,
        sort_direction: sortDirection,
        search: searchText.trim() || undefined,
        operational_filter: operationalFilter || undefined,
        exclude_source_ids: Array.from(excludedSourceIds),
      },
    };
  }

  async function submitAction(taskType: SourceBulkTaskType, confirmLargeDownload = false) {
    setPendingBulkAction(taskType);
    try {
      await createBulkTaskMutation.mutateAsync({
        taskType,
        selection: sourceSelection(),
        confirmLargeDownload,
      });
      setLargeDownloadConfirmOpen(false);
      setPendingBulkAction(null);
    } catch (error) {
      if (taskType === "download_missing" && isLargeDownloadConfirmationError(error)) {
        setLargeDownloadConfirmOpen(true);
        return;
      }
      setPendingBulkAction(null);
      toast.error(`创建批量任务失败：${String(error)}`);
    }
  }

  async function retryTask(taskId: number, confirmLargeDownload = false) {
    try {
      await retryBulkTaskMutation.mutateAsync({ taskId, confirmLargeDownload });
    } catch (error) {
      if (isLargeDownloadConfirmationError(error)) {
        setPendingRetryTaskId(taskId);
        setLargeDownloadConfirmOpen(true);
        return;
      }
      toast.error(`创建重试任务失败：${String(error)}`);
    }
  }

  function clearPendingConfirmation() {
    setPendingBulkAction(null);
    setPendingRetryTaskId(null);
  }

  function confirmLargeDownload() {
    if (pendingRetryTaskId !== null) {
      return retryTask(pendingRetryTaskId, true);
    }
    return submitAction(pendingBulkAction || "download_missing", true);
  }

  function openTasks() {
    setSelectedTaskId(selectedTaskId ?? latestTask?.id ?? bulkTasksQuery.data?.rows[0]?.id ?? null);
    setTaskCenterOpen(true);
  }

  function openScheduleDialog() {
    createScheduleMutation.reset();
    setScheduleDialogOpen(true);
  }

  function createSchedule(input: SourceSchedulePolicyInput) {
    createScheduleMutation.mutate({ ...input, ...sourceSelection() });
  }

  return {
    selection: {
      selectedSourceIds,
      excludedSourceIds,
      selectAllFiltered,
      count: selectionCount,
      toggleSource,
      toggleAllFiltered,
      clear: clearSelection,
    },
    tasks: {
      latest: latestTask,
      rows: bulkTasksQuery.data?.rows ?? [],
      centerOpen: taskCenterOpen,
      setCenterOpen: setTaskCenterOpen,
      selectedTaskId,
      setSelectedTaskId,
      selectedTask: taskDetailQuery.data,
      detailLoading: taskDetailQuery.isLoading,
      createPending: createBulkTaskMutation.isPending,
      controlPending: controlBulkTaskMutation.isPending,
      retryPending: retryBulkTaskMutation.isPending,
      submit: submitAction,
      open: openTasks,
      control: controlBulkTaskMutation.mutate,
      retry: (taskId: number) => void retryTask(taskId),
    },
    schedules: {
      dialogOpen: scheduleDialogOpen,
      setDialogOpen: setScheduleDialogOpen,
      managerOpen: scheduleManagerOpen,
      setManagerOpen: setScheduleManagerOpen,
      policies: schedulePoliciesQuery.data ?? [],
      loading: schedulePoliciesQuery.isLoading,
      createPending: createScheduleMutation.isPending,
      createError: createScheduleMutation.error,
      updatePending: updateScheduleMutation.isPending,
      deletePending: deleteScheduleMutation.isPending,
      openCreate: openScheduleDialog,
      create: createSchedule,
      toggle: (policyId: number, enabled: boolean) => updateScheduleMutation.mutate({ policyId, values: { enabled } }),
      delete: deleteScheduleMutation.mutate,
    },
    confirmation: {
      open: largeDownloadConfirmOpen,
      setOpen: setLargeDownloadConfirmOpen,
      pendingAction: pendingBulkAction,
      pendingRetryTaskId,
      clearPendingAction: clearPendingConfirmation,
      confirm: confirmLargeDownload,
    },
  };
}

function isLargeDownloadConfirmationError(error: unknown) {
  return (
    error instanceof ApiError &&
    (error.code === "source_bulk_task_large_download_confirmation_required" ||
      error.message.includes("source_bulk_task_large_download_confirmation_required"))
  );
}
