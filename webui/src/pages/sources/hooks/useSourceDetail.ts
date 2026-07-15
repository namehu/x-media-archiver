import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  apiGet,
  type ArchiveSourceDetail,
  type DownloadPolicy,
  type SourceDownloadSummary,
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

export function useSourceDownloads(sourceId: number | null, enabled: boolean) {
  return useQuery({
    queryKey: ["source-downloads", sourceId],
    queryFn: () => apiGet<SourceDownloadSummary>(`/api/v1/sources/${sourceId}/downloads`),
    enabled: enabled && sourceId !== null,
    refetchInterval: enabled ? 3000 : false,
  });
}

export function useSourceDiscovered(sourceId: number | null, enabled: boolean) {
  const pageSize = 50;
  return useInfiniteQuery({
    queryKey: ["source-discovered", sourceId],
    queryFn: ({ pageParam }) =>
      apiGet<SourceDiscoveryPageResponse>(`/api/v1/sources/${sourceId}/discovered?limit=${pageSize}&offset=${pageParam}`),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.offset + lastPage.count;
      return nextOffset < lastPage.total_count ? nextOffset : undefined;
    },
    enabled: enabled && sourceId !== null,
    refetchInterval: enabled ? 15000 : false,
  });
}

export function useSourceScanRuns(sourceId: number | null, enabled: boolean, hasActiveScan: boolean) {
  const pageSize = 20;
  return useInfiniteQuery({
    queryKey: ["source-scan-runs", sourceId],
    queryFn: ({ pageParam }) =>
      apiGet<SourceScanRunsPageResponse>(`/api/v1/sources/${sourceId}/scan-runs?limit=${pageSize}&offset=${pageParam}`),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.offset + lastPage.count;
      return nextOffset < lastPage.total_count ? nextOffset : undefined;
    },
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
