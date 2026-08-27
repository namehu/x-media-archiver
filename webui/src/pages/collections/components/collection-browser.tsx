import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Edit3,
  FileText,
  FolderClosed,
  Image as ImageIcon,
  MoreHorizontal,
  Plus,
  Settings2,
  Trash2,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { MediaThumbnail } from "@/components/ui/media-thumbnail";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  apiGet,
  apiPut,
  type OrganizationCollection,
  type OrganizationCollectionPage,
  type WriteActionResponse,
} from "@/lib/api";
import {
  getPrivacyDetailRoute,
  getPrivacyMediaAlt,
  getPrivacyRedactProps,
  usePrivacyRedactionEnabled,
} from "@/lib/privacy-redaction";

const PAGE_SIZE = 20;

export function CollectionCatalog({
  items,
  onOpen,
  onCreate,
  onEdit,
  onDelete,
}: {
  items: OrganizationCollection[];
  onOpen: (id: number) => void;
  onCreate: () => void;
  onEdit: (item: OrganizationCollection) => void;
  onDelete: (item: OrganizationCollection) => void;
}) {
  const privacyRedactionEnabled = usePrivacyRedactionEnabled();

  if (!items.length) {
    return (
      <div className="p-4 sm:p-6">
        <EmptyState
          icon={<FolderClosed />}
          title="还没有合集"
          description="创建合集后，可从首页、Tweet 详情或媒体页加入内容。"
          action={
            <Button onClick={onCreate}>
              <Plus data-icon="inline-start" aria-hidden="true" />
              新建合集
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div role="list" aria-label="合集目录">
      {items.map((item) => (
        <article
          key={item.id}
          role="listitem"
          className="flex items-center gap-4 border-b border-border-subtle px-4 py-4 transition-colors hover:bg-bg-surface sm:px-5"
          {...getPrivacyRedactProps(privacyRedactionEnabled)}
        >
          <MediaThumbnail
            src={item.cover?.media_url}
            mediaType={item.cover?.media_type}
            alt={getPrivacyMediaAlt(privacyRedactionEnabled, `${item.name}合集封面`)}
            ariaLabel={`打开合集 ${item.name}`}
            aspect="square"
            showTypeBadge={false}
            className="size-20 shrink-0"
            onClick={() => onOpen(item.id)}
          />
          <button
            type="button"
            className="min-w-0 flex-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
            onClick={() => onOpen(item.id)}
          >
            <h2 className="truncate text-base font-bold text-fg-primary">{item.name}</h2>
            <p className="mt-1 line-clamp-2 text-sm leading-5 text-fg-secondary">
              {item.description || "暂无描述"}
            </p>
            <p className="mt-2 text-xs tabular-nums text-fg-tertiary">{item.tweet_count ?? 0} 条 Tweet</p>
          </button>
          <CatalogActions label="合集" onEdit={() => onEdit(item)} onDelete={() => onDelete(item)} />
        </article>
      ))}
    </div>
  );
}

export function CollectionDetail({
  collectionId,
  onEdit,
  onDelete,
}: {
  collectionId: number;
  onEdit: (item: OrganizationCollection) => void;
  onDelete: (item: OrganizationCollection) => void;
}) {
  const queryClient = useQueryClient();
  const privacyRedactionEnabled = usePrivacyRedactionEnabled();
  const [offset, setOffset] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => setOffset(0), [collectionId]);

  const query = useQuery({
    queryKey: ["collection-tweets", collectionId, offset],
    queryFn: () =>
      apiGet<OrganizationCollectionPage>(
        `/api/v1/library/organization/collections/${collectionId}/tweets?limit=${PAGE_SIZE}&offset=${offset}`,
      ),
  });
  const mediaOptions = useMemo(() => query.data?.rows.flatMap((row) => row.media) ?? [], [query.data]);
  const currentCoverMissingFromPage = Boolean(
    query.data?.collection.cover_media_id &&
      !mediaOptions.some((media) => media.id === query.data?.collection.cover_media_id),
  );
  const selectedCover = mediaOptions.find((media) => media.id === query.data?.collection.cover_media_id);
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

  if (query.isLoading) return <CollectionDetailSkeleton />;
  if (query.isError || !query.data) {
    return (
      <div className="p-4 sm:p-6">
        <ErrorState title="合集加载失败" detail={String(query.error)} onRetry={() => void query.refetch()} />
      </div>
    );
  }

  const { collection, rows, total_count: totalCount } = query.data;
  const cover = selectedCover ?? collection.cover;

  return (
    <div>
      {cover?.media_url ? (
        <div {...getPrivacyRedactProps(privacyRedactionEnabled)}>
          <MediaThumbnail
            src={cover.media_url}
            mediaType={cover.media_type}
            alt={getPrivacyMediaAlt(privacyRedactionEnabled, `${collection.name}合集封面`)}
            aspect="wide"
            showTypeBadge={false}
            className="rounded-none"
          />
        </div>
      ) : null}
      <section className="border-b border-border-subtle px-4 py-4 sm:px-5" {...getPrivacyRedactProps(privacyRedactionEnabled)}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-2xl font-bold tracking-tight text-fg-primary">{collection.name}</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-fg-secondary">
              {collection.description || "暂无合集描述"}
            </p>
            <p className="mt-2 text-xs tabular-nums text-fg-tertiary">{totalCount.toLocaleString()} 条 Tweet</p>
          </div>
          <Button type="button" variant="ghost" size="icon" aria-label="合集设置" onClick={() => setSettingsOpen(true)}>
            <Settings2 aria-hidden="true" />
          </Button>
        </div>
      </section>

      {rows.length ? (
        <div>
          {rows.map((row) => {
            const detailRoute = getPrivacyDetailRoute(privacyRedactionEnabled, row.tweet_id);
            return (
              <article
                key={row.tweet_id}
                className="grid gap-3 border-b border-border-subtle px-4 py-4 sm:grid-cols-[128px_minmax(0,1fr)] sm:px-5"
              >
                <div {...getPrivacyRedactProps(privacyRedactionEnabled)}>
                  <MediaThumbnail
                    src={row.media[0]?.preview_url || row.media[0]?.media_url}
                    mediaType={row.media[0]?.media_type}
                    alt={getPrivacyMediaAlt(privacyRedactionEnabled, row.tweet_text)}
                    showTypeBadge={false}
                  />
                </div>
                <div className="flex min-w-0 flex-col gap-2" {...getPrivacyRedactProps(privacyRedactionEnabled)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-fg-primary">
                        {row.author_display_name || row.author_username || "未知作者"}
                      </p>
                      <p className="truncate text-xs text-fg-tertiary">@{row.author_username || "-"}</p>
                    </div>
                    {detailRoute ? (
                      <Link className={buttonVariants({ size: "sm", variant: "ghost" })} to={detailRoute}>
                        打开详情
                      </Link>
                    ) : null}
                  </div>
                  <p className="line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-fg-secondary">
                    {row.tweet_text || "暂无正文"}
                  </p>
                  {row.tags?.length || row.note_excerpt ? (
                    <div className="flex flex-wrap gap-1.5">
                      {(row.tags ?? []).slice(0, 3).map((tag) => (
                        <Badge key={tag} tone="secondary">{tag}</Badge>
                      ))}
                      {row.note_excerpt ? (
                        <Badge tone="secondary"><FileText aria-hidden="true" />有私人备注</Badge>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
          {totalCount > PAGE_SIZE ? (
            <div className="px-4 py-3 sm:px-5">
              <Pagination
                offset={offset}
                count={rows.length}
                totalCount={totalCount}
                pageSize={PAGE_SIZE}
                label="第 {start}–{end} 条，共 {total} 条"
                onOffsetChange={setOffset}
              />
            </div>
          ) : null}
        </div>
      ) : (
        <div className="p-4 sm:p-6">
          <EmptyState
            icon={<ImageIcon />}
            title="这个合集还没有 Tweet"
            description="可从首页、Tweet 详情或媒体页把内容加入这里。"
          />
        </div>
      )}

      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent className="w-[min(94vw,440px)] overflow-y-auto">
          <SheetHeader>
            <SheetTitle>合集设置</SheetTitle>
            <SheetDescription>编辑合集信息、调整封面或删除合集关系。</SheetDescription>
          </SheetHeader>
          <FieldGroup className="gap-6" {...getPrivacyRedactProps(privacyRedactionEnabled)}>
            <Field data-disabled={coverMutation.isPending || !mediaOptions.length}>
              <FieldLabel htmlFor="collection-cover">合集封面</FieldLabel>
              <Select
                id="collection-cover"
                value={String(collection.cover_media_id ?? "")}
                disabled={coverMutation.isPending || !mediaOptions.length}
                onChange={(event) => coverMutation.mutate(event.target.value ? Number(event.target.value) : null)}
              >
                <option value="">不设置封面</option>
                {currentCoverMissingFromPage ? (
                  <option value={collection.cover_media_id ?? undefined}>当前封面 #{collection.cover_media_id}</option>
                ) : null}
                {mediaOptions.map((media) => (
                  <option key={media.id} value={media.id}>媒体 #{media.id} · {media.media_type || "未知类型"}</option>
                ))}
              </Select>
              <FieldDescription>
                {mediaOptions.length ? "可从当前页已加载的媒体中选择。" : "合集还没有可作为封面的媒体。"}
              </FieldDescription>
            </Field>
            {coverMutation.error ? <p className="text-sm text-danger">{String(coverMutation.error)}</p> : null}
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setSettingsOpen(false);
                  onEdit(collection);
                }}
              >
                <Edit3 data-icon="inline-start" aria-hidden="true" />
                编辑名称与描述
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  setSettingsOpen(false);
                  onDelete(collection);
                }}
              >
                <Trash2 data-icon="inline-start" aria-hidden="true" />
                删除合集
              </Button>
            </div>
          </FieldGroup>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function CatalogActions({
  label,
  onEdit,
  onDelete,
}: {
  label: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label={`${label}操作`}>
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={onEdit}>
            <Edit3 aria-hidden="true" />
            编辑
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-danger focus:text-danger" onSelect={onDelete}>
            <Trash2 aria-hidden="true" />
            删除
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CollectionDetailSkeleton() {
  return (
    <div>
      <Skeleton className="aspect-[3/1] w-full rounded-none" />
      <div className="flex flex-col gap-3 border-b border-border-subtle px-4 py-4 sm:px-5">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-8 w-52 max-w-full" />
        <Skeleton className="h-4 w-full max-w-lg" />
      </div>
      {Array.from({ length: 3 }).map((_, index) => (
        <div key={index} className="flex gap-3 border-b border-border-subtle px-4 py-4 sm:px-5">
          <Skeleton className="h-20 w-32 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <Skeleton className="h-4 w-40 max-w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}
