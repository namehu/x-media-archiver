import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart, ListFilter, Shuffle, SlidersHorizontal } from "lucide-react";
import { useLocation, useNavigate, useNavigationType, useSearchParams } from "react-router-dom";
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
import { OrganizationEditorDialog } from "@/components/organization/organization-editor-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { closeDialogHistoryEntry, createDialogHistoryEntry } from "@/lib/dialog-history";
import { formatDeletedBytes, mediaDeleteErrorMessage, type MediaDeleteResponse } from "@/lib/media-deletion";
import { DEFAULT_FEED_FILTERS, FeedFilterPanel, type FeedFilters } from "./components/feed-filter-panel";
import { FeedList } from "./components/feed-list";
import { PostDeleteDialog } from "./components/post-delete-dialog";
import { PostPreviewDialog } from "./components/post-preview-dialog";
import { getFeedBrowseState, saveFeedBrowseState } from "./feed-browse-state";
import { ensureRandomSeed, readFeedFilters, sameFeedFilters, writeFeedFilters } from "./feed-query-state";
import type { FeedVideoPlaybackSnapshot, FeedVideoPlaybackState } from "./video-playback-state";

const PAGE_SIZE = 20;

type PostDeleteTarget = {
  post: PostFeedRow;
  mediaIds: number[];
  estimatedBytes: number;
};

type FeedPreviewState = {
  activeTweetId: string;
  historyToken: string;
  tweetIds: string[];
  postsByTweetId: Record<string, PostFeedRow>;
  capturedPageCount: number;
  mediaIndexes: Record<string, number>;
};

