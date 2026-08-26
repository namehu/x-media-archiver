import { forwardRef, useDeferredValue, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpDown, Check, Edit3, MoreHorizontal, Plus, Search, Tag, Trash2 } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { Virtuoso } from "react-virtuoso";
import { toast } from "sonner";
import { CatalogItemDialog } from "@/components/organization/catalog-item-dialog";
import { useAppScrollContainer } from "@/components/layout/app-scroll-container";
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
import { Button } from "@/components/ui/button";
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
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  apiDelete,
  apiGet,
  type OrganizationCatalog,
  type OrganizationTag,
  type WriteActionResponse,
} from "@/lib/api";
import { getDebugRedactProps, useDebugRedactionEnabled } from "@/lib/debug-redaction";

type SortMode = "usage" | "name";

export function TagsPage() {
  const queryClient = useQueryClient();
  const scrollParent = useAppScrollContainer();
  const debugRedactionEnabled = useDebugRedactionEnabled();
  const [searchParams, setSearchParams] = useSearchParams();
  const [editor, setEditor] = useState<{ item: OrganizationTag | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OrganizationTag | null>(null);
  const queryText = searchParams.get("q") ?? "";
  const deferredQueryText = useDeferredValue(queryText);
  const sortMode = readSortMode(searchParams.get("sort"));
  const catalogQuery = useQuery({
    queryKey: ["organization-catalog"],
    queryFn: () => apiGet<OrganizationCatalog>("/api/v1/library/organization"),
  });

  const tags = useMemo(() => {
    const normalizedQuery = deferredQueryText.trim().toLocaleLowerCase("zh-CN");
    const filtered = (catalogQuery.data?.tags ?? []).filter((item) => {
      if (!normalizedQuery) return true;
      return `${item.name} ${item.description ?? ""}`.toLocaleLowerCase("zh-CN").includes(normalizedQuery);
    });
    return filtered.sort((left, right) => {
      if (sortMode === "name") return left.name.localeCompare(right.name, "zh-CN");
      return (right.tweet_count ?? 0) - (left.tweet_count ?? 0) || left.name.localeCompare(right.name, "zh-CN");
    });
  }, [catalogQuery.data?.tags, deferredQueryText, sortMode]);

  const setParam = (key: "q" | "sort", value: string) => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  };

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!deleteTarget) throw new Error("未选择删除目标");
      return apiDelete<WriteActionResponse>(`/api/v1/library/organization/tags/${deleteTarget.id}`, {
        body: { confirm_delete: true },
      });
    },
    onSuccess: async () => {
      toast.success("自定义标签已删除，Tweet 与媒体均已保留");
      setDeleteTarget(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["organization-catalog"] }),
        queryClient.invalidateQueries({ queryKey: ["collection-tweets"] }),
        queryClient.invalidateQueries({ queryKey: ["posts"] }),
        queryClient.invalidateQueries({ queryKey: ["tweet-search"] }),
      ]);
    },
  });

  const totalCount = catalogQuery.data?.tags.length ?? 0;

  return (
    <div className="min-h-full">
      <main className="mx-auto min-h-full max-w-[760px] border-x border-border-subtle bg-bg-base" aria-labelledby="tags-page-title">
        <header className="sticky top-0 z-20 border-b border-border-subtle bg-bg-base/95 backdrop-blur">
          <div className="flex h-14 items-center justify-between gap-3 px-4 sm:px-5">
            <div className="min-w-0">
              <h1 id="tags-page-title" className="truncate text-xl font-bold tracking-tight text-fg-primary">自定义标签</h1>
              {catalogQuery.data ? <p className="text-xs tabular-nums text-fg-tertiary">{totalCount.toLocaleString()} 个标签</p> : null}
            </div>
            <Button type="button" onClick={() => setEditor({ item: null })} disabled={!catalogQuery.data}>
              <Plus data-icon="inline-start" aria-hidden="true" />
              新建
            </Button>
          </div>
          <div className="flex gap-2 px-3 pb-3 sm:px-4">
            <Field className="min-w-0 flex-1 gap-0">
              <FieldLabel className="sr-only" htmlFor="tag-search">搜索自定义标签</FieldLabel>
              <Input
                id="tag-search"
                type="search"
                appearance="search"
                autoComplete="off"
                value={queryText}
                placeholder="搜索标签名称或描述"
                onChange={(event) => setParam("q", event.target.value)}
              />
            </Field>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="secondary" size="icon" aria-label={`排序：${sortMode === "usage" ? "使用量" : "名称"}`}>
                  <ArrowUpDown aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem onSelect={() => setParam("sort", "")}>
                    {sortMode === "usage" ? <Check aria-hidden="true" /> : null}
                    按使用量
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setParam("sort", "name")}>
                    {sortMode === "name" ? <Check aria-hidden="true" /> : null}
                    按名称
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <div className="flex min-h-10 items-center justify-between gap-3 border-b border-border-subtle px-4 py-2 text-sm text-fg-secondary" aria-live="polite">
          <span className="tabular-nums">
            {catalogQuery.isError
              ? "标签目录加载失败"
              : catalogQuery.data
                ? queryText
                  ? `显示 ${tags.length.toLocaleString()} / ${totalCount.toLocaleString()} 个标签`
                  : `${totalCount.toLocaleString()} 个标签，按${sortMode === "usage" ? "使用量" : "名称"}排列`
                : "正在读取标签目录"}
          </span>
          <span className="hidden text-xs text-fg-tertiary sm:inline">不包含平台 Hashtag</span>
        </div>

        {catalogQuery.isLoading ? <TagsSkeleton /> : null}
        {catalogQuery.isError ? (
          <div className="p-4 sm:p-6">
            <ErrorState title="自定义标签加载失败" detail={String(catalogQuery.error)} onRetry={() => void catalogQuery.refetch()} />
          </div>
        ) : null}
        {catalogQuery.data && !totalCount ? (
          <div className="p-4 sm:p-6">
            <EmptyState
              icon={<Tag aria-hidden="true" />}
              title="还没有自定义标签"
              description="创建标签后，可以从首页、Tweet 详情或媒体页整理内容。"
              action={<Button onClick={() => setEditor({ item: null })}>新建标签</Button>}
            />
          </div>
        ) : null}
        {catalogQuery.data && totalCount > 0 && !tags.length ? (
          <div className="p-4 sm:p-6">
            <EmptyState
              icon={<Search aria-hidden="true" />}
              title="没有匹配的自定义标签"
              description="试试更短的关键词，或清除搜索后浏览全部标签。"
              action={<Button variant="secondary" onClick={() => setParam("q", "")}>清除搜索</Button>}
            />
          </div>
        ) : null}
        {catalogQuery.data && tags.length && scrollParent ? (
          <Virtuoso
            customScrollParent={scrollParent}
            data={tags}
            computeItemKey={(_, item) => item.id}
            components={{ List: TagListRoot }}
            itemContent={(_, item) => (
              <TagRow
                item={item}
                debugRedactionEnabled={debugRedactionEnabled}
                onEdit={() => setEditor({ item })}
                onDelete={() => setDeleteTarget(item)}
              />
            )}
          />
        ) : null}
      </main>

      <CatalogItemDialog
        kind="tag"
        item={editor?.item ?? null}
        open={Boolean(editor)}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
      />
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader {...getDebugRedactProps(debugRedactionEnabled)}>
            <AlertDialogTitle>删除“{deleteTarget?.name}”？</AlertDialogTitle>
            <AlertDialogDescription>
              将解除 {deleteTarget?.tweet_count ?? 0} 条 Tweet 的自定义标签关系。Tweet、媒体文件、下载任务、合集与私人备注都不会被删除。
              此标签本身无法恢复。
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

