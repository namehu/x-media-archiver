import { type ReactNode, useMemo, useRef, useState } from "react";
import { Copy, ExternalLink, FileText, FolderClosed, MoreHorizontal, Tags, Trash2 } from "lucide-react";
import { toast } from "sonner";
import type { PostFeedRow } from "@/lib/api";
import { PlatformHashtags } from "@/components/platform-hashtags";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getDebugExternalHref,
  getDebugLinkTitle,
  getDebugRedactProps,
  useDebugRedactionEnabled,
} from "@/lib/debug-redaction";
import { formatDateTime, cn } from "@/lib/utils";
import type { FeedVideoPlaybackStateApi } from "../video-playback-state";
import { PostMediaGrid } from "./post-media-grid";

const LONG_PRESS_MENU_DELAY_MS = 520;
const LONG_PRESS_CANCEL_DISTANCE_PX = 10;

export function PostCard({
  post,
  activeVideoId,
  previewOpen,
  deleted,
  onActivateVideo,
  onRequestDelete,
  onRequestOrganize,
  onPreview,
  getVideoState,
  updateVideoState,
  allowDelete = true,
  tweetTextContent,
  contextContent,
  authorNameContent,
  authorUsernameContent,
}: {
  post: PostFeedRow;
  activeVideoId: string | null;
  previewOpen: boolean;
  deleted: boolean;
  onActivateVideo: (videoId: string | null) => void;
  onRequestDelete: () => void;
  onRequestOrganize?: () => void;
  onPreview: (index: number) => void;
  allowDelete?: boolean;
  tweetTextContent?: ReactNode;
  contextContent?: ReactNode;
  authorNameContent?: ReactNode;
  authorUsernameContent?: ReactNode;
} & FeedVideoPlaybackStateApi) {
  const debugRedactionEnabled = useDebugRedactionEnabled();
  const [expanded, setExpanded] = useState(false);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressGestureRef = useRef<{ pointerId: number; startX: number; startY: number } | null>(null);
  const authorName = post.author_display_name || post.author_username || "未知作者";
  const tweetText = post.tweet_text || "暂无帖子正文";
  const tweetUrl = getDebugExternalHref(debugRedactionEnabled, post.tweet_url);
  const isLong = tweetText.length > 280 || (tweetText.match(/\n/g)?.length ?? 0) > 5;
  const relativeTime = useMemo(() => formatRelativeTime(post.published_at), [post.published_at]);
  const organizationSummary = contextContent ?? <OrganizationSummary post={post} />;

  const copyLink = async () => {
    if (!tweetUrl) {
      toast.error("调试模式下已禁用外链");
      return;
    }

    try {
      await navigator.clipboard.writeText(tweetUrl);
      toast.success("帖子链接已复制");
    } catch (_error) {
      toast.error("复制链接失败");
    }
  };

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const resetLongPress = (event?: React.PointerEvent<HTMLElement>) => {
    clearLongPressTimer();
    const pointerId = longPressGestureRef.current?.pointerId;
    longPressGestureRef.current = null;
    if (event && pointerId !== undefined && event.currentTarget.hasPointerCapture(pointerId)) {
      event.currentTarget.releasePointerCapture(pointerId);
    }
  };

  const handleLongPressStart = (event: React.PointerEvent<HTMLElement>) => {
    if (deleted || (!allowDelete && !onRequestOrganize)) return;
    if (event.pointerType === "mouse" || event.button !== 0) return;
    if (isLongPressExcludedTarget(event.target)) return;

    longPressGestureRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      longPressGestureRef.current = null;
      setMobileActionsOpen(true);
    }, LONG_PRESS_MENU_DELAY_MS);
  };

  const handleLongPressMove = (event: React.PointerEvent<HTMLElement>) => {
    const gesture = longPressGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const moved =
      Math.abs(event.clientX - gesture.startX) > LONG_PRESS_CANCEL_DISTANCE_PX ||
      Math.abs(event.clientY - gesture.startY) > LONG_PRESS_CANCEL_DISTANCE_PX;
    if (moved) resetLongPress(event);
  };

  const requestDelete = () => {
    if (deleted) return;
    setMobileActionsOpen(false);
    onRequestDelete();
  };

  return (
    <article
      className="border-b border-border-subtle bg-bg-elevated px-4 py-3.5 transition-colors hover:bg-bg-subtle/50 sm:px-5 sm:py-4"
      onPointerDown={handleLongPressStart}
      onPointerMove={handleLongPressMove}
      onPointerUp={resetLongPress}
      onPointerCancel={resetLongPress}
      onLostPointerCapture={() => resetLongPress()}
    >
      <div className="flex flex-col gap-2">
        <header className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Avatar className="size-9 shrink-0" {...getDebugRedactProps(debugRedactionEnabled)}>
              <AvatarFallback>{avatarInitials(authorName)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1" {...getDebugRedactProps(debugRedactionEnabled)}>
              <div className="flex flex-col">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-semibold text-fg-primary text-[15px]">
                    {authorNameContent ?? authorName}
                  </span>
                  {deleted ? (
                    <Badge tone="secondary" className="h-4 px-1 text-[10px]">
                      已删除
                    </Badge>
                  ) : null}
                </div>
                <div className="flex items-center gap-1.5 text-[13px] text-fg-secondary">
                  {post.author_username ? (
                    <span className="truncate">@{authorUsernameContent ?? post.author_username}</span>
                  ) : null}
                  <span className="text-fg-tertiary">·</span>
                  <time
                    dateTime={post.published_at || undefined}
                    title={formatDateTime(post.published_at)}
                    className="hover:underline"
                  >
                    {relativeTime}
                  </time>
                </div>
              </div>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" aria-label="帖子操作" className="shrink-0 -mr-2">
                <MoreHorizontal className="size-5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={() => void copyLink()}>
                  <Copy data-icon="inline-start" />
                  复制链接
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!tweetUrl}
                  onSelect={() => {
                    if (tweetUrl) window.open(tweetUrl, "_blank", "noopener,noreferrer");
                  }}
                  title={getDebugLinkTitle(debugRedactionEnabled, "tweet", "在 X 中查看")}
                >
                  <ExternalLink data-icon="inline-start" />在 X 中查看
                </DropdownMenuItem>
                {onRequestOrganize ? (
                  <DropdownMenuItem onSelect={onRequestOrganize}>
                    <Tags data-icon="inline-start" />
                    整理自定义标签、合集与备注
                  </DropdownMenuItem>
                ) : null}
                {allowDelete ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={deleted}
                      className="text-danger focus:text-danger"
                      onSelect={requestDelete}
                    >
                      <Trash2 data-icon="inline-start" />
                      {deleted ? "本地媒体已删除" : "删除本地媒体"}
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {!deleted ? (
          <div className="mt-1" {...getDebugRedactProps(debugRedactionEnabled)}>
            <p
              className={cn(
                "break-words text-[15px] leading-relaxed text-fg-primary",
                !expanded && isLong ? "whitespace-normal line-clamp-6" : "whitespace-pre-wrap",
              )}
            >
              {tweetTextContent ?? tweetText}
            </p>
            {isLong ? (
              <button
                type="button"
                className="mt-1 text-[13px] font-medium text-brand hover:underline"
                onClick={() => setExpanded((current) => !current)}
              >
                {expanded ? "收起" : "展开"}
              </button>
            ) : null}
          </div>
        ) : null}

        {!deleted && organizationSummary ? (
          <div className="mt-1" {...getDebugRedactProps(debugRedactionEnabled)}>
            {organizationSummary}
          </div>
        ) : null}

        {deleted ? (
          <DeletedMediaPlaceholder />
        ) : (
          <div className="mt-1">
            <PostMediaGrid
              media={post.media}
              tweetId={post.tweet_id}
              activeVideoId={activeVideoId}
              previewOpen={previewOpen}
              onActivateVideo={onActivateVideo}
              onPreview={onPreview}
              getVideoState={getVideoState}
              updateVideoState={updateVideoState}
            />
          </div>
        )}
      </div>
      {allowDelete || onRequestOrganize ? (
        <Drawer open={mobileActionsOpen} onOpenChange={setMobileActionsOpen}>
          <DrawerContent className="border-border-subtle bg-bg-elevated text-fg-primary">
            <DrawerHeader>
              <DrawerTitle>帖子操作</DrawerTitle>
              <DrawerDescription className="text-fg-secondary">对这篇本地归档帖子执行操作。</DrawerDescription>
            </DrawerHeader>
            <DrawerFooter>
              {onRequestOrganize ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={deleted}
                  onClick={() => {
                    setMobileActionsOpen(false);
                    onRequestOrganize();
                  }}
                >
                  <Tags data-icon="inline-start" />
                  整理自定义标签、合集与备注
                </Button>
              ) : null}
              {allowDelete ? (
                <Button type="button" variant="destructive" disabled={deleted} onClick={requestDelete}>
                  <Trash2 data-icon="inline-start" />
                  {deleted ? "本地媒体已删除" : "删除本地媒体"}
                </Button>
              ) : null}
              <DrawerClose asChild>
                <Button type="button" variant="outline">
                  取消
                </Button>
              </DrawerClose>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      ) : null}
    </article>
  );
}

