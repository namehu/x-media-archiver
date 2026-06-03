import { useQuery } from "@tanstack/react-query";
import {
  apiGet,
  type ArchiveSourceDetail,
  type DownloadPolicy,
  type SourceDiscoveryPageResponse,
  type SourceScanRunsPageResponse,
} from "@/lib/api";

export function useSourceDetail(sourceId: number | null) {
  return useQuery({
    queryKey: ["source", sourceId],
    queryFn: () => apiGet<ArchiveSourceDetail>(`/api/v1/sources/${sourceId}`),
    enabled: sourceId !== null,
    refetchInterval: (query) => {
      const source = query.state.data as ArchiveSourceDetail | undefined;
      if (source?.active_scan_run?.status === "running") return 3000;
      if (source?.cursor_state?.automation_enabled && source.status === "active") return 5000;
      return 15000;
    },
  });
}

export function useSourceDiscovered(sourceId: number | null, offset: number, enabled: boolean) {
  const pageSize = 50;
  return useQuery({
    queryKey: ["source-discovered", sourceId, offset],
    queryFn: () =>
      apiGet<SourceDiscoveryPageResponse>(`/api/v1/sources/${sourceId}/discovered?limit=${pageSize}&offset=${offset}`),
    enabled: enabled && sourceId !== null,
    refetchInterval: enabled ? 15000 : false,
  });
}

export function useSourceScanRuns(sourceId: number | null, offset: number, enabled: boolean, hasActiveScan: boolean) {
  const pageSize = 20;
  return useQuery({
    queryKey: ["source-scan-runs", sourceId, offset],
    queryFn: () =>
      apiGet<SourceScanRunsPageResponse>(`/api/v1/sources/${sourceId}/scan-runs?limit=${pageSize}&offset=${offset}`),
    enabled: enabled && sourceId !== null,
    refetchInterval: enabled && hasActiveScan ? 3000 : false,
  });
}

export function useDownloadPolicy() {
  return useQuery({
    queryKey: ["download-policy"],
    queryFn: () => apiGet<DownloadPolicy>("/api/v1/settings/download-policy"),
  });
}
