import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  apiGet,
  apiPatch,
  apiPost,
  type MediaPreviewJob,
  type MediaPreviewJobsPage,
  type MediaPreviewSchedule,
} from "@/lib/api";
import { useRuntime } from "@/lib/runtime-provider";
import { errorMessage } from "../utils";

export function useMediaPreviewJobs() {
  const queryClient = useQueryClient();
  const runtimeJobs = useRuntime((state) => state.previewJobsById);
  const jobsQuery = useQuery({
    queryKey: ["preview-jobs"],
    queryFn: () => apiGet<MediaPreviewJobsPage>("/api/v1/maintenance/preview-jobs?limit=20"),
    refetchInterval: 60_000,
  });
  const scheduleQuery = useQuery({
    queryKey: ["preview-schedule"],
    queryFn: () => apiGet<MediaPreviewSchedule>("/api/v1/maintenance/preview-schedule"),
  });

  const jobs = useMemo(() => {
    const merged = new Map<number, MediaPreviewJob>();
    for (const job of jobsQuery.data?.items ?? []) merged.set(job.id, job);
    for (const job of Object.values(runtimeJobs)) {
      merged.set(job.id, { ...merged.get(job.id), ...job });
    }
    return [...merged.values()].sort((left, right) => right.id - left.id);
  }, [jobsQuery.data?.items, runtimeJobs]);

  const createMutation = useMutation({
    mutationFn: (mode: "reconcile" | "force") =>
      apiPost<MediaPreviewJob>("/api/v1/maintenance/preview-jobs", {
        mode,
        confirm_full_scan: true,
        confirm_force: mode === "force",
      }),
    onSuccess: async (_, mode) => {
      toast.success(mode === "force" ? "强制重建任务已入队" : "预览补齐任务已入队");
      await queryClient.invalidateQueries({ queryKey: ["preview-jobs"] });
    },
    onError: (error) => toast.error(`创建预览任务失败：${errorMessage(error)}`),
  });

  const cancelMutation = useMutation({
    mutationFn: (jobId: number) =>
      apiPost<MediaPreviewJob>(`/api/v1/maintenance/preview-jobs/${jobId}/cancel`, {}),
    onSuccess: async () => {
      toast.success("已提交取消请求");
      await queryClient.invalidateQueries({ queryKey: ["preview-jobs"] });
    },
    onError: (error) => toast.error(`取消任务失败：${errorMessage(error)}`),
  });

  const scheduleMutation = useMutation({
    mutationFn: (values: Partial<MediaPreviewSchedule>) =>
      apiPatch<MediaPreviewSchedule>("/api/v1/maintenance/preview-schedule", values),
    onSuccess: async () => {
      toast.success("预览生成计划已保存");
      await queryClient.invalidateQueries({ queryKey: ["preview-schedule"] });
    },
    onError: (error) => toast.error(`保存计划失败：${errorMessage(error)}`),
  });

  return {
    jobs,
    activeJob: jobs.find((job) => job.status === "queued" || job.status === "running") ?? null,
    jobsQuery,
    scheduleQuery,
    schedule: scheduleQuery.data,
    createJob: createMutation.mutate,
    cancelJob: cancelMutation.mutate,
    saveSchedule: scheduleMutation.mutate,
    isCreating: createMutation.isPending,
    isCancelling: cancelMutation.isPending,
    isSavingSchedule: scheduleMutation.isPending,
  };
}
