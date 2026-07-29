import * as React from "react";
import { Check, Film, Image, LocateFixed, Pause, Play, X } from "lucide-react";
import type { SourceDiscoveryFacets } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type { DetailActions } from "./source-detail-sheet/scan-actions";
import type { DownloadMediaType, DownloadSubmitInput, TweetFilters } from "./source-tweet-filters";

type DownloadFollowMode = "following" | "paused";

type PendingConfirm = {
  scope: "download_missing" | "redownload_filter";
  mediaType?: DownloadMediaType;
  count: number;
};

export function SourceTweetsToolbar({
  sourceId,
  filters,
  onFiltersChange,
  facets,
  actionCounts,
  filteredTotalCount,
  unfilteredTotalCount,
  selectedCount,
  selectableCount,
  selectedQueueCount,
  selectedActiveCount,
  selectedActiveIds,
  selectedActiveRunIds,
  loadedQueueIds,
  selectedQueueIds,
  onSelectAll,
  onClearSelection,
  onSubmitDownload,
  actions,
  readonly = false,
  activeRunId,
  currentTweetId,
  followRunId,
  followMode,
  onPauseFollow,
  onResumeFollow,
  onLocateCurrent,
}: {
  sourceId: number;
  filters: TweetFilters;
  onFiltersChange: (filters: TweetFilters) => void;
  facets?: SourceDiscoveryFacets | null;
  actionCounts?: { all_unsubmitted: number; missing: number; failed: number } | null;
  filteredTotalCount: number;
  unfilteredTotalCount: number;
  selectedCount: number;
  selectableCount: number;
  selectedQueueCount: number;
  selectedActiveCount: number;
  selectedActiveIds: string[];
  selectedActiveRunIds: number[];
  loadedQueueIds: string[];
  selectedQueueIds: string[];
  onSelectAll: (checked: boolean) => void;
  onClearSelection: () => void;
  onSubmitDownload: (input: DownloadSubmitInput) => void;
  actions: DetailActions;
  readonly?: boolean;
  activeRunId: number | null;
  currentTweetId: string | null;
  followRunId: number | null;
  followMode: DownloadFollowMode;
  onPauseFollow: () => void;
  onResumeFollow: () => void;
  onLocateCurrent: () => void;
}) {
  const [confirm, setConfirm] = React.useState<PendingConfirm | null>(null);
  const mediaType = filters.media === "all" ? undefined : filters.media;
  const hasFilters = filters.media !== "all" || filters.download !== "all";
  const missingCount = actionCounts?.missing ?? 0;
  const failedCount = actionCounts?.failed ?? 0;
  const redownloadCount = filteredTotalCount;
  const hasMoreActions = loadedQueueIds.length > 0 || failedCount > 0 || redownloadCount > 0;

  if (!readonly && selectedCount > 0) {
    return (
      <div className="sticky top-0 z-10 flex min-h-9 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border-subtle bg-bg-base/95 px-3 py-2 text-sm backdrop-blur">
        <div className="flex min-w-0 items-center gap-2">
          <Checkbox checked aria-label="取消选择" onCheckedChange={() => onClearSelection()} />
          <span className="font-medium text-brand">已选 {selectedCount} 项</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={!selectedQueueCount || actions.pending.download}
            onClick={() => onSubmitDownload({ sourceId, scope: "selected", tweetIds: selectedQueueIds })}
          >
            下载选中 {selectedQueueCount}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={selectedActiveCount ? "outline" : "ghost"}
            className={selectedActiveCount ? "border-danger text-danger hover:bg-danger-soft hover:text-danger" : ""}
            disabled={!selectedActiveCount || selectedActiveRunIds.length !== 1 || actions.pending.download}
            onClick={() => actions.cancelDownloadItems({ runId: selectedActiveRunIds[0], tweetIds: selectedActiveIds })}
          >
            取消选中
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onClearSelection}>
            清空
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="download-follow-controls"
      className="sticky top-0 z-10 flex min-h-11 shrink-0 items-center justify-between gap-3 border-b border-border-subtle bg-bg-base/95 px-3 py-2 text-sm backdrop-blur"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto whitespace-nowrap">
        {!readonly ? (
          <Checkbox
            className="mr-1"
            checked={selectableCount > 0 && selectedCount === selectableCount}
            disabled={selectableCount === 0}
            aria-label="全选已加载可下载项"
            onCheckedChange={(checked) => onSelectAll(Boolean(checked))}
          />
        ) : null}
        <ToggleGroup
          type="single"
          value={filters.media}
          onValueChange={(value) => value && onFiltersChange({ ...filters, media: value as TweetFilters["media"] })}
          size="sm"
          className="rounded-md border border-border-subtle bg-bg-muted p-0.5"
        >
          <ToggleGroupItem value="all" className={mediaToggleClassName}>
            全部 <FilterCount>{facets?.media.all ?? unfilteredTotalCount}</FilterCount>
          </ToggleGroupItem>
          <ToggleGroupItem value="video" className={mediaToggleClassName}>
            <Film className="h-3.5 w-3.5" />
            视频 <FilterCount>{facets?.media.video ?? 0}</FilterCount>
          </ToggleGroupItem>
          <ToggleGroupItem value="photo" className={mediaToggleClassName}>
            <Image className="h-3.5 w-3.5" />
            图片 <FilterCount>{facets?.media.photo ?? 0}</FilterCount>
          </ToggleGroupItem>
        </ToggleGroup>
        <SourceSelect
          value={filters.download}
          onValueChange={(download) => onFiltersChange({ ...filters, download })}
          options={[
            ["all", "全部状态", unfilteredTotalCount],
            ["pending", "待下载", facets?.download.pending ?? 0],
            ["active", "下载中", facets?.download.active ?? 0],
            ["completed", "已完成", facets?.download.completed ?? 0],
            ["failed", "失败", facets?.download.failed ?? 0],
          ]}
        />
        {hasFilters ? (
          <button
            type="button"
            className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs text-fg-secondary transition-colors hover:bg-bg-muted hover:text-fg-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            onClick={() => onFiltersChange({ media: "all", download: "all" })}
          >
            清除 <X className="h-3 w-3" />
          </button>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center justify-end gap-2">
        <span className="text-xs text-fg-secondary tabular-nums">
          {filteredTotalCount} / {unfilteredTotalCount}
        </span>
        {!readonly ? (
          <>
            <Button
              type="button"
              size="sm"
              className="h-8 px-3"
              disabled={actions.pending.download || missingCount === 0}
              onClick={() => setConfirm({ scope: "download_missing", mediaType, count: missingCount })}
            >
              {missingCount > 0 ? `下载缺失项 ${missingCount}` : "已下载完成"}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="h-8 px-2"
                  disabled={actions.pending.download || !hasMoreActions}
                >
                  更多
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-52">
                {missingCount === 0 ? <DropdownMenuItem disabled>当前筛选已下载完成</DropdownMenuItem> : null}
                {loadedQueueIds.length > 0 ? (
                  <DropdownMenuItem
                    disabled={actions.pending.download}
                    onSelect={() => onSubmitDownload({ sourceId, scope: "selected", tweetIds: loadedQueueIds })}
                    className="justify-between gap-3"
                  >
                    <span>下载已加载缺失项</span>
                    <span className="text-xs text-fg-secondary tabular-nums">{loadedQueueIds.length}</span>
                  </DropdownMenuItem>
                ) : null}
                {failedCount > 0 ? (
                  <DropdownMenuItem
                    disabled={actions.pending.download}
                    onSelect={() => onSubmitDownload({ sourceId, scope: "retry_failed", mediaType })}
                    className="justify-between gap-3"
                  >
                    <span>重试失败{mediaSuffix(mediaType)}</span>
                    <span className="text-xs text-fg-secondary tabular-nums">{failedCount}</span>
                  </DropdownMenuItem>
                ) : null}
                {redownloadCount > 0 ? (
                  <>
                    <DropdownMenuSeparator className="my-1 h-px bg-border-subtle" />
                    <DropdownMenuItem
                      disabled={actions.pending.download}
                      onSelect={() => setConfirm({ scope: "redownload_filter", mediaType, count: redownloadCount })}
                      className="justify-between gap-3 text-danger focus:text-danger"
                    >
                      <span>重新下载当前筛选{mediaSuffix(mediaType)}</span>
                      <span className="text-xs text-fg-secondary tabular-nums">{redownloadCount}</span>
                    </DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        ) : null}
        <DownloadFollowControls
          activeRunId={activeRunId}
          currentTweetId={currentTweetId}
          followRunId={followRunId}
          followMode={followMode}
          onPause={onPauseFollow}
          onResume={onResumeFollow}
          onLocateCurrent={onLocateCurrent}
        />
      </div>
      <AlertDialog open={Boolean(confirm)} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm?.scope === "redownload_filter" ? "重新下载当前筛选？" : "下载缺失项？"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.scope === "redownload_filter"
                ? `将重新提交当前筛选中的 ${confirm?.count ?? 0} 条发现记录，包含已完成项。通常不需要这样做，除非你要强制修复本地文件。混合媒体推文会按 Tweet 整体下载。`
                : `将把当前筛选中尚未完成下载的 ${confirm?.count ?? 0} 条发现记录提交为一个下载任务。已完成项不会重新下载，混合媒体推文会按 Tweet 整体下载。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={actions.pending.download}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={actions.pending.download}
              onClick={() => {
                if (!confirm) return;
                onSubmitDownload({
                  sourceId,
                  scope: confirm.scope,
                  mediaType: confirm.mediaType,
                });
                setConfirm(null);
              }}
            >
              确认下载
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

const mediaToggleClassName =
  "group h-7 gap-1 rounded px-2 text-xs text-fg-secondary hover:bg-bg-surface hover:text-fg-primary data-[state=on]:bg-bg-surface data-[state=on]:text-brand data-[state=on]:shadow-sm";

function FilterCount({ children }: { children: React.ReactNode }) {
  return <span className="text-fg-tertiary tabular-nums group-data-[state=on]:text-brand">{children}</span>;
}

function SourceSelect<T extends string>({
  value,
  onValueChange,
  options,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: Array<[T, string, number]>;
}) {
  return (
    <Select value={value} onValueChange={(next) => onValueChange(next as T)}>
      <SelectTrigger className="h-8 w-[8.25rem] border-border-subtle bg-bg-surface px-2 text-xs shadow-none">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map(([optionValue, label, count]) => (
          <SelectItem key={optionValue} value={optionValue}>
            {label} {count}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function DownloadFollowControls({
  activeRunId,
  currentTweetId,
  followRunId,
  followMode,
  onPause,
  onResume,
  onLocateCurrent,
}: {
  activeRunId: number | null;
  currentTweetId: string | null;
  followRunId: number | null;
  followMode: DownloadFollowMode;
  onPause: () => void;
  onResume: () => void;
  onLocateCurrent: () => void;
}) {
  if (followRunId && followRunId !== activeRunId) {
    return <Badge tone="secondary">等待 Run #{followRunId}</Badge>;
  }
  if (followRunId && followRunId === activeRunId) {
    return (
      <div className="flex items-center gap-1">
        <Badge tone={followMode === "following" ? "default" : "warning"} className="gap-1">
          <Check className={cn("h-3 w-3", followMode !== "following" && "hidden")} />
          {followMode === "following" ? "跟随" : "已暂停"}
        </Badge>
        <TooltipButton
          label={followMode === "following" ? "暂停跟随" : "继续跟随"}
          onClick={followMode === "following" ? onPause : onResume}
        >
          {followMode === "following" ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </TooltipButton>
        {currentTweetId ? (
          <TooltipButton label="定位当前项" onClick={onLocateCurrent}>
            <LocateFixed className="h-4 w-4" />
          </TooltipButton>
        ) : null}
      </div>
    );
  }
  if (activeRunId && currentTweetId) {
    return (
      <TooltipButton label="定位当前项" onClick={onLocateCurrent}>
        <LocateFixed className="h-4 w-4" />
      </TooltipButton>
    );
  }
  return null;
}

function TooltipButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={onClick} aria-label={label}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function mediaSuffix(mediaType?: DownloadMediaType) {
  if (mediaType === "video") return " · 仅视频";
  if (mediaType === "photo") return " · 仅图片";
  return "";
}

