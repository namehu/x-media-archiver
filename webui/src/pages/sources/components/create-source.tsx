import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ApiError } from "@/lib/api";
import { sourceTypeLabel } from "@/lib/formatters";
import { CREATABLE_SOURCE_TYPES } from "../utils";

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
  const hasSourceUrl = sourceUrl.trim().length > 0;
  const canCreate = sourceUrl.trim().length > 0 && !isPending;
  const errorMessage = createSourceErrorMessage(error);

  useEffect(() => {
    setSourceType("profile");
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
      if (parts[1] === "media") return parsed.searchParams.get("filter") === "photo" ? "user_photos" : "user_videos";
      if (parts.length === 1 && !["home", "i"].includes(parts[0])) return "profile";
    } catch {
      return null;
    }
    return null;
  }

  function handleSourceUrlChange(nextUrl: string) {
    setSourceUrl(nextUrl);
    const inferred = inferSourceType(nextUrl);
    if (inferred) setSourceType(inferred);
  }

  function handleSourceTypeChange(nextType: string) {
    setSourceType(nextType);
    if (nextType !== "user_photos" && nextType !== "user_videos") return;
    try {
      const parsed = new URL(sourceUrl.trim());
      const username = parsed.pathname.split("/").filter(Boolean)[0];
      if (!username) return;
      parsed.pathname = `/${username}/media`;
      parsed.search = nextType === "user_photos" ? "?filter=photo" : "";
      parsed.hash = "";
      setSourceUrl(parsed.toString());
    } catch { /* Keep invalid input visible for the existing form validation. */ }
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
            <Field data-invalid={error ? true : undefined}>
              <FieldLabel htmlFor="source-url">来源 URL</FieldLabel>
              <Input
                id="source-url"
                placeholder="https://x.com/username/media"
                value={sourceUrl}
                aria-invalid={error ? true : undefined}
                onChange={(e) => handleSourceUrlChange(e.target.value)}
              />
            </Field>

            {hasSourceUrl ? (
              <div className="flex flex-col gap-4 pt-1">
                <Field>
                  <FieldLabel htmlFor="source-type">来源类型</FieldLabel>
                  <Select value={sourceType} onValueChange={handleSourceTypeChange} disabled={!hasSourceUrl}>
                    <SelectTrigger id="source-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {CREATABLE_SOURCE_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {sourceTypeLabel(type)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  {sourceType === "user_photos" || sourceType === "user_videos" ? (
                    <FieldDescription>图片与视频来源各自扫描；含两种媒体的推文共享完整归档结果。</FieldDescription>
                  ) : null}
                </Field>

                <Field>
                  <FieldLabel htmlFor="source-label">名称（可选）</FieldLabel>
                  <Input
                    id="source-label"
                    placeholder="名称（可选）"
                    value={label}
                    disabled={!hasSourceUrl}
                    onChange={(e) => setLabel(e.target.value)}
                  />
                </Field>
              </div>
            ) : null}
          </FieldGroup>
          {errorMessage ? <FieldError errors={[{ message: errorMessage }]} /> : null}
          <DialogFooter>
            <Button type="submit" disabled={!canCreate}>
              新增来源
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function createSourceErrorMessage(error: unknown) {
  if (!error) return null;
  if (
    error instanceof ApiError &&
    (error.code === "source_already_exists" || error.detail === "source_already_exists")
  ) {
    return "该来源链接已存在，请从列表中选择已有来源。";
  }
  return String(error);
}
