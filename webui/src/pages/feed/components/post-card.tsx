import { useMemo, useState } from "react";
import { Copy, ExternalLink, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import type { PostFeedRow } from "@/lib/api";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getDebugExternalHref,
  getDebugLinkTitle,
  getDebugRedactProps,
  useDebugRedactionEnabled,
} from "@/lib/debug-redaction";
import { formatDateTime, cn } from "@/lib/utils";
import { PostMediaGrid } from "./post-media-grid";

export function PostCard({
  post,
  activeVideoId,
  previewOpen,
  onActivateVideo,
  onPreview,
}: {
  post: PostFeedRow;
  activeVideoId: string | null;
  previewOpen: boolean;
  onActivateVideo: (videoId: string | null) => void;
  onPreview: (index: number) => void;
}) {
  const debugRedactionEnabled = useDebugRedactionEnabled();
  const [expanded, setExpanded] = useState(false);
  const authorName = post.author_display_name || post.author_username || "未知作者";
  const tweetText = post.tweet_text || "暂无帖子正文";
  const tweetUrl = getDebugExternalHref(debugRedactionEnabled, post.tweet_url);
  const isLong = tweetText.length > 280 || (tweetText.match(/\n/g)?.length ?? 0) > 5;
  const relativeTime = useMemo(() => formatRelativeTime(post.published_at), [post.published_at]);

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

  return (
    <article className="border-b border-border-subtle bg-bg-elevated px-4 py-3.5 sm:px-5 sm:py-4 transition-colors hover:bg-bg-subtle/50">
      <div className="flex items-start gap-3">
        <Avatar className="size-10 shrink-0" {...getDebugRedactProps(debugRedactionEnabled)}>
          <AvatarFallback>{avatarInitials(authorName)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <header className="flex items-start justify-between gap-2">
            <div className="min-w-0" {...getDebugRedactProps(debugRedactionEnabled)}>
              <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                <span className="max-w-full truncate font-semibold text-fg-primary">{authorName}</span>
                {post.author_username ? (
                  <span className="truncate text-sm text-fg-secondary">@{post.author_username}</span>
                ) : null}
                <span className="text-sm text-fg-tertiary">·</span>
                <time
                  className="text-sm text-fg-tertiary"
                  dateTime={post.published_at || undefined}
                  title={formatDateTime(post.published_at)}
                >
                  {relativeTime}
                </time>
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="帖子操作"
                  className="-mr-2 -mt-2 shrink-0"
                >
                  <MoreHorizontal />
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
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </header>

          <div className="mt-1.5" {...getDebugRedactProps(debugRedactionEnabled)}>
            <p
              className={cn(
                "break-words text-[15px] leading-6 text-fg-primary",
                !expanded && isLong ? "whitespace-normal line-clamp-6" : "whitespace-pre-wrap",
              )}
            >
              {tweetText}
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

          <PostMediaGrid
            media={post.media}
            tweetId={post.tweet_id}
            activeVideoId={activeVideoId}
            previewOpen={previewOpen}
            onActivateVideo={onActivateVideo}
            onPreview={onPreview}
          />
        </div>
      </div>
    </article>
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
