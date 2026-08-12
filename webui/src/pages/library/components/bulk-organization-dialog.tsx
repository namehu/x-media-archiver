import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderClosed, Tags } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ErrorState } from "@/components/ui/error-state";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  apiGet,
  apiPost,
  type OrganizationCatalog,
  type WriteActionResponse,
} from "@/lib/api";
import { getDebugRedactProps, useDebugRedactionEnabled } from "@/lib/debug-redaction";

export function BulkOrganizationDialog({
  tweetIds,
  open,
  onOpenChange,
  onCompleted,
}: {
  tweetIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCompleted: () => void;
}) {
  const queryClient = useQueryClient();
  const debugRedactionEnabled = useDebugRedactionEnabled();
  const catalogQuery = useQuery({
    queryKey: ["organization-catalog"],
    queryFn: () => apiGet<OrganizationCatalog>("/api/v1/library/organization"),
    enabled: open,
  });
  const [addTagIds, setAddTagIds] = useState<Set<number>>(new Set());
  const [removeTagIds, setRemoveTagIds] = useState<Set<number>>(new Set());
  const [addCollectionIds, setAddCollectionIds] = useState<Set<number>>(new Set());
  const [removeCollectionIds, setRemoveCollectionIds] = useState<Set<number>>(new Set());
  const hasChanges = addTagIds.size + removeTagIds.size + addCollectionIds.size + removeCollectionIds.size > 0;

  const mutation = useMutation({
    mutationFn: () =>
      apiPost<WriteActionResponse<{ selected_tweet_count: number }>>("/api/v1/library/organization/bulk", {
        tweet_ids: tweetIds,
        add_tag_ids: Array.from(addTagIds),
        remove_tag_ids: Array.from(removeTagIds),
        add_collection_ids: Array.from(addCollectionIds),
        remove_collection_ids: Array.from(removeCollectionIds),
      }),
    onSuccess: async (response) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["organization-catalog"] }),
        queryClient.invalidateQueries({ queryKey: ["posts"] }),
        queryClient.invalidateQueries({ queryKey: ["tweet-search"] }),
        queryClient.invalidateQueries({ queryKey: ["collection-tweets"] }),
        queryClient.invalidateQueries({ queryKey: ["tweet"] }),
      ]);
      toast.success(`已整理 ${response.result.selected_tweet_count} 条 Tweet`);
      resetChanges();
      onCompleted();
      onOpenChange(false);
    },
  });

  const resetChanges = () => {
    setAddTagIds(new Set());
    setRemoveTagIds(new Set());
    setAddCollectionIds(new Set());
    setRemoveCollectionIds(new Set());
  };

  const changeOpen = (next: boolean) => {
    if (mutation.isPending) return;
    if (!next) resetChanges();
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent className="max-h-[min(88vh,760px)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>批量整理 {tweetIds.length} 条 Tweet</DialogTitle>
          <DialogDescription>添加不会覆盖已有关系；移除只解除所选关系。每次最多精确处理 200 条 Tweet。</DialogDescription>
        </DialogHeader>
        {catalogQuery.error ? (
          <ErrorState title="整理目录加载失败" detail={String(catalogQuery.error)} onRetry={() => void catalogQuery.refetch()} />
        ) : catalogQuery.isLoading ? (
          <p className="py-8 text-center text-sm text-fg-secondary">正在读取标签与合集…</p>
        ) : (
          <Tabs defaultValue="add" {...getDebugRedactProps(debugRedactionEnabled)}>
            <TabsList className="w-full">
              <TabsTrigger value="add" className="flex-1">添加关系</TabsTrigger>
              <TabsTrigger value="remove" className="flex-1">移除关系</TabsTrigger>
            </TabsList>
            <TabsContent value="add" className="mt-4">
              <BulkFields
                catalog={catalogQuery.data ?? { tags: [], collections: [] }}
                tagIds={addTagIds}
                collectionIds={addCollectionIds}
                disabledTagIds={removeTagIds}
                disabledCollectionIds={removeCollectionIds}
                onToggleTag={(id) => setAddTagIds(toggleId(addTagIds, id))}
                onToggleCollection={(id) => setAddCollectionIds(toggleId(addCollectionIds, id))}
              />
            </TabsContent>
            <TabsContent value="remove" className="mt-4">
              <BulkFields
                catalog={catalogQuery.data ?? { tags: [], collections: [] }}
                tagIds={removeTagIds}
                collectionIds={removeCollectionIds}
                disabledTagIds={addTagIds}
                disabledCollectionIds={addCollectionIds}
                onToggleTag={(id) => setRemoveTagIds(toggleId(removeTagIds, id))}
                onToggleCollection={(id) => setRemoveCollectionIds(toggleId(removeCollectionIds, id))}
              />
            </TabsContent>
          </Tabs>
        )}
        {mutation.error ? <p className="text-sm text-danger">{String(mutation.error)}</p> : null}
        <DialogFooter>
          <Button variant="outline" disabled={mutation.isPending} onClick={() => changeOpen(false)}>取消</Button>
          <Button disabled={!hasChanges || !tweetIds.length || mutation.isPending} onClick={() => mutation.mutate()}>
            {mutation.isPending ? "整理中…" : "应用批量整理"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkFields({
  catalog,
  tagIds,
  collectionIds,
  disabledTagIds,
  disabledCollectionIds,
  onToggleTag,
  onToggleCollection,
}: {
  catalog: OrganizationCatalog;
  tagIds: Set<number>;
  collectionIds: Set<number>;
  disabledTagIds: Set<number>;
  disabledCollectionIds: Set<number>;
  onToggleTag: (id: number) => void;
  onToggleCollection: (id: number) => void;
}) {
  return (
    <FieldGroup className="gap-5">
      <FieldSet>
        <FieldLegend className="flex items-center gap-2"><Tags />标签</FieldLegend>
        <div data-slot="checkbox-group" className="grid max-h-48 gap-2 overflow-y-auto rounded-lg border border-border-subtle p-3 sm:grid-cols-2">
          {catalog.tags.length ? catalog.tags.map((tag) => (
            <Field key={tag.id} orientation="horizontal" data-disabled={disabledTagIds.has(tag.id)}>
              <Checkbox
                id={`bulk-tag-${tag.id}`}
                checked={tagIds.has(tag.id)}
                disabled={disabledTagIds.has(tag.id)}
                onCheckedChange={() => onToggleTag(tag.id)}
              />
              <FieldLabel htmlFor={`bulk-tag-${tag.id}`} className="min-w-0">
                <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color || "var(--border-strong)" }} />
                <span className="truncate">{tag.name}</span>
              </FieldLabel>
            </Field>
          )) : <p className="text-sm text-fg-tertiary">暂无标签</p>}
        </div>
      </FieldSet>
      <FieldSet>
        <FieldLegend className="flex items-center gap-2"><FolderClosed />合集</FieldLegend>
        <div data-slot="checkbox-group" className="grid max-h-48 gap-2 overflow-y-auto rounded-lg border border-border-subtle p-3 sm:grid-cols-2">
          {catalog.collections.length ? catalog.collections.map((collection) => (
            <Field key={collection.id} orientation="horizontal" data-disabled={disabledCollectionIds.has(collection.id)}>
              <Checkbox
                id={`bulk-collection-${collection.id}`}
                checked={collectionIds.has(collection.id)}
                disabled={disabledCollectionIds.has(collection.id)}
                onCheckedChange={() => onToggleCollection(collection.id)}
              />
              <FieldLabel htmlFor={`bulk-collection-${collection.id}`} className="min-w-0">
                <span className="truncate">{collection.name}</span>
              </FieldLabel>
            </Field>
          )) : <p className="text-sm text-fg-tertiary">暂无合集</p>}
        </div>
      </FieldSet>
    </FieldGroup>
  );
}

function toggleId(current: Set<number>, id: number) {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
