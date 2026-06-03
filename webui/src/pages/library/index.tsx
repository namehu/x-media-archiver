import { forwardRef, useMemo, useState, type CSSProperties, type HTMLAttributes } from "react";
import { Link } from "react-router-dom";
import { Grid2X2, ListFilter, Search } from "lucide-react";
import { VirtuosoGrid } from "react-virtuoso";
import { useQuery } from "@tanstack/react-query";
import { apiGet, mediaQueryString, type MediaRow, type PageResponse } from "../../lib/api";
import { mediaTypeLabel, statusLabel } from "../../lib/formatters";
import { formatBytes, formatDateTime } from "../../lib/utils";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { EmptyState } from "../../components/ui/empty-state";
import { ErrorState } from "../../components/ui/error-state";
import { Input } from "../../components/ui/input";
import { MediaThumbnail } from "../../components/ui/media-thumbnail";
import { Pagination } from "../../components/ui/pagination";
import { Skeleton } from "../../components/ui/skeleton";

const PAGE_SIZE = 60;

export function LibraryPage() {
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
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["media", query],
    queryFn: () => apiGet<PageResponse<MediaRow>>(`/api/v1/library/media?${query}`),
  });

  const applyFilters = () => {
    setOffset(0);
    setSubmitted(filters);
  };

  return (
    <div className="space-y-5">
      <section className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-fg-primary">媒体库</h1>
          <p className="mt-1 text-sm text-fg-secondary">本地已归档媒体文件索引与搜索。</p>
        </div>
        {data ? <Badge tone="default">{data.total_count}</Badge> : null}
      </section>

      <Card className="sticky top-0 z-10">
        <CardContent className="p-3">
          <form
            className="grid gap-3 md:grid-cols-[1fr_1fr_160px_160px_auto]"
            onSubmit={(event) => {
              event.preventDefault();
              applyFilters();
            }}
          >
            <Input
              placeholder="作者"
              value={filters.author}
              onChange={(event) => setFilters({ ...filters, author: event.target.value })}
            />
            <Input
              placeholder="Tweet 文本"
              value={filters.text}
              onChange={(event) => setFilters({ ...filters, text: event.target.value })}
            />
            <select
              className="h-9 rounded-md border border-border-strong bg-bg-elevated px-3 text-sm text-fg-primary outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
              value={filters.media_status}
              onChange={(event) => setFilters({ ...filters, media_status: event.target.value })}
            >
              <option value="verified">已校验</option>
              <option value="all">全部状态</option>
              <option value="downloaded">已下载</option>
              <option value="missing">文件缺失</option>
              <option value="corrupt">文件损坏</option>
            </select>
            <select
              className="h-9 rounded-md border border-border-strong bg-bg-elevated px-3 text-sm text-fg-primary outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
              value={filters.media_type}
              onChange={(event) => setFilters({ ...filters, media_type: event.target.value })}
            >
              <option value="">全部媒体</option>
              <option value="photo">图片</option>
              <option value="video">视频</option>
            </select>
            <Button type="submit">
              <Search className="h-4 w-4" />
              搜索
            </Button>
          </form>
        </CardContent>
      </Card>

      {isLoading ? <LibrarySkeleton /> : null}
      {error ? <ErrorState title="API 不可用" detail={String(error)} onRetry={() => void refetch()} /> : null}

      {data ? (
        <>
          <Pagination
            offset={offset}
            count={data.count}
            totalCount={data.total_count}
            pageSize={PAGE_SIZE}
            onOffsetChange={setOffset}
            label="第 {start}-{end} 项，共 {total} 项"
          />
          {data.rows.length ? <MediaGrid rows={data.rows} /> : <EmptyState icon={<ListFilter className="h-5 w-5" />} title="当前筛选条件下没有媒体。" />}
          {data.rows.length ? (
            <Pagination
              offset={offset}
              count={data.count}
              totalCount={data.total_count}
              pageSize={PAGE_SIZE}
              onOffsetChange={setOffset}
              label="第 {start}-{end} 项，共 {total} 项"
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function MediaGrid({ rows }: { rows: MediaRow[] }) {
  return (
    <VirtuosoGrid
      useWindowScroll
      data={rows}
      components={gridComponents}
      itemContent={(_, row) => <MediaCard row={row} />}
    />
  );
}

const GridList = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & { style?: CSSProperties }>(
  ({ style, children, ...props }, ref) => (
    <div
      ref={ref}
      style={style}
      className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
      {...props}
    >
      {children}
    </div>
  ),
);
GridList.displayName = "GridList";

const GridItem = ({ children, ...props }: HTMLAttributes<HTMLDivElement>) => (
  <div className="min-w-0" {...props}>
    {children}
  </div>
);

const gridComponents = {
  List: GridList,
  Item: GridItem,
};

function MediaCard({ row }: { row: MediaRow }) {
  const title = row.author_display_name || row.author_username || "未知作者";

  return (
    <Card className="group overflow-hidden hover:border-border-strong hover:shadow-2">
      <MediaThumbnail src={row.media_url} mediaType={row.media_type} alt={row.tweet_text || title} />
      <CardContent className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-fg-primary">{title}</div>
            <div className="text-xs text-fg-tertiary">@{row.author_username || "-"}</div>
          </div>
          <Badge tone={row.media_status === "verified" || row.media_status === "downloaded" ? "success" : "warning"}>
            {statusLabel(row.media_status)}
          </Badge>
        </div>
        <p className="line-clamp-3 min-h-[3.9rem] text-sm text-fg-secondary">{row.tweet_text || "暂无 Tweet 文本"}</p>
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-tertiary">
          <Badge tone="secondary">{mediaTypeLabel(row.media_type)}</Badge>
          <span>{formatBytes(row.file_size)}</span>
          <span>{formatDateTime(row.published_at)}</span>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link className="text-sm font-semibold text-brand hover:text-brand-hover" to={`/tweets/${row.tweet_id}`}>
            详情
          </Link>
          {row.tweet_url ? (
            <a className="text-sm font-semibold text-brand hover:text-brand-hover" href={row.tweet_url} target="_blank" rel="noreferrer">
              打开 Tweet
            </a>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function LibrarySkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, index) => (
        <Card key={index} className="overflow-hidden">
          <Skeleton className="aspect-video rounded-none" />
          <CardHeader>
            <div className="flex items-center gap-2">
              <Grid2X2 className="h-4 w-4 text-brand" />
              <CardTitle className="text-base">Loading</CardTitle>
            </div>
            <CardDescription>Media preview</CardDescription>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}
