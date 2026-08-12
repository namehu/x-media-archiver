import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Edit3, FileText, FolderClosed, Image as ImageIcon, Plus, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { MediaThumbnail } from "@/components/ui/media-thumbnail";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  apiDelete,
  apiGet,
  apiPut,
  type OrganizationCatalog,
  type OrganizationCollection,
  type OrganizationCollectionPage,
  type OrganizationTag,
  type WriteActionResponse,
} from "@/lib/api";
import {
  getDebugDetailRoute,
  getDebugMediaAlt,
  getDebugRedactProps,
  useDebugRedactionEnabled,
} from "@/lib/debug-redaction";
import { CatalogItemDialog } from "./components/catalog-item-dialog";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

const PAGE_SIZE = 20;
type CatalogItem = OrganizationTag | OrganizationCollection;

export function CollectionsPage() {
  const queryClient = useQueryClient();
  const debugRedactionEnabled = useDebugRedactionEnabled();
  const catalogQuery = useQuery({
    queryKey: ["organization-catalog"],
    queryFn: () => apiGet<OrganizationCatalog>("/api/v1/library/organization"),
  });
  const [selectedCollectionId, setSelectedCollectionId] = useState<number | null>(null);
  const [editor, setEditor] = useState<{ kind: "tag" | "collection"; item: CatalogItem | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ kind: "tag" | "collection"; item: CatalogItem } | null>(null);

  useEffect(() => {
    const collections = catalogQuery.data?.collections ?? [];
    if (!collections.length) setSelectedCollectionId(null);
    else if (!selectedCollectionId || !collections.some((item) => item.id === selectedCollectionId)) {
      setSelectedCollectionId(collections[0].id);
    }
  }, [catalogQuery.data?.collections, selectedCollectionId]);

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!deleteTarget) throw new Error("未选择删除目标");
      const segment = deleteTarget.kind === "tag" ? "tags" : "collections";
      return apiDelete<WriteActionResponse>(`/api/v1/library/organization/${segment}/${deleteTarget.item.id}`, {
        body: { confirm_delete: true },
      });
    },
    onSuccess: async () => {
      toast.success(`${deleteTarget?.kind === "tag" ? "标签" : "合集"}已删除，Tweet 与媒体均已保留`);
      setDeleteTarget(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["organization-catalog"] }),
        queryClient.invalidateQueries({ queryKey: ["collection-tweets"] }),
        queryClient.invalidateQueries({ queryKey: ["posts"] }),
        queryClient.invalidateQueries({ queryKey: ["tweet-search"] }),
      ]);
    },
  });

  if (catalogQuery.isLoading) return <CollectionsSkeleton />;
  if (catalogQuery.error || !catalogQuery.data) {
    return <ErrorState title="整理目录加载失败" detail={String(catalogQuery.error)} onRetry={() => void catalogQuery.refetch()} />;
  }

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-fg-primary">合集</h1>
        <p className="mt-1 text-sm text-fg-secondary">用标签、合集和私人备注组织本地 Tweet，不改变原始归档文件。</p>
      </header>
      <Tabs defaultValue="collections">
        <TabsList>
          <TabsTrigger value="collections">合集</TabsTrigger>
          <TabsTrigger value="tags">标签管理</TabsTrigger>
        </TabsList>
        <TabsContent value="collections" className="mt-4">
          <div className="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
            <CatalogList
              kind="collection"
              items={catalogQuery.data.collections}
              selectedId={selectedCollectionId}
              onSelect={setSelectedCollectionId}
              onCreate={() => setEditor({ kind: "collection", item: null })}
              onEdit={(item) => setEditor({ kind: "collection", item })}
              onDelete={(item) => setDeleteTarget({ kind: "collection", item })}
            />
            {selectedCollectionId ? (
              <CollectionDetail collectionId={selectedCollectionId} />
            ) : (
              <EmptyState
                icon={<FolderClosed />}
                title="还没有合集"
                description="创建合集后，可从帖子浏览、Tweet 详情或媒体库批量加入。"
                action={<Button onClick={() => setEditor({ kind: "collection", item: null })}><Plus data-icon="inline-start" />新建合集</Button>}
              />
            )}
          </div>
        </TabsContent>
        <TabsContent value="tags" className="mt-4">
          <CatalogList
            kind="tag"
            items={catalogQuery.data.tags}
            selectedId={null}
            onSelect={() => undefined}
            onCreate={() => setEditor({ kind: "tag", item: null })}
            onEdit={(item) => setEditor({ kind: "tag", item })}
            onDelete={(item) => setDeleteTarget({ kind: "tag", item })}
          />
        </TabsContent>
      </Tabs>

      <CatalogItemDialog
        kind={editor?.kind ?? "collection"}
        item={editor?.item ?? null}
        open={Boolean(editor)}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
      />
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader {...getDebugRedactProps(debugRedactionEnabled)}>
            <AlertDialogTitle>删除“{deleteTarget?.item.name}”？</AlertDialogTitle>
            <AlertDialogDescription>
              将解除 {deleteTarget?.item.tweet_count ?? 0} 条 Tweet 的{deleteTarget?.kind === "tag" ? "标签" : "合集"}关系。
              Tweet、媒体文件、下载任务与私人备注都不会被删除。此目录项本身无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteMutation.error ? <p className="text-sm text-danger">{String(deleteMutation.error)}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              className="bg-danger text-white hover:bg-danger/90"
              onClick={(event) => {
                event.preventDefault();
                deleteMutation.mutate();
              }}
            >
              {deleteMutation.isPending ? "删除中…" : "确认删除并解除关系"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CatalogList({
  kind,
  items,
  selectedId,
  onSelect,
  onCreate,
  onEdit,
  onDelete,
}: {
  kind: "tag" | "collection";
  items: CatalogItem[];
  selectedId: number | null;
  onSelect: (id: number) => void;
  onCreate: () => void;
  onEdit: (item: CatalogItem) => void;
  onDelete: (item: CatalogItem) => void;
}) {
  const debugRedactionEnabled = useDebugRedactionEnabled();
  const label = kind === "tag" ? "标签" : "合集";
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <CardTitle>{label}</CardTitle>
            <CardDescription>共 {items.length} 个{label}</CardDescription>
          </div>
          <Button size="sm" onClick={onCreate}><Plus data-icon="inline-start" />新建</Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-2" {...getDebugRedactProps(debugRedactionEnabled)}>
        {items.length ? items.map((item) => (
          <div
            key={item.id}
            className={cn(
              "flex items-center gap-1 rounded-lg border pr-1 transition-colors",
              selectedId === item.id ? "border-brand bg-brand-soft" : "border-border-subtle hover:bg-bg-muted",
            )}
          >
            <button type="button" className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left" onClick={() => onSelect(item.id)}>
              {kind === "tag" ? (
                <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: (item as OrganizationTag).color || "var(--border-strong)" }} />
              ) : (
                <FolderClosed className="size-4 shrink-0 text-brand" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-fg-primary">{item.name}</span>
                <span className="block truncate text-xs text-fg-tertiary">{item.tweet_count ?? 0} 条 Tweet</span>
              </span>
            </button>
            <span className="flex shrink-0 gap-1">
              <Button type="button" variant="ghost" size="icon" aria-label={`编辑${label}`} onClick={() => onEdit(item)}><Edit3 /></Button>
              <Button type="button" variant="ghost" size="icon" aria-label={`删除${label}`} onClick={() => onDelete(item)}><Trash2 /></Button>
            </span>
          </div>
        )) : (
          <p className="rounded-lg border border-dashed border-border-subtle px-3 py-6 text-center text-sm text-fg-tertiary">暂无{label}</p>
        )}
      </CardContent>
    </Card>
  );
}

