import { useMemo, useState } from "react";
import { Grid2X2, ListFilter } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiGet, mediaQueryString, type MediaRow, type PageResponse } from "../../lib/api";
import { Card, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { EmptyState } from "../../components/ui/empty-state";
import { ErrorState } from "../../components/ui/error-state";
import { Pagination } from "../../components/ui/pagination";
import { Skeleton } from "../../components/ui/skeleton";
import {
  DEFAULT_LIBRARY_FILTERS,
  LibraryFilterPanel,
  type LibraryFilters,
} from "./components/library-filter-panel";
import { LibraryResultsToolbar } from "./components/library-results-toolbar";
import { MediaGrid } from "./components/media-grid";

const PAGE_SIZE = 60;

export function LibraryPage() {
  const [filters, setFilters] = useState<LibraryFilters>(DEFAULT_LIBRARY_FILTERS);
  const [submitted, setSubmitted] = useState<LibraryFilters>(DEFAULT_LIBRARY_FILTERS);
  const [offset, setOffset] = useState(0);
  const draftFilterCount = useMemo(() => countActiveFilters(filters), [filters]);
  const query = useMemo(
    () => mediaQueryString({ ...submitted, limit: String(PAGE_SIZE), offset: String(offset) }),
    [offset, submitted],
  );
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["media", query],
    queryFn: () => apiGet<PageResponse<MediaRow>>(`/api/v1/library/media?${query}`),
  });

  const applyFilters = () => {
    setOffset(0);
    setSubmitted(filters);
  };

  const resetFilters = () => {
    setOffset(0);
    setFilters(DEFAULT_LIBRARY_FILTERS);
    setSubmitted(DEFAULT_LIBRARY_FILTERS);
  };

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-fg-primary">媒体库</h1>
          <p className="mt-1 text-sm text-fg-secondary">按作者、文本、状态快速收敛本地已归档媒体。</p>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="min-w-0">
          <LibraryFilterPanel
            filters={filters}
            activeCount={draftFilterCount}
            onFiltersChange={setFilters}
            onApply={applyFilters}
            onReset={resetFilters}
          />
        </aside>

        <main className="flex min-w-0 flex-col gap-4">
          {isLoading ? <LibrarySkeleton /> : null}
          {error ? <ErrorState title="API 不可用" detail={String(error)} onRetry={() => void refetch()} /> : null}

          {data ? (
            <>
              <LibraryResultsToolbar
                filters={submitted}
                offset={offset}
                count={data.count}
                totalCount={data.total_count}
                onReset={resetFilters}
              />
              {data.rows.length ? (
                <MediaGrid rows={data.rows} />
              ) : (
                <EmptyState icon={<ListFilter className="h-5 w-5" />} title="当前筛选条件下没有媒体。" />
              )}
              {data.rows.length ? (
                <div className="flex justify-end">
                  <Pagination
                    offset={offset}
                    count={data.count}
                    totalCount={data.total_count}
                    pageSize={PAGE_SIZE}
                    onOffsetChange={setOffset}
                    label="第 {start}-{end} 项，共 {total} 项"
                  />
                </div>
              ) : null}
            </>
          ) : null}
        </main>
      </section>
    </div>
  );
}

function countActiveFilters(filters: LibraryFilters) {
  let count = 0;
  if (filters.author.trim()) count += 1;
  if (filters.text.trim()) count += 1;
  if (filters.media_status !== DEFAULT_LIBRARY_FILTERS.media_status) count += 1;
  if (filters.media_type) count += 1;
  return count;
}

function LibrarySkeleton() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
      {Array.from({ length: 8 }).map((_, index) => (
        <Card key={index} className="overflow-hidden">
          <Skeleton className="aspect-video rounded-none" />
          <CardHeader>
            <div className="flex items-center gap-2">
              <Grid2X2 className="h-4 w-4 text-brand" />
              <CardTitle className="text-base">Loading</CardTitle>
            </div>
            <CardDescription>Media preview</CardDescription>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}
