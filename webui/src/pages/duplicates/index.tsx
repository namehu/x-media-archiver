import { useEffect, useMemo, useState } from "react";
import { CheckCheck, Files, Gauge, GitCompare, HardDrive, Image as ImageIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  apiDelete,
  apiGet,
  type DuplicateGroup,
  type DuplicatesResponse,
  type MediaRow,
} from "../../lib/api";
import {
  formatDeletedBytes,
  mediaDeleteErrorMessage,
  type MediaDeleteResponse,
} from "../../lib/media-deletion";
import { mediaTypeLabel } from "../../lib/formatters";
import { formatBytes } from "../../lib/utils";
import { MediaDeleteDialog } from "../../components/media-delete-dialog";
import { MediaSelectionBar } from "../../components/media-selection-bar";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent } from "../../components/ui/card";
import { Checkbox } from "../../components/ui/checkbox";
import { EmptyState } from "../../components/ui/empty-state";
import { ErrorState } from "../../components/ui/error-state";
import { ManagementPageHeader } from "../../components/ui/management-page-header";
import { MediaThumbnail } from "../../components/ui/media-thumbnail";
import { Pagination } from "../../components/ui/pagination";
import { Skeleton } from "../../components/ui/skeleton";
import {
  getPrivacyDetailLinkLabel,
  getPrivacyDetailRoute,
  getPrivacyMediaAlt,
  usePrivacyRedactionEnabled,
} from "../../lib/privacy-redaction";
import { StatCard } from "../../components/ui/stat-card";

const PAGE_SIZE = 20;
const MAX_DELETE_SELECTION = 200;

