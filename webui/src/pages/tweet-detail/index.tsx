import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays, ExternalLink, FileText, Image as ImageIcon, Images, Loader2, RotateCcw } from "lucide-react";
import { useParams } from "react-router-dom";
import { apiGet, type MediaRow, type TweetDetail } from "../../lib/api";
import { errorLabel, mediaTypeLabel, statusLabel } from "../../lib/formatters";
import { formatBytes, formatDateTime } from "../../lib/utils";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { EmptyState } from "../../components/ui/empty-state";
import { ErrorState } from "../../components/ui/error-state";
import { MediaThumbnail } from "../../components/ui/media-thumbnail";
import { Skeleton } from "../../components/ui/skeleton";
import { StatusDot } from "../../components/ui/status-dot";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../components/ui/tooltip";

type Attempt = TweetDetail["attempts"][number];
type Tone = "default" | "secondary" | "success" | "warning" | "danger";
type DotStatus = "running" | "success" | "warning" | "danger" | "idle";

export function TweetDetailPage() {
  const { tweetId } = useParams();
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["tweet", tweetId],
    queryFn: () => apiGet<TweetDetail>(`/api/v1/library/tweets/${tweetId}`),
    enabled: Boolean(tweetId),
  });

  const selectedMedia = previewIndex === null ? null : data?.media[previewIndex] ?? null;
  const canPreviewNext = data ? previewIndex !== null && previewIndex < data.media.length - 1 : false;
  const canPreviewPrevious = previewIndex !== null && previewIndex > 0;

  useEffect(() => {
    if (previewIndex === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "j" && canPreviewNext) setPreviewIndex((index) => (index === null ? index : index + 1));
      if (event.key.toLowerCase() === "k" && canPreviewPrevious) setPreviewIndex((index) => (index === null ? index : index - 1));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canPreviewNext, canPreviewPrevious, previewIndex]);

  if (isLoading) return <TweetDetailSkeleton />;
  if (error || !data) return <ErrorState title="未找到 Tweet" detail={String(error || "未找到 Tweet")} />;

  const authorName = data.tweet.author_display_name || data.tweet.author_username || data.tweet.tweet_id;
  const statusTone = toneForStatus(data.tweet.tweet_status);

  return (
    <div className="mx-auto max-w-[1480px] space-y-6">
        <Card className="relative overflow-hidden border-border-strong bg-bg-elevated shadow-2">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-brand" />
          <CardContent className="p-5 sm:p-6">
            <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 max-w-4xl space-y-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-semibold uppercase tracking-[0.16em] text-fg-tertiary">已归档 Tweet</span>
                  <Badge tone={statusTone} className="gap-1">
                    <StatusDot status={dotForStatus(data.tweet.tweet_status)} />
                    {statusLabel(data.tweet.tweet_status)}
                  </Badge>
                </div>
                <div>
                  <h1 className="break-words text-3xl font-bold tracking-tight text-fg-primary">{authorName}</h1>
                  {data.tweet.author_username ? <p className="mt-1 text-base text-fg-secondary">@{data.tweet.author_username}</p> : null}
                </div>
                <p className="whitespace-pre-wrap text-base leading-7 text-fg-primary">
                  {data.tweet.tweet_text || "暂无 Tweet 文本"}
                </p>
              </div>
              {data.tweet.tweet_url ? (
                <Button variant="secondary" size="sm" onClick={() => window.open(data.tweet.tweet_url || "", "_blank", "noopener,noreferrer")}>
                  <ExternalLink className="h-4 w-4" />
                  在 X 中查看
                </Button>
              ) : null}
            </div>
            <div className="mt-6 flex flex-wrap gap-x-6 gap-y-3 border-t border-border-subtle pt-4 text-sm text-fg-secondary">
              <span className="inline-flex items-center gap-2"><CalendarDays className="h-4 w-4 text-fg-tertiary" />{formatDateTime(data.tweet.published_at)}</span>
              <span className="inline-flex items-center gap-2"><Images className="h-4 w-4 text-fg-tertiary" />{data.media.length} 个媒体文件</span>
              <span className="font-mono text-xs text-fg-tertiary">{data.tweet.tweet_id}</span>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <MediaGrid
            media={data.media}
            title="媒体"
            onPreview={setPreviewIndex}
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

        <MediaPreviewDialog
          media={selectedMedia}
          index={previewIndex}
          count={data.media.length}
          canNext={canPreviewNext}
          canPrevious={canPreviewPrevious}
          onNext={() => setPreviewIndex((index) => (index === null ? index : Math.min(index + 1, data.media.length - 1)))}
          onPrevious={() => setPreviewIndex((index) => (index === null ? index : Math.max(index - 1, 0)))}
          onOpenChange={(open) => {
            if (!open) setPreviewIndex(null);
          }}
        />
    </div>
  );
}

