import { AlertTriangle, Loader2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/utils";

type PostDeleteDialogProps = {
  open: boolean;
  mediaCount: number;
  estimatedBytes: number;
  pending: boolean;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
};

export function PostDeleteDialog({
  open,
  mediaCount,
  estimatedBytes,
  pending,
  error,
  onOpenChange,
  onConfirm,
}: PostDeleteDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(nextOpen) => !pending && onOpenChange(nextOpen)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>删除此帖的本地媒体？</AlertDialogTitle>
          <AlertDialogDescription className="flex flex-col gap-2">
            <span>将删除这篇帖子下的 {mediaCount} 个媒体项，主媒体约占 {formatBytes(estimatedBytes)}。</span>
            <span>对应元数据和标准缩略图也会从磁盘删除，此操作不可撤销。</span>
            <span>Tweet、来源和下载历史会保留，之后可以重新归档。</span>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>删除失败</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
          <Button type="button" variant="destructive" disabled={pending || mediaCount === 0} onClick={onConfirm}>
            {pending ? <Loader2 data-icon="inline-start" className="animate-spin" /> : null}
            {pending ? "正在删除" : "确认删除本地媒体"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
