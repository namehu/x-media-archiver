import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus } from "lucide-react";
import { useSearchParams } from "react-router-dom";
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
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { CatalogItemDialog } from "@/components/organization/catalog-item-dialog";
import {
  apiDelete,
  apiGet,
  type OrganizationCatalog,
  type OrganizationCollection,
  type WriteActionResponse,
} from "@/lib/api";
import { getPrivacyRedactProps, usePrivacyRedactionEnabled } from "@/lib/privacy-redaction";
import { CollectionCatalog, CollectionDetail } from "./components/collection-browser";

export function CollectionsPage() {
  const queryClient = useQueryClient();
  const privacyRedactionEnabled = usePrivacyRedactionEnabled();
  const [searchParams, setSearchParams] = useSearchParams();
  const [editor, setEditor] = useState<{ item: OrganizationCollection | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<OrganizationCollection | null>(null);
  const catalogQuery = useQuery({
    queryKey: ["organization-catalog"],
    queryFn: () => apiGet<OrganizationCatalog>("/api/v1/library/organization"),
  });
  const requestedCollectionId = parseCollectionId(searchParams.get("collection"));
  const selectedCollection = catalogQuery.data?.collections.find((item) => item.id === requestedCollectionId) ?? null;

  const closeCollection = () => {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete("collection");
        return next;
      },
      { replace: true },
    );
  };

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!deleteTarget) throw new Error("未选择删除目标");
      return apiDelete<WriteActionResponse>(`/api/v1/library/organization/collections/${deleteTarget.id}`, {
        body: { confirm_delete: true },
      });
    },
    onSuccess: async () => {
      const deletedTarget = deleteTarget;
      toast.success("合集已删除，Tweet 与媒体均已保留");
      setDeleteTarget(null);
      if (deletedTarget?.id === requestedCollectionId) {
        closeCollection();
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["organization-catalog"] }),
        queryClient.invalidateQueries({ queryKey: ["collection-tweets"] }),
        queryClient.invalidateQueries({ queryKey: ["posts"] }),
        queryClient.invalidateQueries({ queryKey: ["tweet-search"] }),
      ]);
    },
  });

  return (
    <div className="min-h-full">
      <main className="mx-auto min-h-full max-w-[760px] border-x border-border-subtle bg-bg-base">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-border-subtle bg-bg-base/95 px-4 backdrop-blur sm:px-5">
          {selectedCollection ? (
            <div className="flex min-w-0 items-center gap-2">
              <Button type="button" variant="ghost" size="icon" className="-ml-2" aria-label="返回全部合集" onClick={closeCollection}>
                <ArrowLeft aria-hidden="true" />
              </Button>
              <div className="min-w-0" {...getPrivacyRedactProps(privacyRedactionEnabled)}>
                <h1 className="truncate text-base font-bold text-fg-primary">{selectedCollection.name}</h1>
                <p className="text-xs tabular-nums text-fg-tertiary">{selectedCollection.tweet_count ?? 0} 条 Tweet</p>
              </div>
            </div>
          ) : (
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold tracking-tight text-fg-primary">合集</h1>
              {catalogQuery.data ? (
                <p className="text-xs tabular-nums text-fg-tertiary">{catalogQuery.data.collections.length} 个合集</p>
              ) : null}
            </div>
          )}
          {!selectedCollection ? (
            <div className="flex shrink-0 items-center">
              <Button type="button" onClick={() => setEditor({ item: null })} disabled={!catalogQuery.data}>
                <Plus data-icon="inline-start" aria-hidden="true" />
                新建
              </Button>
            </div>
          ) : null}
        </header>

        {catalogQuery.isLoading ? <CollectionsSkeleton /> : null}
        {catalogQuery.isError || !catalogQuery.data ? (
          <div className="p-4 sm:p-6">
            <ErrorState
              title="整理目录加载失败"
              detail={String(catalogQuery.error)}
              onRetry={() => void catalogQuery.refetch()}
            />
          </div>
        ) : null}
        {catalogQuery.data && selectedCollection ? (
          <CollectionDetail
            collectionId={selectedCollection.id}
            onEdit={(item) => setEditor({ item })}
            onDelete={setDeleteTarget}
          />
        ) : null}
        {catalogQuery.data && !selectedCollection ? (
          <CollectionCatalog
            items={catalogQuery.data.collections}
            onOpen={(id) => {
              setSearchParams((current) => {
                const next = new URLSearchParams(current);
                next.set("collection", String(id));
                return next;
              });
            }}
            onCreate={() => setEditor({ item: null })}
            onEdit={(item) => setEditor({ item })}
            onDelete={setDeleteTarget}
          />
        ) : null}
      </main>

      <CatalogItemDialog
        kind="collection"
        item={editor?.item ?? null}
        open={Boolean(editor)}
        onOpenChange={(open) => {
          if (!open) setEditor(null);
        }}
      />
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader {...getPrivacyRedactProps(privacyRedactionEnabled)}>
            <AlertDialogTitle>删除“{deleteTarget?.name}”？</AlertDialogTitle>
            <AlertDialogDescription>
              将解除 {deleteTarget?.tweet_count ?? 0} 条 Tweet 的合集关系。Tweet、媒体文件、下载任务与私人备注都不会被删除。
              此目录项本身无法恢复。
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

function CollectionsSkeleton() {
  return (
    <div className="flex flex-col">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="flex gap-4 border-b border-border-subtle px-4 py-4 sm:px-5">
          <Skeleton className="size-20 shrink-0 rounded-lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-3 py-1">
            <Skeleton className="h-5 w-40 max-w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

function parseCollectionId(value: string | null) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
