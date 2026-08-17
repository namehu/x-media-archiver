import {
  CheckSquare,
  ChevronDown,
  GalleryHorizontalEnd,
  Grid2X2,
  ListFilter,
  Rows3,
  SlidersHorizontal,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "../../../components/ui/toggle-group";
import { mediaTypeLabel, statusLabel } from "../../../lib/formatters";
import type { LibraryDensity, LibrarySelectionMode, LibraryViewMode } from "../library-view-state";
import type { LibraryFilters } from "./library-filter-panel";

type LibraryResultsToolbarProps = {
  filters: LibraryFilters;
  activeFilterCount: number;
  loadedCount: number;
  totalCount: number;
  selectedCount: number;
  selectionMode: LibrarySelectionMode | null;
  viewMode: LibraryViewMode;
  density: LibraryDensity;
  filtersOpen: boolean;
  onReset: () => void;
  onSelectLoaded: () => void;
  onClearSelection: () => void;
  onExitSelection: () => void;
  onStartSelection: (mode: LibrarySelectionMode) => void;
  onViewModeChange: (mode: LibraryViewMode) => void;
  onDensityChange: (density: LibraryDensity) => void;
  onToggleFilters: () => void;
};

export function LibraryResultsToolbar({
  filters,
  activeFilterCount,
  loadedCount,
  totalCount,
  selectedCount,
  selectionMode,
  viewMode,
  density,
  filtersOpen,
  onReset,
  onSelectLoaded,
  onClearSelection,
  onExitSelection,
  onStartSelection,
  onViewModeChange,
  onDensityChange,
  onToggleFilters,
}: LibraryResultsToolbarProps) {
  const chips = buildFilterChips(filters);

  if (selectionMode) {
    const isOrganizing = selectionMode === "organize";
    return (
      <div className="sticky top-0 z-20 rounded-lg border border-brand/30 bg-bg-elevated/95 p-3 shadow-2 backdrop-blur">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {isOrganizing ? <Tags className="size-4 text-brand" /> : <Trash2 className="size-4 text-danger" />}
            <span className="text-sm font-semibold text-fg-primary">
              {isOrganizing ? "整理 Tweet" : "删除媒体"}
            </span>
            <Badge tone={selectedCount ? "default" : "secondary"}>
              已选 {selectedCount} {isOrganizing ? "条 Tweet" : "项媒体"}
            </Badge>
            <span className="text-xs text-fg-tertiary">单次最多 200 项</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onSelectLoaded}>
              <CheckSquare data-icon="inline-start" />
              选择已加载的 {loadedCount} 项
            </Button>
            {selectedCount ? (
              <Button type="button" variant="ghost" size="sm" onClick={onClearSelection}>
                清除选择
              </Button>
            ) : null}
            <Button type="button" variant="ghost" size="sm" onClick={onExitSelection}>
              <X data-icon="inline-start" />
              退出批量
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sticky top-0 z-20 rounded-lg border border-border-subtle bg-bg-elevated/95 p-3 shadow-1 backdrop-blur">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <ListFilter className="size-4 text-brand" />
            <span className="text-sm font-semibold text-fg-primary">结果</span>
            <Badge tone="secondary">{totalCount.toLocaleString()} 项</Badge>
            <span className="text-xs text-fg-tertiary">已加载 {loadedCount.toLocaleString()} 项</span>
            <span className="text-xs text-fg-tertiary sm:hidden">
              {activeFilterCount ? `已应用 ${activeFilterCount} 项筛选` : "默认筛选"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={activeFilterCount ? "secondary" : "ghost"}
              size="sm"
              aria-pressed={filtersOpen}
              onClick={onToggleFilters}
            >
              <SlidersHorizontal data-icon="inline-start" />
              筛选{activeFilterCount ? ` ${activeFilterCount}` : ""}
            </Button>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value={viewMode}
              onValueChange={(value) => {
                if (value === "media" || value === "details") onViewModeChange(value);
              }}
              aria-label="媒体库视图"
            >
              <ToggleGroupItem value="media" aria-label="媒体墙">
                <Grid2X2 />
                媒体墙
              </ToggleGroupItem>
              <ToggleGroupItem value="details" aria-label="详情卡片">
                <Rows3 />
                详情
              </ToggleGroupItem>
            </ToggleGroup>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="sm">
                  批量操作
                  <ChevronDown data-icon="inline-end" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>选择操作后显示复选框</DropdownMenuLabel>
                <DropdownMenuGroup>
                  <DropdownMenuItem onSelect={() => onStartSelection("organize")}>
                    <Tags className="mr-2 size-4" />
                    整理 Tweet
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onStartSelection("delete")}>
                    <Trash2 className="mr-2 size-4 text-danger" />
                    删除媒体
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border-subtle pt-2">
          <div className="hidden min-w-0 flex-wrap items-center gap-2 sm:flex">
            {chips.map((chip) => (
              <Badge key={chip} tone="default">
                {chip}
              </Badge>
            ))}
            {chips.length ? (
              <Button type="button" variant="ghost" size="sm" onClick={onReset}>
                清空
              </Button>
            ) : (
              <span className="text-xs text-fg-tertiary">未设置额外筛选。</span>
            )}
          </div>
          {viewMode === "media" ? (
            <div className="ml-auto flex shrink-0 items-center gap-2">
              <GalleryHorizontalEnd className="size-4 text-fg-tertiary" />
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                value={density}
                onValueChange={(value) => {
                  if (value === "compact" || value === "standard" || value === "comfortable") {
                    onDensityChange(value);
                  }
                }}
                aria-label="媒体墙密度"
              >
                <ToggleGroupItem value="compact">紧凑</ToggleGroupItem>
                <ToggleGroupItem value="standard">标准</ToggleGroupItem>
                <ToggleGroupItem value="comfortable">宽松</ToggleGroupItem>
              </ToggleGroup>
            </div>
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