function CollectionDetail({ collectionId }: { collectionId: number }) {
  const queryClient = useQueryClient();
  const debugRedactionEnabled = useDebugRedactionEnabled();
  const [offset, setOffset] = useState(0);
  useEffect(() => setOffset(0), [collectionId]);
  const query = useQuery({
    queryKey: ["collection-tweets", collectionId, offset],
    queryFn: () => apiGet<OrganizationCollectionPage>(`/api/v1/library/organization/collections/${collectionId}/tweets?limit=${PAGE_SIZE}&offset=${offset}`),
  });
  const mediaOptions = useMemo(() => query.data?.rows.flatMap((row) => row.media) ?? [], [query.data]);
  const currentCoverMissingFromPage = Boolean(
    query.data?.collection.cover_media_id &&
      !mediaOptions.some((media) => media.id === query.data?.collection.cover_media_id),
  );
  const coverMutation = useMutation({
    mutationFn: (coverMediaId: number | null) => {
      if (!query.data) throw new Error("合集尚未加载");
      return apiPut<WriteActionResponse>(`/api/v1/library/organization/collections/${collectionId}`, {
        name: query.data.collection.name,
        description: query.data.collection.description ?? null,
        cover_media_id: coverMediaId,
      });
    },
    onSuccess: async () => {
      toast.success("合集封面已更新");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["organization-catalog"] }),
        queryClient.invalidateQueries({ queryKey: ["collection-tweets", collectionId] }),
      ]);
    },
  });

  if (query.isLoading) return <Card><CardContent className="flex flex-col gap-3 p-5"><Skeleton className="h-7 w-44" /><Skeleton className="h-40 w-full" /></CardContent></Card>;
  if (query.error || !query.data) return <ErrorState title="合集加载失败" detail={String(query.error)} onRetry={() => void query.refetch()} />;
  const { collection, rows, total_count: totalCount } = query.data;
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div className="flex flex-col gap-1" {...getDebugRedactProps(debugRedactionEnabled)}>
            <CardTitle>{collection.name}</CardTitle>
            <CardDescription>{collection.description || "暂无合集描述"}</CardDescription>
          </div>
          <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-fg-secondary sm:w-64" {...getDebugRedactProps(debugRedactionEnabled)}>
            合集封面
            <Select
              value={String(collection.cover_media_id ?? "")}
              disabled={coverMutation.isPending || !mediaOptions.length}
              onChange={(event) => coverMutation.mutate(event.target.value ? Number(event.target.value) : null)}
            >
              <option value="">不设置封面</option>
              {currentCoverMissingFromPage ? (
                <option value={collection.cover_media_id ?? undefined}>当前封面 #{collection.cover_media_id}</option>
              ) : null}
              {mediaOptions.map((media) => <option key={media.id} value={media.id}>媒体 #{media.id} · {media.media_type || "未知类型"}</option>)}
            </Select>
          </label>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {rows.length ? rows.map((row) => {
          const detailRoute = getDebugDetailRoute(debugRedactionEnabled, row.tweet_id);
          return (
            <article key={row.tweet_id} className="grid gap-3 rounded-lg border border-border-subtle p-3 sm:grid-cols-[144px_minmax(0,1fr)]">
              <MediaThumbnail src={row.media[0]?.preview_url || row.media[0]?.media_url} mediaType={row.media[0]?.media_type} alt={getDebugMediaAlt(debugRedactionEnabled, row.tweet_text)} />
              <div className="flex min-w-0 flex-col gap-2" {...getDebugRedactProps(debugRedactionEnabled)}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-fg-primary">{row.author_display_name || row.author_username || "未知作者"}</p>
                    <p className="text-xs text-fg-tertiary">@{row.author_username || "-"}</p>
                  </div>
                  {detailRoute ? <Link className={buttonVariants({ size: "sm", variant: "outline" })} to={detailRoute}>查看详情</Link> : null}
                </div>
                <p className="line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed text-fg-secondary">{row.tweet_text || "暂无正文"}</p>
                <div className="flex flex-wrap gap-1.5">
                  {(row.tags ?? []).slice(0, 3).map((tag) => <Badge key={tag} tone="secondary">{tag}</Badge>)}
                  {row.note_excerpt ? <Badge tone="secondary"><FileText />有私人备注</Badge> : null}
                </div>
              </div>
            </article>
          );
        }) : (
          <EmptyState icon={<ImageIcon />} title="这个合集还没有 Tweet" description="在帖子浏览、Tweet 详情或媒体库中加入内容。" />
        )}
        {totalCount > PAGE_SIZE ? (
          <div className="flex items-center justify-between gap-3">
            <Button variant="outline" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>上一页</Button>
            <span className="text-xs tabular-nums text-fg-tertiary">{offset + 1}–{Math.min(offset + rows.length, totalCount)} / {totalCount}</span>
            <Button variant="outline" disabled={offset + rows.length >= totalCount} onClick={() => setOffset(offset + PAGE_SIZE)}>下一页</Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CollectionsSkeleton() {
  return <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]"><Skeleton className="h-80" /><Skeleton className="h-96" /></div>;
}
