import { ListFilter } from "lucide-react";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { mediaTypeLabel, statusLabel } from "../../../lib/formatters";
import type { LibraryFilters } from "./library-filter-panel";

type LibraryResultsToolbarProps = {
  filters: LibraryFilters;
  loadedCount: number;
  totalCount: number;
  onReset: () => void;
  selectedCount: number;
  onSelectLoaded: () => void;
  onClearSelection: () => void;
  selectionLabel: string;
};

export function LibraryResultsToolbar({
  filters,
  loadedCount,
  totalCount,
  onReset,
  selectedCount,
  onSelectLoaded,
  onClearSelection,
  selectionLabel,
}: LibraryResultsToolbarProps) {
  const chips = buildFilterChips(filters);

  return (
    <div className="rounded-lg border border-border-subtle bg-bg-elevated p-3">
      <div className="flex flex-col justify-between gap-3 xl:flex-row xl:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <ListFilter className="h-4 w-4 text-brand" />
            <span className="text-sm font-semibold text-fg-primary">结果</span>
            <Badge tone="secondary">{totalCount.toLocaleString()} 项</Badge>
            <span className="text-xs text-fg-tertiary">
              已加载 {loadedCount.toLocaleString()} 项
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {chips.length ? (
              chips.map((chip) => (
                <Badge key={chip} tone="default">
                  {chip}
                </Badge>
              ))
            ) : (
              <span className="text-xs text-fg-tertiary">未设置额外筛选。</span>
            )}
            {chips.length ? (
              <Button type="button" variant="ghost" size="sm" onClick={onReset}>
                清空
              </Button>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onSelectLoaded}>
            全选已加载{selectionLabel}
          </Button>
          {selectedCount ? (
            <Button type="button" variant="ghost" size="sm" onClick={onClearSelection}>
              清除选择
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function buildFilterChips(filters: LibraryFilters) {
  const chips: string[] = [];
  if (filters.author.trim()) chips.push(`作者：@${filters.author.trim()}`);
  if (filters.text.trim()) chips.push(`文本：${filters.text.trim()}`);
  chips.push(`状态：${filters.media_status === "all" ? "全部状态" : statusLabel(filters.media_status)}`);
  if (filters.media_type) chips.push(`类型：${mediaTypeLabel(filters.media_type)}`);
  return chips;
}
