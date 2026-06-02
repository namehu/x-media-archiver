import { useQuery } from "@tanstack/react-query";
import { apiGet, type ArchiveSource, type DownloadPolicy } from "../../../lib/api";

export function useSourceDetail(sourceId: number | null) {
  return useQuery({
    queryKey: ["source", sourceId],
    queryFn: () => apiGet<ArchiveSource>(`/api/v1/sources/${sourceId}`),
    enabled: sourceId !== null,
    refetchInterval: (query) => {
      const source = query.state.data as ArchiveSource | undefined;
      if (source?.scan_runs?.some((run) => run.status === "running")) return 3000;
      if (source?.cursor_state?.automation_enabled && source.status === "active") return 5000;
      return 15000;
    },
  });
}

export function useDownloadPolicy() {
  return useQuery({
    queryKey: ["download-policy"],
    queryFn: () => apiGet<DownloadPolicy>("/api/v1/settings/download-policy"),
  });
}
