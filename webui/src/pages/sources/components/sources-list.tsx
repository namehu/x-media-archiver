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
import { CalendarClock, Download, GripVertical, ListChecks, Pin, PinOff, Plus, RefreshCw, Search, Workflow } from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import { toast } from "sonner";
import type { ArchiveSourceListItem, SourcePageResponse } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAppScrollContainer } from "@/components/layout/app-scroll-container";
import { getDebugRedactProps, useDebugRedactionEnabled } from "@/lib/debug-redaction";
import { sourceTypeLabel } from "@/lib/formatters";
import { formatDateTime } from "@/lib/utils";
import {
  SOURCE_TYPES,
  sourceScanStatus,
  type SourceDeletedFilter,
  type SourceOperationalFilter,
  type SourceSortBy,
} from "../utils";

const ALL_TYPE_VALUE = "__all_type__";
const SOURCE_SORT_VALUES = [
  "manual_order:desc",
  "latest_tweet_published_at:desc",
  "last_success_at:desc",
  "unsubmitted_tweet_count:desc",
  "schedule_next_run_at:asc",
  "updated_at:desc",
  "updated_at:asc",
  "created_at:desc",
  "created_at:asc",
] as const;
const SOURCE_DELETED_LABELS: Record<SourceDeletedFilter, string> = {
  active: "正常来源",
  deleted: "已删除来源",
  all: "全部来源",
};

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
  onManageSchedules,
  onOpenTasks,
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
  onManageSchedules: () => void;
  onOpenTasks: () => void;
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
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CardTitle>来源列表</CardTitle>
            <Badge tone="default">{data?.total_count ?? 0}</Badge>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={onManageSchedules}>
              <CalendarClock data-icon="inline-start" />定时策略
            </Button>
            <Button type="button" variant="outline" onClick={onOpenTasks}>
              <ListChecks data-icon="inline-start" />任务记录
            </Button>
            <Button type="button" variant="secondary" onClick={onAddClick}>
              <Plus data-icon="inline-start" />新增来源
            </Button>
          </div>
        </div>
        {(data?.total_count ?? 0) > 200 ? (
          <p className="text-xs text-fg-secondary">当前筛选超过 200 个来源，请缩小筛选范围；也可逐项勾选已加载的来源。</p>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid gap-2 lg:grid-cols-[minmax(220px,1.4fr)_repeat(4,minmax(0,1fr))]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-tertiary" />
            <Input
              className="pl-9"
              value={searchText}
              onChange={(event) => onSearchTextChange(event.target.value)}
              placeholder="搜索名称、用户名或 URL"
            />
          </div>
          <Select
            value={typeFilter || ALL_TYPE_VALUE}
            onValueChange={(value) => {
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
            value={deletedFilter}
            onValueChange={(value) => {
              if (value !== "active" && value !== "deleted" && value !== "all") return;
              onDeletedFilterChange(value);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {Object.entries(SOURCE_DELETED_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select
            value={operationalFilter || "__all_operation__"}
            onValueChange={(value) => onOperationalFilterChange(value === "__all_operation__" ? "" : value as SourceOperationalFilter)}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="__all_operation__">全部运行状态</SelectItem>
                <SelectItem value="due">待更新</SelectItem>
                <SelectItem value="waiting_download">待下载</SelectItem>
                <SelectItem value="running">执行中</SelectItem>
                <SelectItem value="error">异常</SelectItem>
                <SelectItem value="scheduled">已启用定时</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <Select
            value={`${sortBy}:${sortDirection}`}
            onValueChange={(value) => {
              if (!SOURCE_SORT_VALUES.includes(value as (typeof SOURCE_SORT_VALUES)[number])) return;
              const [nextSortBy, nextSortDirection] = value.split(":") as [SourceSortBy, "asc" | "desc"];
              onSortChange(nextSortBy, nextSortDirection);
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="manual_order:desc">手动排序（默认）</SelectItem>
                <SelectItem value="latest_tweet_published_at:desc">最新 Tweet 时间</SelectItem>
                <SelectItem value="last_success_at:desc">最近成功同步</SelectItem>
                <SelectItem value="unsubmitted_tweet_count:desc">未提交下载数量</SelectItem>
                <SelectItem value="schedule_next_run_at:asc">下次执行时间</SelectItem>
                <SelectItem value="updated_at:desc">最近更新（从新到旧）</SelectItem>
                <SelectItem value="updated_at:asc">最近更新（从旧到新）</SelectItem>
                <SelectItem value="created_at:desc">创建时间（从新到旧）</SelectItem>
                <SelectItem value="created_at:asc">创建时间（从旧到新）</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        {!isLoading && rows.length > 0 ? (
          <div className="flex items-center gap-2 rounded-lg border border-border-subtle bg-bg-muted px-3 py-2 xl:hidden">
            <Checkbox
              id="sources-select-all-filtered"
              aria-label="选择当前筛选下的全部来源"
              checked={allFilteredChecked}
              disabled={allFilteredDisabled}
              onCheckedChange={(checked) => onToggleAllFiltered(checked === true)}
            />
            <label className="text-sm font-medium text-fg-primary" htmlFor="sources-select-all-filtered">
              选择当前筛选全部 {data?.total_count ?? 0} 个来源
            </label>
          </div>
        ) : null}
        {selectionCount > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand/30 bg-brand-soft p-3">
            <div className="flex items-center gap-2 text-sm text-fg-primary">
              <strong>已选择 {selectionCount} 个来源</strong>
              {selectAllFiltered ? <span className="text-xs text-fg-secondary">当前筛选全部来源的冻结快照</span> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" size="sm" variant="outline" disabled={bulkPending} onClick={() => onBulkAction("refresh_latest")}>
                <RefreshCw data-icon="inline-start" />更新最新推文
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={bulkPending} onClick={() => onBulkAction("download_missing")}>
                <Download data-icon="inline-start" />下载当前缺失项
              </Button>
              <Button type="button" size="sm" disabled={bulkPending} onClick={() => onBulkAction("refresh_and_download_new")}>
                <Workflow data-icon="inline-start" />更新并下载新增
              </Button>
              <Button type="button" size="sm" variant="outline" disabled={bulkPending} onClick={onSchedule}>
                <CalendarClock data-icon="inline-start" />创建定时策略
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={onClearSelection}>清除选择</Button>
            </div>
          </div>
        ) : null}
        {!isLoading && rows.length > 0 ? (
          <div className="hidden grid-cols-[36px_minmax(220px,1.5fr)_minmax(120px,.8fr)_minmax(130px,.9fr)_120px_minmax(120px,.8fr)_minmax(120px,.8fr)_76px] items-center gap-3 border-b border-border-subtle px-3 pb-2 text-xs font-medium text-fg-secondary xl:grid">
            <Checkbox
              aria-label="选择当前筛选下的全部来源"
              checked={allFilteredChecked}
              disabled={allFilteredDisabled}
              onCheckedChange={(checked) => onToggleAllFiltered(checked === true)}
            />
            <span>来源</span><span>最新内容</span><span>最近同步</span><span>下载积压</span><span>任务状态</span><span>下次执行</span><span>操作</span>
          </div>
        ) : null}
        {isLoading ? <p className="py-8 text-center text-sm text-fg-secondary">正在加载来源…</p> : null}
        {!isLoading && rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-fg-secondary">
            {deletedFilter === "deleted" ? "还没有已删除来源。" : "还没有登记来源。"}
          </p>
        ) : null}
        {!isLoading && rows.length > 0 && scrollParent ? (
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
                  onSelectSource={onSelectSource}
                  onToggleSource={onToggleSource}
                  onPin={onPin}
                  pinPending={pinPendingSourceId === activeSource.id}
                />
              ) : null}
            </DragOverlay>
          </DndContext>
        ) : null}
      </CardContent>
    </Card>
  );
}

function SourceListRow(props: SourceListRowProps) {
  if (!props.sortable) {
    return (
      <div className="pb-2">
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
    <div ref={setNodeRef} style={style} className="pb-2">
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
      className={[
        "grid w-full grid-cols-[36px_minmax(0,1fr)_40px] items-center gap-3 rounded-lg border p-3 text-left transition duration-fast ease-out xl:grid-cols-[36px_minmax(220px,1.5fr)_minmax(120px,.8fr)_minmax(130px,.9fr)_120px_minmax(120px,.8fr)_minmax(120px,.8fr)_40px]",
        dragging ? "opacity-40" : "",
        overlay ? "border-brand/40 bg-bg-surface shadow-2" : "",
        selected
          ? "border-brand/30 bg-brand-soft"
          : "border-border-subtle bg-bg-surface hover:border-border-strong hover:bg-bg-muted",
      ].join(" ")}
      onClick={() => onSelectSource(source.id)}
    >
      <Checkbox
        aria-label={`选择${source.label || source.author_username || `来源 ${source.id}`}`}
        checked={checked}
        disabled={isDeleted}
        onClick={(event) => event.stopPropagation()}
        onCheckedChange={(value) => onToggleSource(source.id, value === true)}
      />
      <div className="flex min-w-0 items-center gap-2">
        {showDragHandle ? (
          <button
            type="button"
            className={[
              "touch-none flex size-8 shrink-0 items-center justify-center rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
              dragHandleEnabled
                ? "cursor-grab text-fg-tertiary hover:bg-bg-muted hover:text-fg-primary active:cursor-grabbing"
                : "cursor-not-allowed text-fg-tertiary/40",
            ].join(" ")}
            aria-label="拖动排序"
            disabled={!dragHandleEnabled}
            onClick={(event) => event.stopPropagation()}
            {...(dragHandleEnabled ? dragHandleProps : {})}
          >
            <GripVertical className="h-4 w-4" />
          </button>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          className="h-auto min-w-0 flex-1 justify-start p-0 text-left"
          onClick={(event) => {
            event.stopPropagation();
            onSelectSource(source.id);
          }}
        >
          <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {source.is_pinned ? <Pin className="h-3.5 w-3.5 shrink-0 text-brand" aria-label="已置顶" /> : null}
            {isDeleted ? <Badge tone="danger">已删除</Badge> : null}
            <div className="truncate text-sm font-semibold text-fg-primary">{source.label || source.source_url}</div>
          </div>
          <div className="mt-0.5 text-xs text-fg-secondary" {...getDebugRedactProps(debugRedactionEnabled)}>
            {sourceTypeLabel(source.source_type)} · @{source.author_username || "-"}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-fg-secondary xl:hidden">
            <span>最新 {formatListDate(source.latest_tweet_published_at)}</span>
            <span>同步 {formatListDate(source.last_success_at)}</span>
            <span>未提交 {source.unsubmitted_tweet_count ?? 0}</span>
            <Badge tone={source.active_bulk_task_item_status ? bulkItemTone(source.active_bulk_task_item_status) : scanStatus.tone}>
              {bulkItemStatusLabel(source.active_bulk_task_item_status) || scanStatus.label}
            </Badge>
          </div>
          </div>
        </Button>
      </div>
      <ListDate value={source.latest_tweet_published_at} emptyLabel="尚无内容" />
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
          未提交 {source.unsubmitted_tweet_count ?? 0}
        </p>
        <p className="text-[11px] text-fg-tertiary">
          队列 {source.pending_download_count ?? 0} · 处理中 {source.processing_download_count ?? 0}
        </p>
        {(source.failed_download_count ?? 0) > 0 ? <p className="text-[11px] text-danger">失败 {source.failed_download_count}</p> : null}
      </div>
      <div className="hidden xl:block">
        <Badge tone={source.active_bulk_task_item_status ? bulkItemTone(source.active_bulk_task_item_status) : scanStatus.tone}>
          {bulkItemStatusLabel(source.active_bulk_task_item_status) || scanStatus.label}
        </Badge>
      </div>
      <div className="hidden min-w-0 xl:block">
        <p className="truncate text-xs text-fg-primary">{formatListDate(source.schedule_next_run_at)}</p>
        <p className="mt-1 truncate text-[11px] text-fg-tertiary">
          {source.schedule_enabled ? source.schedule_policy_label || "已启用策略" : "未启用定时"}
        </p>
      </div>
      <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8"
              aria-label={isDeleted ? "已删除来源不可置顶" : source.is_pinned ? "取消置顶" : "置顶"}
              disabled={pinPending || isDeleted}
              onClick={(event) => {
                event.stopPropagation();
                onPin(source.id, !source.is_pinned);
              }}
            >
              {source.is_pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
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

function ListDate({ value, emptyLabel }: { value?: string | null; emptyLabel: string }) {
  return (
    <div className="hidden min-w-0 xl:block">
      <p className="truncate text-xs text-fg-primary">{value ? formatDateTime(value) : emptyLabel}</p>
      <p className="mt-1 text-[11px] text-fg-tertiary">Tweet 发布时间</p>
    </div>
  );
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
