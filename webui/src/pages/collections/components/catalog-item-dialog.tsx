import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  apiPost,
  apiPut,
  type OrganizationCollection,
  type OrganizationTag,
  type WriteActionResponse,
} from "@/lib/api";
import { getDebugRedactProps, useDebugRedactionEnabled } from "@/lib/debug-redaction";

type CatalogItem = OrganizationTag | OrganizationCollection;

export function CatalogItemDialog({
  kind,
  item,
  open,
  onOpenChange,
}: {
  kind: "tag" | "collection";
  item: CatalogItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const debugRedactionEnabled = useDebugRedactionEnabled();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState("#0096fa");

  useEffect(() => {
    if (!open) return;
    setName(item?.name ?? "");
    setDescription(item?.description ?? "");
    setColor("color" in (item ?? {}) ? (item as OrganizationTag).color || "#0096fa" : "#0096fa");
  }, [item, open]);

  const mutation = useMutation({
    mutationFn: () => {
      const segment = kind === "tag" ? "tags" : "collections";
      const path = `/api/v1/library/organization/${segment}${item ? `/${item.id}` : ""}`;
      const body =
        kind === "tag"
          ? { name: name.trim(), description: description.trim() || null, color }
          : {
              name: name.trim(),
              description: description.trim() || null,
              cover_media_id: (item as OrganizationCollection | null)?.cover_media_id ?? null,
            };
      return item ? apiPut<WriteActionResponse>(path, body) : apiPost<WriteActionResponse>(path, body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["organization-catalog"] });
      toast.success(`${kind === "tag" ? "标签" : "合集"}已${item ? "更新" : "创建"}`);
      onOpenChange(false);
    },
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) return;
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !mutation.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-lg">
        <form className="flex flex-col gap-5" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{item ? "编辑" : "新建"}{kind === "tag" ? "标签" : "合集"}</DialogTitle>
            <DialogDescription>
              {kind === "tag" ? "标签名称不区分大小写，颜色仅用于快速识别。" : "合集可包含多条 Tweet，封面稍后从合集现有媒体中选择。"}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-4" {...getDebugRedactProps(debugRedactionEnabled)}>
            <Field>
              <FieldLabel htmlFor="catalog-name">名称</FieldLabel>
              <Input
                id="catalog-name"
                autoFocus
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <FieldDescription>{name.length}/100</FieldDescription>
            </Field>
            {kind === "tag" ? (
              <Field>
                <FieldLabel htmlFor="catalog-color">颜色</FieldLabel>
                <Input
                  id="catalog-color"
                  type="color"
                  className="h-10 w-20 p-1"
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                />
              </Field>
            ) : null}
            <Field>
              <FieldLabel htmlFor="catalog-description">描述</FieldLabel>
              <Textarea
                id="catalog-description"
                maxLength={500}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
              <FieldDescription>{description.length}/500</FieldDescription>
            </Field>
          </FieldGroup>
          {mutation.error ? <p className="text-sm text-danger">{String(mutation.error)}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={!name.trim() || mutation.isPending}>
              {mutation.isPending ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
