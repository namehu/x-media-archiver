import { useI18n } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { Button } from "./Button";

type PaginationBarProps = {
  offset: number;
  count: number;
  totalCount: number;
  pageSize: number;
  onOffsetChange: (offset: number) => void;
  className?: string;
};

export function PaginationBar({
  offset,
  count,
  totalCount,
  pageSize,
  onOffsetChange,
  className,
}: PaginationBarProps) {
  const { t } = useI18n();
  const start = totalCount === 0 ? 0 : offset + 1;
  const end = Math.min(offset + count, totalCount);
  const canGoPrevious = offset > 0;
  const canGoNext = offset + count < totalCount;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-white px-4 py-3 text-sm text-muted-foreground",
        className,
      )}
    >
      <span className="min-w-0">
        {t("common.pagination.range", { start, end, total: totalCount })}
      </span>
      <div className="flex shrink-0 gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => onOffsetChange(Math.max(0, offset - pageSize))}
          disabled={!canGoPrevious}
        >
          {t("common.pagination.previous")}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => onOffsetChange(offset + pageSize)}
          disabled={!canGoNext}
        >
          {t("common.pagination.next")}
        </Button>
      </div>
    </div>
  );
}
