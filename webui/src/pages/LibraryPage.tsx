import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiGet, mediaQueryString, type MediaRow, type PageResponse } from "../lib/api";
import { useFormatters, useI18n } from "../lib/i18n";
import { formatBytes, formatDateTime } from "../lib/utils";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardContent } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { PaginationBar } from "../components/ui/PaginationBar";
import { Select } from "../components/ui/Select";

const PAGE_SIZE = 60;

export function LibraryPage() {
  const { t } = useI18n();
  const [filters, setFilters] = useState({
    author: "",
    text: "",
    media_status: "verified",
    media_type: "",
  });
  const [submitted, setSubmitted] = useState(filters);
  const [offset, setOffset] = useState(0);
  const query = useMemo(
    () => mediaQueryString({ ...submitted, limit: String(PAGE_SIZE), offset: String(offset) }),
    [offset, submitted],
  );
  const { data, isLoading, error } = useQuery({
    queryKey: ["media", query],
    queryFn: () => apiGet<PageResponse<MediaRow>>(`/api/media?${query}`),
  });

  return (
    <div className="space-y-5">
      <form
        className="grid gap-3 rounded-lg border border-border bg-white p-4 md:grid-cols-[1fr_1fr_160px_160px_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          setOffset(0);
          setSubmitted(filters);
        }}
      >
        <Input
          placeholder={t("library.author")}
          value={filters.author}
          onChange={(event) => setFilters({ ...filters, author: event.target.value })}
        />
        <Input
          placeholder={t("library.tweetText")}
          value={filters.text}
          onChange={(event) => setFilters({ ...filters, text: event.target.value })}
        />
        <Select
          value={filters.media_status}
          onChange={(event) => setFilters({ ...filters, media_status: event.target.value })}
        >
          <option value="verified">{t("common.status.verified")}</option>
          <option value="all">{t("common.status.all")}</option>
          <option value="downloaded">{t("common.status.downloaded")}</option>
          <option value="missing">{t("common.status.missing")}</option>
          <option value="corrupt">{t("common.status.corrupt")}</option>
        </Select>
        <Select
          value={filters.media_type}
          onChange={(event) => setFilters({ ...filters, media_type: event.target.value })}
        >
          <option value="">{t("common.media.all")}</option>
          <option value="photo">{t("common.media.photo")}</option>
          <option value="video">{t("common.media.video")}</option>
        </Select>
        <Button type="submit">{t("library.search")}</Button>
      </form>

      {isLoading ? <State text={t("library.loading")} /> : null}
      {error ? <State text={String(error)} /> : null}
      {data ? (
        <PaginationBar
          offset={offset}
          count={data.count}
          totalCount={data.total_count}
          pageSize={PAGE_SIZE}
          onOffsetChange={setOffset}
        />
      ) : null}

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data?.rows.map((row) => <MediaCard key={`${row.tweet_id}-${row.media_index}`} row={row} />)}
      </section>

      {data && data.rows.length === 0 ? <State text={t("library.noMatched")} /> : null}
      {data && data.rows.length > 0 ? (
        <PaginationBar
          offset={offset}
          count={data.count}
          totalCount={data.total_count}
          pageSize={PAGE_SIZE}
          onOffsetChange={setOffset}
        />
      ) : null}
    </div>
  );
}

function MediaCard({ row }: { row: MediaRow }) {
  const { t } = useI18n();
  const { statusLabel, mediaTypeLabel } = useFormatters();
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
          <span className="text-sm text-muted-foreground">{t("common.noPreview")}</span>
        )}
      </div>
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold">
              {row.author_display_name || row.author_username || t("common.unknownAuthor")}
            </div>
            <div className="text-xs text-muted-foreground">@{row.author_username || "-"}</div>
          </div>
          <Badge>{statusLabel(row.media_status)}</Badge>
        </div>
        <p className="line-clamp-3 text-sm text-muted-foreground">{row.tweet_text || t("library.noTweetText")}</p>
        <div className="text-xs text-muted-foreground">
          {mediaTypeLabel(row.media_type)} · {formatBytes(row.file_size)} · {formatDateTime(row.published_at)}
        </div>
        <div className="flex flex-wrap gap-2">
          <Link className="text-sm font-medium text-primary" to={`/tweets/${row.tweet_id}`}>
            {t("library.details")}
          </Link>
          {row.tweet_url ? (
            <a className="text-sm font-medium text-primary" href={row.tweet_url} target="_blank" rel="noreferrer">
              {t("library.openTweet")}
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
