import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  CalendarDays,
  ExternalLink,
  FileText,
  FolderClosed,
  Image as ImageIcon,
  Images,
  RotateCcw,
  Tags,
} from "lucide-react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { apiGet, type MediaRow, type TweetDetail } from "../../lib/api";
import { PlatformHashtags } from "../../components/platform-hashtags";
import { errorLabel, mediaTypeLabel, statusLabel } from "../../lib/formatters";
import { formatDateTime } from "../../lib/utils";
import { Badge } from "../../components/ui/badge";
import { Avatar, AvatarFallback } from "../../components/ui/avatar";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { EmptyState } from "../../components/ui/empty-state";
import { ErrorState } from "../../components/ui/error-state";
import { MediaThumbnail } from "../../components/ui/media-thumbnail";
import { Skeleton } from "../../components/ui/skeleton";
import { StatusDot } from "../../components/ui/status-dot";
import {
  getPrivacyExternalHref,
  getPrivacyLinkTitle,
  getPrivacyMediaAlt,
  getPrivacyRedactProps,
  usePrivacyRedactionEnabled,
} from "../../lib/privacy-redaction";
import { ImagePreviewDialog } from "./components/image-preview-dialog";
import { MediaDetails } from "./components/media-details";
import { VideoMediaPlayer } from "./components/video-media-player";
import { OrganizationEditorDialog } from "../../components/organization/organization-editor-dialog";

type Attempt = TweetDetail["attempts"][number];
type Tone = "default" | "secondary" | "success" | "warning" | "danger";
type DotStatus = "running" | "success" | "warning" | "danger" | "idle";

