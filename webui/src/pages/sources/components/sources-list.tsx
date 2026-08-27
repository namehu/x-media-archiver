import { useCallback, useEffect, useRef, useState, type HTMLAttributes } from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CalendarClock, Download, GripVertical, ListChecks, MoreHorizontal, Pin, PinOff, Radio, RefreshCw, Search, Workflow } from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import { toast } from "sonner";
import type { ArchiveSourceListItem, SourcePageResponse } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAppScrollContainer } from "@/components/layout/app-scroll-container";
import { getDebugRedactProps, useDebugRedactionEnabled } from "@/lib/debug-redaction";
import { sourceTypeLabel } from "@/lib/formatters";
import { cn, formatDateTime } from "@/lib/utils";
import {
  sourceScanStatus,
  type SourceDeletedFilter,
  type SourceOperationalFilter,
  type SourceSortBy,
} from "../utils";
import { SourceFilterSheet } from "./source-filter-sheet";

export function SourcesList({
  data,
  selectedSourceId,
  typeFilter,
  deletedFilter,
  sortBy,
  sortDirection,
  searchText,
  operationalFilter,
  selectedSourceIds,
  selectAllFiltered,
  excludedSourceIds,
  selectionCount,
  onTypeFilterChange,
  onDeletedFilterChange,
  onSortChange,
  onSearchTextChange,
  onOperationalFilterChange,
  onToggleSource,
  onToggleAllFiltered,
  onClearSelection,
  onBulkAction,
  onSchedule,
  onSelectSource,
  onAddClick,
  onPin,
  pinPendingSourceId,
  canReorder,
  isLoading,
  isFetchingNextPage,
  hasNextPage,
  error,
  reorderPending,
  bulkPending,
  onLoadMore,
  onRetryLoadMore,
  onReorder,
}: {
  data?: SourcePageResponse;
  selectedSourceId: number | null;
  typeFilter: string;
  deletedFilter: SourceDeletedFilter;
  sortBy: SourceSortBy;
  sortDirection: "asc" | "desc";
  searchText: string;
  operationalFilter: SourceOperationalFilter;
  selectedSourceIds: Set<number>;
  selectAllFiltered: boolean;
  excludedSourceIds: Set<number>;
  selectionCount: number;
  onTypeFilterChange: (value: string) => void;
  onDeletedFilterChange: (value: SourceDeletedFilter) => void;
  onSortChange: (sortBy: SourceSortBy, sortDirection: "asc" | "desc") => void;
  onSearchTextChange: (value: string) => void;
  onOperationalFilterChange: (value: SourceOperationalFilter) => void;
  onToggleSource: (sourceId: number, selected: boolean) => void;
  onToggleAllFiltered: (selected: boolean) => void;
  onClearSelection: () => void;
  onBulkAction: (action: "refresh_latest" | "download_missing" | "refresh_and_download_new") => void;
  onSchedule: () => void;
  onSelectSource: (sourceId: number) => void;
  onAddClick: () => void;
  onPin: (sourceId: number, isPinned: boolean) => void;
  pinPendingSourceId?: number;
  canReorder: boolean;
  isLoading: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  error: unknown;
  reorderPending: boolean;
  bulkPending: boolean;
  onLoadMore: () => void;
  onRetryLoadMore: () => void;
  onReorder: (sourceIds: number[]) => Promise<unknown>;
}) {
  const scrollParent = useAppScrollContainer();
  const loadMorePendingRef = useRef(false);
  const [rows, setRows] = useState<ArchiveSourceListItem[]>(data?.rows ?? []);
  const [activeSourceId, setActiveSourceId] = useState<number | null>(null);
  const [selectionMode, setSelectionMode] = useState(selectionCount > 0);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  useEffect(() => {
    setRows(data?.rows ?? []);
  }, [data?.rows]);

  useEffect(() => {
    if (selectionCount > 0) setSelectionMode(true);
  }, [selectionCount]);

  useEffect(() => {
    if (!isFetchingNextPage) loadMorePendingRef.current = false;
  }, [isFetchingNextPage]);

  const requestLoadMore = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage || error || loadMorePendingRef.current) return;
    loadMorePendingRef.current = true;
    onLoadMore();
  }, [error, hasNextPage, isFetchingNextPage, onLoadMore]);

  const reorderWithinPartition = async (draggedSourceId: number, targetSourceId: number) => {
    if (!canReorder || reorderPending || draggedSourceId === targetSourceId) return;
    const dragged = rows.find((source) => source.id === draggedSourceId);
    const target = rows.find((source) => source.id === targetSourceId);
    if (!dragged || !target || dragged.is_pinned !== target.is_pinned || dragged.deleted_at || target.deleted_at) {
      toast.error("只能在同一置顶分区内拖动排序。");
      return;
    }

    const previousRows = rows;
    const partitionRows = rows.filter((source) => source.is_pinned === dragged.is_pinned && !source.deleted_at);
    const nextPartitionRows = moveSource(partitionRows, draggedSourceId, targetSourceId);
    if (nextPartitionRows === partitionRows) return;

    const nextById = new Map(nextPartitionRows.map((source) => [source.id, source]));
    let partitionIndex = 0;
    const nextRows = rows.map((source) => {
      if (!nextById.has(source.id)) return source;
      const next = nextPartitionRows[partitionIndex];
      partitionIndex += 1;
      return next;
    });
    setRows(nextRows);
    try {
      await onReorder(nextPartitionRows.map((source) => source.id));
      toast.success("来源排序已更新。");
    } catch {
      setRows(previousRows);
      toast.error("更新来源排序失败，已恢复原顺序。");
    }
  };

  const onDragStart = (event: DragStartEvent) => {
    setActiveSourceId(Number(event.active.id));
  };

  const onDragEnd = (event: DragEndEvent) => {
    setActiveSourceId(null);
    const activeId = Number(event.active.id);
    const overId = Number(event.over?.id);
    if (!Number.isFinite(activeId) || !Number.isFinite(overId)) return;
    void reorderWithinPartition(activeId, overId);
  };

  const activeSource = activeSourceId ? rows.find((source) => source.id === activeSourceId) : undefined;
  const activePinnedPartition = activeSource?.is_pinned;
  const allFilteredChecked = selectAllFiltered
    ? (excludedSourceIds.size ? "indeterminate" : true)
    : (selectedSourceIds.size ? "indeterminate" : false);
  const allFilteredDisabled = deletedFilter !== "active" || (data?.total_count ?? 0) > 200;
  const sortableRows = rows.filter(
    (source) =>
      canReorder &&
      !reorderPending &&
      !source.deleted_at &&
      (activePinnedPartition === undefined || source.is_pinned === activePinnedPartition),
  );

  const footer = () => (
    <SourcesFooter
      hasNextPage={hasNextPage}
      isFetchingNextPage={isFetchingNextPage}
      error={error}
      onRetry={onRetryLoadMore}
    />
  );

  return (
    <section className="flex flex-col gap-4" aria-label="来源目录">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="text-lg font-semibold text-fg-primary">来源目录</h2>
          <Badge tone="secondary" className="tabular-nums">{data?.total_count ?? 0}</Badge>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative min-w-0 sm:w-72 lg:w-96">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-tertiary" aria-hidden="true" />
            <Input
              className="pl-9"
              value={searchText}
              onChange={(event) => onSearchTextChange(event.target.value)}
              placeholder="搜索名称、用户名或 URL"
              aria-label="搜索来源"
            />
          </div>
          <div className="flex items-center gap-2">
            <SourceFilterSheet
              typeFilter={typeFilter}
              deletedFilter={deletedFilter}
              operationalFilter={operationalFilter}
              sortBy={sortBy}
              sortDirection={sortDirection}
              onTypeFilterChange={onTypeFilterChange}
              onDeletedFilterChange={onDeletedFilterChange}
              onOperationalFilterChange={onOperationalFilterChange}
              onSortChange={onSortChange}
            />
            <Button
              type="button"
              variant={selectionMode ? "secondary" : "outline"}
              aria-pressed={selectionMode}
              onClick={() => {
                const next = !selectionMode;
                setSelectionMode(next);
                if (!next) onClearSelection();
              }}
            >
              <ListChecks data-icon="inline-start" aria-hidden="true" />
              批量选择
            </Button>
          </div>
        </div>
      </div>

      {(data?.total_count ?? 0) > 200 && selectionMode ? (
        <p className="text-xs text-fg-secondary">当前筛选超过 200 个来源，无法一键全选；请缩小范围或逐项选择已加载来源。</p>
      ) : null}

      {selectionMode ? (
        <div className="flex flex-col gap-3 border-y border-border-subtle bg-brand-soft px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2">
            <Checkbox
              id="sources-select-all-filtered"
              aria-label="选择当前筛选下的全部来源"
              checked={allFilteredChecked}
              disabled={allFilteredDisabled}
              onCheckedChange={(checked) => onToggleAllFiltered(checked === true)}
            />
            <label className="min-w-0 text-sm font-medium text-fg-primary" htmlFor="sources-select-all-filtered">
              {selectionCount > 0 ? `已选择 ${selectionCount} 个来源` : `选择当前筛选的 ${data?.total_count ?? 0} 个来源`}
            </label>
            {selectAllFiltered ? <span className="hidden text-xs text-fg-secondary md:inline">冻结当前筛选快照</span> : null}
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              disabled={!selectionCount || bulkPending}
              onClick={() => onBulkAction("refresh_and_download_new")}
            >
              <Workflow data-icon="inline-start" aria-hidden="true" />
              更新并下载新增
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" size="sm" variant="outline" disabled={!selectionCount || bulkPending}>
                  <MoreHorizontal data-icon="inline-start" aria-hidden="true" />
                  更多操作
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem onSelect={() => onBulkAction("refresh_latest")}>
                    <RefreshCw aria-hidden="true" />
                    更新最新推文
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onBulkAction("download_missing")}>
                    <Download aria-hidden="true" />
                    下载当前缺失项
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={onSchedule}>
                    <CalendarClock aria-hidden="true" />
                    创建定时策略
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button type="button" size="sm" variant="ghost" disabled={!selectionCount} onClick={onClearSelection}>
              清除
            </Button>
          </div>
        </div>
      ) : null}

      {isLoading ? <SourcesListSkeleton /> : null}
      {!isLoading && error && rows.length === 0 ? (
        <ErrorState title="无法加载来源" detail={error instanceof Error ? error.message : "请检查服务连接后重试。"} onRetry={onRetryLoadMore} />
      ) : null}
      {!isLoading && !error && rows.length === 0 ? (
        <EmptyState
          icon={<Radio aria-hidden="true" />}
          title={deletedFilter === "deleted" ? "没有已删除来源" : "没有匹配的来源"}
          description={searchText || typeFilter || operationalFilter ? "换一组筛选条件，或清除搜索后再试。" : "新增一个 X 页面，开始发现并归档其中的媒体内容。"}
          action={!searchText && !typeFilter && !operationalFilter && deletedFilter === "active" ? (
            <Button type="button" onClick={onAddClick}>新增来源</Button>
          ) : undefined}
        />
      ) : null}
      {!isLoading && rows.length > 0 && scrollParent ? (
        <div className="overflow-hidden rounded-xl border border-border-subtle bg-bg-surface">
          <div className="hidden grid-cols-[36px_minmax(260px,1.5fr)_minmax(150px,.8fr)_150px_minmax(140px,.8fr)_minmax(128px,.75fr)_40px] items-center gap-3 border-b border-border-subtle bg-bg-muted px-4 py-2.5 text-xs font-medium text-fg-secondary xl:grid">
            <span aria-hidden="true" />
            <span>来源</span>
            <span>最近同步</span>
            <span>下载积压</span>
            <span>下次执行</span>
            <span>当前状态</span>
            <span className="sr-only">操作</span>
          </div>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={onDragStart}
            onDragCancel={() => setActiveSourceId(null)}
            onDragEnd={onDragEnd}
          >
            <SortableContext items={sortableRows.map((source) => source.id)} strategy={verticalListSortingStrategy}>
              <Virtuoso
                customScrollParent={scrollParent}
                data={rows}
                computeItemKey={(_, source) => source.id}
                endReached={requestLoadMore}
                itemContent={(_, source) => (
                  <SourceListRow
                    source={source}
                    selected={source.id === selectedSourceId}
                    checked={selectAllFiltered ? !excludedSourceIds.has(source.id) : selectedSourceIds.has(source.id)}
                    sortable={
                      canReorder &&
                      !reorderPending &&
                      !source.deleted_at &&
                      (activePinnedPartition === undefined || source.is_pinned === activePinnedPartition)
                    }
                    canDrag={
                      canReorder && !reorderPending && !source.deleted_at
                    }
                    selectionMode={selectionMode}
                    onSelectSource={onSelectSource}
                    onToggleSource={onToggleSource}
                    onPin={onPin}
                    pinPending={pinPendingSourceId === source.id}
                  />
                )}
                components={{ Footer: footer }}
              />
            </SortableContext>
            <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
              {activeSource ? (
                <SourceListItem
                  source={activeSource}
                  selected={activeSource.id === selectedSourceId}
                  checked={selectAllFiltered ? !excludedSourceIds.has(activeSource.id) : selectedSourceIds.has(activeSource.id)}
                  showDragHandle={canReorder && !reorderPending && !activeSource.deleted_at}
                  dragHandleEnabled={false}
                  overlay
                  selectionMode={selectionMode}
                  onSelectSource={onSelectSource}
                  onToggleSource={onToggleSource}
                  onPin={onPin}
                  pinPending={pinPendingSourceId === activeSource.id}
                />
              ) : null}
            </DragOverlay>
          </DndContext>
        </div>
      ) : null}
    </section>
  );
}

function SourcesListSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border border-border-subtle bg-bg-surface" aria-label="正在加载来源">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="flex items-center gap-3 border-b border-border-subtle px-4 py-4 last:border-b-0">
          <Skeleton className="size-8 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-44 max-w-full" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
          <Skeleton className="hidden h-7 w-24 sm:block" />
        </div>
      ))}
    </div>
  );
}

function SourceListRow(props: SourceListRowProps) {
  if (!props.sortable) {
    return (
      <div>
        <SourceListItem {...props} showDragHandle={props.canDrag} dragHandleEnabled={false} />
      </div>
    );
  }
  return <SortableSourceListItem {...props} />;
}

type SourceListRowProps = {
  source: ArchiveSourceListItem;
  selected: boolean;
  checked: boolean;
  sortable: boolean;
  canDrag: boolean;
  selectionMode: boolean;
  onSelectSource: (sourceId: number) => void;
  onToggleSource: (sourceId: number, selected: boolean) => void;
  onPin: (sourceId: number, isPinned: boolean) => void;
  pinPending: boolean;
};

function SortableSourceListItem(props: SourceListRowProps) {
  const { source, canDrag } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: source.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <SourceListItem
        {...props}
        showDragHandle={canDrag}
        dragHandleEnabled={canDrag}
        dragging={isDragging}
        dragHandleProps={{ ...attributes, ...listeners }}
      />
    </div>
  );
}

