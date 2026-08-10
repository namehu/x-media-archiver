import { useInfiniteQuery, useMutation } from "@tanstack/react-query";
import {
  apiDelete,
  apiGet,
  apiPost,
  type ActionResponse,
  type ArchiveSourceListItem,
  type SourceDeleteResponse,
  type SourcePageResponse,
} from "@/lib/api";
import {
  sourceQueryString,
  type SourceDeletedFilter,
  type SourceOperationalFilter,
  type SourceSortBy,
} from "../utils";

export const SOURCES_PAGE_SIZE = 50;

export function useSourcesQuery(
  typeFilter: string,
  deletedFilter: SourceDeletedFilter,
  sortBy: SourceSortBy,
  sortDirection: "asc" | "desc",
  searchText: string,
  operationalFilter: SourceOperationalFilter,
) {
  return useInfiniteQuery({
    queryKey: ["sources", typeFilter, deletedFilter, sortBy, sortDirection, searchText, operationalFilter],
    queryFn: ({ pageParam }) =>
      apiGet<SourcePageResponse>(
        `/api/v1/sources?${sourceQueryString(
          typeFilter,
          deletedFilter,
          sortBy,
          sortDirection,
          searchText,
          operationalFilter,
          SOURCES_PAGE_SIZE,
          pageParam,
        )}`,
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.offset + lastPage.count;
      return nextOffset < lastPage.total_count ? nextOffset : undefined;
    },
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

export function useReorderSources(onReordered: () => Promise<void> | void) {
  return useMutation({
    mutationFn: (sourceIds: number[]) =>
      apiPost<ActionResponse>("/api/v1/sources/reorder", {
        source_ids: sourceIds,
      }),
    onSuccess: async () => {
      await onReordered();
    },
  });
}
