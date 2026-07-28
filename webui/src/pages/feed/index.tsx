import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart, ListFilter, SlidersHorizontal } from "lucide-react";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { toast } from "sonner";
import type { StateSnapshot } from "react-virtuoso";
import {
  apiDelete,
  apiGet,
  mediaQueryString,
  type PostFeedPageResponse,
  type PostFeedRow,
  type SourcePageResponse,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { createDialogHistoryEntry } from "@/lib/dialog-history";
import {
  formatDeletedBytes,
  mediaDeleteErrorMessage,
  type MediaDeleteResponse,
} from "@/lib/media-deletion";
import { DEFAULT_FEED_FILTERS, FeedFilterPanel, type FeedFilters } from "./components/feed-filter-panel";
import { FeedList } from "./components/feed-list";
import { PostDeleteDialog } from "./components/post-delete-dialog";
import { PostPreviewDialog } from "./components/post-preview-dialog";
import { getFeedBrowseState, saveFeedBrowseState } from "./feed-browse-state";

const PAGE_SIZE = 20;

type PostDeleteTarget = {
  post: PostFeedRow;
  mediaIds: number[];
  estimatedBytes: number;
};

export function FeedPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const queryClient = useQueryClient();
  const [restoredState] = useState(() => (navigationType === "POP" ? getFeedBrowseState(location.key) : undefined));
  const [filters, setFilters] = useState<FeedFilters>(() => restoredState?.filters ?? { ...DEFAULT_FEED_FILTERS });
  const [submitted, setSubmitted] = useState<FeedFilters>(
    () => restoredState?.submittedFilters ?? { ...DEFAULT_FEED_FILTERS },
  );
  const [restoreListState, setRestoreListState] = useState<StateSnapshot | null>(restoredState?.listState ?? null);
  const [listVersion, setListVersion] = useState(0);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ post: PostFeedRow; index: number; historyToken: string } | null>(null);
  const [deleteTargetPost, setDeleteTargetPost] = useState<PostDeleteTarget | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteOperationId, setDeleteOperationId] = useState<string | null>(null);
  const [deletedTweetIds, setDeletedTweetIds] = useState<Set<string>>(() => new Set());
  const filtersRef = useRef(filters);
  const submittedRef = useRef(submitted);
  const listStateRef = useRef<StateSnapshot | null>(restoreListState);
  filtersRef.current = filters;
  submittedRef.current = submitted;

  const sourcesQuery = useQuery({
    queryKey: ["sources", "feed-options"],
    queryFn: () => apiGet<SourcePageResponse>("/api/v1/sources?limit=200&offset=0"),
    staleTime: 60_000,
  });
  const sources = sourcesQuery.data?.rows ?? [];
  const hasLikesSource = sources.some((source) => source.source_type === "likes");
  const draftFilterCount = useMemo(() => countActiveFilters(filters), [filters]);
  const query = useMemo(() => feedQueryString(submitted), [submitted]);

  const postsQuery = useInfiniteQuery({
    queryKey: ["posts", query],
    queryFn: ({ pageParam }) => {
      const pageQuery = feedQueryString(submitted, {
        limit: String(PAGE_SIZE),
        offset: String(pageParam),
      });
      return apiGet<PostFeedPageResponse>(`/api/v1/library/posts?${pageQuery}`);
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage) => {
      const nextOffset = lastPage.offset + lastPage.count;
      return lastPage.count > 0 && nextOffset < lastPage.total_count ? nextOffset : undefined;
    },
    gcTime: Infinity,
    refetchOnMount: restoredState ? false : true,
  });
  const rows = useMemo(() => postsQuery.data?.pages.flatMap((page) => page.rows) ?? [], [postsQuery.data]);
  const totalCount = postsQuery.data?.pages[0]?.total_count ?? 0;
  const deleteMutation = useMutation({
    mutationFn: (operationId: string) => {
      if (!deleteTargetPost) throw new Error("未选择要删除的帖子。");
      return apiDelete<MediaDeleteResponse>("/api/v1/library/media", {
        body: {
          operation_id: operationId,
          media_ids: deleteTargetPost.mediaIds,
          confirm_physical_delete: true,
        },
      });
    },
    onSuccess: async (response) => {
      const deletedTweetId = deleteTargetPost?.post.tweet_id ?? null;
      setDeleteDialogOpen(false);
      setDeleteOperationId(null);
      setDeleteTargetPost(null);
      setActiveVideoId(null);
      setPreview((current) => (current?.post.tweet_id === deletedTweetId ? null : current));
      if (deletedTweetId) {
        setDeletedTweetIds((current) => {
          const next = new Set(current);
          next.add(deletedTweetId);
          return next;
        });
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["media"] }),
        queryClient.invalidateQueries({ queryKey: ["tweet"] }),
        queryClient.invalidateQueries({ queryKey: ["summary"] }),
        queryClient.invalidateQueries({ queryKey: ["failures"] }),
        queryClient.invalidateQueries({ queryKey: ["duplicates"] }),
        queryClient.invalidateQueries({ queryKey: ["source-discovered"] }),
      ]);
      toast.success(
        `已删除 ${response.result.deleted_media_count} 项媒体，释放 ${formatDeletedBytes(response.result.deleted_bytes)}`,
      );
    },
  });

  useEffect(
    () => () => {
      saveFeedBrowseState(location.key, {
        filters: filtersRef.current,
        submittedFilters: submittedRef.current,
        listState: listStateRef.current,
      });
    },
    [location.key],
  );

  const resetListAndQuery = useCallback(
    (nextFilters: FeedFilters) => {
      const nextQuery = feedQueryString(nextFilters);
      listStateRef.current = null;
      setRestoreListState(null);
      setListVersion((version) => version + 1);
      setActiveVideoId(null);
      void queryClient.resetQueries({ queryKey: ["posts", nextQuery], exact: true });
    },
    [queryClient],
  );

  const applyFilters = () => {
    const nextFilters = { ...filters };
    setDeletedTweetIds(new Set());
    resetListAndQuery(nextFilters);
    setSubmitted(nextFilters);
  };

  const resetFilters = () => {
    const nextFilters = { ...DEFAULT_FEED_FILTERS };
    setDeletedTweetIds(new Set());
    resetListAndQuery(nextFilters);
    setFilters(nextFilters);
    setSubmitted(nextFilters);
  };

  const switchFeed = (value: string) => {
    if (!value) return;
    const nextFilters = {
      ...submitted,
      source_id: "",
      source_type: value === "likes" ? "likes" : "",
    };
    setDeletedTweetIds(new Set());
    resetListAndQuery(nextFilters);
    setFilters(nextFilters);
    setSubmitted(nextFilters);
  };

  const handleListStateChanged = useCallback(
    (state: StateSnapshot) => {
      listStateRef.current = state;
      saveFeedBrowseState(location.key, {
        filters: filtersRef.current,
        submittedFilters: submittedRef.current,
        listState: state,
      });
    },
    [location.key],
  );

  const openPostDeleteDialog = useCallback((post: PostFeedRow) => {
    const mediaIds = post.media.map((item) => item.id);
    if (!mediaIds.length) {
      toast.error("这篇帖子没有可删除的本地媒体。");
      return;
    }
    deleteMutation.reset();
    setDeleteTargetPost({
      post,
      mediaIds,
      estimatedBytes: post.media.reduce((total, item) => total + (item.file_size ?? 0), 0),
    });
    setDeleteOperationId(crypto.randomUUID());
    setDeleteDialogOpen(true);
  }, [deleteMutation]);

  return (
    <div className="-m-4 sm:-m-6 lg:m-0">
      <div className="mx-auto grid max-w-[1020px] items-start lg:grid-cols-[minmax(0,680px)_280px] lg:gap-5">
        <main className="min-w-0 overflow-hidden border-x border-border-subtle bg-bg-elevated lg:rounded-xl lg:border">
          <header className="sticky top-0 z-20 border-b border-border-subtle bg-bg-elevated/90 backdrop-blur">
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 sm:px-5">
              <div className="min-w-0">
                <h1 className="text-xl font-bold tracking-tight text-fg-primary">帖子浏览</h1>
                <p className="truncate text-xs text-fg-secondary">
                  {postsQuery.data ? `共 ${totalCount.toLocaleString()} 条本地帖子` : "像刷 X 一样浏览本地归档"}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="lg:hidden"
                aria-label="打开筛选"
                onClick={() => setMobileFiltersOpen(true)}
              >
                <SlidersHorizontal />
              </Button>
            </div>
            {hasLikesSource ? (
              <ToggleGroup
                type="single"
                value={submitted.source_type === "likes" ? "likes" : "all"}
                onValueChange={switchFeed}
                className="grid grid-cols-2 gap-0 px-2"
              >
                <ToggleGroupItem
                  value="all"
                  className="rounded-none border-b-2 border-transparent data-[state=on]:border-brand"
                >
                  全部
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="likes"
                  className="rounded-none border-b-2 border-transparent data-[state=on]:border-brand"
                >
                  <Heart data-icon="inline-start" />
                  我的喜欢
                </ToggleGroupItem>
              </ToggleGroup>
            ) : null}
          </header>

          {postsQuery.isLoading ? <FeedSkeleton /> : null}
          {postsQuery.error && !postsQuery.data ? (
            <div className="p-4">
              <ErrorState
                title="帖子加载失败"
                detail={String(postsQuery.error)}
                onRetry={() => void postsQuery.refetch()}
              />
            </div>
          ) : null}
          {postsQuery.data && rows.length ? (
            <FeedList
              key={`${query}:${listVersion}`}
              rows={rows}
              hasNextPage={Boolean(postsQuery.hasNextPage)}
              isFetchingNextPage={postsQuery.isFetchingNextPage}
              nextPageError={postsQuery.isFetchNextPageError ? postsQuery.error : null}
              restoreStateFrom={restoreListState}
              activeVideoId={activeVideoId}
              previewOpen={Boolean(preview)}
              deletedTweetIds={deletedTweetIds}
              onLoadMore={() => void postsQuery.fetchNextPage()}
              onRetryLoadMore={() => void postsQuery.fetchNextPage()}
              onStateChanged={handleListStateChanged}
              onActivateVideo={setActiveVideoId}
              onRequestDelete={openPostDeleteDialog}
              onPreview={(post, index) => {
                const dialogEntry = createDialogHistoryEntry(location.state);
                setActiveVideoId(null);
                void navigate(
                  { pathname: location.pathname, search: location.search, hash: location.hash },
                  { state: dialogEntry.state },
                );
                setPreview({ post, index, historyToken: dialogEntry.token });
              }}
            />
          ) : null}
          {postsQuery.data && !rows.length ? (
            <div className="p-4">
              <EmptyState
                icon={<ListFilter />}
                title="当前条件下没有可浏览的帖子"
                description="信息流只展示至少拥有一项已校验本地媒体的帖子。"
                action={<Button onClick={resetFilters}>清除筛选</Button>}
              />
            </div>
          ) : null}
        </main>

        <aside className="hidden min-w-0 lg:block">
          <FeedFilterPanel
            filters={filters}
            sources={sources}
            activeCount={draftFilterCount}
            onFiltersChange={setFilters}
            onApply={applyFilters}
            onReset={resetFilters}
          />
        </aside>
      </div>

      <Sheet open={mobileFiltersOpen} onOpenChange={setMobileFiltersOpen}>
        <SheetContent className="w-[min(92vw,420px)] overflow-y-auto p-4">
          <SheetHeader>
            <SheetTitle>筛选帖子</SheetTitle>
            <SheetDescription>按来源、作者、正文或媒体类型收窄信息流。</SheetDescription>
          </SheetHeader>
          <FeedFilterPanel
            filters={filters}
            sources={sources}
            activeCount={draftFilterCount}
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
        onActiveIndexChange={(index) => setPreview((current) => (current ? { ...current, index } : null))}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      />
      <PostDeleteDialog
        open={deleteDialogOpen}
        mediaCount={deleteTargetPost?.mediaIds.length ?? 0}
        estimatedBytes={deleteTargetPost?.estimatedBytes ?? 0}
        pending={deleteMutation.isPending}
        error={deleteMutation.error ? mediaDeleteErrorMessage(deleteMutation.error) : null}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open);
          if (!open) {
            setDeleteOperationId(null);
            setDeleteTargetPost(null);
          }
        }}
        onConfirm={() => {
          if (deleteOperationId) deleteMutation.mutate(deleteOperationId);
        }}
      />
    </div>
  );
}

function feedQueryString(filters: FeedFilters, pagination: Record<string, string> = {}) {
  return mediaQueryString({
    source_id: filters.source_id,
    source_type: filters.source_type,
    author_username: filters.author,
    text: filters.text,
    media_type: filters.media_type,
    ...pagination,
  });
}

function countActiveFilters(filters: FeedFilters) {
  return [filters.source_id || filters.source_type, filters.author, filters.text, filters.media_type].filter(Boolean)
    .length;
}

function FeedSkeleton() {
  return (
    <div className="flex flex-col">
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="flex gap-3 border-b border-border-subtle px-4 py-3.5 sm:px-5 sm:py-4">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <Skeleton className="h-4 w-48 max-w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="aspect-video w-full rounded-xl" />
          </div>
        </div>
      ))}
    </div>
  );
}
