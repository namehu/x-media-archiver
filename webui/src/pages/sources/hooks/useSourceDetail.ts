import { useQuery } from "@tanstack/react-query";
import { apiGet, type ArchiveSource, type DownloadPolicy } from "../../../lib/api";

export function useSourceDetail(sourceId: number | null) {
  return useQuery({
    queryKey: ["source", sourceId],
    queryFn: () => apiGet<ArchiveSource>(`/api/v1/sources/${sourceId}`),
    enabled: sourceId !== null,
    refetchInterval: 15000,
  });
}

export function useDownloadPolicy() {
  return useQuery({
    queryKey: ["download-policy"],
    queryFn: () => apiGet<DownloadPolicy>("/api/v1/settings/download-policy"),
  });
}
