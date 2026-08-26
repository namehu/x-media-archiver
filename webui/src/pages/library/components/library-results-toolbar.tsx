import {
  Check,
  CheckSquare,
  Grid2X2,
  MoreHorizontal,
  Rows3,
  Settings2,
  SlidersHorizontal,
  Tags,
  Trash2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { LibraryDensity, LibrarySelectionMode, LibraryViewMode } from "../library-view-state";

type LibraryResultsToolbarProps = {
  activeFilterCount: number;
  loadedCount: number;
  totalCount: number;
  selectedCount: number;
  selectionMode: LibrarySelectionMode | null;
  viewMode: LibraryViewMode;
  density: LibraryDensity;
  filtersOpen: boolean;
  onSelectLoaded: () => void;
  onClearSelection: () => void;
  onExitSelection: () => void;
  onStartSelection: (mode: LibrarySelectionMode) => void;
  onViewModeChange: (mode: LibraryViewMode) => void;
  onDensityChange: (density: LibraryDensity) => void;
  onToggleFilters: () => void;
};

export function LibraryResultsToolbar({
  activeFilterCount,
  loadedCount,
  totalCount,
  selectedCount,
  selectionMode,
  viewMode,
  density,
  filtersOpen,
  onSelectLoaded,
  onClearSelection,
  onExitSelection,
  onStartSelection,
  onViewModeChange,
  onDensityChange,
  onToggleFilters,
}: LibraryResultsToolbarProps) {
  if (selectionMode) {
    const isOrganizing = selectionMode === "organize";
    return (
      <header className="sticky top-0 z-20 border-b border-border-subtle bg-bg-base/95 backdrop-blur">
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 px-4 py-2 sm:px-5">
          <div className="flex min-w-0 items-center gap-2">
            {isOrganizing ? (
              <Tags className="size-5 text-brand" aria-hidden="true" />
            ) : (
              <Trash2 className="size-5 text-danger" aria-hidden="true" />
            )}
            <div className="min-w-0">
              <p className="truncate text-base font-bold text-fg-primary">
                {isOrganizing ? "整理 Tweet" : "删除媒体"}
              </p>
              <p className="text-xs text-fg-secondary">
                已选择 {selectedCount.toLocaleString()} {isOrganizing ? "条 Tweet" : "项媒体"} · 单次最多 200 项
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="sm" onClick={onSelectLoaded}>
              <CheckSquare data-icon="inline-start" />
              <span className="hidden sm:inline">选择已加载的 {loadedCount.toLocaleString()} 项</span>
              <span className="sm:hidden">全选</span>
            </Button>
            {selectedCount ? (
              <Button type="button" variant="ghost" size="sm" onClick={onClearSelection}>
                清除
              </Button>
            ) : null}
            <Button type="button" variant="ghost" size="icon" aria-label="退出批量操作" onClick={onExitSelection}>
              <X aria-hidden="true" />
            </Button>
          </div>
        </div>
      </header>
    );
  }

  return (
    <header className="sticky top-0 z-20 border-b border-border-subtle bg-bg-base/95 backdrop-blur">
      <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-2 sm:px-5">
        <div className="min-w-0">
          <h1 className="sr-only text-xl font-bold tracking-tight text-fg-primary sm:not-sr-only sm:block sm:truncate">
            媒体
          </h1>
          <p className="truncate text-xs text-fg-secondary">
            {totalCount.toLocaleString()} 项归档媒体 · <span>已加载 {loadedCount.toLocaleString()} 项</span>
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="rounded-full"
            aria-haspopup="dialog"
            aria-expanded={filtersOpen}
            aria-label={activeFilterCount ? `筛选，已启用 ${activeFilterCount} 项` : "筛选"}
            onClick={onToggleFilters}
          >
            <SlidersHorizontal data-icon="inline-start" aria-hidden="true" />
            筛选
            {activeFilterCount ? (
              <Badge tone="default" aria-hidden="true">
                {activeFilterCount}
              </Badge>
            ) : null}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="rounded-full"
                aria-label={`显示设置，当前为${viewMode === "media" ? "媒体墙" : "详情"}`}
              >
                <Settings2 aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              <DropdownMenuGroup>
                <DropdownMenuLabel>浏览方式</DropdownMenuLabel>
                <DropdownMenuItem
                  role="menuitemradio"
                  aria-checked={viewMode === "media"}
                  onSelect={() => onViewModeChange("media")}
                >
                  <Grid2X2 aria-hidden="true" />
                  <span className="flex-1">媒体墙</span>
                  {viewMode === "media" ? <Check aria-hidden="true" /> : null}
                </DropdownMenuItem>
                <DropdownMenuItem
                  role="menuitemradio"
                  aria-checked={viewMode === "details"}
                  onSelect={() => onViewModeChange("details")}
                >
                  <Rows3 aria-hidden="true" />
                  <span className="flex-1">详情</span>
                  {viewMode === "details" ? <Check aria-hidden="true" /> : null}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              {viewMode === "media" ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>媒体墙密度</DropdownMenuLabel>
                    {(["compact", "standard", "comfortable"] as const).map((value) => (
                      <DropdownMenuItem
                        key={value}
                        role="menuitemradio"
                        aria-checked={density === value}
                        onSelect={() => onDensityChange(value)}
                      >
                        <span className="flex-1">{densityLabel(value)}</span>
                        {density === value ? <Check aria-hidden="true" /> : null}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="rounded-full"
                aria-label="批量操作和更多选项"
              >
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuGroup>
                <DropdownMenuLabel>批量操作</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => onStartSelection("organize")}>
                  <Tags aria-hidden="true" />
                  整理 Tweet
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem className="text-danger" onSelect={() => onStartSelection("delete")}>
                  <Trash2 aria-hidden="true" />
                  删除媒体
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}

function densityLabel(density: LibraryDensity) {
  if (density === "compact") return "紧凑";
  if (density === "comfortable") return "宽松";
  return "标准";
}
