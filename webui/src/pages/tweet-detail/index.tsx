import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ExternalLink, FileText, Image as ImageIcon, Images, Loader2, RotateCcw } from "lucide-react";
import { useParams } from "react-router-dom";
import { apiGet, type MediaRow, type TweetDetail } from "../../lib/api";
import { errorLabel, mediaTypeLabel, statusLabel } from "../../lib/formatters";
import { formatDateTime } from "../../lib/utils";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { EmptyState } from "../../components/ui/empty-state";
import { ErrorState } from "../../components/ui/error-state";
import { MediaThumbnail } from "../../components/ui/media-thumbnail";
import { Skeleton } from "../../components/ui/skeleton";
import { StatusDot } from "../../components/ui/status-dot";
import { ImagePreviewDialog } from "./components/image-preview-dialog";
import { MediaDetails } from "./components/media-details";
import { VideoMediaPlayer } from "./components/video-media-player";

type Attempt = TweetDetail["attempts"][number];
type Tone = "default" | "secondary" | "success" | "warning" | "danger";
type DotStatus = "running" | "success" | "warning" | "danger" | "idle";

export function TweetDetailPage() {
  const { tweetId } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["tweet", tweetId],
    queryFn: () => apiGet<TweetDetail>(`/api/v1/library/tweets/${tweetId}`),
    enabled: Boolean(tweetId),
  });

  if (isLoading) return <TweetDetailSkeleton />;
  if (error || !data) return <ErrorState title="未找到 Tweet" detail={String(error || "未找到 Tweet")} />;

  const authorName = data.tweet.author_display_name || data.tweet.author_username || data.tweet.tweet_id;
  const statusTone = toneForStatus(data.tweet.tweet_status);

  return (
    <div className="mx-auto max-w-[1480px] space-y-4 sm:space-y-6">
        <Card className="relative overflow-hidden border-border-strong bg-bg-elevated shadow-2">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-brand" />
          <CardContent className="p-4 sm:p-6">
            <div className="flex flex-col gap-5 sm:gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 max-w-4xl space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-fg-tertiary">已归档 Tweet</span>
                  <Badge tone={statusTone} className="gap-1">
                    <StatusDot status={dotForStatus(data.tweet.tweet_status)} />
                    {statusLabel(data.tweet.tweet_status)}
                  </Badge>
                </div>
                <div>
                  <h1 className="break-words text-2xl font-bold tracking-tight text-fg-primary sm:text-3xl">{authorName}</h1>
                  {data.tweet.author_username ? <p className="mt-1 text-base text-fg-secondary">@{data.tweet.author_username}</p> : null}
                </div>
                <p className="whitespace-pre-wrap text-base leading-7 text-fg-primary">
                  {data.tweet.tweet_text || "暂无 Tweet 文本"}
                </p>
              </div>
              {data.tweet.tweet_url ? (
                <Button className="self-start" variant="secondary" size="sm" onClick={() => window.open(data.tweet.tweet_url || "", "_blank", "noopener,noreferrer")}>
                  <ExternalLink className="h-4 w-4" />
                  在 X 中查看
                </Button>
              ) : null}
            </div>
            <div className="mt-5 flex flex-col gap-2 border-t border-border-subtle pt-4 text-sm text-fg-secondary sm:mt-6 sm:flex-row sm:flex-wrap sm:gap-x-6 sm:gap-y-3">
              <span className="inline-flex items-center gap-2"><CalendarDays className="h-4 w-4 text-fg-tertiary" />{formatDateTime(data.tweet.published_at)}</span>
              <span className="inline-flex items-center gap-2"><Images className="h-4 w-4 text-fg-tertiary" />{data.media.length} 个媒体文件</span>
              <span className="break-all font-mono text-xs text-fg-tertiary">{data.tweet.tweet_id}</span>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <MediaGrid
            media={data.media}
            title="媒体"
            emptyText="暂无预览"
          />
          <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
            <MetadataCard
              tweet={data.tweet}
              labels={{
                title: "Tweet",
                published: "发布时间",
                updated: "更新时间",
                retries: "重试次数",
                lastError: "最近错误",
              }}
            />
            <AttemptsTimeline
              attempts={data.attempts}
              title="最近尝试"
              emptyText="没有记录下载尝试。"
            />
          </aside>
        </div>

    </div>
  );
}

