import { Plus } from "lucide-react";
import type { ArchiveSourceListItem, SourcePageResponse } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { sourceTypeLabel } from "@/lib/formatters";
import { SOURCE_TYPES, sourceStatusTone } from "../utils";
import { SOURCES_PAGE_SIZE } from "../hooks/useSourcesQuery";

const ALL_STATUS_VALUE = "__all_status__";
const ALL_TYPE_VALUE = "__all_type__";

export function SourcesList({
  statusLabel,
  data,
  selectedSourceId,
  statusFilter,
  typeFilter,
  offset,
  onStatusFilterChange,
  onTypeFilterChange,
  onOffsetChange,
  onSelectSource,
  onAddClick,
}: {
  statusLabel: (status?: string | null) => string;
  data?: SourcePageResponse;
  selectedSourceId: number | null;
  statusFilter: string;
  typeFilter: string;
  offset: number;
  onStatusFilterChange: (value: string) => void;
  onTypeFilterChange: (value: string) => void;
  onOffsetChange: (offset: number) => void;
  onSelectSource: (sourceId: number) => void;
  onAddClick: () => void;
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
            value={statusFilter || ALL_STATUS_VALUE}
            onValueChange={(value) => {
              onOffsetChange(0);
              onStatusFilterChange(value === ALL_STATUS_VALUE ? "" : value);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value={ALL_STATUS_VALUE}>全部状态</SelectItem>
                <SelectItem value="active">{statusLabel("active")}</SelectItem>
                <SelectItem value="paused">{statusLabel("paused")}</SelectItem>
                <SelectItem value="completed">{statusLabel("completed")}</SelectItem>
                <SelectItem value="failed">{statusLabel("failed")}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
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
              statusLabel={statusLabel}
              onSelectSource={onSelectSource}
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
  statusLabel,
  onSelectSource,
}: {
  source: ArchiveSourceListItem;
  selected: boolean;
  statusLabel: (status?: string | null) => string;
  onSelectSource: (sourceId: number) => void;
}) {
  return (
    <button
      type="button"
      className={[
        "flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition duration-fast ease-out",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
        selected
          ? "border-brand/30 bg-brand-soft"
          : "border-border-subtle bg-bg-surface hover:border-border-strong hover:bg-bg-muted",
      ].join(" ")}
      onClick={() => onSelectSource(source.id)}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-fg-primary">{source.label || source.source_url}</div>
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
        <Badge tone={sourceStatusTone(source.status)}>{statusLabel(source.status)}</Badge>
      </div>
    </button>
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