export function DuplicatesPage() {
  const queryClient = useQueryClient();
  const [offset, setOffset] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteOperationId, setDeleteOperationId] = useState<string | null>(null);
  const duplicatesQuery = useQuery({
    queryKey: ["duplicates", offset],
    queryFn: () => apiGet<DuplicatesResponse>(`/api/v1/library/duplicates?limit=${PAGE_SIZE}&offset=${offset}`),
  });
  const groups = useMemo(() => duplicatesQuery.data?.groups ?? [], [duplicatesQuery.data]);
  const rows = useMemo(() => groups.flatMap((group) => group.rows), [groups]);
  const model = useMemo(
    () => buildDuplicateModel(groups, duplicatesQuery.data?.duplicate_groups ?? 0, duplicatesQuery.data?.total_media_count ?? 0),
    [groups, duplicatesQuery.data?.duplicate_groups, duplicatesQuery.data?.total_media_count],
  );
  const selectedRows = useMemo(() => rows.filter((row) => selectedIds.has(row.id)), [rows, selectedIds]);
  const selectedBytes = useMemo(
    () => selectedRows.reduce((total, row) => total + (row.file_size ?? 0), 0),
    [selectedRows],
  );
  const fullySelectedGroupCount = useMemo(
    () => groups.filter((group) => group.rows.length > 0 && group.rows.every((row) => selectedIds.has(row.id))).length,
    [groups, selectedIds],
  );
  const deleteMutation = useMutation({
    mutationFn: (operationId: string) =>
      apiDelete<MediaDeleteResponse>("/api/v1/library/media", {
        body: {
          operation_id: operationId,
          media_ids: Array.from(selectedIds),
          confirm_physical_delete: true,
        },
      }),
    onSuccess: async (response) => {
      setDeleteDialogOpen(false);
      setDeleteOperationId(null);
      setSelectedIds(new Set());
      await Promise.all([
        queryClient.resetQueries({ queryKey: ["duplicates"] }),
        queryClient.resetQueries({ queryKey: ["media"] }),
        queryClient.invalidateQueries({ queryKey: ["tweet"] }),
        queryClient.invalidateQueries({ queryKey: ["summary"] }),
        queryClient.invalidateQueries({ queryKey: ["failures"] }),
        queryClient.invalidateQueries({ queryKey: ["source-discovered"] }),
      ]);
      toast.success(
        `已删除 ${response.result.deleted_media_count} 项媒体，释放 ${formatDeletedBytes(response.result.deleted_bytes)}`,
      );
    },
  });

  useEffect(() => {
    const availableIds = new Set(rows.map((row) => row.id));
    setSelectedIds((current) => {
      const next = new Set([...current].filter((id) => availableIds.has(id)));
      return setsEqual(current, next) ? current : next;
    });
  }, [rows]);

  useEffect(() => {
    if (!duplicatesQuery.isFetching && duplicatesQuery.data?.count === 0 && offset > 0) {
      setSelectedIds(new Set());
      setOffset(Math.max(0, offset - PAGE_SIZE));
    }
  }, [duplicatesQuery.data?.count, duplicatesQuery.isFetching, offset]);

  if (duplicatesQuery.isLoading) return <DuplicatesSkeleton />;
  if (duplicatesQuery.error) {
    return (
      <div className="flex flex-col gap-5">
        <ManagementPageHeader
          eyebrow="存储维护"
          title="重复媒体"
          description="重复媒体索引暂时无法读取。"
        />
        <ErrorState title="重复媒体不可用" detail={String(duplicatesQuery.error)} onRetry={() => void duplicatesQuery.refetch()} />
      </div>
    );
  }

  const changePage = (nextOffset: number) => {
    setSelectedIds(new Set());
    setOffset(nextOffset);
  };

  const toggleSelected = (row: MediaRow) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(row.id)) next.delete(row.id);
      else if (next.size >= MAX_DELETE_SELECTION) toast.error("单次最多选择 200 个媒体项。");
      else next.add(row.id);
      return next;
    });
  };

  const selectRedundantRows = (targetGroups: DuplicateGroup[], preserveOtherSelections: boolean) => {
    let truncated = false;
    setSelectedIds((current) => {
      const next = preserveOtherSelections ? new Set(current) : new Set<number>();
      for (const group of targetGroups) {
        const [keeper, ...redundantRows] = group.rows;
        if (keeper) next.delete(keeper.id);
        for (const row of redundantRows) {
          if (next.size >= MAX_DELETE_SELECTION && !next.has(row.id)) {
            truncated = true;
            continue;
          }
          next.add(row.id);
        }
      }
      return next;
    });
    if (truncated) toast.info("已选择前 200 个重复媒体项，其余项目可分批处理。");
  };

  const openDeleteDialog = () => {
    deleteMutation.reset();
    setDeleteOperationId(crypto.randomUUID());
    setDeleteDialogOpen(true);
  };

  return (
    <div className="flex flex-col gap-5">
      <ManagementPageHeader
        eyebrow="存储维护"
        title="重复媒体"
        description="按 SHA-256 聚合相同文件，先确认保留项，再精确删除冗余媒体。"
        meta={
          <Badge tone={model.groupCount ? "warning" : "success"}>
            {model.groupCount.toLocaleString()} 组重复 · {model.fileCount.toLocaleString()} 个媒体
          </Badge>
        }
        actions={
          <>
          {groups.length ? (
            <Button type="button" variant="outline" size="sm" onClick={() => selectRedundantRows(groups, false)}>
              <CheckCheck data-icon="inline-start" />
              选择本页冗余项
            </Button>
          ) : null}
          {selectedIds.size ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>
              清除选择
            </Button>
          ) : null}
          {duplicatesQuery.data ? (
            <Pagination
              offset={offset}
              count={duplicatesQuery.data.count}
              totalCount={duplicatesQuery.data.total_count}
              pageSize={PAGE_SIZE}
              onOffsetChange={changePage}
              label="第 {start}-{end} 组，共 {total} 组"
            />
          ) : null}
          </>
        }
      />

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="重复组"
          value={model.groupCount.toLocaleString()}
          detail="完整哈希分组"
          icon={<GitCompare className="h-4 w-4" />}
          tone={model.groupCount ? "warning" : "success"}
          sparklineData={model.groupSizes}
        />
        <StatCard
          label="全库媒体"
          value={model.fileCount.toLocaleString()}
          detail={`本页 ${model.loadedFileCount} 个文件`}
          icon={<Files className="h-4 w-4" />}
          tone="brand"
        />
        <StatCard
          label="本页空间"
          value={formatBytes(model.pageBytes)}
          detail="主媒体文件"
          icon={<HardDrive className="h-4 w-4" />}
          tone={model.pageBytes ? "warning" : "brand"}
        />
        <StatCard
          label="媒体"
          value={model.dominantMediaType ? mediaTypeLabel(model.dominantMediaType) : "-"}
          detail={model.dominantMediaTypeCount ? `本页 ${model.dominantMediaTypeCount} 个文件` : "没有重复媒体。"}
          icon={<ImageIcon className="h-4 w-4" />}
          tone="brand"
        />
      </section>

      {groups.length ? (
        <section className="flex flex-col gap-4">
          {groups.map((group) => (
            <DuplicateGroupCard
              key={group.sha256}
              group={group}
              selectedIds={selectedIds}
              onToggleSelected={toggleSelected}
              onSelectRedundant={() => selectRedundantRows([group], true)}
            />
          ))}
          {duplicatesQuery.data ? (
            <Pagination
              offset={offset}
              count={duplicatesQuery.data.count}
              totalCount={duplicatesQuery.data.total_count}
              pageSize={PAGE_SIZE}
              onOffsetChange={changePage}
              label="第 {start}-{end} 组，共 {total} 组"
            />
          ) : null}
        </section>
      ) : (
        <EmptyState icon={<GitCompare className="h-5 w-5" />} title="没有重复媒体" description="当前没有检测到 SHA-256 完全一致的媒体文件。" />
      )}

      <MediaSelectionBar
        count={selectedIds.size}
        estimatedBytes={selectedBytes}
        onClear={() => setSelectedIds(new Set())}
        onDelete={openDeleteDialog}
      />
      <MediaDeleteDialog
        open={deleteDialogOpen}
        count={selectedIds.size}
        estimatedBytes={selectedBytes}
        pending={deleteMutation.isPending}
        error={deleteMutation.error ? mediaDeleteErrorMessage(deleteMutation.error) : null}
        fullySelectedGroupCount={fullySelectedGroupCount}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open);
          if (!open) setDeleteOperationId(null);
        }}
        onConfirm={() => {
          if (deleteOperationId) deleteMutation.mutate(deleteOperationId);
        }}
      />
    </div>
  );
}

