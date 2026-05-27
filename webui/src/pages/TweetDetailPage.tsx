import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { apiGet, type TweetDetail } from "../lib/api";
import { formatBytes, formatDateTime } from "../lib/utils";
import { Badge } from "../components/ui/Badge";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";

export function TweetDetailPage() {
  const { tweetId } = useParams();
  const { data, isLoading, error } = useQuery({
    queryKey: ["tweet", tweetId],
    queryFn: () => apiGet<TweetDetail>(`/api/tweets/${tweetId}`),
    enabled: Boolean(tweetId),
  });

  if (isLoading) return <State text="Loading tweet detail" />;
  if (error || !data) return <State text={String(error || "Tweet not found")} />;

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle>{data.tweet.author_display_name || data.tweet.author_username || data.tweet.tweet_id}</CardTitle>
            <Badge>{data.tweet.tweet_status || "-"}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="whitespace-pre-wrap text-sm">{data.tweet.tweet_text || "No tweet text"}</p>
          <div className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
            <div>Published: {formatDateTime(data.tweet.published_at)}</div>
            <div>Updated: {formatDateTime(data.tweet.updated_at)}</div>
            <div>Retry count: {data.tweet.retry_count ?? 0}</div>
            <div>Last error: {data.tweet.last_error || "-"}</div>
          </div>
          {data.tweet.tweet_url ? (
            <a className="text-sm font-medium text-primary" href={data.tweet.tweet_url} target="_blank" rel="noreferrer">
              Open tweet
            </a>
          ) : null}
        </CardContent>
      </Card>

      <section className="grid gap-4 lg:grid-cols-2">
        {data.media.map((media) => (
          <Card key={media.local_path || media.media_index}>
            <div className="flex aspect-video items-center justify-center bg-muted">
              {media.media_url && media.media_type === "video" ? (
                <video className="h-full w-full object-contain" src={media.media_url} controls preload="metadata" />
              ) : media.media_url ? (
                <img className="h-full w-full object-contain" src={media.media_url} alt="" />
              ) : (
                <span className="text-sm text-muted-foreground">No preview</span>
              )}
            </div>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between gap-3">
                <span>{media.media_type || "media"}</span>
                <Badge>{media.media_status || "-"}</Badge>
              </div>
              <div className="text-muted-foreground">{formatBytes(media.file_size)}</div>
              <code className="block break-all text-xs text-muted-foreground">{media.local_path || "-"}</code>
            </CardContent>
          </Card>
        ))}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>Recent attempts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {data.attempts.length === 0 ? (
            <p className="text-sm text-muted-foreground">No attempts recorded.</p>
          ) : (
            data.attempts.map((attempt) => (
              <div key={attempt.id} className="rounded-md border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{attempt.engine || "-"}</Badge>
                  <span>{attempt.status || "-"}</span>
                  <span className="text-muted-foreground">{formatDateTime(attempt.finished_at)}</span>
                </div>
                <div className="mt-1 text-muted-foreground">
                  {attempt.error_category || attempt.error_message || "ok"}
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function State({ text }: { text: string }) {
  return (
    <Card>
      <CardContent className="p-5 text-sm text-muted-foreground">{text}</CardContent>
    </Card>
  );
}

