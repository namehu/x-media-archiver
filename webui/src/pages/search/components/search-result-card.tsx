import { FileText, FolderClosed, Tag } from "lucide-react";
import { Link } from "react-router-dom";
import type { TweetSearchRow } from "@/lib/api";
import { PlatformHashtags } from "@/components/platform-hashtags";
import { Badge } from "@/components/ui/badge";
import { PostCard } from "@/pages/feed/components/post-card";
import type { FeedVideoPlaybackStateApi } from "@/pages/feed/video-playback-state";

export function SearchResultCard({
  row,
  query,
  activeVideoId,
  previewOpen,
  onActivateVideo,
  onPreview,
  getVideoState,
  updateVideoState,
}: {
  row: TweetSearchRow;
  query: string;
  activeVideoId: string | null;
  previewOpen: boolean;
  onActivateVideo: (videoId: string | null) => void;
  onPreview: (index: number) => void;
} & FeedVideoPlaybackStateApi) {
  return (
    <PostCard
      post={row}
      activeVideoId={activeVideoId}
      previewOpen={previewOpen}
      deleted={false}
      allowDelete={false}
      onActivateVideo={onActivateVideo}
      onRequestDelete={() => undefined}
      onPreview={onPreview}
      getVideoState={getVideoState}
      updateVideoState={updateVideoState}
      authorNameContent={
        <HighlightedText text={row.author_display_name || row.author_username || "未知作者"} query={query} />
      }
      authorUsernameContent={
        row.author_username ? <HighlightedText text={row.author_username} query={query} /> : undefined
      }
      tweetTextContent={<HighlightedText text={row.tweet_text || "暂无帖子正文"} query={query} />}
      contextContent={
        <div className="flex flex-col gap-2">
          <PlatformHashtags hashtags={row.hashtags ?? []} />
          {row.tags.length || row.collections.length ? (
            <div role="group" className="flex flex-wrap items-center gap-1.5" aria-label="自定义整理信息">
              {row.tags.length ? <span className="text-xs font-semibold text-fg-secondary">自定义标签</span> : null}
              {row.tags.map((tag) => (
                <Badge key={`tag:${tag}`} tone="secondary" className="gap-1">
                  <Tag data-icon="inline-start" />
                  <HighlightedText text={tag} query={query} />
                </Badge>
              ))}
              {row.collections.map((collection) => (
                <Badge key={`collection:${collection}`} tone="default" className="gap-1">
                  <FolderClosed data-icon="inline-start" />
                  <HighlightedText text={collection} query={query} />
                </Badge>
              ))}
            </div>
          ) : null}
          {row.tweet_status !== "verified" ? (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={statusTone(row.tweet_status)}>{statusLabel(row.tweet_status)}</Badge>
            </div>
          ) : null}
          {row.note_excerpt ? (
            <p className="flex items-start gap-1.5 text-sm text-fg-secondary">
              <FileText data-icon="inline-start" className="mt-0.5 shrink-0" />
              <span className="min-w-0 break-words">
                <HighlightedText text={row.note_excerpt} query={query} />
              </span>
            </p>
          ) : null}
          <div>
            <Link
              className="text-sm font-medium text-brand hover:text-brand-hover hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
              to={`/tweets/${encodeURIComponent(row.tweet_id)}`}
            >
              打开详情
            </Link>
          </div>
        </div>
      }
    />
  );
}

function HighlightedText({ text, query }: { text: string; query: string }) {
  const terms = extractHighlightTerms(query)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .filter(Boolean);
  if (!terms.length) return text;

  const expression = new RegExp(`(${terms.join("|")})`, "gi");
  return text.split(expression).map((part, index) =>
    index % 2 === 1 ? (
      <mark key={`${part}:${index}`} className="rounded-sm bg-brand-soft px-0.5 text-fg-primary">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function extractHighlightTerms(query: string) {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return [];
  if (normalizedQuery.includes("%") || normalizedQuery.includes("_")) return [normalizedQuery];

  const terms: string[] = [];
  for (const match of normalizedQuery.matchAll(/"([^"]+)"|(\S+)/g)) {
    const raw = (match[1] ?? match[2] ?? "").trim();
    if (!raw || raw.startsWith("-") || /^or$/i.test(raw)) continue;
    const term = raw.replace(/^\+/, "").replace(/\*$/, "");
    if (term) terms.push(term);
  }
  return terms;
}

function statusLabel(status: string) {
  return (
    {
      verified: "已校验",
      pending: "待处理",
      downloading: "下载中",
      downloaded: "已下载",
      partial: "部分完成",
      failed_retryable: "可重试失败",
      failed_permanent: "永久失败",
      missing: "文件缺失",
      corrupt: "文件损坏",
      skipped: "已跳过",
    }[status] ?? status
  );
}

function statusTone(status: string): "success" | "warning" | "danger" | "secondary" {
  if (status === "verified") return "success";
  if (["failed_retryable", "failed_permanent", "missing", "corrupt"].includes(status)) return "danger";
  if (["pending", "downloading", "downloaded", "partial"].includes(status)) return "warning";
  return "secondary";
}
