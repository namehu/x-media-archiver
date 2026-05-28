import { useState } from "react";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { Input } from "./Input";

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmText?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmText,
  confirmLabel = "确认",
  cancelLabel = "取消",
  destructive = false,
}: ConfirmDialogProps) {
  const [inputValue, setInputValue] = useState("");
  const isConfirmable = !confirmText || inputValue === confirmText;

  const handleConfirm = () => {
    onConfirm();
    onClose();
    setInputValue("");
  };

  const handleClose = () => {
    onClose();
    setInputValue("");
  };

  return (
    <Dialog open={open} onClose={handleClose} title={title}>
      {description && <p className="mb-4 text-sm text-muted-foreground">{description}</p>}
      {confirmText && (
        <div className="mb-4">
          <p className="mb-2 text-sm text-muted-foreground">
            请输入{" "}
            <code className="rounded bg-muted px-1 font-mono text-xs">{confirmText}</code>{" "}
            以确认
          </p>
          <Input
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={confirmText}
          />
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={handleClose}>
          {cancelLabel}
        </Button>
        <Button
          className={destructive ? "bg-destructive text-white hover:bg-destructive/90" : ""}
          disabled={!isConfirmable}
          onClick={handleConfirm}
        >
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
