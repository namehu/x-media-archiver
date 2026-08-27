import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { sourceTypeLabel } from "@/lib/formatters";
import {
  SOURCE_TYPES,
  type SourceDeletedFilter,
  type SourceOperationalFilter,
  type SourceSortBy,
} from "../utils";

const ALL_TYPE_VALUE = "__all_type__";
const ALL_OPERATION_VALUE = "__all_operation__";

const SOURCE_DELETED_LABELS: Record<SourceDeletedFilter, string> = {
  active: "正常来源",
  deleted: "已删除来源",
  all: "全部来源",
};

const SOURCE_SORT_OPTIONS: Array<{
  value: `${SourceSortBy}:${"asc" | "desc"}`;
  label: string;
}> = [
  { value: "manual_order:desc", label: "手动排序（默认）" },
  { value: "latest_tweet_published_at:desc", label: "最新 Tweet 时间" },
  { value: "last_success_at:desc", label: "最近成功同步" },
  { value: "unsubmitted_tweet_count:desc", label: "未提交下载数量" },
  { value: "schedule_next_run_at:asc", label: "下次执行时间" },
  { value: "updated_at:desc", label: "最近更新（从新到旧）" },
  { value: "updated_at:asc", label: "最近更新（从旧到新）" },
  { value: "created_at:desc", label: "创建时间（从新到旧）" },
  { value: "created_at:asc", label: "创建时间（从旧到新）" },
];

export function SourceFilterSheet({
  typeFilter,
  deletedFilter,
  operationalFilter,
  sortBy,
  sortDirection,
  onTypeFilterChange,
  onDeletedFilterChange,
  onOperationalFilterChange,
  onSortChange,
}: {
  typeFilter: string;
  deletedFilter: SourceDeletedFilter;
  operationalFilter: SourceOperationalFilter;
  sortBy: SourceSortBy;
  sortDirection: "asc" | "desc";
  onTypeFilterChange: (value: string) => void;
  onDeletedFilterChange: (value: SourceDeletedFilter) => void;
  onOperationalFilterChange: (value: SourceOperationalFilter) => void;
  onSortChange: (sortBy: SourceSortBy, sortDirection: "asc" | "desc") => void;
}) {
  const activeFilterCount = Number(Boolean(typeFilter)) + Number(deletedFilter !== "active") + Number(Boolean(operationalFilter));
  const hasCustomSort = sortBy !== "manual_order" || sortDirection !== "desc";

  const reset = () => {
    onTypeFilterChange("");
    onDeletedFilterChange("active");
    onOperationalFilterChange("");
    onSortChange("manual_order", "desc");
  };

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" aria-label={`筛选与排序${activeFilterCount ? `，已启用 ${activeFilterCount} 项筛选` : ""}`}>
          <SlidersHorizontal data-icon="inline-start" aria-hidden="true" />
          筛选与排序
          {activeFilterCount ? <Badge tone="default">{activeFilterCount}</Badge> : null}
        </Button>
      </SheetTrigger>
      <SheetContent className="overflow-y-auto">
        <SheetHeader>
          <SheetTitle>筛选与排序</SheetTitle>
          <SheetDescription>只保留需要关注的来源，列表会在条件变化后自动刷新。</SheetDescription>
        </SheetHeader>

        <FieldGroup className="gap-5">
          <Field>
            <FieldLabel htmlFor="source-type-filter">来源类型</FieldLabel>
            <Select
              value={typeFilter || ALL_TYPE_VALUE}
              onValueChange={(value) => onTypeFilterChange(value === ALL_TYPE_VALUE ? "" : value)}
            >
              <SelectTrigger id="source-type-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={ALL_TYPE_VALUE}>全部来源类型</SelectItem>
                  {SOURCE_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {sourceTypeLabel(type)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="source-operation-filter">运行状态</FieldLabel>
            <Select
              value={operationalFilter || ALL_OPERATION_VALUE}
              onValueChange={(value) => onOperationalFilterChange(value === ALL_OPERATION_VALUE ? "" : value as SourceOperationalFilter)}
            >
              <SelectTrigger id="source-operation-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={ALL_OPERATION_VALUE}>全部运行状态</SelectItem>
                  <SelectItem value="due">待更新</SelectItem>
                  <SelectItem value="waiting_download">待下载</SelectItem>
                  <SelectItem value="running">执行中</SelectItem>
                  <SelectItem value="error">异常</SelectItem>
                  <SelectItem value="scheduled">已启用定时</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="source-deleted-filter">列表范围</FieldLabel>
            <Select
              value={deletedFilter}
              onValueChange={(value) => {
                if (value === "active" || value === "deleted" || value === "all") onDeletedFilterChange(value);
              }}
            >
              <SelectTrigger id="source-deleted-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {Object.entries(SOURCE_DELETED_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          <Field>
            <FieldLabel htmlFor="source-sort">排序方式</FieldLabel>
            <Select
              value={`${sortBy}:${sortDirection}`}
              onValueChange={(value) => {
                const option = SOURCE_SORT_OPTIONS.find((item) => item.value === value);
                if (!option) return;
                const [nextSortBy, nextSortDirection] = option.value.split(":") as [SourceSortBy, "asc" | "desc"];
                onSortChange(nextSortBy, nextSortDirection);
              }}
            >
              <SelectTrigger id="source-sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {SOURCE_SORT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </FieldGroup>

        <div className="mt-8 border-t border-border-subtle pt-4">
          <Button
            type="button"
            variant="ghost"
            disabled={!activeFilterCount && !hasCustomSort}
            onClick={reset}
          >
            <RotateCcw data-icon="inline-start" aria-hidden="true" />
            恢复默认条件
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
