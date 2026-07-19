import { Pin, PinOff, Plus } from "lucide-react";
import type { ArchiveSourceListItem, SourcePageResponse } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { sourceTypeLabel } from "@/lib/formatters";
import { SOURCE_TYPES, sourceScanStatus } from "../utils";
import { SOURCES_PAGE_SIZE } from "../hooks/useSourcesQuery";

const ALL_TYPE_VALUE = "__all_type__";
const SOURCE_SORT_VALUES = ["updated_at:desc", "updated_at:asc", "created_at:desc", "created_at:asc"] as const;

export function SourcesList({
  data,
  selectedSourceId,
  typeFilter,
  sortBy,
  sortDirection,
  offset,
  onTypeFilterChange,
  onSortChange,
  onOffsetChange,
  onSelectSource,
  onAddClick,
  onPin,
  pinPendingSourceId,
}: {
  data?: SourcePageResponse;
  selectedSourceId: number | null;
  typeFilter: string;
  sortBy: "updated_at" | "created_at";
  sortDirection: "asc" | "desc";
  offset: number;
  onTypeFilterChange: (value: string) => void;
  onSortChange: (sortBy: "updated_at" | "created_at", sortDirection: "asc" | "desc") => void;
  onOffsetChange: (offset: number) => void;
  onSelectSource: (sourceId: number) => void;
  onAddClick: () => void;
  onPin: (sourceId: number, isPinned: boolean) => void;
  pinPendingSourceId?: number;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CardTitle>来源列表</CardTitle>
            <Badge tone="default">{data?.total_count ?? 0}</Badge>
          </div>
          <Button type="button" variant="secondary" onClick={onAddClick}>
            <Plus className="mr-1.5 h-4 w-4" />
            新增来源
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <Select
            value={typeFilter || ALL_TYPE_VALUE}
            onValueChange={(value) => {
              onOffsetChange(0);
              onTypeFilterChange(value === ALL_TYPE_VALUE ? "" : value);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={ALL_TYPE_VALUE}>全部来源</SelectItem>
                {SOURCE_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {sourceTypeLabel(type)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select
            value={`${sortBy}:${sortDirection}`}
            onValueChange={(value) => {
              if (!SOURCE_SORT_VALUES.includes(value as (typeof SOURCE_SORT_VALUES)[number])) return;
              const [nextSortBy, nextSortDirection] = value.split(":") as ["updated_at" | "created_at", "asc" | "desc"];
              onSortChange(nextSortBy, nextSortDirection);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="updated_at:desc">最近更新（从新到旧）</SelectItem>
                <SelectItem value="updated_at:asc">最近更新（从旧到新）</SelectItem>
                <SelectItem value="created_at:desc">创建时间（从新到旧）</SelectItem>
                <SelectItem value="created_at:asc">创建时间（从旧到新）</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        {data ? (
          <Pagination
            offset={offset}
            count={data.count}
            totalCount={data.total_count}
            pageSize={SOURCES_PAGE_SIZE}
            onOffsetChange={onOffsetChange}
            label="第 {start}-{end} 项，共 {total} 项"
          />
        ) : null}
        <div className="space-y-2">
          {data?.rows.map((source) => (
            <SourceListItem
              key={source.id}
              source={source}
              selected={source.id === selectedSourceId}
              onSelectSource={onSelectSource}
              onPin={onPin}
              pinPending={pinPendingSourceId === source.id}
            />
          ))}
        </div>
        {data?.rows.length === 0 ? <p className="text-sm text-fg-secondary">还没有登记来源。</p> : null}
        {data && data.rows.length > 0 ? (
          <Pagination
            offset={offset}
            count={data.count}
            totalCount={data.total_count}
            pageSize={SOURCES_PAGE_SIZE}
            onOffsetChange={onOffsetChange}
            label="第 {start}-{end} 项，共 {total} 项"
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function SourceListItem({
  source,
  selected,
  onSelectSource,
  onPin,
  pinPending,
}: {
  source: ArchiveSourceListItem;
  selected: boolean;
  onSelectSource: (sourceId: number) => void;
  onPin: (sourceId: number, isPinned: boolean) => void;
  pinPending: boolean;
}) {
  const scanStatus = sourceScanStatus(source);

  return (
    <div
      role="button"
      tabIndex={0}
      className={[
        "flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition duration-fast ease-out",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
        selected
          ? "border-brand/30 bg-brand-soft"
          : "border-border-subtle bg-bg-surface hover:border-border-strong hover:bg-bg-muted",
      ].join(" ")}
      onClick={() => onSelectSource(source.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelectSource(source.id);
        }
      }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          {source.is_pinned ? <Pin className="h-3.5 w-3.5 shrink-0 text-brand" aria-label="已置顶" /> : null}
          <div className="truncate text-sm font-semibold text-fg-primary">{source.label || source.source_url}</div>
        </div>
        <div className="mt-0.5 text-xs text-fg-secondary">
          {sourceTypeLabel(source.source_type)} · @{source.author_username || "-"}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-4 text-xs text-fg-secondary">
        <div className="hidden grid-cols-4 gap-3 sm:grid">
          <ListMetric label="已发现 Tweet" value={source.discovered_tweet_count ?? source.discovered_count ?? 0} />
          <ListMetric label="扫描发现媒体" value={source.discovered_media_count ?? 0} />
          <ListMetric label="未入队发现" value={source.unsubmitted_tweet_count ?? 0} warning={(source.unsubmitted_tweet_count ?? 0) > 0} />
          <ListMetric label="累计扫描批次" value={source.scan_batch_count ?? 0} />
        </div>
        <Badge tone={scanStatus.tone}>{scanStatus.label}</Badge>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              aria-label={source.is_pinned ? "取消置顶" : "置顶"}
              disabled={pinPending}
              onClick={(event) => {
                event.stopPropagation();
                onPin(source.id, !source.is_pinned);
              }}
            >
              {source.is_pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{source.is_pinned ? "取消置顶" : "置顶"}</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}

function ListMetric({
  label,
  value,
  warning,
}: {
  label: string;
  value: number;
  warning?: boolean;
}) {
  return (
    <div className="w-24 text-right">
      <div className="truncate text-[11px] text-fg-tertiary">{label}</div>
      <div className={warning ? "font-semibold text-warning" : "font-semibold text-fg-primary"}>{value}</div>
    </div>
  );
}
