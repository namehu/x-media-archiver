import { useMutation, useQuery } from "@tanstack/react-query";
import { apiGet, apiPost, type ArchiveSource, type SourcePageResponse } from "../../../lib/api";
import { sourceQueryString } from "../utils";

export const SOURCES_PAGE_SIZE = 50;

export function useSourcesQuery(statusFilter: string, typeFilter: string, offset: number) {
  return useQuery({
    queryKey: ["sources", statusFilter, typeFilter, offset],
    queryFn: () =>
      apiGet<SourcePageResponse>(
        `/api/v1/sources?${sourceQueryString(statusFilter, typeFilter, SOURCES_PAGE_SIZE, offset)}`,
      ),
    refetchInterval: 15000,
  });
}

export function useCreateSource(onCreated: (source: ArchiveSource) => Promise<void> | void) {
  return useMutation({
    mutationFn: (input: { sourceType: string; sourceUrl: string; label?: string }) =>
      apiPost<ArchiveSource>("/api/v1/sources", {
        source_type: input.sourceType,
        source_url: input.sourceUrl,
        label: input.label || undefined,
      }),
    onSuccess: async (source) => {
      await onCreated(source);
    },
  });
}
