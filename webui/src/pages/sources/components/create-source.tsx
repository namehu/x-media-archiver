import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { sourceTypeLabel } from "@/lib/formatters";
import { SOURCE_TYPES } from "../utils";

export function CreateSource({
  open,
  isPending,
  error,
  resetKey,
  onCreate,
  onOpenChange,
}: {
  open: boolean;
  isPending: boolean;
  error: unknown;
  resetKey: number;
  onCreate: (input: { sourceType: string; sourceUrl: string; label?: string }) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const [sourceType, setSourceType] = useState("profile");
  const [sourceUrl, setSourceUrl] = useState("");
  const [label, setLabel] = useState("");
  const canCreate = sourceUrl.trim().length > 0 && !isPending;

  useEffect(() => {
    setSourceUrl("");
    setLabel("");
  }, [resetKey]);

  function inferSourceType(url: string) {
    try {
      const parsed = new URL(url.trim());
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.includes("search")) return "search";
      if (parts.includes("bookmarks")) return "bookmarks";
      if (parts.includes("likes")) return "likes";
      if (parts[1] === "media") return "user_media";
      if (parts.length === 1 && !["home", "i"].includes(parts[0])) return "profile";
    } catch {
      return null;
    }
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>新增来源</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canCreate) onCreate({ sourceType, sourceUrl, label });
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="source-label">名称（可选）</FieldLabel>
              <Input
                id="source-label"
                placeholder="名称（可选）"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
            </Field>

            <Field data-invalid={error ? true : undefined}>
              <FieldLabel htmlFor="source-url">来源 URL</FieldLabel>
              <Input
                id="source-url"
                placeholder="https://x.com/username/media"
                value={sourceUrl}
                aria-invalid={error ? true : undefined}
                onChange={(e) => {
                  const nextUrl = e.target.value;
                  setSourceUrl(nextUrl);
                  const inferred = inferSourceType(nextUrl);
                  if (inferred) setSourceType(inferred);
                }}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="source-type">来源类型</FieldLabel>
              <Select value={sourceType} onValueChange={setSourceType}>
                <SelectTrigger id="source-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {SOURCE_TYPES.map((type) => (
                      <SelectItem key={type} value={type}>
                        {sourceTypeLabel(type)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>例如 /media 会识别为博主媒体页，/bookmarks 识别为书签，普通用户名主页识别为博主主页。</FieldDescription>
            </Field>
          </FieldGroup>
          {error ? <FieldError errors={[{ message: String(error) }]} /> : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                取消
              </Button>
            </DialogClose>
            <Button type="submit" disabled={!canCreate}>
              新增来源
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