function DuplicateGroupCard({
  group,
  selectedIds,
  onToggleSelected,
  onSelectRedundant,
}: {
  group: DuplicateGroup;
  selectedIds: Set<number>;
  onToggleSelected: (row: MediaRow) => void;
  onSelectRedundant: () => void;
}) {
  const primary = group.rows[0];
  return (
    <section className="overflow-hidden rounded-xl border border-border-subtle bg-bg-elevated">
      <header className="flex flex-col gap-3 border-b border-border-subtle p-4">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
          <div className="min-w-0">
            <h2 className="flex flex-wrap items-center gap-2">
              <Badge tone="warning">{group.duplicate_count} 个文件</Badge>
              <span className="break-all font-mono text-sm font-semibold text-fg-primary">{shortHash(group.sha256)}</span>
            </h2>
            <p className="mt-1 break-all text-xs text-fg-tertiary">{group.sha256}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="secondary">{formatBytes(group.total_size)}</Badge>
            <Badge tone="default">{mediaTypeLabel(primary?.media_type)}</Badge>
            <Button type="button" variant="outline" size="sm" onClick={onSelectRedundant}>
              <CheckCheck data-icon="inline-start" />
              保留一项，选择其余
            </Button>
          </div>
        </div>
        <HashMatchBar count={group.duplicate_count} />
      </header>

      <div className="p-4">
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-4">
          {group.rows.map((row, index) => (
            <DuplicateMediaCard
              key={row.id}
              row={row}
              index={index}
              keeper={index === 0}
              selected={selectedIds.has(row.id)}
              onToggleSelected={() => onToggleSelected(row)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function DuplicateMediaCard({
  row,
  index,
  keeper,
  selected,
  onToggleSelected,
}: {
  row: MediaRow;
  index: number;
  keeper: boolean;
  selected: boolean;
  onToggleSelected: () => void;
}) {
  const privacyRedactionEnabled = usePrivacyRedactionEnabled();
  const detailRoute = getPrivacyDetailRoute(privacyRedactionEnabled, row.tweet_id);
  return (
    <div className="relative min-w-0 overflow-hidden rounded-lg border border-border-subtle bg-bg-surface transition duration-fast hover:border-border-strong">
      <div className="absolute left-2 top-2 z-10 flex items-center gap-2 rounded-md bg-bg-elevated/95 p-2 shadow-2 backdrop-blur">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggleSelected}
          onClick={(event) => event.stopPropagation()}
          aria-label={privacyRedactionEnabled ? "选择媒体" : `选择媒体 ${row.id}`}
        />
        {keeper ? <Badge tone="default">建议保留</Badge> : null}
      </div>
      <MediaThumbnail
        src={row.media_url}
        mediaType={row.media_type}
        alt={getPrivacyMediaAlt(privacyRedactionEnabled, row.tweet_text || row.tweet_id)}
        className="rounded-b-none"
      />
      <div className="flex flex-col gap-3 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase text-fg-tertiary">媒体 #{index + 1}</div>
            {detailRoute ? (
              <Link className="mt-1 block truncate text-sm font-semibold text-brand hover:text-brand-hover" to={detailRoute}>
                Tweet 详情
              </Link>
            ) : (
              <span className="mt-1 block truncate text-sm font-semibold text-fg-tertiary">
                {getPrivacyDetailLinkLabel(privacyRedactionEnabled)}
              </span>
            )}
          </div>
          <Badge tone="secondary">{mediaTypeLabel(row.media_type)}</Badge>
        </div>
        <div className="grid gap-2 text-xs text-fg-secondary">
          <div className="flex items-center justify-between gap-3">
            <span>文件大小</span>
            <span className="tabular-nums text-fg-primary">{formatBytes(row.file_size)}</span>
          </div>
          <div className="min-w-0 break-all rounded-md bg-bg-elevated px-2 py-1 font-mono text-[11px] text-fg-tertiary">
            {row.local_path || row.media_relative_path || "-"}
          </div>
        </div>
      </div>
    </div>
  );
}

function HashMatchBar({ count }: { count: number }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs font-medium text-fg-secondary">
      <span className="inline-flex items-center gap-1">
        <Gauge className="h-3.5 w-3.5 text-brand" />
        SHA-256 完全一致
      </span>
      <span>{count} 个文件</span>
    </div>
  );
}

function DuplicatesSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <ManagementPageHeader
        eyebrow="存储维护"
        title="重复媒体"
        description="正在分析重复组与媒体占用。"
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-32 rounded-lg" />
        ))}
      </div>
      {Array.from({ length: 3 }).map((_, index) => (
        <Card key={index}>
          <CardContent className="flex flex-col gap-4 p-4">
            <Skeleton className="h-12" />
            <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-4">
              {Array.from({ length: 4 }).map((__, childIndex) => (
                <Skeleton key={childIndex} className="aspect-video rounded-lg" />
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function buildDuplicateModel(groups: DuplicateGroup[], duplicateGroups: number, totalMediaCount: number) {
  const mediaTypeCounts = new Map<string, number>();
  let pageBytes = 0;
  let loadedFileCount = 0;
  for (const group of groups) {
    for (const row of group.rows) {
      if (row.media_type) mediaTypeCounts.set(row.media_type, (mediaTypeCounts.get(row.media_type) ?? 0) + 1);
      pageBytes += row.file_size ?? 0;
      loadedFileCount += 1;
    }
  }
  const [dominantMediaType, dominantMediaTypeCount = 0] = [...mediaTypeCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
  return {
    groupCount: duplicateGroups,
    fileCount: totalMediaCount,
    loadedFileCount,
    pageBytes,
    dominantMediaType,
    dominantMediaTypeCount,
    groupSizes: groups.map((group) => group.duplicate_count).slice(0, 12),
  };
}

function shortHash(sha256: string) {
  return `${sha256.slice(0, 10)}...${sha256.slice(-8)}`;
}

function setsEqual(left: Set<number>, right: Set<number>) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}