function OrganizationSummary({ post }: { post: PostFeedRow }) {
  const hashtags = post.hashtags ?? [];
  const tags = post.tags ?? [];
  const collectionCount = post.collection_count ?? 0;
  const hasNote = post.has_note ?? false;
  if (!hashtags.length && !tags.length && !collectionCount && !hasNote) return null;

  return (
    <div className="flex flex-col gap-2">
      <PlatformHashtags hashtags={hashtags} />
      {tags.length || collectionCount || hasNote ? (
        <div role="group" className="flex flex-wrap items-center gap-1.5" aria-label="自定义整理摘要">
          {tags.length ? <span className="text-xs font-semibold text-fg-secondary">自定义标签</span> : null}
          {tags.slice(0, 3).map((tag) => (
            <Badge key={tag} tone="secondary" className="max-w-40 truncate">
              {tag}
            </Badge>
          ))}
          {collectionCount ? (
            <span className="inline-flex items-center gap-1 text-xs text-fg-tertiary">
              <FolderClosed />
              {collectionCount} 个合集
            </span>
          ) : null}
          {hasNote ? (
            <span className="inline-flex items-center gap-1 text-xs text-fg-tertiary">
              <FileText />
              有私人备注
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DeletedMediaPlaceholder() {
  return (
    <div
      data-feed-media="true"
      className="mt-3 flex min-h-32 items-center justify-center rounded-xl border border-dashed border-border-subtle bg-bg-muted px-4 py-8 text-center"
    >
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-fg-primary">本地媒体已删除</span>
        <span className="text-xs text-fg-secondary">Tweet、来源和下载历史已保留，可之后重新归档。</span>
      </div>
    </div>
  );
}

function isLongPressExcludedTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        'button, a, input, select, textarea, [role="button"], [role="menuitem"], [data-feed-media="true"]',
      ),
    )
  );
}

function avatarInitials(value: string) {
  return Array.from(value.trim()).slice(0, 2).join("").toUpperCase() || "?";
}

function formatRelativeTime(value?: string | null) {
  if (!value) return "未知时间";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "未知时间";
  const differenceSeconds = Math.round((timestamp - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("zh-CN", { numeric: "auto" });
  if (Math.abs(differenceSeconds) < 60) return formatter.format(differenceSeconds, "second");
  const minutes = Math.round(differenceSeconds / 60);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, "hour");
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 7) return formatter.format(days, "day");
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(timestamp));
}