function MediaGrid({
  media,
  title,
  emptyText,
}: {
  media: MediaRow[];
  title: string;
  emptyText: string;
}) {
  const images = media.filter((item) => !isVideoMedia(item));
  const videos = media.filter(isVideoMedia);
  const [imagePreviewIndex, setImagePreviewIndex] = useState<number | null>(null);
  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border-subtle bg-bg-muted/30 p-4 pb-3 sm:p-5 sm:pb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-xl">{title}</CardTitle>
            <CardDescription className="mt-1">点击媒体可查看大图与文件详情</CardDescription>
          </div>
          <Badge tone="secondary">共 {media.length} 项</Badge>
        </div>
      </CardHeader>
      <CardContent className="p-3 sm:p-5">
        {media.length === 0 ? (
          <EmptyState icon={<ImageIcon className="h-5 w-5" />} title={emptyText} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            {images.map((item, index) => (
              <article
                key={`${item.local_path || item.media_url || "image"}-${index}`}
                className="group overflow-hidden rounded-xl border border-border-subtle bg-bg-muted transition duration-base ease-out hover:-translate-y-0.5 hover:border-border-strong hover:shadow-2"
              >
                <MediaThumbnail
                  src={item.media_url}
                  alt={item.local_path || mediaTypeLabel(item.media_type)}
                  mediaType={item.media_type}
                  className="rounded-none"
                  onClick={item.media_url ? () => setImagePreviewIndex(index) : undefined}
                />
                <MediaDetails media={item} />
              </article>
            ))}
            {videos.map((item, index) => (
              <article
                key={`${item.local_path || item.media_url || "video"}-${index}`}
                className="overflow-hidden rounded-xl border border-border-subtle bg-bg-muted"
              >
                <VideoMediaPlayer media={item} />
                <MediaDetails media={item} />
              </article>
            ))}
          </div>
        )}
      </CardContent>
      <ImagePreviewDialog
        media={images}
        activeIndex={imagePreviewIndex}
        onActiveIndexChange={setImagePreviewIndex}
        onOpenChange={(open) => {
          if (!open) setImagePreviewIndex(null);
        }}
      />
    </Card>
  );
}

function isVideoMedia(media: MediaRow) {
  return media.media_type === "video" || Boolean(media.media_url?.match(/\.(mp4|mov|m4v|webm)(\?|$)/i));
}

function MetadataCard({
  tweet,
  labels,
}: {
  tweet: TweetDetail["tweet"];
  labels: { title: string; published: string; updated: string; retries: string; lastError: string };
}) {
  const meta = useMemo(
    () => [
      { label: labels.published, value: formatDateTime(tweet.published_at) },
      { label: labels.updated, value: formatDateTime(tweet.updated_at) },
      { label: labels.retries, value: String(tweet.retry_count ?? 0) },
      { label: labels.lastError, value: errorLabel(tweet.last_error) },
    ],
    [labels.lastError, labels.published, labels.retries, labels.updated, tweet.last_error, tweet.published_at, tweet.retry_count, tweet.updated_at],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{labels.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {meta.map((item) => (
          <div key={item.label} className="flex items-start justify-between gap-4 border-b border-border-subtle pb-2 last:border-0 last:pb-0">
            <span className="text-sm text-fg-secondary">{item.label}</span>
            <span className="min-w-0 text-right text-sm font-medium text-fg-primary">{item.value}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function AttemptsTimeline({
  attempts,
  title,
  emptyText,
}: {
  attempts: Attempt[];
  title: string;
  emptyText: string;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>{title}</CardTitle>
          </div>
          <Badge tone="secondary">{attempts.length}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        {attempts.length === 0 ? (
          <EmptyState icon={<RotateCcw className="h-5 w-5" />} title={emptyText} />
        ) : (
          <ol className="relative space-y-4 before:absolute before:left-2 before:top-2 before:h-[calc(100%-16px)] before:w-px before:bg-border-subtle">
            {attempts.map((attempt) => (
              <li key={attempt.id} className="relative grid gap-2 pl-7">
                <span className="absolute left-0 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-bg-elevated ring-4 ring-bg-elevated">
                  <StatusDot status={dotForStatus(attempt.status)} />
                </span>
                <div className="rounded-lg border border-border-subtle bg-bg-surface p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={toneForStatus(attempt.status)}>{statusLabel(attempt.status)}</Badge>
                    <Badge tone="secondary">{attempt.engine || "-"}</Badge>
                    <span className="text-xs text-fg-tertiary">Job #{attempt.job_id}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2 text-xs text-fg-secondary">
                    <FileText className="h-3.5 w-3.5" />
                    {formatDateTime(attempt.finished_at)}
                  </div>
                  <p className="mt-2 break-words text-sm text-fg-secondary">
                    {attempt.error_category || attempt.error_message ? errorLabel(attempt.error_category || attempt.error_message) : "ok"}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

function TweetDetailSkeleton() {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 p-4">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)]">
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-24" />
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <Skeleton className="aspect-video rounded-lg" />
            <Skeleton className="aspect-video rounded-lg" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3 p-4">
            <Loader2 className="h-5 w-5 animate-spin text-brand" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-2/3" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function toneForStatus(status?: string | null): Tone {
  if (status === "verified" || status === "downloaded" || status === "completed") return "success";
  if (status === "running" || status === "processing" || status === "downloading" || status === "queued") return "default";
  if (status === "pending" || status === "missing" || status === "corrupt" || status === "completed_with_failures") return "warning";
  if (status?.startsWith("failed")) return "danger";
  return "secondary";
}

function dotForStatus(status?: string | null): DotStatus {
  if (status === "running" || status === "processing" || status === "downloading" || status === "queued") return "running";
  if (status === "verified" || status === "downloaded" || status === "completed") return "success";
  if (status === "pending" || status === "missing" || status === "corrupt" || status === "completed_with_failures") return "warning";
  if (status?.startsWith("failed")) return "danger";
  return "idle";
}
