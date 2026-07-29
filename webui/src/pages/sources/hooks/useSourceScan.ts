import { useMutation } from "@tanstack/react-query";
import { apiPost, type ArchiveRunControl, type ArchiveSourceDetail, type ArchiveSourceListItem, type ArchiveSubmission } from "@/lib/api";
import type { DownloadSubmitInput } from "../components/source-tweet-filters";
import { unwrapActionResult } from "../utils";

export type SourceScanMode = "history" | "latest_refresh" | "from_start";

export function useSourceActions({
  selectedSourceId,
  onFeedback,
  onScanFeedback,
  onRefresh,
}: {
  selectedSourceId: number | null;
  onFeedback: (feedback: ArchiveSubmission) => void;
  onScanFeedback: (feedback: Record<string, unknown>) => void;
  onRefresh: (sourceId?: number) => Promise<void>;
}) {
  const submitMutation = useMutation({
    mutationFn: ({ sourceId, records }: { sourceId: number; records: Array<{ url: string }> }) =>
      apiPost<ArchiveSubmission>(`/api/v1/sources/${sourceId}/records`, { records }),
    onSuccess: async (result) => {
      onFeedback(result);
      await onRefresh(result.source_id as number | undefined);
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ sourceId, status }: { sourceId: number; status: "active" | "paused" }) =>
      apiPost<ArchiveSourceListItem>(`/api/v1/sources/${sourceId}/status`, { status }),
    onSuccess: async (source) => onRefresh(source.id),
  });

  const pinMutation = useMutation({
    mutationFn: ({ sourceId, isPinned }: { sourceId: number; isPinned: boolean }) =>
      apiPost<ArchiveSourceListItem>(`/api/v1/sources/${sourceId}/pin`, { is_pinned: isPinned }),
    onSuccess: async (source) => onRefresh(source.id),
  });

  const scanMutation = useMutation({
    mutationFn: ({ sourceId, limit, restart }: { sourceId: number; limit: number; restart?: boolean }) =>
      apiPost<Record<string, unknown>>(`/api/v1/sources/${sourceId}/scan`, { limit, restart }),
    onSuccess: async (response) => {
      const result = unwrapActionResult(response);
      onScanFeedback(result);
      await onRefresh(Number(result.source_id) || selectedSourceId || undefined);
    },
  });

  const submitDiscoveredMutation = useMutation({
    mutationFn: ({ sourceId, limit }: { sourceId: number; limit?: number }) =>
      apiPost<ArchiveSubmission>(`/api/v1/sources/${sourceId}/submit-discovered`, { limit }),
    onSuccess: async (result) => {
      onFeedback(result);
      await onRefresh(result.source_id);
    },
  });

  const sourceDownloadMutation = useMutation({
    mutationFn: ({ sourceId, scope, tweetIds, limit, mediaType }: DownloadSubmitInput) =>
      apiPost<ArchiveSubmission>(`/api/v1/sources/${sourceId}/downloads`, {
        scope,
        tweet_ids: tweetIds,
        limit,
        media_type: mediaType,
      }),
    onSuccess: async (result) => {
      onFeedback(result);
      await onRefresh(result.source_id);
    },
  });

  const pauseDownloadMutation = useMutation({
    mutationFn: (runId: number) => apiPost<ArchiveRunControl>(`/api/v1/archive-runs/${runId}/pause`, {}),
    onSuccess: async () => onRefresh(selectedSourceId || undefined),
  });

  const resumeDownloadMutation = useMutation({
    mutationFn: (runId: number) => apiPost<ArchiveRunControl>(`/api/v1/archive-runs/${runId}/resume`, {}),
    onSuccess: async () => onRefresh(selectedSourceId || undefined),
  });

  const stopDownloadMutation = useMutation({
    mutationFn: (runId: number) => apiPost<ArchiveRunControl>(`/api/v1/archive-runs/${runId}/stop`, {}),
    onSuccess: async () => onRefresh(selectedSourceId || undefined),
  });

  const cancelDownloadItemsMutation = useMutation({
    mutationFn: ({ runId, tweetIds }: { runId: number; tweetIds: string[] }) =>
      apiPost<ArchiveRunControl>(`/api/v1/archive-runs/${runId}/items/cancel`, { tweet_ids: tweetIds }),
    onSuccess: async () => onRefresh(selectedSourceId || undefined),
  });

  const historyScanMutation = useMutation({
    mutationFn: ({ sourceId, limit, restart = false }: { sourceId: number; limit: number; restart?: boolean }) =>
      apiPost<ArchiveSourceDetail>(`/api/v1/sources/${sourceId}/history-scan`, { limit, restart }),
    onSuccess: async (source) => onRefresh(source.id),
  });

  const scanSessionMutation = useMutation({
    mutationFn: ({ sourceId, mode, limit, restart = false }: { sourceId: number; mode: SourceScanMode; limit: number; restart?: boolean }) =>
      apiPost<ArchiveSourceDetail>(`/api/v1/sources/${sourceId}/scan-sessions`, { mode, limit, restart }),
    onSuccess: async (source) => onRefresh(source.id),
  });

  const pauseScanSessionMutation = useMutation({
    mutationFn: (sourceId: number) => apiPost<ArchiveSourceDetail>(`/api/v1/sources/${sourceId}/scan-sessions/pause`, {}),
    onSuccess: async (source) => onRefresh(source.id),
  });

  const resumeScanSessionMutation = useMutation({
    mutationFn: (sourceId: number) => apiPost<ArchiveSourceDetail>(`/api/v1/sources/${sourceId}/scan-sessions/resume`, {}),
    onSuccess: async (source) => onRefresh(source.id),
  });

  const stopHistoryScanMutation = useMutation({
    mutationFn: (sourceId: number) => apiPost<ArchiveSourceDetail>(`/api/v1/sources/${sourceId}/scan-sessions/stop`, {}),
    onSuccess: async (source) => onRefresh(source.id),
  });

  return {
    submitMutation,
    statusMutation,
    pinMutation,
    scanMutation,
    submitDiscoveredMutation,
    sourceDownloadMutation,
    pauseDownloadMutation,
    resumeDownloadMutation,
    stopDownloadMutation,
    cancelDownloadItemsMutation,
    historyScanMutation,
    scanSessionMutation,
    pauseScanSessionMutation,
    resumeScanSessionMutation,
    stopHistoryScanMutation,
  };
}
