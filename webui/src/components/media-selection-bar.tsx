import { Trash2, X } from "lucide-react";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { formatBytes } from "../lib/utils";

type MediaSelectionBarProps = {
  count: number;
  estimatedBytes: number;
  onClear: () => void;
  onDelete: () => void;
};

export function MediaSelectionBar({ count, estimatedBytes, onClear, onDelete }: MediaSelectionBarProps) {
  if (!count) return null;
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-30 flex justify-center">
      <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-2 rounded-xl border border-border-strong bg-bg-elevated/95 p-2 shadow-3 backdrop-blur">
        <Badge tone="default">已选 {count} 项</Badge>
        <span className="text-xs text-fg-secondary">主媒体约 {formatBytes(estimatedBytes)} · 单次最多 200 项</span>
        <Button type="button" variant="destructive" size="sm" onClick={onDelete}>
          <Trash2 data-icon="inline-start" />
          删除
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClear}>
          <X data-icon="inline-start" />
          取消
        </Button>
      </div>
    </div>
  );
}
