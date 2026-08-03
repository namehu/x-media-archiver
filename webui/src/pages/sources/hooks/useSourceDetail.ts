import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  apiGet,
  type ArchiveSourceDetail,
  type DownloadPolicy,
  type SourceDownloadSummary,
  type SourceDiscoveryPageResponse,
  type SourceScanRunsPageResponse,
} from "@/lib/api";
import { useRuntimeConnection } from "@/lib/runtime-provider";
import type { TweetFilters } from "../components/source-tweet-filters";

export function useSourceDetail(sourceId: number | null, includeDeleted = false) {
  const runtimeConnection = useRuntimeConnection();
  const shouldFallbackPoll = shouldUseRuntimePollingFallback(runtimeConnection.status);
  const deletedQuery = includeDeleted ? "?include_deleted=true" : "";
  return useQuery({
    queryKey: ["source", sourceId, includeDeleted],
    queryFn: () => apiGet<ArchiveSourceDetail>(`/api/v1/sources/${sourceId}${deletedQuery}`),
    enabled: sourceId !== null,
    refetchInterval: (query) => {
      if (!shouldFallbackPoll) return false;
      const source = query.state.data as ArchiveSourceDetail | undefined;
      if (source?.active_scan_run?.status === "running") return 3000;
      return 15000;
    },
  });
}

export function useSourceDownloads(sourceId: number | null, enabled: boolean, includeDeleted = false) {
  const runtimeConnection = useRuntimeConnection();
  const deletedQuery = includeDeleted ? "?include_deleted=true" : "";
  const shouldFallbackPoll = shouldUseRuntimePollingFallback(runtimeConnection.status);
  return useQuery({
    queryKey: ["source-downloads", sourceId, includeDeleted],
    queryFn: () => apiGet<SourceDownloadSummary>(`/api/v1/sources/${sourceId}/downloads${deletedQuery}`),
    enabled: enabled && sourceId !== null,
    refetchInterval: enabled && shouldFallbackPoll ? 3000 : false,
  });
}

export function useSourceDiscovered(
  sourceId: number | null,
  enabled: boolean,
  includeDeleted = false,
  filters?: TweetFilters,
) {
  const runtimeConnection = useRuntimeConnection();
  const shouldFallbackPoll = shouldUseRuntimePollingFallback(runtimeConnection.status);
  const pageSize = 50;
  return useInfiniteQuery({
    queryKey: ["source-discovered", sourceId, includeDeleted, filters],
    queryFn: ({ pageParam }) => {
      const search = new URLSearchParams({
        limit: String(pageSize),
        offset: String(pageParam),
      });
      if (includeDeleted) search.set("include_deleted", "true");
      if (filters?.media && filters.media !== "all") search.set("media_type", filters.media);
      if (filters?.download && filters.download !== "all") search.set("download_state", filters.download);
      return apiGet<SourceDiscoveryPageResponse>(
        `/api/v1/sources/${sourceId}/discovered?${search.toString()}`,
      );
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.offset + lastPage.count;
      return nextOffset < lastPage.total_count ? nextOffset : undefined;
    },
    enabled: enabled && sourceId !== null,
    refetchInterval: enabled && shouldFallbackPoll ? 15000 : false,
  });
}

export function useSourceScanRuns(sourceId: number | null, enabled: boolean, hasActiveScan: boolean, includeDeleted = false) {
  const runtimeConnection = useRuntimeConnection();
  const shouldFallbackPoll = shouldUseRuntimePollingFallback(runtimeConnection.status);
  const pageSize = 20;
  return useInfiniteQuery({
    queryKey: ["source-scan-runs", sourceId, includeDeleted],
    queryFn: ({ pageParam }) => {
      const deletedParam = includeDeleted ? "&include_deleted=true" : "";
      return apiGet<SourceScanRunsPageResponse>(
        `/api/v1/sources/${sourceId}/scan-runs?limit=${pageSize}&offset=${pageParam}${deletedParam}`,
      );
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.offset + lastPage.count;
      return nextOffset < lastPage.total_count ? nextOffset : undefined;
    },
    enabled: enabled && sourceId !== null,
    refetchInterval: enabled && hasActiveScan && shouldFallbackPoll ? 3000 : false,
  });
}

export function useDownloadPolicy() {
  return useQuery({
    queryKey: ["download-policy"],
    queryFn: () => apiGet<DownloadPolicy>("/api/v1/settings/download-policy"),
  });
}

function shouldUseRuntimePollingFallback(status: string) {
  return status === "offline" || status === "reconnecting" || status === "stale";
}
