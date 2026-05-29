import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./button";

export function Pagination({
  offset,
  count,
  totalCount,
  pageSize,
  onOffsetChange,
  label,
}: {
  offset: number;
  count: number;
  totalCount: number;
  pageSize: number;
  onOffsetChange: (offset: number) => void;
  label: string;
}) {
  const start = totalCount === 0 ? 0 : offset + 1;
  const end = Math.min(offset + count, totalCount);
  const canPrevious = offset > 0;
  const canNext = offset + count < totalCount;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-fg-secondary">
      <span>{label.replace("{start}", String(start)).replace("{end}", String(end)).replace("{total}", String(totalCount))}</span>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" disabled={!canPrevious} onClick={() => onOffsetChange(Math.max(0, offset - pageSize))} aria-label="Previous">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <Button variant="outline" size="icon" disabled={!canNext} onClick={() => onOffsetChange(offset + pageSize)} aria-label="Next">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