function SourceListItem({
  source,
  selected,
  checked,
  selectionMode,
  showDragHandle,
  dragHandleEnabled,
  dragging,
  overlay,
  dragHandleProps,
  onSelectSource,
  onToggleSource,
  onPin,
  pinPending,
}: {
  source: ArchiveSourceListItem;
  selected: boolean;
  checked: boolean;
  selectionMode: boolean;
  showDragHandle: boolean;
  dragHandleEnabled: boolean;
  dragging?: boolean;
  overlay?: boolean;
  dragHandleProps?: HTMLAttributes<HTMLButtonElement>;
  onSelectSource: (sourceId: number) => void;
  onToggleSource: (sourceId: number, selected: boolean) => void;
  onPin: (sourceId: number, isPinned: boolean) => void;
  pinPending: boolean;
}) {
  const debugRedactionEnabled = useDebugRedactionEnabled();
  const isDeleted = Boolean(source.deleted_at);
  const scanStatus = sourceScanStatus(source);
  const hasDownloadBacklog =
    (source.unsubmitted_tweet_count ?? 0) +
      (source.pending_download_count ?? 0) +
      (source.processing_download_count ?? 0) +
      (source.failed_download_count ?? 0) >
    0;

  return (
    <div
      className={cn(
        "grid w-full grid-cols-[36px_minmax(0,1fr)_40px] items-center gap-3 border-b border-border-subtle px-4 py-3 text-left transition-colors last:border-b-0 xl:grid-cols-[36px_minmax(260px,1.5fr)_minmax(150px,.8fr)_150px_minmax(140px,.8fr)_minmax(128px,.75fr)_40px]",
        dragging && "opacity-40",
        overlay && "rounded-xl border border-brand/40 bg-bg-surface shadow-2",
        selected ? "bg-brand-soft" : "bg-bg-surface hover:bg-bg-muted",
      )}
    >
      <div className="flex size-9 items-center justify-center">
        {selectionMode ? (
          <Checkbox
            aria-label={`选择${source.label || source.author_username || `来源 ${source.id}`}`}
            checked={checked}
            disabled={isDeleted}
            onCheckedChange={(value) => onToggleSource(source.id, value === true)}
          />
        ) : showDragHandle ? (
          <button
            type="button"
            className={cn(
              "touch-none flex size-8 shrink-0 items-center justify-center rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
              dragHandleEnabled
                ? "cursor-grab text-fg-tertiary hover:bg-bg-muted hover:text-fg-primary active:cursor-grabbing"
                : "cursor-not-allowed text-fg-tertiary/40",
            )}
            aria-label="拖动排序"
            disabled={!dragHandleEnabled}
            onClick={(event) => event.stopPropagation()}
            {...(dragHandleEnabled ? dragHandleProps : {})}
          >
            <GripVertical aria-hidden="true" />
          </button>
        ) : <span aria-hidden="true" />}
      </div>
      <div className="flex min-w-0 items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          className="h-auto min-w-0 flex-1 justify-start p-0 text-left"
          onClick={(event) => {
            event.stopPropagation();
            onSelectSource(source.id);
          }}
        >
          <div className="min-w-0 flex-1 py-1">
          <div className="flex min-w-0 items-center gap-1.5">
            {source.is_pinned ? <Pin className="size-3.5 shrink-0 text-brand" aria-label="已置顶" /> : null}
            {isDeleted ? <Badge tone="danger">已删除</Badge> : null}
            <div className="truncate text-sm font-semibold text-fg-primary">{source.label || source.source_url}</div>
          </div>
          <div className="mt-0.5 text-xs text-fg-secondary" {...getDebugRedactProps(debugRedactionEnabled)}>
            {sourceTypeLabel(source.source_type)} · @{source.author_username || "-"}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-secondary xl:hidden">
            <span>同步 {formatListDate(source.last_success_at)}</span>
            <span>待下载 {source.unsubmitted_tweet_count ?? 0}</span>
            <span>下次 {formatListDate(source.schedule_next_run_at)}</span>
            <Badge tone={source.active_bulk_task_item_status ? bulkItemTone(source.active_bulk_task_item_status) : scanStatus.tone}>
              {bulkItemStatusLabel(source.active_bulk_task_item_status) || scanStatus.label}
            </Badge>
          </div>
          </div>
        </Button>
      </div>
      <div className="hidden min-w-0 xl:block">
        <p className="text-xs text-fg-primary">{formatListDate(source.last_success_at)}</p>
        {source.last_error_at && (!source.last_success_at || source.last_error_at > source.last_success_at) ? (
          <p className="mt-1 truncate text-[11px] text-danger">最近尝试失败</p>
        ) : (
          <p className="mt-1 text-[11px] text-fg-tertiary">{source.last_success_at ? "成功" : "从未同步"}</p>
        )}
      </div>
      <div className="hidden xl:block">
        <p className={hasDownloadBacklog ? "text-sm font-semibold tabular-nums text-warning" : "text-sm font-semibold tabular-nums text-fg-primary"}>
          {source.unsubmitted_tweet_count ?? 0} 待提交
        </p>
        <p className="text-[11px] text-fg-tertiary">
          队列 {source.pending_download_count ?? 0} · 处理中 {source.processing_download_count ?? 0}
        </p>
        {(source.failed_download_count ?? 0) > 0 ? <p className="text-[11px] text-danger">失败 {source.failed_download_count}</p> : null}
      </div>
      <div className="hidden min-w-0 xl:block">
        <p className="truncate text-xs text-fg-primary">{formatListDate(source.schedule_next_run_at)}</p>
        <p className="mt-1 truncate text-[11px] text-fg-tertiary">
          {source.schedule_enabled ? source.schedule_policy_label || "已启用策略" : "未启用定时"}
        </p>
      </div>
      <div className="hidden xl:block">
        <Badge tone={source.active_bulk_task_item_status ? bulkItemTone(source.active_bulk_task_item_status) : scanStatus.tone}>
          {bulkItemStatusLabel(source.active_bulk_task_item_status) || scanStatus.label}
        </Badge>
      </div>
      <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-9"
              aria-label={isDeleted ? "已删除来源不可置顶" : source.is_pinned ? "取消置顶" : "置顶"}
              disabled={pinPending || isDeleted}
              onClick={(event) => {
                event.stopPropagation();
                onPin(source.id, !source.is_pinned);
              }}
            >
              {source.is_pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{isDeleted ? "已删除来源不可置顶" : source.is_pinned ? "取消置顶" : "置顶"}</TooltipContent>
      </Tooltip>
    </div>
  );
}

function SourcesFooter({
  hasNextPage,
  isFetchingNextPage,
  error,
  onRetry,
}: {
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  if (error) {
    return (
      <div className="flex flex-col items-center gap-2 px-4 py-4 text-center text-sm text-fg-secondary">
        <span>加载更多来源失败，已加载的内容会继续保留。</span>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          重试
        </Button>
      </div>
    );
  }
  if (isFetchingNextPage) return <p className="px-4 py-4 text-center text-[13px] text-fg-secondary">正在加载更多来源…</p>;
  if (hasNextPage) return <p className="px-4 py-4 text-center text-[13px] text-fg-tertiary">继续下拉加载更多</p>;
  return <p className="px-4 py-4 text-center text-[13px] text-fg-tertiary">已经浏览完全部来源</p>;
}

function moveSource(rows: ArchiveSourceListItem[], draggedId: number, targetId: number) {
  const fromIndex = rows.findIndex((source) => source.id === draggedId);
  const toIndex = rows.findIndex((source) => source.id === targetId);
  if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return rows;
  return arrayMove(rows, fromIndex, toIndex);
}

function formatListDate(value?: string | null) {
  return value ? formatDateTime(value) : "-";
}

function bulkItemStatusLabel(status?: string | null) {
  if (status === "queued") return "等待批量任务";
  if (status === "scanning") return "批量更新中";
  if (status === "waiting_download") return "等待提交下载";
  if (status === "downloading") return "批量下载中";
  if (status === "paused") return "批量任务已暂停";
  if (status === "blocked") return "批量任务需处理";
  return "";
}

function bulkItemTone(status: string) {
  if (status === "blocked") return "danger" as const;
  if (status === "paused") return "secondary" as const;
  if (status === "waiting_download") return "warning" as const;
  return "default" as const;
}
