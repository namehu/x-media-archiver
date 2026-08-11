import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  apiDelete,
  apiGet,
  apiPatch,
  apiPost,
  apiPut,
  type SourceBulkTask,
  type SourceBulkTasksPageResponse,
  type SourceBulkTaskType,
  type SourceSchedulePolicy,
} from "@/lib/api";

const ACTIVE_TASK_STATUSES = new Set(["queued", "running", "pausing", "paused", "blocked"]);

export type SourceBulkSelection =
  | { source_ids: number[]; source_filter?: never }
  | { source_ids?: never; source_filter: Record<string, unknown> };

export function useSourceBulkTasks() {
  return useQuery({
    queryKey: ["source-bulk-tasks"],
    queryFn: () => apiGet<SourceBulkTasksPageResponse>("/api/v1/source-bulk-tasks?limit=20&offset=0"),
    refetchInterval: (query) => {
      const active = query.state.data?.rows.some((task) => ACTIVE_TASK_STATUSES.has(task.status));
      return active ? 2000 : 10000;
    },
  });
}

export function useSourceBulkTaskDetail(taskId: number | null, open: boolean) {
  return useQuery({
    queryKey: ["source-bulk-task", taskId],
    queryFn: () => apiGet<SourceBulkTask>(`/api/v1/source-bulk-tasks/${taskId}`),
    enabled: Boolean(taskId && open),
    refetchInterval: (query) => (query.state.data && ACTIVE_TASK_STATUSES.has(query.state.data.status) ? 2000 : false),
  });
}

export function useCreateSourceBulkTask(onCreated: (task: SourceBulkTask) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      taskType,
      selection,
      confirmLargeDownload = false,
    }: {
      taskType: SourceBulkTaskType;
      selection: SourceBulkSelection;
      confirmLargeDownload?: boolean;
    }) =>
      apiPost<SourceBulkTask>("/api/v1/source-bulk-tasks", {
        task_type: taskType,
        ...selection,
        confirm_large_download: confirmLargeDownload,
      }),
    onSuccess: async (task) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["source-bulk-tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["sources"] }),
      ]);
      onCreated(task);
    },
  });
}

export function useControlSourceBulkTask(onUpdated?: (task: SourceBulkTask) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, action }: { taskId: number; action: "pause" | "resume" | "cancel" }) =>
      apiPost<SourceBulkTask>(`/api/v1/source-bulk-tasks/${taskId}/control`, { action }),
    onSuccess: async (task) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["source-bulk-tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["source-bulk-task", task.id] }),
        queryClient.invalidateQueries({ queryKey: ["sources"] }),
      ]);
      onUpdated?.(task);
    },
  });
}

export function useRetrySourceBulkTask(onCreated: (task: SourceBulkTask) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      taskId,
      confirmLargeDownload = false,
    }: {
      taskId: number;
      confirmLargeDownload?: boolean;
    }) =>
      apiPost<SourceBulkTask>(`/api/v1/source-bulk-tasks/${taskId}/retry`, {
        confirm_large_download: confirmLargeDownload,
      }),
    onSuccess: async (task) => {
      await queryClient.invalidateQueries({ queryKey: ["source-bulk-tasks"] });
      onCreated(task);
    },
  });
}

export function useSourceSchedulePolicies() {
  return useQuery({
    queryKey: ["source-schedule-policies"],
    queryFn: () => apiGet<SourceSchedulePolicy[]>("/api/v1/source-schedule-policies"),
  });
}

export type SourceSchedulePolicyInput = {
  label: string;
  action: "refresh_latest" | "refresh_and_download_new";
  frequency_kind: "interval" | "daily" | "weekly";
  interval_minutes?: number | null;
  local_time?: string | null;
  weekday?: number | null;
  timezone?: string;
  enabled?: boolean;
  source_ids?: number[];
  source_filter?: Record<string, unknown>;
};

export function useCreateSourceSchedulePolicy(onCreated?: (policy: SourceSchedulePolicy) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SourceSchedulePolicyInput) =>
      apiPost<SourceSchedulePolicy>("/api/v1/source-schedule-policies", input),
    onSuccess: async (policy) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["source-schedule-policies"] }),
        queryClient.invalidateQueries({ queryKey: ["sources"] }),
      ]);
      onCreated?.(policy);
    },
  });
}

export function useUpdateSourceSchedulePolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, values }: { policyId: number; values: Partial<SourceSchedulePolicyInput> }) =>
      apiPatch<SourceSchedulePolicy>(`/api/v1/source-schedule-policies/${policyId}`, values),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["source-schedule-policies"] }),
        queryClient.invalidateQueries({ queryKey: ["sources"] }),
      ]);
    },
  });
}

export function useAssignSourceSchedulePolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ policyId, sourceIds }: { policyId: number; sourceIds: number[] }) =>
      apiPut<SourceSchedulePolicy>(`/api/v1/source-schedule-policies/${policyId}/sources`, {
        source_ids: sourceIds,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["source-schedule-policies"] }),
        queryClient.invalidateQueries({ queryKey: ["sources"] }),
      ]);
    },
  });
}

export function useDeleteSourceSchedulePolicy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (policyId: number) => apiDelete<void>(`/api/v1/source-schedule-policies/${policyId}`),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["source-schedule-policies"] }),
        queryClient.invalidateQueries({ queryKey: ["sources"] }),
      ]);
    },
  });
}
