import { AlertTriangle, ImageOff, Loader2 } from "lucide-react";
import type { MediaRow } from "../lib/api";
import { getPrivacyMediaAlt, getPrivacyRedactProps, usePrivacyRedactionEnabled } from "../lib/privacy-redaction";
import { mediaTypeLabel } from "../lib/formatters";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { Button } from "./ui/button";
import { formatBytes } from "../lib/utils";
import { PrivacyMediaPlaceholder } from "./ui/privacy-media-placeholder";
import { FallbackImage } from "./ui/fallback-image";

type MediaDeleteDialogProps = {
  open: boolean;
  count: number;
  estimatedBytes: number;
  pending: boolean;
  error: string | null;
  fullySelectedGroupCount?: number;
  targetMedia?: MediaRow | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

export function MediaDeleteDialog({
  open,
  count,
  estimatedBytes,
  pending,
  error,
  fullySelectedGroupCount = 0,
  targetMedia = null,
  onOpenChange,
  onConfirm,
}: MediaDeleteDialogProps) {
  const privacyRedactionEnabled = usePrivacyRedactionEnabled();
  const title = targetMedia ? "永久删除此媒体？" : "永久删除所选媒体？";

  return (
    <AlertDialog open={open} onOpenChange={(nextOpen) => !pending && onOpenChange(nextOpen)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription className="flex flex-col gap-2">
            <span>
              将永久删除 {count} 个媒体项，主媒体约占 {formatBytes(estimatedBytes)}。
            </span>
            <span>对应元数据和标准缩略图也会从磁盘删除，此操作不可撤销。</span>
            <span>Tweet、来源、任务历史和删除审计会保留，Tweet 将标记为“文件缺失”，之后可以重新归档。</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {targetMedia ? (
          <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-3 rounded-lg border border-border-subtle bg-bg-muted p-3">
            <div className="flex aspect-square items-center justify-center overflow-hidden rounded-md bg-bg-surface">
              {privacyRedactionEnabled ? (
                <PrivacyMediaPlaceholder compact />
              ) : targetMedia.preview_url || targetMedia.media_url ? (
                <FallbackImage
                  className="size-full object-contain"
                  src={targetMedia.preview_url}
                  fallbackSrc={targetMedia.media_url}
                  alt={getPrivacyMediaAlt(
                    privacyRedactionEnabled,
                    targetMedia.tweet_text || targetMedia.author_display_name || "待删除媒体",
                  )}
                  fallback={<ImageOff className="size-6 text-fg-tertiary" />}
                />
              ) : (
                <ImageOff className="size-6 text-fg-tertiary" />
              )}
            </div>
            <div className="min-w-0" {...getPrivacyRedactProps(privacyRedactionEnabled)}>
              <p className="truncate text-sm font-semibold text-fg-primary">
                {targetMedia.author_display_name || targetMedia.author_username || "未知作者"}
              </p>
              <p className="mt-1 text-xs text-fg-secondary">
                {mediaTypeLabel(targetMedia.media_type)} · {formatBytes(targetMedia.file_size)}
              </p>
              <p className="mt-1 truncate text-xs text-fg-tertiary">Tweet {targetMedia.tweet_id}</p>
            </div>
          </div>
        ) : null}
        {fullySelectedGroupCount ? (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>重复组将被清空</AlertTitle>
            <AlertDescription>
              当前选择会删除 {fullySelectedGroupCount} 个重复组的全部媒体，不会保留副本。
            </AlertDescription>
          </Alert>
        ) : null}
        {error ? (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>删除失败</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
          <Button type="button" variant="destructive" disabled={pending || count === 0} onClick={onConfirm}>
            {pending ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
            {pending ? "正在删除" : targetMedia ? "永久删除此媒体" : "确认永久删除"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
