import { useMutation } from "@tanstack/react-query";
import { apiPost, type ArchiveSource, type ArchiveSubmission } from "../../../lib/api";
import { unwrapActionResult } from "../utils";

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
      apiPost<ArchiveSource>(`/api/v1/sources/${sourceId}/status`, { status }),
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

  const historyScanMutation = useMutation({
    mutationFn: ({ sourceId, limit, restart = false }: { sourceId: number; limit: number; restart?: boolean }) =>
      apiPost<ArchiveSource>(`/api/v1/sources/${sourceId}/history-scan`, { limit, restart }),
    onSuccess: async (source) => onRefresh(source.id),
  });

  const stopHistoryScanMutation = useMutation({
    mutationFn: (sourceId: number) => apiPost<ArchiveSource>(`/api/v1/sources/${sourceId}/history-scan/stop`, {}),
    onSuccess: async (source) => onRefresh(source.id),
  });

  return {
    submitMutation,
    statusMutation,
    scanMutation,
    submitDiscoveredMutation,
    historyScanMutation,
    stopHistoryScanMutation,
  };
}