export function TweetDetailPage() {
  const privacyRedactionEnabled = usePrivacyRedactionEnabled();
  const { tweetId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const goBack = () => (location.key === "default" ? navigate("/library") : navigate(-1));
  const { data, isLoading, error } = useQuery({
    queryKey: ["tweet", tweetId],
    queryFn: () => apiGet<TweetDetail>(`/api/v1/library/tweets/${tweetId}`),
    enabled: Boolean(tweetId),
  });

  if (isLoading) return <TweetDetailSkeleton />;
  if (error || !data) {
    return (
      <div className="mx-auto min-h-[calc(100dvh-3.5rem)] max-w-[720px] border-x border-border-subtle bg-bg-base">
        <header className="flex h-14 items-center gap-2 border-b border-border-subtle px-2 sm:px-3">
          <Button type="button" variant="ghost" size="icon" aria-label="返回上一页" onClick={goBack}>
            <ArrowLeft aria-hidden="true" />
          </Button>
          <h1 className="text-lg font-bold text-fg-primary">Tweet</h1>
        </header>
        <div className="p-4 sm:p-6">
          <ErrorState title="未找到 Tweet" detail={String(error || "未找到 Tweet")} />
        </div>
      </div>
    );
  }

  const authorName = data.tweet.author_display_name || data.tweet.author_username || data.tweet.tweet_id;
  const tweetText = data.tweet.tweet_text || "暂无 Tweet 文本";
  const tweetHref = getPrivacyExternalHref(privacyRedactionEnabled, data.tweet.tweet_url);
  const statusTone = toneForStatus(data.tweet.tweet_status);
  const authorInitial = authorName.trim().slice(0, 1).toUpperCase() || "X";

  return (
    <div className="grid min-h-[calc(100dvh-3.5rem)] xl:grid-cols-[minmax(0,720px)_360px] xl:justify-center">
      <main className="min-w-0 border-x border-border-subtle bg-bg-base">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border-subtle bg-bg-base/95 px-2 backdrop-blur sm:px-3">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="返回上一页"
              onClick={goBack}
            >
              <ArrowLeft aria-hidden="true" />
            </Button>
            <div className="min-w-0">
              <h1 className="truncate text-lg font-bold tracking-tight text-fg-primary">Tweet</h1>
              <p className="text-xs tabular-nums text-fg-tertiary">{data.media.length} 个媒体</p>
            </div>
          </div>
          <Badge tone={statusTone} className="gap-1">
            <StatusDot status={dotForStatus(data.tweet.tweet_status)} />
            {statusLabel(data.tweet.tweet_status)}
          </Badge>
        </header>

        <article>
          <div className="p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <Avatar className="size-10 shrink-0" {...getPrivacyRedactProps(privacyRedactionEnabled)}>
                <AvatarFallback>{authorInitial}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0" {...getPrivacyRedactProps(privacyRedactionEnabled)}>
                    <h2 className="truncate text-sm font-bold text-fg-primary">{authorName}</h2>
                    <p className="truncate text-sm text-fg-secondary">
                      {data.tweet.author_username ? `@${data.tweet.author_username}` : "已归档作者"}
                    </p>
                  </div>
                  {tweetHref ? (
                    <Button
                      className="shrink-0"
                      variant="ghost"
                      size="sm"
                      title={getPrivacyLinkTitle(privacyRedactionEnabled, "tweet", "在 X 中查看")}
                      onClick={() => window.open(tweetHref, "_blank", "noopener,noreferrer")}
                    >
                      <ExternalLink data-icon="inline-start" aria-hidden="true" />
                      在 X 中查看
                    </Button>
                  ) : null}
                </div>
                <p
                  className="mt-3 whitespace-pre-wrap text-[15px] leading-6 text-fg-primary sm:text-base sm:leading-7"
                  {...getPrivacyRedactProps(privacyRedactionEnabled)}
                >
                  {tweetText}
                </p>
                <div className="mt-3">
                  <PlatformHashtags hashtags={data.hashtags ?? []} />
                </div>
              </div>
            </div>
          </div>

          <MediaGrid media={data.media} title="媒体" emptyText="暂无媒体预览" />

          <footer className="flex flex-col gap-2 border-b border-border-subtle px-4 py-4 text-sm text-fg-secondary sm:flex-row sm:flex-wrap sm:gap-x-5 sm:px-5">
            <span className="inline-flex items-center gap-2">
              <CalendarDays className="size-4 text-fg-tertiary" aria-hidden="true" />
              {formatDateTime(data.tweet.published_at)}
            </span>
            <span className="inline-flex items-center gap-2">
              <Images className="size-4 text-fg-tertiary" aria-hidden="true" />
              {data.media.length} 个媒体文件
            </span>
            <span
              className="[overflow-wrap:anywhere] font-mono text-xs text-fg-tertiary"
              {...getPrivacyRedactProps(privacyRedactionEnabled)}
            >
              {data.tweet.tweet_id}
            </span>
          </footer>
        </article>
      </main>

      <aside
        aria-label="Tweet 整理与元数据"
        className="flex flex-col gap-4 border-r border-border-subtle bg-bg-surface p-4 xl:sticky xl:top-0 xl:max-h-[calc(100dvh-3.5rem)] xl:overflow-y-auto"
      >
          <OrganizationCard
            organization={data.organization ?? { tweet_id: data.tweet.tweet_id, tags: [], collections: [], note: null }}
            onEdit={() => setOrganizeOpen(true)}
          />
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
          <AttemptsTimeline attempts={data.attempts} title="最近尝试" emptyText="没有记录下载尝试。" />
      </aside>
      <OrganizationEditorDialog tweetId={tweetId ?? null} open={organizeOpen} onOpenChange={setOrganizeOpen} />
    </div>
  );
}

function OrganizationCard({
  organization,
  onEdit,
}: {
  organization: TweetDetail["organization"];
  onEdit: () => void;
}) {
  const privacyRedactionEnabled = usePrivacyRedactionEnabled();
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle>整理信息</CardTitle>
            <CardDescription>为当前 Tweet 分配标签、合集和私人备注</CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onEdit}>
            <Tags data-icon="inline-start" />
            编辑整理
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <section className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-xs font-semibold text-fg-secondary">
            <Tags />自定义标签
          </p>
          {organization.tags.length ? (
            <div className="flex flex-wrap gap-1.5" {...getPrivacyRedactProps(privacyRedactionEnabled)}>
              {organization.tags.map((tag) => (
                <Badge key={tag.id} tone="secondary">
                  {tag.name}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-fg-tertiary">暂无自定义标签</p>
          )}
        </section>
        <section className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-xs font-semibold text-fg-secondary">
            <FolderClosed />合集
          </p>
          {organization.collections.length ? (
            <div className="flex flex-wrap gap-1.5" {...getPrivacyRedactProps(privacyRedactionEnabled)}>
              {organization.collections.map((collection) => (
                <Badge key={collection.id} tone="secondary">
                  {collection.name}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-sm text-fg-tertiary">尚未加入合集</p>
          )}
        </section>
        <section className="flex flex-col gap-2" {...getPrivacyRedactProps(privacyRedactionEnabled)}>
          <p className="flex items-center gap-2 text-xs font-semibold text-fg-secondary">
            <FileText />私人备注
          </p>
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-fg-primary">
            {organization.note?.content || "暂无私人备注"}
          </p>
          {organization.note ? (
            <time className="text-xs text-fg-tertiary" dateTime={organization.note.updated_at}>
              更新于 {formatDateTime(organization.note.updated_at)}
            </time>
          ) : null}
        </section>
      </CardContent>
    </Card>
  );
}

function MediaGrid({ media, title, emptyText }: { media: MediaRow[]; title: string; emptyText: string }) {
  const privacyRedactionEnabled = usePrivacyRedactionEnabled();
  const images = media.filter((item) => !isVideoMedia(item));
  const videos = media.filter(isVideoMedia);
  const [imagePreviewIndex, setImagePreviewIndex] = useState<number | null>(null);
  return (
    <section className="border-y border-border-subtle">
      <header className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
        <div>
          <h2 className="text-sm font-semibold text-fg-primary">{title}</h2>
          <p className="mt-0.5 text-xs text-fg-tertiary">点击媒体查看大图与文件详情</p>
        </div>
        <Badge tone="secondary">{media.length}</Badge>
      </header>
      <div className="px-4 pb-4 sm:px-5 sm:pb-5">
        {media.length === 0 ? (
          <EmptyState icon={<ImageIcon className="h-5 w-5" />} title={emptyText} />
        ) : (
          <div className="grid gap-1 sm:grid-cols-2">
            {images.map((item, index) => (
              <article
                key={`${item.local_path || item.media_url || "image"}-${index}`}
                className="group min-w-0 overflow-hidden rounded-xl border border-border-subtle bg-bg-surface focus-within:border-border-strong hover:border-border-strong"
              >
                <MediaThumbnail
                  src={item.preview_url}
                  fallbackSrc={item.media_url}
                  alt={getPrivacyMediaAlt(privacyRedactionEnabled, item.local_path || mediaTypeLabel(item.media_type))}
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
                className="min-w-0 overflow-hidden rounded-xl border border-border-subtle bg-bg-surface"
              >
                <VideoMediaPlayer media={item} />
                <MediaDetails media={item} />
              </article>
            ))}
          </div>
        )}
      </div>
      <ImagePreviewDialog
        media={images}
        activeIndex={imagePreviewIndex}
        onActiveIndexChange={setImagePreviewIndex}
        onOpenChange={(open) => {
          if (!open) setImagePreviewIndex(null);
        }}
      />
    </section>
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
    [
      labels.lastError,
      labels.published,
      labels.retries,
      labels.updated,
      tweet.last_error,
      tweet.published_at,
      tweet.retry_count,
      tweet.updated_at,
    ],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{labels.title}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {meta.map((item) => (
          <div
            key={item.label}
            className="flex items-start justify-between gap-4 border-b border-border-subtle pb-2 last:border-0 last:pb-0"
          >
            <span className="text-sm text-fg-secondary">{item.label}</span>
            <span className="min-w-0 text-right text-sm font-medium text-fg-primary">{item.value}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function AttemptsTimeline({ attempts, title, emptyText }: { attempts: Attempt[]; title: string; emptyText: string }) {
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
          <ol className="relative flex flex-col gap-4 before:absolute before:left-2 before:top-2 before:h-[calc(100%-16px)] before:w-px before:bg-border-subtle">
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
                    {attempt.error_category || attempt.error_message
                      ? errorLabel(attempt.error_category || attempt.error_message)
                      : "ok"}
                  </p>
                  {attempt.stderr_excerpt ? (
                    <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-md bg-bg-elevated p-2 font-mono text-xs text-fg-secondary">
                      {attempt.stderr_excerpt}
                    </pre>
                  ) : null}
                  {attempt.log_stream_id ? (
                    <Link
                      to={`/operations?tab=logs&streamId=${attempt.log_stream_id}`}
                      className="mt-2 inline-flex text-xs font-semibold text-brand hover:text-brand-hover"
                    >
                      查看 Job 日志
                    </Link>
                  ) : (
                    <p className="mt-2 text-xs text-fg-tertiary">该历史任务未保存完整日志。</p>
                  )}
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
    <div className="grid min-h-[calc(100dvh-3.5rem)] xl:grid-cols-[minmax(0,720px)_360px] xl:justify-center">
      <main className="min-w-0 border-x border-border-subtle bg-bg-base">
        <header className="flex h-14 items-center gap-3 border-b border-border-subtle px-3">
          <Skeleton className="size-9 rounded-full" />
          <div>
            <h1 className="text-lg font-bold text-fg-primary">Tweet</h1>
            <p className="text-xs text-fg-tertiary">正在加载归档内容</p>
          </div>
        </header>
        <div className="flex gap-3 p-5">
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-20 w-full" />
            <Skeleton className="aspect-video w-full rounded-xl" />
          </div>
        </div>
      </main>
      <aside className="flex flex-col gap-4 border-r border-border-subtle bg-bg-surface p-4">
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </aside>
    </div>
  );
}

function toneForStatus(status?: string | null): Tone {
  if (status === "verified" || status === "downloaded" || status === "completed") return "success";
  if (status === "running" || status === "processing" || status === "downloading" || status === "queued")
    return "default";
  if (status === "pending" || status === "missing" || status === "corrupt" || status === "completed_with_failures")
    return "warning";
  if (status?.startsWith("failed")) return "danger";
  return "secondary";
}

function dotForStatus(status?: string | null): DotStatus {
  if (status === "running" || status === "processing" || status === "downloading" || status === "queued")
    return "running";
  if (status === "verified" || status === "downloaded" || status === "completed") return "success";
  if (status === "pending" || status === "missing" || status === "corrupt" || status === "completed_with_failures")
    return "warning";
  if (status?.startsWith("failed")) return "danger";
  return "idle";
}
