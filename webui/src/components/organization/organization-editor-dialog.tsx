import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderClosed, Tag } from "lucide-react";
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
  const [savedNote, setSavedNote] = useState("");
  const [noteState, setNoteState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const initializedTweetRef = useRef<string | null>(null);
  const noteRef = useRef(note);
  noteRef.current = note;

  useEffect(() => {
    const organization = organizationQuery.data;
    if (!open) {
      initializedTweetRef.current = null;
      return;
    }
    if (!organization || initializedTweetRef.current === organization.tweet_id) return;
    initializedTweetRef.current = organization.tweet_id;
    setTagIds(new Set(organization.tags.map((item) => item.id)));
    setCollectionIds(new Set(organization.collections.map((item) => item.id)));
    setNote(organization.note?.content ?? "");
    setSavedNote(organization.note?.content ?? "");
    setNoteState("idle");
  }, [open, organizationQuery.data]);

  const labelsMutation = useMutation({
    mutationFn: () =>
      apiPut<WriteActionResponse>(`/api/v1/library/tweets/${tweetId}/organization/labels`, {
        tag_ids: Array.from(tagIds),
        collection_ids: Array.from(collectionIds),
      }),
    onSuccess: async () => {
      await invalidateOrganization(queryClient, tweetId);
      toast.success("标签与合集已保存");
      onOpenChange(false);
    },
  });
  const noteMutation = useMutation({
    mutationFn: (content: string) =>
      apiPut<WriteActionResponse>(`/api/v1/library/tweets/${tweetId}/organization/note`, { content }),
    onMutate: () => setNoteState("saving"),
    onSuccess: async (_response, content) => {
      setSavedNote(content);
      setNoteState(noteRef.current === content ? "saved" : "idle");
      await invalidateOrganization(queryClient, tweetId);
    },
    onError: () => setNoteState("error"),
  });
  const saveNote = noteMutation.mutate;

  useEffect(() => {
    if (
      !open ||
      !tweetId ||
      noteMutation.isPending ||
      noteState === "error" ||
      note === savedNote ||
      note.length > 10_000
    )
      return;
    const timer = window.setTimeout(() => saveNote(note), 700);
    return () => window.clearTimeout(timer);
  }, [note, noteMutation.isPending, noteState, open, saveNote, savedNote, tweetId]);

  const requestClose = () => {
    if (busy) return;
    if (note.length > 10_000) return;
    if (tweetId && note !== savedNote && note.length <= 10_000) {
      noteMutation.mutate(note, { onSuccess: () => onOpenChange(false) });
      return;
    }
    onOpenChange(false);
  };

  const requestSave = () => {
    if (busy || note.length > 10_000) return;
    if (note !== savedNote) {
      noteMutation.mutate(note, { onSuccess: () => labelsMutation.mutate() });
      return;
    }
    labelsMutation.mutate();
  };

  const busy = labelsMutation.isPending || noteMutation.isPending;
  const error = catalogQuery.error || organizationQuery.error || labelsMutation.error;
  const noteLabel = useMemo(() => {
    if (note.length > 10_000) return `超出 ${note.length - 10_000} 字`;
    if (noteState === "saving") return "正在自动保存…";
    if (noteState === "saved") return "已自动保存";
    if (noteState === "error") return "自动保存失败，将在继续编辑后重试";
    return `${note.length}/10000`;
  }, [note.length, noteState]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else requestClose();
      }}
    >
      <DialogContent className="max-h-[min(88vh,760px)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>整理 Tweet</DialogTitle>
          <DialogDescription>标签和合集点击“保存整理”后生效；私人备注会在停止输入后自动保存。</DialogDescription>
        </DialogHeader>

        {error ? (
          <ErrorState
            title="整理信息加载失败"
            detail={String(error)}
            onRetry={() => void Promise.all([catalogQuery.refetch(), organizationQuery.refetch()])}
          />
        ) : catalogQuery.isLoading || organizationQuery.isLoading ? (
          <p className="py-8 text-center text-sm text-fg-secondary">正在读取整理信息…</p>
        ) : (
          <FieldGroup className="gap-5" {...getDebugRedactProps(debugRedactionEnabled)}>
            <SelectionField
              label="标签"
              icon={<Tag />}
              empty="还没有标签，请先到“合集 → 标签管理”创建。"
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
            <Field className="gap-2">
              <div className="flex items-center justify-between gap-3">
                <FieldLabel htmlFor="tweet-private-note">私人备注</FieldLabel>
                <span className={noteState === "error" || note.length > 10_000 ? "text-xs text-danger" : "text-xs text-fg-tertiary"}>
                  {noteLabel}
                </span>
              </div>
              <Textarea
                id="tweet-private-note"
                className="min-h-32 resize-y"
                placeholder="记录为什么保存、之后要做什么，或任何仅在本地使用的上下文。"
                disabled={busy}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                  setNoteState("idle");
                }}
              />
            </Field>
          </FieldGroup>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" disabled={busy || note.length > 10_000} onClick={requestClose}>
            {noteMutation.isPending ? "保存备注中…" : "关闭"}
          </Button>
          <Button
            type="button"
            disabled={!catalogQuery.data || !organizationQuery.data || busy || note.length > 10_000}
            onClick={requestSave}
          >
            {labelsMutation.isPending ? "保存中…" : "保存整理"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
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
