import { forwardRef, type CSSProperties, type HTMLAttributes } from "react";
import { ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { VirtuosoGrid } from "react-virtuoso";
import { Badge } from "../../../components/ui/badge";
import { Card, CardContent } from "../../../components/ui/card";
import { MediaThumbnail } from "../../../components/ui/media-thumbnail";
import type { MediaRow } from "../../../lib/api";
import { mediaTypeLabel, statusLabel } from "../../../lib/formatters";
import { formatBytes, formatDateTime } from "../../../lib/utils";

export function MediaGrid({ rows }: { rows: MediaRow[] }) {
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
      style={{
        ...style,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
        gap: "0.75rem",
      }}
      className="items-start"
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
  const statusTone = row.media_status === "verified" || row.media_status === "downloaded" ? "success" : "warning";

  return (
    <Card className="group overflow-hidden hover:border-border-strong hover:shadow-2">
      <MediaThumbnail
        src={row.media_url}
        mediaType={row.media_type}
        alt={row.tweet_text || title}
        className="rounded-none"
      />
      <CardContent className="flex flex-col gap-2.5 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-fg-primary">{title}</div>
            <div className="mt-0.5 truncate text-xs text-fg-tertiary">@{row.author_username || "-"}</div>
          </div>
          <Badge tone={statusTone}>{statusLabel(row.media_status)}</Badge>
        </div>

        <p className="line-clamp-2 min-h-9 text-xs leading-relaxed text-fg-secondary">{row.tweet_text || "暂无 Tweet 文本"}</p>

        <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs text-fg-tertiary">
          <MetaItem label="类型" value={mediaTypeLabel(row.media_type)} />
          <MetaItem label="大小" value={formatBytes(row.file_size)} />
          <MetaItem label="发布" value={formatDateTime(row.published_at)} className="col-span-2" />
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border-subtle pt-2.5">
          <Link className="text-sm font-semibold text-brand hover:text-brand-hover" to={`/tweets/${row.tweet_id}`}>
            详情
          </Link>
          {row.tweet_url ? (
            <a
              className="inline-flex items-center gap-1 text-sm font-semibold text-brand hover:text-brand-hover"
              href={row.tweet_url}
              target="_blank"
              rel="noreferrer"
            >
              打开
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}

function MetaItem({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <span className="text-fg-tertiary">{label}</span>
      <span className="ml-1 font-medium text-fg-secondary">{value}</span>
    </div>
  );
}
