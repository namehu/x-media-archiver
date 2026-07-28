import { useMutation, useQuery } from "@tanstack/react-query";
import { apiDelete, apiGet, apiPost, type ArchiveSourceListItem, type SourceDeleteResponse, type SourcePageResponse } from "@/lib/api";
import { sourceQueryString } from "../utils";

export const SOURCES_PAGE_SIZE = 50;

export function useSourcesQuery(
  typeFilter: string,
  sortBy: "updated_at" | "created_at",
  sortDirection: "asc" | "desc",
  offset: number,
) {
  return useQuery({
    queryKey: ["sources", typeFilter, sortBy, sortDirection, offset],
    queryFn: () =>
      apiGet<SourcePageResponse>(
        `/api/v1/sources?${sourceQueryString(typeFilter, sortBy, sortDirection, SOURCES_PAGE_SIZE, offset)}`,
      ),
  });
}

export function useCreateSource(onCreated: (source: ArchiveSourceListItem) => Promise<void> | void) {
  return useMutation({
    mutationFn: (input: { sourceType: string; sourceUrl: string; label?: string }) =>
      apiPost<ArchiveSourceListItem>("/api/v1/sources", {
        source_type: input.sourceType,
        source_url: input.sourceUrl,
        label: input.label || undefined,
      }),
    onSuccess: async (source) => {
      await onCreated(source);
    },
  });
}

export function useDeleteSource(onDeleted: (result: SourceDeleteResponse) => Promise<void> | void) {
  return useMutation({
    mutationFn: (sourceId: number) =>
      apiDelete<SourceDeleteResponse>(`/api/v1/sources/${sourceId}`, {
        body: { confirm_delete: true },
      }),
    onSuccess: async (result) => {
      await onDeleted(result);
    },
  });
}
