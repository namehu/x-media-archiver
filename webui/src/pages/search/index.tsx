import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, SlidersHorizontal } from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { apiGet, type SourcePageResponse, type TweetSearchOptionsResponse, type TweetSearchPageResponse } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Pagination } from "@/components/ui/pagination";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { createDialogHistoryEntry } from "@/lib/dialog-history";
import { PostPreviewDialog } from "@/pages/feed/components/post-preview-dialog";
import type { FeedVideoPlaybackSnapshot, FeedVideoPlaybackState } from "@/pages/feed/video-playback-state";
import { SearchFilterPanel } from "./components/search-filter-panel";
import { SearchResultCard } from "./components/search-result-card";
import {
  countSearchFilters,
  DEFAULT_SEARCH_FILTERS,
  readSearchFilters,
  SEARCH_FILTER_KEYS,
  type SearchFilters,
} from "./search-state";

const PAGE_SIZE = 20;

export function SearchPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const appliedFilters = useMemo(() => readSearchFilters(searchParams), [searchParams]);
  const [filters, setFilters] = useState<SearchFilters>(appliedFilters);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    post: TweetSearchPageResponse["rows"][number];
    index: number;
    historyToken: string;
  } | null>(null);
  const videoPlaybackStatesRef = useRef<Map<string, FeedVideoPlaybackState>>(new Map());
  const previewResumeFrameRef = useRef<number | null>(null);
  const offset = parseOffset(searchParams.get("offset"));
  const queryString = useMemo(() => buildApiQuery(appliedFilters, offset), [appliedFilters, offset]);

  useEffect(() => setFilters(appliedFilters), [appliedFilters]);

  const sourcesQuery = useQuery({
    queryKey: ["sources", "search-options"],
    queryFn: () => apiGet<SourcePageResponse>("/api/v1/sources?limit=200&offset=0"),
    staleTime: 60_000,
  });
  const optionsQuery = useQuery({
    queryKey: ["tweet-search-options"],
    queryFn: () => apiGet<TweetSearchOptionsResponse>("/api/v1/library/search/options"),
    staleTime: 60_000,
  });
  const resultsQuery = useQuery({
    queryKey: ["tweet-search", queryString],
    queryFn: () => apiGet<TweetSearchPageResponse>(`/api/v1/library/search?${queryString}`),
  });

  useEffect(
    () => () => {
      if (previewResumeFrameRef.current !== null) window.cancelAnimationFrame(previewResumeFrameRef.current);
    },
    [],
  );

  const getVideoState = useCallback((videoId: string) => videoPlaybackStatesRef.current.get(videoId), []);
  const updateVideoState = useCallback((videoId: string, snapshot: FeedVideoPlaybackSnapshot) => {
    const current = videoPlaybackStatesRef.current.get(videoId);
    const next: FeedVideoPlaybackState = {
      currentTime: snapshot.currentTime ?? current?.currentTime ?? 0,
      paused: snapshot.paused ?? current?.paused ?? true,
      ended: snapshot.ended ?? current?.ended ?? false,
      playbackRate: snapshot.playbackRate ?? current?.playbackRate ?? 1,
      volume: snapshot.volume ?? current?.volume ?? 1,
      muted: snapshot.muted ?? current?.muted ?? false,
      duration: snapshot.duration ?? current?.duration ?? null,
      updatedAt: Date.now(),
    };
    videoPlaybackStatesRef.current.set(videoId, next);
    return next;
  }, []);
  const schedulePreviewResume = useCallback(
    (videoId: string | null) => {
      if (previewResumeFrameRef.current !== null) window.cancelAnimationFrame(previewResumeFrameRef.current);
      if (!videoId) {
        setActiveVideoId(null);
        return;
      }
      previewResumeFrameRef.current = window.requestAnimationFrame(() => {
        previewResumeFrameRef.current = null;
        const videoState = getVideoState(videoId);
        setActiveVideoId(videoState && !videoState.paused && !videoState.ended ? videoId : null);
      });
    },
    [getVideoState],
  );

  const applyFilters = (nextFilters = filters) => {
    setSearchParams((current) => writeSearchParams(current, nextFilters, 0));
  };
  const resetFilters = () => {
    const next = { ...DEFAULT_SEARCH_FILTERS };
    setFilters(next);
    applyFilters(next);
  };
  const activeFilterCount = countSearchFilters(filters);
  const rows = resultsQuery.data?.rows ?? [];

  return (
    <div className="mx-auto grid max-w-[1180px] items-start gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <main className="min-w-0">
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-fg-primary">全局搜索</h1>
            <p className="mt-1 text-sm text-fg-secondary">
              搜索 Tweet 正文、作者、平台 Hashtag、自定义标签、合集和私人备注，并用结构化条件继续收窄。
            </p>
          </div>
          <Button
            type="button"
            variant={activeFilterCount ? "default" : "secondary"}
            size="sm"
            className="shrink-0 lg:hidden"
            onClick={() => setMobileFiltersOpen(true)}
          >
            <SlidersHorizontal data-icon="inline-start" />
            筛选{activeFilterCount ? ` ${activeFilterCount}` : ""}
          </Button>
        </header>

        <div className="mb-3 flex items-center justify-between gap-3 text-sm text-fg-secondary">
          <span className="tabular-nums">
            {resultsQuery.isError
              ? "搜索请求失败"
              : resultsQuery.data
              ? `找到 ${resultsQuery.data.total_count.toLocaleString()} 条 Tweet`
              : "正在读取本地搜索索引"}
          </span>
          {resultsQuery.isFetching && resultsQuery.data ? <span>正在刷新结果…</span> : null}
        </div>

        {resultsQuery.isLoading ? <SearchSkeleton /> : null}
        {resultsQuery.isError ? (
          <ErrorState title="搜索失败" detail={String(resultsQuery.error)} onRetry={() => void resultsQuery.refetch()} />
        ) : null}
        {!resultsQuery.isError && resultsQuery.data && rows.length ? (
          <div className="overflow-hidden rounded-xl border border-border-subtle bg-bg-elevated">
            {rows.map((row) => (
              <SearchResultCard
                key={row.tweet_id}
                row={row}
                query={appliedFilters.q}
                activeVideoId={activeVideoId}
                previewOpen={Boolean(preview)}
                onActivateVideo={setActiveVideoId}
                getVideoState={getVideoState}
                updateVideoState={updateVideoState}
                onPreview={(index) => {
                  const dialogEntry = createDialogHistoryEntry(location.state);
                  void navigate(
                    { pathname: location.pathname, search: location.search, hash: location.hash },
                    { state: dialogEntry.state },
                  );
                  setActiveVideoId(null);
                  setPreview({ post: row, index, historyToken: dialogEntry.token });
                }}
              />
            ))}
          </div>
        ) : null}
        {!resultsQuery.isError && resultsQuery.data && !rows.length ? (
          <EmptyState
            icon={<Search />}
            title={appliedFilters.q || appliedFilters.hashtag ? "没有找到匹配的 Tweet" : "当前条件下没有 Tweet"}
            description="可以减少筛选条件、检查关键词，或把归档状态切换为“全部状态”。"
            action={<Button onClick={resetFilters}>重置搜索</Button>}
          />
        ) : null}
        {!resultsQuery.isError && resultsQuery.data && resultsQuery.data.total_count > 0 ? (
          <div className="mt-4 rounded-lg border border-border-subtle bg-bg-elevated p-3">
            <Pagination
              offset={resultsQuery.data.offset}
              count={resultsQuery.data.count}
              totalCount={resultsQuery.data.total_count}
              pageSize={PAGE_SIZE}
              label="第 {start}–{end} 条，共 {total} 条"
              onOffsetChange={(nextOffset) =>
                setSearchParams((current) => writeSearchParams(current, appliedFilters, nextOffset))
              }
            />
          </div>
        ) : null}
      </main>

      <aside className="hidden min-w-0 self-start lg:sticky lg:top-4 lg:block">
        {sourcesQuery.isError || optionsQuery.isError ? (
          <ErrorState
            title="筛选项加载失败"
            detail="搜索仍可使用；重试后可恢复来源、自定义标签与合集候选项。"
            onRetry={() => void Promise.all([sourcesQuery.refetch(), optionsQuery.refetch()])}
          />
        ) : (
          <SearchFilterPanel
            filters={filters}
            sources={sourcesQuery.data?.rows ?? []}
            tags={optionsQuery.data?.tags ?? []}
            collections={optionsQuery.data?.collections ?? []}
            activeCount={activeFilterCount}
            sourcesTruncated={Boolean(
              sourcesQuery.data && sourcesQuery.data.total_count > sourcesQuery.data.rows.length,
            )}
            onFiltersChange={setFilters}
            onApply={() => applyFilters()}
            onReset={resetFilters}
          />
        )}
      </aside>

      <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
        <SheetContent className="w-[min(94vw,440px)] overflow-y-auto p-4">
          <SheetHeader>
            <SheetTitle>搜索条件</SheetTitle>
            <SheetDescription>关键词与全部筛选会写入当前 URL，便于刷新和分享本地视图。</SheetDescription>
          </SheetHeader>
          <SearchFilterPanel
            filters={filters}
            sources={sourcesQuery.data?.rows ?? []}
            tags={optionsQuery.data?.tags ?? []}
            collections={optionsQuery.data?.collections ?? []}
            activeCount={activeFilterCount}
            sourcesTruncated={Boolean(
              sourcesQuery.data && sourcesQuery.data.total_count > sourcesQuery.data.rows.length,
            )}
            onFiltersChange={setFilters}
            onApply={() => {
              applyFilters();
              setMobileFiltersOpen(false);
            }}
            onReset={resetFilters}
          />
        </SheetContent>
      </Sheet>

      <PostPreviewDialog
        post={preview?.post ?? null}
        activeIndex={preview?.index ?? 0}
        historyToken={preview?.historyToken ?? null}
        getVideoState={getVideoState}
        updateVideoState={updateVideoState}
        onActiveIndexChange={(index) => setPreview((current) => (current ? { ...current, index } : null))}
        onOpenChange={(open) => {
          if (open) return;
          const currentPreview = preview;
          const media = currentPreview?.post.media[currentPreview.index];
          const videoId =
            currentPreview && media?.media_type === "video"
              ? `${currentPreview.post.tweet_id}:${media.id}`
              : null;
          setPreview(null);
          schedulePreviewResume(videoId);
        }}
      />
    </div>
  );
}

function buildApiQuery(filters: SearchFilters, offset: number) {
  const params = writeSearchParams(new URLSearchParams(), filters, offset);
  params.set("client_utc_offset_minutes", String(new Date().getTimezoneOffset()));
  params.set("limit", String(PAGE_SIZE));
  return params.toString();
}

function writeSearchParams(current: URLSearchParams, filters: SearchFilters, offset: number) {
  const next = new URLSearchParams(current);
  for (const key of SEARCH_FILTER_KEYS) next.delete(key);
  next.delete("offset");
  next.delete("limit");
  for (const key of SEARCH_FILTER_KEYS) {
    const value = filters[key].trim();
    if (value) next.set(key, value);
  }
  if (offset > 0) next.set("offset", String(offset));
  return next;
}

function parseOffset(value: string | null) {
  const parsed = Number(value ?? 0);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function SearchSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-border-subtle bg-bg-elevated">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="flex gap-3 border-b border-border-subtle px-4 py-4 last:border-b-0">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <Skeleton className="h-4 w-48 max-w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="aspect-video w-full rounded-xl" />
          </div>
        </div>
      ))}
    </div>
  );
}
