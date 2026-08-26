import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderClosed, Tag } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import {
  apiGet,
  apiPut,
  type OrganizationCatalog,
  type TweetOrganization,
  type WriteActionResponse,
} from "@/lib/api";
import { getDebugRedactProps, useDebugRedactionEnabled } from "@/lib/debug-redaction";

export function OrganizationEditorDialog({
  tweetId,
  open,
  onOpenChange,
}: {
  tweetId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const debugRedactionEnabled = useDebugRedactionEnabled();
  const catalogQuery = useQuery({
    queryKey: ["organization-catalog"],
    queryFn: () => apiGet<OrganizationCatalog>("/api/v1/library/organization"),
    enabled: open,
  });
  const organizationQuery = useQuery({
    queryKey: ["tweet-organization", tweetId],
    queryFn: () => apiGet<TweetOrganization>(`/api/v1/library/tweets/${tweetId}/organization`),
    enabled: open && Boolean(tweetId),
  });
  const [tagIds, setTagIds] = useState<Set<number>>(new Set());
  const [collectionIds, setCollectionIds] = useState<Set<number>>(new Set());
  const [note, setNote] = useState("");
  const [initialOrganization, setInitialOrganization] = useState<OrganizationSnapshot | null>(null);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const initializedTweetRef = useRef<string | null>(null);

  useEffect(() => {
    const organization = organizationQuery.data;
    if (!open) {
      initializedTweetRef.current = null;
      setTagIds(new Set());
      setCollectionIds(new Set());
      setNote("");
      setInitialOrganization(null);
      setDiscardConfirmOpen(false);
      return;
    }
    if (!tweetId || !organization || organization.tweet_id !== tweetId) {
      initializedTweetRef.current = null;
      setTagIds(new Set());
      setCollectionIds(new Set());
      setNote("");
      setInitialOrganization(null);
      return;
    }
    if (initializedTweetRef.current === organization.tweet_id) return;
    initializedTweetRef.current = organization.tweet_id;
    const nextOrganization = {
      tagIds: new Set(organization.tags.map((item) => item.id)),
      collectionIds: new Set(organization.collections.map((item) => item.id)),
      note: organization.note?.content ?? "",
    };
    setTagIds(new Set(nextOrganization.tagIds));
    setCollectionIds(new Set(nextOrganization.collectionIds));
    setNote(nextOrganization.note);
    setInitialOrganization(nextOrganization);
  }, [open, organizationQuery.data, tweetId]);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiPut<WriteActionResponse<TweetOrganization>>(`/api/v1/library/tweets/${tweetId}/organization`, {
        tag_ids: Array.from(tagIds),
        collection_ids: Array.from(collectionIds),
        note_content: note,
      }),
    onSuccess: async () => {
      await invalidateOrganization(queryClient, tweetId);
      toast.success("整理信息已保存");
      onOpenChange(false);
    },
  });

  const hasUnsavedChanges = useMemo(
    () =>
      Boolean(
        initialOrganization &&
          (!setsEqual(tagIds, initialOrganization.tagIds) ||
            !setsEqual(collectionIds, initialOrganization.collectionIds) ||
            note !== initialOrganization.note),
      ),
    [collectionIds, initialOrganization, note, tagIds],
  );
  const busy = saveMutation.isPending;
  const loadError = catalogQuery.error || organizationQuery.error;

  const requestClose = () => {
    if (busy) return;
    if (hasUnsavedChanges) {
      setDiscardConfirmOpen(true);
      return;
    }
    saveMutation.reset();
    onOpenChange(false);
  };

  const requestSave = () => {
    if (busy || !hasUnsavedChanges || note.length > 10_000) return;
    saveMutation.mutate();
  };

  const noteLabel = note.length > 10_000 ? `超出 ${note.length - 10_000} 字` : `${note.length}/10000`;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (next) onOpenChange(true);
          else requestClose();
        }}
      >
        <DialogContent
          className="max-h-[min(88vh,760px)] overflow-y-auto sm:max-w-2xl"
          onKeyDownCapture={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            requestClose();
          }}
          onPointerDownOutside={(event) => {
            event.preventDefault();
            window.setTimeout(requestClose, 0);
          }}
        >
          <DialogHeader>
            <DialogTitle>整理 Tweet</DialogTitle>
            <DialogDescription>自定义标签、合集和私人备注会在点击“保存整理”后一次性保存。</DialogDescription>
          </DialogHeader>

          {loadError ? (
            <ErrorState
              title="整理信息加载失败"
              detail={String(loadError)}
              onRetry={() => void Promise.all([catalogQuery.refetch(), organizationQuery.refetch()])}
            />
          ) : catalogQuery.isLoading || organizationQuery.isLoading ? (
            <p className="py-8 text-center text-sm text-fg-secondary">正在读取整理信息…</p>
          ) : (
            <FieldGroup className="gap-5" {...getDebugRedactProps(debugRedactionEnabled)}>
              {saveMutation.error ? (
                <Alert variant="destructive">
                  <AlertTitle>保存整理失败</AlertTitle>
                  <AlertDescription>{String(saveMutation.error)}</AlertDescription>
                </Alert>
              ) : null}
              <SelectionField
                label="自定义标签"
                icon={<Tag />}
                empty="还没有自定义标签，请先到“自定义标签”页面创建。"
                items={catalogQuery.data?.tags ?? []}
                selected={tagIds}
                disabled={busy}
                onToggle={(id) => setTagIds(toggleId(tagIds, id))}
              />
              <SelectionField
                label="合集"
                icon={<FolderClosed />}
                empty="还没有合集，请先到“合集”页面创建。"
                items={catalogQuery.data?.collections ?? []}
                selected={collectionIds}
                disabled={busy}
                onToggle={(id) => setCollectionIds(toggleId(collectionIds, id))}
              />
              <Field className="gap-2" data-invalid={note.length > 10_000}>
                <div className="flex items-center justify-between gap-3">
                  <FieldLabel htmlFor="tweet-private-note">私人备注</FieldLabel>
                  <span className={note.length > 10_000 ? "text-xs text-danger" : "text-xs text-fg-tertiary"}>
                    {noteLabel}
                  </span>
                </div>
                <Textarea
                  id="tweet-private-note"
                  className="min-h-32 resize-y"
                  placeholder="记录为什么保存、之后要做什么，或任何仅在本地使用的上下文。"
                  disabled={busy}
                  aria-invalid={note.length > 10_000}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </Field>
            </FieldGroup>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={requestClose}>
              取消
            </Button>
            <Button
              type="button"
              disabled={
                !catalogQuery.data ||
                !organizationQuery.data ||
                !hasUnsavedChanges ||
                busy ||
                note.length > 10_000
              }
              onClick={requestSave}
            >
              {saveMutation.isPending ? "保存中…" : "保存整理"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={discardConfirmOpen} onOpenChange={setDiscardConfirmOpen}>
        <AlertDialogContent onEscapeKeyDown={(event) => event.preventDefault()}>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃未保存的整理更改？</AlertDialogTitle>
            <AlertDialogDescription>自定义标签、合集和私人备注的本次修改尚未保存。放弃后无法恢复。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction
              className="bg-danger text-white hover:bg-danger/90"
              onClick={() => {
                saveMutation.reset();
                setDiscardConfirmOpen(false);
                onOpenChange(false);
              }}
            >
              放弃更改
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

type OrganizationSnapshot = {
  tagIds: Set<number>;
  collectionIds: Set<number>;
  note: string;
};

function setsEqual(left: Set<number>, right: Set<number>) {
  return left.size === right.size && Array.from(left).every((value) => right.has(value));
}

function SelectionField({
  label,
  icon,
  empty,
  items,
  selected,
  disabled,
  onToggle,
}: {
  label: string;
  icon: ReactNode;
  empty: string;
  items: Array<{ id: number; name: string; color?: string | null }>;
  selected: Set<number>;
  disabled: boolean;
  onToggle: (id: number) => void;
}) {
  return (
    <Field className="gap-2">
      <FieldLabel className="flex items-center gap-2">
        {icon}
        {label}
      </FieldLabel>
      {items.length ? (
        <div className="grid max-h-44 gap-2 overflow-y-auto rounded-lg border border-border-subtle p-3 sm:grid-cols-2">
          {items.map((item) => (
            <label key={item.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-bg-muted">
              <Checkbox disabled={disabled} checked={selected.has(item.id)} onCheckedChange={() => onToggle(item.id)} />
              {item.color ? <span className="size-2.5 rounded-full" style={{ backgroundColor: item.color }} /> : null}
              <span className="min-w-0 truncate text-sm text-fg-primary">{item.name}</span>
            </label>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border-subtle px-3 py-4 text-sm text-fg-tertiary">{empty}</p>
      )}
    </Field>
  );
}

function toggleId(current: Set<number>, id: number) {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

async function invalidateOrganization(
  queryClient: QueryClient,
  tweetId: string | null,
) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["organization-catalog"] }),
    queryClient.invalidateQueries({ queryKey: ["tweet-organization", tweetId] }),
    queryClient.invalidateQueries({ queryKey: ["tweet", tweetId] }),
    queryClient.invalidateQueries({ queryKey: ["posts"] }),
    queryClient.invalidateQueries({ queryKey: ["tweet-search"] }),
    queryClient.invalidateQueries({ queryKey: ["collection-tweets"] }),
  ]);
}
