import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiGet, mediaQueryString, type MediaRow } from "../lib/api";
import { formatBytes, formatDateTime } from "../lib/utils";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardContent } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";

type MediaResponse = { rows: MediaRow[]; count: number };

export function LibraryPage() {
  const [filters, setFilters] = useState({
    author: "",
    text: "",
    media_status: "verified",
    media_type: "",
  });
  const [submitted, setSubmitted] = useState(filters);
  const query = useMemo(() => mediaQueryString({ ...submitted, limit: "80" }), [submitted]);
  const { data, isLoading, error } = useQuery({
    queryKey: ["media", query],
    queryFn: () => apiGet<MediaResponse>(`/api/media?${query}`),
  });

  return (
    <div className="space-y-5">
      <form
        className="grid gap-3 rounded-lg border border-border bg-white p-4 md:grid-cols-[1fr_1fr_160px_160px_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(filters);
        }}
      >
        <Input
          placeholder="Author"
          value={filters.author}
          onChange={(event) => setFilters({ ...filters, author: event.target.value })}
        />
        <Input
          placeholder="Tweet text"
          value={filters.text}
          onChange={(event) => setFilters({ ...filters, text: event.target.value })}
        />
        <Select
          value={filters.media_status}
          onChange={(event) => setFilters({ ...filters, media_status: event.target.value })}
        >
          <option value="verified">verified</option>
          <option value="all">all statuses</option>
          <option value="downloaded">downloaded</option>
          <option value="missing">missing</option>
          <option value="corrupt">corrupt</option>
        </Select>
        <Select
          value={filters.media_type}
          onChange={(event) => setFilters({ ...filters, media_type: event.target.value })}
        >
          <option value="">all media</option>
          <option value="photo">photo</option>
          <option value="video">video</option>
        </Select>
        <Button type="submit">Search</Button>
      </form>

      {isLoading ? <State text="Loading media" /> : null}
      {error ? <State text={String(error)} /> : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data?.rows.map((row) => <MediaCard key={`${row.tweet_id}-${row.media_index}`} row={row} />)}
      </section>

      {data && data.rows.length === 0 ? <State text="No media matched the current filters." /> : null}
    </div>
  );
}

function MediaCard({ row }: { row: MediaRow }) {
  const isVideo = row.media_type === "video" || row.media_url?.match(/\.(mp4|mov|m4v|webm)$/i);
  return (
    <Card className="overflow-hidden">
      <div className="flex aspect-video items-center justify-center bg-muted">
        {row.media_url ? (
          isVideo ? (
            <video className="h-full w-full object-contain" src={row.media_url} controls preload="metadata" />
          ) : (
            <img className="h-full w-full object-contain" src={row.media_url} loading="lazy" alt="" />
          )
        ) : (
          <span className="text-sm text-muted-foreground">No preview</span>
        )}
      </div>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              {row.author_display_name || row.author_username || "Unknown author"}
            </div>
            <div className="text-xs text-muted-foreground">@{row.author_username || "-"}</div>
          </div>
          <Badge>{row.media_status || "-"}</Badge>
        </div>
        <p className="line-clamp-3 text-sm text-muted-foreground">{row.tweet_text || "No tweet text"}</p>
        <div className="text-xs text-muted-foreground">
          {row.media_type || "media"} · {formatBytes(row.file_size)} · {formatDateTime(row.published_at)}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="text-sm font-medium text-primary" to={`/tweets/${row.tweet_id}`}>
            Details
          </Link>
          {row.tweet_url ? (
            <a className="text-sm font-medium text-primary" href={row.tweet_url} target="_blank" rel="noreferrer">
              Open tweet
            </a>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function State({ text }: { text: string }) {
  return (
    <Card>
      <CardContent className="p-5 text-sm text-muted-foreground">{text}</CardContent>
    </Card>
  );
}

