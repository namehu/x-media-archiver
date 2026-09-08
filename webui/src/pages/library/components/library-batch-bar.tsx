import { Loader2, Tags, Trash2, X } from "lucide-react";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { formatBytes } from "../../../lib/utils";
import type { LibrarySelectionMode } from "../library-view-state";

export function LibraryBatchBar({
  mode,
  count,
  estimatedBytes,
  pending,
  onCancel,
  onOrganize,
  onDelete,
}: {
  mode: LibrarySelectionMode;
  count: number;
  estimatedBytes: number;
  pending: boolean;
  onCancel: () => void;
  onOrganize: () => void;
  onDelete: () => void;
}) {
  const isOrganizing = mode === "organize";

  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-30 flex justify-center">
      <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-2 rounded-xl border border-border-strong bg-bg-elevated/95 p-2 shadow-3 backdrop-blur">
        <Badge tone={count ? "default" : "secondary"}>
          已选 {count} {isOrganizing ? "条 Tweet" : "项媒体"}
        </Badge>
        <span className="text-xs text-fg-secondary">
          {isOrganizing
            ? "同一 Tweet 的多个媒体只计一次 · 单次最多 200 条"
            : `主媒体约 ${formatBytes(estimatedBytes)} · 单次最多 200 项`}
        </span>
        <Button
          type="button"
          variant={isOrganizing ? "default" : "destructive"}
          size="sm"
          disabled={!count || pending}
          aria-keyshortcuts={isOrganizing ? undefined : "Delete"}
          title={isOrganizing ? undefined : "删除所选媒体（Del）"}
          onClick={isOrganizing ? onOrganize : onDelete}
        >
          {pending ? <Loader2 data-icon="inline-start" className="animate-spin" /> :
            isOrganizing ? <Tags data-icon="inline-start" /> : <Trash2 data-icon="inline-start" />}
          {pending ? "正在删除" : isOrganizing ? "批量整理" : "删除"}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={onCancel}>
          <X data-icon="inline-start" />
          取消
        </Button>
      </div>
    </div>
  );
}