function MediaGrid({
  media,
  title,
  onPreview,
  emptyText,
}: {
  media: MediaRow[];
  title: string;
  onPreview: (index: number) => void;
  emptyText: string;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b border-border-subtle bg-bg-muted/30 p-5 pb-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-xl">{title}</CardTitle>
            <CardDescription className="mt-1">点击媒体可查看大图与文件详情</CardDescription>
          </div>
          <Badge tone="secondary">共 {media.length} 项</Badge>
        </div>
      </CardHeader>
      <CardContent className="p-4 sm:p-5">
        {media.length === 0 ? (
          <EmptyState icon={<ImageIcon className="h-5 w-5" />} title={emptyText} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            {media.map((item, index) => (
              <article
                key={`${item.local_path || item.media_url || "media"}-${item.media_index ?? index}`}
                className="group relative overflow-hidden rounded-xl border border-border-subtle bg-bg-muted transition duration-base ease-out hover:-translate-y-0.5 hover:border-border-strong hover:shadow-2"
              >
                <MediaThumbnail
                  src={item.media_url}
                  alt={item.local_path || mediaTypeLabel(item.media_type)}
                  mediaType={item.media_type}
                  className="rounded-none"
                  onClick={item.media_url ? () => onPreview(index) : undefined}
                />
                <div className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                  <div className="min-w-0">
                    <span className="font-medium text-fg-primary">{mediaTypeLabel(item.media_type)}</span>
                    <span className="ml-2 text-xs text-fg-secondary">{formatBytes(item.file_size)}</span>
                  </div>
                  <Badge tone={toneForStatus(item.media_status)}>{statusLabel(item.media_status)}</Badge>
                </div>
              </article>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
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

function MediaPreviewDialog({
  media,
  index,
  count,
  canNext,
  canPrevious,
  onNext,
  onPrevious,
  onOpenChange,
}: {
  media: MediaRow | null;
  index: number | null;
  count: number;
  canNext: boolean;
  canPrevious: boolean;
  onNext: () => void;
  onPrevious: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const isVideo = media?.media_type === "video" || Boolean(media?.media_url?.match(/\.(mp4|mov|m4v|webm)(\?|$)/i));

  return (
    <Dialog open={Boolean(media)} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(calc(100vw-32px),1120px)] p-4">
        <DialogHeader className="pr-8">
          <DialogTitle>{media ? mediaTypeLabel(media.media_type) : "Media"}</DialogTitle>
          <DialogDescription>
            {index === null ? "-" : `${index + 1} / ${count}`} · {media ? statusLabel(media.media_status) : "-"}
          </DialogDescription>
        </DialogHeader>
        {media ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="flex min-h-[320px] items-center justify-center overflow-hidden rounded-lg bg-bg-muted">
              {media.media_url ? (
                isVideo ? (
                  <video className="max-h-[70vh] w-full object-contain" src={media.media_url} controls autoPlay preload="metadata" />
                ) : (
                  <img className="max-h-[70vh] w-full object-contain" src={media.media_url} alt="" />
                )
              ) : (
                <div className="flex flex-col items-center gap-2 text-sm text-fg-secondary">
                  <ImageIcon className="h-6 w-6" />
                  No preview
                </div>
              )}
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm" disabled={!canPrevious} onClick={onPrevious}>
                      K
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Previous media</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm" disabled={!canNext} onClick={onNext}>
                      J
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Next media</TooltipContent>
                </Tooltip>
              </div>
              <div className="rounded-lg border border-border-subtle bg-bg-surface p-3 text-sm">
                <MetadataLine label="Size" value={formatBytes(media.file_size)} />
                <MetadataLine label="Dimensions" value={media.width && media.height ? `${media.width} x ${media.height}` : "-"} />
                <MetadataLine label="Path" value={media.local_path || "-"} />
              </div>
            </div>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function MetadataLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 border-b border-border-subtle py-2 first:pt-0 last:border-0 last:pb-0">
      <span className="text-xs text-fg-tertiary">{label}</span>
      <span className="break-words text-sm font-medium text-fg-primary">{value}</span>
    </div>
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
