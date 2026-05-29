import type { ArchiveSource, SourcePageResponse } from "../../../lib/api";
import { Badge } from "../../../components/ui-next/badge";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui-next/card";
import { Pagination } from "../../../components/ui-next/pagination";
import { Select } from "../../../components/ui-next/select";
import { SOURCE_TYPES, sourceStatusTone, sourceTypeLabel, type TFunction } from "../utils";
import { SOURCES_PAGE_SIZE } from "../hooks/useSourcesQuery";

export function SourcesList({
  t,
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
}: {
  t: TFunction;
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
}) {
  return (
    <Card className="lg:sticky lg:top-4 lg:self-start">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>{t("sources.list")}</CardTitle>
          <Badge tone="default">{data?.total_count ?? 0}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <Select
            value={statusFilter}
            onChange={(event) => {
              onOffsetChange(0);
              onStatusFilterChange(event.target.value);
            }}
          >
            <option value="">{t("common.status.all")}</option>
            <option value="active">{statusLabel("active")}</option>
            <option value="paused">{statusLabel("paused")}</option>
            <option value="completed">{statusLabel("completed")}</option>
            <option value="failed">{statusLabel("failed")}</option>
          </Select>
          <Select
            value={typeFilter}
            onChange={(event) => {
              onOffsetChange(0);
              onTypeFilterChange(event.target.value);
            }}
          >
            <option value="">{t("sources.type.all")}</option>
            {SOURCE_TYPES.map((type) => (
              <option key={type} value={type}>
                {t(`sources.type.${type}`)}
              </option>
            ))}
          </Select>
        </div>
        {data ? (
          <Pagination
            offset={offset}
            count={data.count}
            totalCount={data.total_count}
            pageSize={SOURCES_PAGE_SIZE}
            onOffsetChange={onOffsetChange}
            label={t("common.pagination.range")}
          />
        ) : null}
        <div className="space-y-2">
          {data?.rows.map((source) => (
            <SourceListItem
              key={source.id}
              source={source}
              selected={source.id === selectedSourceId}
              t={t}
              statusLabel={statusLabel}
              onSelectSource={onSelectSource}
            />
          ))}
        </div>
        {data?.rows.length === 0 ? <p className="text-sm text-fg-secondary">{t("sources.empty")}</p> : null}
        {data && data.rows.length > 0 ? (
          <Pagination
            offset={offset}
            count={data.count}
            totalCount={data.total_count}
            pageSize={SOURCES_PAGE_SIZE}
            onOffsetChange={onOffsetChange}
            label={t("common.pagination.range")}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function SourceListItem({
  source,
  selected,
  t,
  statusLabel,
  onSelectSource,
}: {
  source: ArchiveSource;
  selected: boolean;
  t: TFunction;
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
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-fg-primary">{source.label || source.source_url}</div>
        <div className="text-xs text-fg-secondary">
          {sourceTypeLabel(source.source_type, t)} · {source.author_username || "-"} · {t("sources.discovered")}:{" "}
          {source.discovered_tweet_count ?? source.discovered_count ?? 0} / {source.discovered_media_count ?? 0}{" "}
          {t("sources.mediaUnit")}
        </div>
      </div>
      <Badge tone={sourceStatusTone(source.status)}>{statusLabel(source.status)}</Badge>
    </button>
  );
}
