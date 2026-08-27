import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Search, SlidersHorizontal } from "lucide-react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { apiGet, type SourcePageResponse, type TweetSearchOptionsResponse, type TweetSearchPageResponse } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Pagination } from "@/components/ui/pagination";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { createDialogHistoryEntry } from "@/lib/dialog-history";
import { getPrivacyRedactProps, usePrivacyRedactionEnabled } from "@/lib/privacy-redaction";
import { PostPreviewDialog } from "@/pages/feed/components/post-preview-dialog";
import type { FeedVideoPlaybackSnapshot, FeedVideoPlaybackState } from "@/pages/feed/video-playback-state";
import { SearchFilterPanel } from "./components/search-filter-panel";
import { SearchResultCard } from "./components/search-result-card";
import {
  countSearchRefinements,
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
  const [filtersOpen, setFiltersOpen] = useState(false);
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
  const privacyRedactionEnabled = usePrivacyRedactionEnabled();

  useEffect(() => setFilters(appliedFilters), [appliedFilters]);

  const sourcesQuery = useQuery({
    queryKey: ["sources", "search-options"],
    queryFn: () => apiGet<SourcePageResponse>("/api/v1/sources?limit=200&offset=0"),
    enabled: filtersOpen,
    staleTime: 60_000,
  });
  const optionsQuery = useQuery({
    queryKey: ["tweet-search-options"],
    queryFn: () => apiGet<TweetSearchOptionsResponse>("/api/v1/library/search/options"),
    enabled: filtersOpen,
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

  const applyFilters = (nextFilters: SearchFilters) => {
    setSearchParams((current) => writeSearchParams(current, nextFilters, 0));
  };
  const resetSearch = () => {
    const next = { ...DEFAULT_SEARCH_FILTERS };
    setFilters(next);
    applyFilters(next);
  };
  const resetFilterDraft = () => {
    setFilters({ ...DEFAULT_SEARCH_FILTERS, q: filters.q });
  };
  const appliedFilterCount = countSearchRefinements(appliedFilters);
  const draftFilterCount = countSearchRefinements(filters);
  const hasSearchIntent = Boolean(appliedFilters.q.trim() || appliedFilterCount);
  const rows = resultsQuery.data?.rows ?? [];

  return (
    <div className="min-h-full">
      <main className="mx-auto min-h-full max-w-[680px] border-x border-border-subtle bg-bg-base" aria-labelledby="search-page-title">
        <h1 id="search-page-title" className="sr-only">全局搜索</h1>
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border-subtle bg-bg-base/95 px-3 backdrop-blur sm:px-4">
          <form
            className="flex min-w-0 flex-1 gap-2"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              applyFilters({ ...appliedFilters, q: filters.q });
            }}
          >
            <Field className="min-w-0 flex-1 gap-0" {...getPrivacyRedactProps(privacyRedactionEnabled)}>
              <FieldLabel className="sr-only" htmlFor="global-search-query">关键词</FieldLabel>
              <div className="relative">
                <Search
                  className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-fg-tertiary"
                  aria-hidden="true"
                />
                <Input
                  id="global-search-query"
                  type="search"
                  value={filters.q}
                  placeholder="搜索正文、作者、Hashtag 或备注"
                  autoComplete="off"
                  enterKeyHint="search"
                  appearance="search"
                  className="h-11 pl-10 pr-12"
                  onChange={(event) => setFilters({ ...filters, q: event.target.value })}
                />
                <Button
                  type="submit"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0.5 top-0.5 rounded-full"
                  aria-label="搜索"
                >
                  <ArrowRight aria-hidden="true" />
                </Button>
              </div>
            </Field>
          </form>

          <Sheet
            open={filtersOpen}
            onOpenChange={(open) => {
              setFiltersOpen(open);
              if (open) setFilters(appliedFilters);
            }}
          >
            <SheetTrigger asChild>
              <Button
                type="button"
                variant="secondary"
                size="icon"
                className="relative shrink-0 rounded-full"
                aria-label={appliedFilterCount ? `筛选，已启用 ${appliedFilterCount} 项` : "筛选"}
              >
                <SlidersHorizontal aria-hidden="true" />
                {appliedFilterCount ? (
                  <Badge
                    tone="default"
                    className="pointer-events-none absolute -right-1 -top-1 min-w-5 justify-center rounded-full px-1 py-0 text-[10px] leading-4"
                  >
                    {appliedFilterCount}
                  </Badge>
                ) : null}
              </Button>
            </SheetTrigger>
            <SheetContent className="w-[min(94vw,440px)] p-0">
              <SheetHeader className="px-5 pb-4 pt-5 sm:px-6">
                <div className="flex items-center justify-between gap-3 pr-8">
                  <SheetTitle>筛选搜索结果</SheetTitle>
                  <Badge tone={draftFilterCount ? "default" : "secondary"}>
                    {draftFilterCount ? `${draftFilterCount} 项` : "默认"}
                  </Badge>
                </div>
                <SheetDescription>
                  按内容范围和整理信息继续收窄，应用后会保留在当前 URL。
                </SheetDescription>
              </SheetHeader>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {sourcesQuery.isError || optionsQuery.isError ? (
                  <div className="px-5 pb-4 sm:px-6">
                    <ErrorState
                      title="部分筛选项加载失败"
                      detail="基础条件仍可使用；重试后可恢复来源、自定义标签与合集候选项。"
                      onRetry={() => void Promise.all([sourcesQuery.refetch(), optionsQuery.refetch()])}
                    />
                  </div>
                ) : null}
                <SearchFilterPanel
                  filters={filters}
                  sources={sourcesQuery.data?.rows ?? []}
                  tags={optionsQuery.data?.tags ?? []}
                  collections={optionsQuery.data?.collections ?? []}
                  sourcesTruncated={Boolean(
                    sourcesQuery.data && sourcesQuery.data.total_count > sourcesQuery.data.rows.length,
                  )}
                  onFiltersChange={setFilters}
                  onApply={() => {
                    applyFilters(filters);
                    setFiltersOpen(false);
                  }}
                  onReset={resetFilterDraft}
                />
              </div>
            </SheetContent>
          </Sheet>
        </header>

        <p className="sr-only" aria-live="polite">
          {resultsQuery.isError
            ? "搜索请求失败"
            : resultsQuery.data
              ? `找到 ${resultsQuery.data.total_count.toLocaleString()} 条 Tweet`
              : "正在读取本地搜索索引"}
        </p>

        {resultsQuery.data && rows.length ? (
          <div className="flex h-9 items-center gap-1.5 border-b border-border-subtle px-4">
            <h2 className="text-sm font-semibold text-fg-primary">
              {hasSearchIntent ? "搜索结果" : "最近归档"}
            </h2>
            <span className="text-xs tabular-nums text-fg-tertiary">
              {resultsQuery.data.total_count.toLocaleString()} 条
            </span>
            {resultsQuery.isFetching ? <span className="ml-auto text-xs text-fg-tertiary">更新中…</span> : null}
          </div>
        ) : null}

        {resultsQuery.isLoading ? <SearchSkeleton /> : null}
        {resultsQuery.isError ? (
          <div className="p-4">
            <ErrorState title="搜索失败" detail={String(resultsQuery.error)} onRetry={() => void resultsQuery.refetch()} />
          </div>
        ) : null}
        {!resultsQuery.isError && resultsQuery.data && rows.length ? (
          <div>
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
          <div className="p-4">
            <EmptyState
              icon={<Search />}
              title={hasSearchIntent ? "没有找到匹配的 Tweet" : "还没有可搜索的 Tweet"}
              description={
                hasSearchIntent
                  ? "试试更短的关键词，或清除部分筛选条件后重新搜索。"
                  : "完成归档后，Tweet 会出现在这里并可按正文、作者和整理信息检索。"
              }
              action={hasSearchIntent ? <Button onClick={resetSearch}>清除搜索条件</Button> : undefined}
            />
          </div>
        ) : null}
        {!resultsQuery.isError && resultsQuery.data && resultsQuery.data.total_count > 0 ? (
          <div className="px-4 py-3">
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
    <div>
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