export function FeedPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const navigationType = useNavigationType();
  const [, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [restoredState] = useState(() => (navigationType === "POP" ? getFeedBrowseState(location.key) : undefined));
  const [initialFilters] = useState(() => ensureRandomSeed(readFeedFilters(new URLSearchParams(location.search))));
  const [canRestoreInitialState] = useState(() =>
    Boolean(restoredState && sameFeedFilters(restoredState.submittedFilters, initialFilters)),
  );
  const [filters, setFilters] = useState<FeedFilters>(initialFilters);
  const [submitted, setSubmitted] = useState<FeedFilters>(initialFilters);
  const [restoreListState, setRestoreListState] = useState<StateSnapshot | null>(
    canRestoreInitialState ? (restoredState?.listState ?? null) : null,
  );
  const [listVersion, setListVersion] = useState(0);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [preview, setPreview] = useState<FeedPreviewState | null>(null);
  const [deleteTargetPost, setDeleteTargetPost] = useState<PostDeleteTarget | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteOperationId, setDeleteOperationId] = useState<string | null>(null);
  const [deletedTweetIds, setDeletedTweetIds] = useState<Set<string>>(() => new Set());
  const [organizeTweetId, setOrganizeTweetId] = useState<string | null>(null);
  const filtersRef = useRef(filters);
  const submittedRef = useRef(submitted);
  const listStateRef = useRef<StateSnapshot | null>(restoreListState);
  const previewResumeFrameRef = useRef<number | null>(null);
  const closingPreviewHistoryTokenRef = useRef<string | null>(null);
  const videoPlaybackStatesRef = useRef<Map<string, FeedVideoPlaybackState>>(
    new Map(canRestoreInitialState ? (restoredState?.videoPlaybackStates ?? []) : []),
  );
  filtersRef.current = filters;
  submittedRef.current = submitted;

  const sourcesQuery = useQuery({
    queryKey: ["sources", "feed-options"],
    queryFn: () => apiGet<SourcePageResponse>("/api/v1/sources?limit=200&offset=0"),
    staleTime: 60_000,
  });
  const sources = sourcesQuery.data?.rows ?? [];
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
    // 随机轮次会产生一次性的 seed 查询键，较短回收期可限制历史轮次占用的内存。
    gcTime: submitted.sort === "random" ? 5 * 60_000 : Infinity,
    refetchOnMount: canRestoreInitialState ? false : true,
  });
  const rows = useMemo(
    () => dedupePosts(postsQuery.data?.pages.flatMap((page) => page.rows) ?? []),
    [postsQuery.data],
  );
  const previewPosts = useMemo(
    () =>
      preview?.tweetIds
        .map((tweetId) => preview.postsByTweetId[tweetId])
        .filter((post): post is PostFeedRow => Boolean(post)) ?? [],
    [preview],
  );
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
      const deletedPost = deleteTargetPost?.post ?? null;
      const deletedTweetId = deleteTargetPost?.post.tweet_id ?? null;
      setDeleteDialogOpen(false);
      setDeleteOperationId(null);
      setDeleteTargetPost(null);
      setActiveVideoId(null);
      if (deletedPost) {
        for (const media of deletedPost.media) {
          videoPlaybackStatesRef.current.delete(`${deletedPost.tweet_id}:${media.id}`);
        }
      }
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
      if (previewResumeFrameRef.current !== null) {
        window.cancelAnimationFrame(previewResumeFrameRef.current);
        previewResumeFrameRef.current = null;
      }
      saveFeedBrowseState(location.key, {
        filters: filtersRef.current,
        submittedFilters: submittedRef.current,
        listState: listStateRef.current,
        videoPlaybackStates: Array.from(videoPlaybackStatesRef.current.entries()),
      });
    },
    [location.key],
  );

  useEffect(() => {
    setPreview((current) => {
      if (!current) return null;
      return reconcilePreviewSnapshot(current, postsQuery.data?.pages ?? [], deletedTweetIds);
    });
  }, [deletedTweetIds, postsQuery.data?.pages]);

  useEffect(() => {
    if (!preview) {
      closingPreviewHistoryTokenRef.current = null;
      return;
    }
    // 快照被删空时只弹出一次对话框历史条目，避免重复 Back 或重复清理。
    if (preview.tweetIds.length || closingPreviewHistoryTokenRef.current === preview.historyToken) return;

    closingPreviewHistoryTokenRef.current = preview.historyToken;
    closeDialogHistoryEntry(preview.historyToken, () => {
      closingPreviewHistoryTokenRef.current = null;
      setPreview(null);
    });
  }, [preview]);

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

  const clearVideoPlaybackStates = useCallback((post?: PostFeedRow | null) => {
    if (!post) {
      videoPlaybackStatesRef.current.clear();
      return;
    }
    for (const media of post.media) {
      videoPlaybackStatesRef.current.delete(`${post.tweet_id}:${media.id}`);
    }
  }, []);

  useEffect(() => {
    const parsed = readFeedFilters(new URLSearchParams(location.search));
    // 每次从 URL 进入页面都重建标准化过滤条件，缺失 seed 的 random 会延续当前 seed，避免刷新后“无意重排”。
    const nextFilters =
      parsed.sort === "random" && !parsed.seed && submittedRef.current.sort === "random"
        ? { ...parsed, seed: submittedRef.current.seed || crypto.randomUUID() }
        : ensureRandomSeed(parsed);
    if (!sameFeedFilters(parsed, nextFilters)) {
      setSearchParams((current) => writeFeedFilters(current, nextFilters), { replace: true });
    }
    if (sameFeedFilters(nextFilters, submittedRef.current)) return;

    listStateRef.current = null;
    setRestoreListState(null);
    setListVersion((version) => version + 1);
    setActiveVideoId(null);
    clearVideoPlaybackStates();
    setDeletedTweetIds(new Set());
    setFilters(nextFilters);
    setSubmitted(nextFilters);
  }, [clearVideoPlaybackStates, location.search, setSearchParams]);

  const schedulePreviewResume = useCallback(
    (videoId: string | null) => {
      if (previewResumeFrameRef.current !== null) {
        window.cancelAnimationFrame(previewResumeFrameRef.current);
        previewResumeFrameRef.current = null;
      }
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

  const resetListAndQuery = useCallback(
    (nextFilters: FeedFilters) => {
      const nextQuery = feedQueryString(nextFilters);
      listStateRef.current = null;
      setRestoreListState(null);
      setListVersion((version) => version + 1);
      setActiveVideoId(null);
      clearVideoPlaybackStates();
      void queryClient.resetQueries({ queryKey: ["posts", nextQuery], exact: true });
    },
    [clearVideoPlaybackStates, queryClient],
  );

  const commitSubmittedFilters = useCallback(
    (nextFilters: FeedFilters) => {
      setDeletedTweetIds(new Set());
      resetListAndQuery(nextFilters);
      setFilters(nextFilters);
      setSubmitted(nextFilters);
      setSearchParams((current) => writeFeedFilters(current, nextFilters));
    },
    [resetListAndQuery, setSearchParams],
  );

  const applyFilters = () => {
    commitSubmittedFilters(ensureRandomSeed({ ...filters }));
  };

  const resetFilters = () => {
    commitSubmittedFilters({
      ...DEFAULT_FEED_FILTERS,
      sort: submitted.sort,
      seed: submitted.seed,
    });
  };

  const switchFeed = (value: string) => {
    if (!value) return;
    const nextFilters = {
      ...submitted,
      source_id: "",
      source_type: value === "likes" ? "likes" : "",
    };
    commitSubmittedFilters(nextFilters);
  };

  const reshuffle = useCallback(() => {
    const nextFilters: FeedFilters = {
      ...submittedRef.current,
      sort: "random",
      seed: crypto.randomUUID(),
    };
    queryClient.removeQueries({ queryKey: ["posts", query], exact: true });
    commitSubmittedFilters(nextFilters);
  }, [commitSubmittedFilters, query, queryClient]);

  const handleListStateChanged = useCallback(
    (state: StateSnapshot) => {
      listStateRef.current = state;
      saveFeedBrowseState(location.key, {
        filters: filtersRef.current,
        submittedFilters: submittedRef.current,
        listState: state,
        videoPlaybackStates: Array.from(videoPlaybackStatesRef.current.entries()),
      });
    },
    [location.key],
  );

  const openPostDeleteDialog = useCallback(
    (post: PostFeedRow) => {
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
    },
    [deleteMutation],
  );

  return (
    <div className="min-h-full">
      <div className="mx-auto grid max-w-[1080px] items-start lg:grid-cols-[minmax(0,680px)_minmax(280px,340px)] lg:gap-6">
        <main className="min-w-0 border-x border-border-subtle bg-bg-base">
          <h1 className="sr-only">首页</h1>
          <header className="sticky top-0 z-20 border-b border-border-subtle bg-bg-base/95 backdrop-blur">
            <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-2 sm:px-5 lg:hidden">
              <p className="truncate text-xs text-fg-secondary">
                {postsQuery.data ? `${totalCount.toLocaleString()} 条本地帖子` : "正在加载本地归档"}
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  variant={draftFilterCount ? "default" : "secondary"}
                  size="sm"
                  className="h-8 rounded-full px-3 text-xs shadow-none"
                  aria-label="打开筛选"
                  onClick={() => setMobileFiltersOpen(true)}
                >
                  <SlidersHorizontal data-icon="inline-start" />
                  筛选
                  {draftFilterCount > 0 && (
                    <span className="ml-1.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-bg-base/20 px-1 text-[10px] font-bold text-white">
                      {draftFilterCount}
                    </span>
                  )}
                </Button>
              </div>
            </div>
            <ToggleGroup
              type="single"
              value={submitted.source_type === "likes" ? "likes" : "all"}
              onValueChange={switchFeed}
              className="flex w-full gap-0"
            >
              <ToggleGroupItem
                value="all"
                className="group relative flex h-11 flex-1 items-center justify-center rounded-none bg-transparent text-sm font-medium text-fg-secondary transition-colors hover:bg-muted/50 hover:text-fg-primary data-[state=on]:bg-transparent data-[state=on]:text-fg-primary"
              >
                <span className="relative flex h-full items-center justify-center px-3 group-data-[state=on]:font-bold">
                  全部
                  {submitted.source_type !== "likes" && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 animate-in fade-in zoom-in-90 duration-200 rounded-t-full bg-brand" />
                  )}
                </span>
              </ToggleGroupItem>
              <ToggleGroupItem
                value="likes"
                className="group relative flex h-11 flex-1 items-center justify-center rounded-none bg-transparent text-sm font-medium text-fg-secondary transition-colors hover:bg-muted/50 hover:text-fg-primary data-[state=on]:bg-transparent data-[state=on]:text-fg-primary"
              >
                <span className="relative flex h-full items-center justify-center gap-1.5 px-3 group-data-[state=on]:font-bold">
                  <Heart aria-hidden="true" />
                  我的喜欢
                  {submitted.source_type === "likes" && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 animate-in fade-in zoom-in-90 duration-200 rounded-t-full bg-brand" />
                  )}
                </span>
              </ToggleGroupItem>
            </ToggleGroup>
            {submitted.sort === "random" ? (
              <div className="flex min-h-10 items-center gap-2 border-t border-border-subtle px-4 py-1.5 sm:px-5">
                <Shuffle className="size-4 shrink-0 text-brand" aria-hidden="true" />
                <p className="min-w-0 flex-1 truncate text-xs font-medium text-fg-secondary">随机时间线</p>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 shrink-0 rounded-full px-3 text-xs"
                  onClick={reshuffle}
                >
                  重新随机
                </Button>
              </div>
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
              randomMode={submitted.sort === "random"}
              onLoadMore={() => void postsQuery.fetchNextPage()}
              onRetryLoadMore={() => void postsQuery.fetchNextPage()}
              onReshuffle={reshuffle}
              onStateChanged={handleListStateChanged}
              onActivateVideo={setActiveVideoId}
              onRequestDelete={openPostDeleteDialog}
              onRequestOrganize={setOrganizeTweetId}
              getVideoState={getVideoState}
              updateVideoState={updateVideoState}
              onPreview={(post, index) => {
                if (previewResumeFrameRef.current !== null) {
                  window.cancelAnimationFrame(previewResumeFrameRef.current);
                  previewResumeFrameRef.current = null;
                }
                // 冻结当前列表顺序；预览期间只把后续新加载的分页追加到末尾。
                const dialogEntry = createDialogHistoryEntry(location.state);
                setActiveVideoId(null);
                void navigate(
                  { pathname: location.pathname, search: location.search, hash: location.hash },
                  { state: dialogEntry.state, flushSync: true },
                );
                const previewableRows = rows.filter(
                  (row) => isPreviewablePost(row) && !deletedTweetIds.has(row.tweet_id),
                );
                setPreview({
                  activeTweetId: post.tweet_id,
                  historyToken: dialogEntry.token,
                  tweetIds: previewableRows.map((row) => row.tweet_id),
                  postsByTweetId: snapshotPosts(previewableRows),
                  capturedPageCount: postsQuery.data?.pages.length ?? 0,
                  mediaIndexes: { [post.tweet_id]: index },
                });
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

        <aside className="hidden min-w-0 self-start lg:sticky lg:top-4 lg:block lg:py-4 lg:pr-4">
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
        posts={previewPosts}
        activeTweetId={preview?.activeTweetId ?? null}
        activeIndex={preview ? (preview.mediaIndexes[preview.activeTweetId] ?? 0) : 0}
        historyToken={preview?.historyToken ?? null}
        hasNextPage={Boolean(postsQuery.hasNextPage)}
        isFetchingNextPage={postsQuery.isFetchingNextPage}
        nextPageError={postsQuery.isFetchNextPageError ? postsQuery.error : null}
        endLabel={submitted.sort === "random" ? "本轮已浏览完" : "已经浏览完"}
        getVideoState={getVideoState}
        updateVideoState={updateVideoState}
        onActiveTweetChange={(tweetId) =>
          setPreview((current) => (current ? { ...current, activeTweetId: tweetId } : null))
        }
        onActiveIndexChange={(index) =>
          setPreview((current) =>
            current
              ? {
                  ...current,
                  mediaIndexes: { ...current.mediaIndexes, [current.activeTweetId]: index },
                }
              : null,
          )
        }
        onLoadMore={() => void postsQuery.fetchNextPage()}
        onRetryLoadMore={() => void postsQuery.fetchNextPage()}
        onOpenChange={(open) => {
          if (open) return;
          const currentPreview = preview;
          const currentPost = currentPreview?.postsByTweetId[currentPreview.activeTweetId] ?? null;
          const currentMediaIndex = currentPreview
            ? (currentPreview.mediaIndexes[currentPreview.activeTweetId] ?? 0)
            : 0;
          const media = currentPost?.media[currentMediaIndex];
          const videoId =
            currentPost && media?.media_type === "video" ? `${currentPost.tweet_id}:${media.id}` : null;
          setPreview(null);
          schedulePreviewResume(videoId);
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
      <OrganizationEditorDialog
        tweetId={organizeTweetId}
        open={Boolean(organizeTweetId)}
        onOpenChange={(open) => {
          if (!open) setOrganizeTweetId(null);
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
    sort: filters.sort,
    seed: filters.sort === "random" ? filters.seed : "",
    ...pagination,
  });
}

function countActiveFilters(filters: FeedFilters) {
  return [filters.source_id || filters.source_type, filters.author, filters.text, filters.media_type].filter(Boolean)
    .length;
}

function dedupePosts(rows: PostFeedRow[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.tweet_id)) return false;
    seen.add(row.tweet_id);
    return true;
  });
}

function reconcilePreviewSnapshot(
  current: FeedPreviewState,
  pages: PostFeedPageResponse[],
  deletedTweetIds: Set<string>,
): FeedPreviewState {
  // 预览列表只允许“追加”新获取页，确保已加载顺序稳定，不因后续 refetch 改变当前导航顺序。
  const previousPosition = Math.max(current.tweetIds.indexOf(current.activeTweetId), 0);
  const knownTweetIds = new Set(current.tweetIds);
  const removedTweetIds = new Set(deletedTweetIds);
  const postsByTweetId = { ...current.postsByTweetId };

  for (const page of pages) {
    for (const post of page.rows) {
      if (!knownTweetIds.has(post.tweet_id)) continue;
      if (!isPreviewablePost(post)) {
        removedTweetIds.add(post.tweet_id);
        continue;
      }
      postsByTweetId[post.tweet_id] = snapshotPost(post);
    }
  }

  const appendedTweetIds: string[] = [];
  // 跳过打开预览时已经捕获的页，只从后续新增页追加条目。
  for (const page of pages.slice(current.capturedPageCount)) {
    for (const post of page.rows) {
      if (knownTweetIds.has(post.tweet_id) || removedTweetIds.has(post.tweet_id) || !isPreviewablePost(post)) {
        continue;
      }
      knownTweetIds.add(post.tweet_id);
      appendedTweetIds.push(post.tweet_id);
      postsByTweetId[post.tweet_id] = snapshotPost(post);
    }
  }

  const tweetIds = [...current.tweetIds, ...appendedTweetIds].filter((tweetId) => !removedTweetIds.has(tweetId));
  for (const tweetId of removedTweetIds) delete postsByTweetId[tweetId];
  const activeTweetId = tweetIds.includes(current.activeTweetId)
    ? current.activeTweetId
    : (tweetIds[Math.min(previousPosition, tweetIds.length - 1)] ?? current.activeTweetId);

  return {
    ...current,
    activeTweetId,
    tweetIds,
    postsByTweetId,
    capturedPageCount: Math.max(current.capturedPageCount, pages.length),
  };
}

function snapshotPosts(posts: PostFeedRow[]) {
  return Object.fromEntries(posts.map((post) => [post.tweet_id, snapshotPost(post)]));
}

function snapshotPost(post: PostFeedRow): PostFeedRow {
  return {
    ...post,
    hashtags: [...(post.hashtags ?? [])],
    tags: [...(post.tags ?? [])],
    media: post.media.map((media) => ({ ...media })),
  };
}

function isPreviewablePost(post: PostFeedRow) {
  return post.media.length > 0;
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