function TagRow({
  item,
  debugRedactionEnabled,
  onEdit,
  onDelete,
}: {
  item: OrganizationTag;
  debugRedactionEnabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <article
      role="listitem"
      className="flex min-h-20 items-center gap-3 border-b border-border-subtle px-4 py-3 transition-colors hover:bg-bg-surface sm:px-5"
      {...getDebugRedactProps(debugRedactionEnabled)}
    >
      <span
        className="size-3 shrink-0 rounded-full border border-border-subtle"
        style={{ backgroundColor: item.color || "var(--border-strong)" }}
        aria-hidden="true"
      />
      <Link
        to={`/search?tag_id=${item.id}`}
        className="min-w-0 flex-1 rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
        aria-label={`查看“${item.name}”标签下的 Tweet`}
      >
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="truncate text-sm font-bold text-fg-primary">{item.name}</h2>
          <span className="shrink-0 text-xs tabular-nums text-fg-tertiary">{item.tweet_count ?? 0} 条 Tweet</span>
        </div>
        <p className="mt-1 line-clamp-2 text-sm leading-5 text-fg-secondary">{item.description || "暂无描述"}</p>
      </Link>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="icon" aria-label={`标签操作：${item.name}`}>
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
    </article>
  );
}

const TagListRoot = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => (
  <div {...props} ref={ref} role="list" aria-label="自定义标签目录" />
));
TagListRoot.displayName = "TagListRoot";

function TagsSkeleton() {
  return (
    <div className="flex flex-col">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="flex min-h-20 items-center gap-3 border-b border-border-subtle px-4 py-3 sm:px-5">
          <Skeleton className="size-3 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-40 max-w-full" />
            <Skeleton className="h-4 w-full max-w-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

function readSortMode(value: string | null): SortMode {
  return value === "name" ? "name" : "usage";
}
