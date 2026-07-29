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
import { GripVertical, Pin, PinOff, Plus } from "lucide-react";
import { Virtuoso } from "react-virtuoso";
import { toast } from "sonner";
import type { ArchiveSourceListItem, SourcePageResponse } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAppScrollContainer } from "@/components/layout/app-scroll-container";
import { getDebugRedactProps, useDebugRedactionEnabled } from "@/lib/debug-redaction";
import { sourceTypeLabel } from "@/lib/formatters";
import { SOURCE_TYPES, sourceScanStatus, type SourceDeletedFilter, type SourceSortBy } from "../utils";

const ALL_TYPE_VALUE = "__all_type__";
const SOURCE_SORT_VALUES = ["manual_order:desc", "updated_at:desc", "updated_at:asc", "created_at:desc", "created_at:asc"] as const;
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
  onTypeFilterChange,
  onDeletedFilterChange,
  onSortChange,
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
  onTypeFilterChange: (value: string) => void;
  onDeletedFilterChange: (value: SourceDeletedFilter) => void;
  onSortChange: (sortBy: SourceSortBy, sortDirection: "asc" | "desc") => void;
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
        <div className="grid gap-2 lg:grid-cols-3">
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
                <SelectItem value="updated_at:desc">最近更新（从新到旧）</SelectItem>
                <SelectItem value="updated_at:asc">最近更新（从旧到新）</SelectItem>
                <SelectItem value="created_at:desc">创建时间（从新到旧）</SelectItem>
                <SelectItem value="created_at:asc">创建时间（从旧到新）</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
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
                  showDragHandle={canReorder && !reorderPending && !activeSource.deleted_at}
                  dragHandleEnabled={false}
                  overlay
                  onSelectSource={onSelectSource}
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

function SourceListRow({
  source,
  selected,
  sortable,
  canDrag,
  onSelectSource,
  onPin,
  pinPending,
}: {
  source: ArchiveSourceListItem;
  selected: boolean;
  sortable: boolean;
  canDrag: boolean;
  onSelectSource: (sourceId: number) => void;
  onPin: (sourceId: number, isPinned: boolean) => void;
  pinPending: boolean;
}) {
  if (!sortable) {
    return (
      <div className="pb-2">
        <SourceListItem
          source={source}
          selected={selected}
          showDragHandle={canDrag}
          dragHandleEnabled={false}
          onSelectSource={onSelectSource}
          onPin={onPin}
          pinPending={pinPending}
        />
      </div>
    );
  }

  return (
    <SortableSourceListItem
      source={source}
      selected={selected}
      canDrag={canDrag}
      onSelectSource={onSelectSource}
      onPin={onPin}
      pinPending={pinPending}
    />
  );
}

function SortableSourceListItem({
  source,
  selected,
  canDrag,
  onSelectSource,
  onPin,
  pinPending,
}: {
  source: ArchiveSourceListItem;
  selected: boolean;
  canDrag: boolean;
  onSelectSource: (sourceId: number) => void;
  onPin: (sourceId: number, isPinned: boolean) => void;
  pinPending: boolean;
}) {
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
        source={source}
        selected={selected}
        showDragHandle={canDrag}
        dragHandleEnabled={canDrag}
        dragging={isDragging}
        dragHandleProps={{ ...attributes, ...listeners }}
        onSelectSource={onSelectSource}
        onPin={onPin}
        pinPending={pinPending}
      />
    </div>
  );
}

function SourceListItem({
  source,
  selected,
  showDragHandle,
  dragHandleEnabled,
  dragging,
  overlay,
  dragHandleProps,
  onSelectSource,
  onPin,
  pinPending,
}: {
  source: ArchiveSourceListItem;
  selected: boolean;
  showDragHandle: boolean;
  dragHandleEnabled: boolean;
  dragging?: boolean;
  overlay?: boolean;
  dragHandleProps?: HTMLAttributes<HTMLButtonElement>;
  onSelectSource: (sourceId: number) => void;
  onPin: (sourceId: number, isPinned: boolean) => void;
  pinPending: boolean;
}) {
  const debugRedactionEnabled = useDebugRedactionEnabled();
  const isDeleted = Boolean(source.deleted_at);
  const scanStatus = sourceScanStatus(source);

  return (
    <div
      role="button"
      tabIndex={0}
      className={[
        "flex w-full items-center justify-between gap-3 rounded-lg border p-3 text-left transition duration-fast ease-out",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
        dragging ? "opacity-40" : "",
        overlay ? "border-brand/40 bg-bg-surface shadow-2" : "",
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
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {showDragHandle ? (
          <button
            type="button"
            className={[
              "touch-none flex h-8 w-8 shrink-0 items-center justify-center rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50",
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
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {source.is_pinned ? <Pin className="h-3.5 w-3.5 shrink-0 text-brand" aria-label="已置顶" /> : null}
            {isDeleted ? <Badge tone="danger">已删除</Badge> : null}
            <div className="truncate text-sm font-semibold text-fg-primary">{source.label || source.source_url}</div>
          </div>
          <div className="mt-0.5 text-xs text-fg-secondary" {...getDebugRedactProps(debugRedactionEnabled)}>
            {sourceTypeLabel(source.source_type)} · @{source.author_username || "-"}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-4 text-xs text-fg-secondary">
        <div className="hidden grid-cols-4 gap-3 sm:grid">
          <ListMetric label="已发现 Tweet" value={source.discovered_tweet_count ?? source.discovered_count ?? 0} />
          <ListMetric label="扫描发现媒体" value={source.discovered_media_count ?? 0} />
          <ListMetric label="待下载发现" value={source.unsubmitted_tweet_count ?? 0} warning={(source.unsubmitted_tweet_count ?? 0) > 0} />
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
