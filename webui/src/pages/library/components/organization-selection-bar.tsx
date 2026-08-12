import { Tags, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export function OrganizationSelectionBar({ count, onClear, onOrganize }: { count: number; onClear: () => void; onOrganize: () => void }) {
  if (!count) return null;
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-30 flex justify-center">
      <div className="pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-2 rounded-xl border border-border-strong bg-bg-elevated/95 p-2 shadow-3 backdrop-blur">
        <Badge tone="default">已选 {count} 条 Tweet</Badge>
        <span className="text-xs text-fg-secondary">同一 Tweet 的多个媒体只计一次 · 单次最多 200 条</span>
        <Button type="button" size="sm" onClick={onOrganize}><Tags data-icon="inline-start" />批量整理</Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClear}><X data-icon="inline-start" />取消</Button>
      </div>
    </div>
  );
}
