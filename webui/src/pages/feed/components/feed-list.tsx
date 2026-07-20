import { useCallback, useEffect, useRef } from "react";
import { Virtuoso, type StateSnapshot, type VirtuosoHandle } from "react-virtuoso";
import type { PostFeedRow } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { useAppScrollContainer } from "@/components/layout/app-scroll-container";
import { PostCard } from "./post-card";

export function FeedList({
  rows,
  hasNextPage,
  isFetchingNextPage,
  nextPageError,
  restoreStateFrom,
  activeVideoId,
  previewOpen,
  onLoadMore,
  onRetryLoadMore,
  onStateChanged,
  onActivateVideo,
  onPreview,
}: {
  rows: PostFeedRow[];
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  nextPageError: unknown;
  restoreStateFrom: StateSnapshot | null;
  activeVideoId: string | null;
  previewOpen: boolean;
  onLoadMore: () => void;
  onRetryLoadMore: () => void;
  onStateChanged: (state: StateSnapshot) => void;
  onActivateVideo: (videoId: string | null) => void;
  onPreview: (post: PostFeedRow, index: number) => void;
}) {
  const scrollParent = useAppScrollContainer();
  const loadMorePendingRef = useRef(false);
  const virtuosoRef = useRef<VirtuosoHandle>(null);

  const captureState = useCallback(() => {
    virtuosoRef.current?.getState(onStateChanged);
  }, [onStateChanged]);

  useEffect(() => {
    if (!isFetchingNextPage) loadMorePendingRef.current = false;
  }, [isFetchingNextPage]);

  useEffect(() => captureState, [captureState]);

  const requestLoadMore = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage || nextPageError || loadMorePendingRef.current) return;
    loadMorePendingRef.current = true;
    onLoadMore();
  }, [hasNextPage, isFetchingNextPage, nextPageError, onLoadMore]);

  if (!scrollParent) return null;

  return (
    <Virtuoso
      ref={virtuosoRef}
      customScrollParent={scrollParent}
      data={rows}
      computeItemKey={(_, post) => post.tweet_id}
      endReached={requestLoadMore}
      itemContent={(_, post) => (
        <PostCard
          post={post}
          activeVideoId={activeVideoId}
          previewOpen={previewOpen}
          onActivateVideo={onActivateVideo}
          onPreview={(index) => onPreview(post, index)}
        />
      )}
      restoreStateFrom={restoreStateFrom ?? undefined}
      isScrolling={(scrolling) => {
        if (!scrolling) captureState();
      }}
      components={{
        Footer: () => (
          <FeedFooter
            hasNextPage={hasNextPage}
            isFetchingNextPage={isFetchingNextPage}
            error={nextPageError}
            onRetry={onRetryLoadMore}
          />
        ),
      }}
    />
  );
}

function FeedFooter({
  hasNextPage,
  isFetchingNextPage,
  error,
  onRetry,
}: {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-4 text-center text-sm text-fg-secondary">
        <span>加载更多帖子失败，已加载的内容会继续保留。</span>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          重试
        </Button>
      </div>
    );
  }
  if (isFetchingNextPage)
    return <p className="px-4 py-4 text-center text-[13px] text-fg-secondary">正在加载更多帖子…</p>;
  if (hasNextPage) return <p className="px-4 py-4 text-center text-[13px] text-fg-tertiary">继续下拉加载更多</p>;
  return <p className="px-4 py-4 text-center text-[13px] text-fg-tertiary">已经浏览完全部帖子</p>;
}
