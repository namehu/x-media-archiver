import { useEffect, useState } from "react";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type IgnoreFailureInput = {
  tweetIds: string[];
  reason: string | null;
  note: string | null;
};

export function IgnoreFailureDialog({
  tweetIds,
  pending,
  onOpenChange,
  onConfirm,
}: {
  tweetIds: string[];
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (input: IgnoreFailureInput) => void;
}) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const open = tweetIds.length > 0;

  useEffect(() => {
    if (open) {
      setReason("");
      setNote("");
    }
  }, [open, tweetIds]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>忽略失败项</DialogTitle>
          <DialogDescription>
            将忽略 {tweetIds.length} 个失败项并停止尚未执行的自动重试。失败状态与下载历史会保留。
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="failure-ignore-reason">原因（可选）</FieldLabel>
            <Select id="failure-ignore-reason" value={reason} onChange={(event) => setReason(event.target.value)}>
              <option value="">未填写</option>
              <option value="not_needed">暂不需要</option>
              <option value="unavailable">内容不可访问</option>
              <option value="unsupported">工具暂不支持</option>
              <option value="duplicate">重复内容</option>
              <option value="other">其他</option>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="failure-ignore-note">备注（可选）</FieldLabel>
            <Textarea
              id="failure-ignore-note"
              value={note}
              maxLength={500}
              placeholder="补充处置背景，最多 500 字"
              onChange={(event) => setNote(event.target.value)}
            />
            <FieldDescription className="text-right tabular-nums">{note.length}/500</FieldDescription>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() => onConfirm({ tweetIds, reason: reason || null, note: note.trim() || null })}
          >
            {pending ? "正在忽略…" : "确认忽略"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ConfirmFailureActionDialog({
  open,
  title,
  description,
  confirmLabel,
  pending,
  destructive = false,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  pending: boolean;
  destructive?: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>取消</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            className={destructive ? "bg-danger text-white hover:bg-danger/90" : undefined}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {pending ? "处理中…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
