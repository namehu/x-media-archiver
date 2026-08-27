import { RotateCcw, Search } from "lucide-react";
import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import type { FailureCategory } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

export type FailureDisposition = "open" | "ignored" | "all";
export type FailureSort = "recent" | "oldest" | "retries";

type FailureFiltersProps = {
  disposition: FailureDisposition;
  status: string;
  errorCategory: string;
  search: string;
  sort: FailureSort;
  openCount: number;
  ignoredCount: number;
  categories: FailureCategory[];
  onDispositionChange: (value: FailureDisposition) => void;
  onFilterChange: (key: "status" | "error_category" | "sort" | "search", value: string) => void;
  onReset: () => void;
};

export function FailureFilters({
  disposition,
  status,
  errorCategory,
  search,
  sort,
  openCount,
  ignoredCount,
  categories,
  onDispositionChange,
  onFilterChange,
  onReset,
}: FailureFiltersProps) {
  const [searchValue, setSearchValue] = useState(search);

  useEffect(() => setSearchValue(search), [search]);

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onFilterChange("search", searchValue.trim());
  };

  const hasFilters = disposition !== "open" || status || errorCategory || search || sort !== "recent";

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border-subtle bg-bg-elevated p-4">
      <ToggleGroup
        type="single"
        value={disposition}
        variant="outline"
        className="w-fit justify-start"
        aria-label="失败处置状态"
        onValueChange={(value) => value && onDispositionChange(value as FailureDisposition)}
      >
        <ToggleGroupItem value="open" aria-label="待处理">
          待处理 <span className="tabular-nums">{openCount}</span>
        </ToggleGroupItem>
        <ToggleGroupItem value="ignored" aria-label="已忽略">
          已忽略 <span className="tabular-nums">{ignoredCount}</span>
        </ToggleGroupItem>
        <ToggleGroupItem value="all" aria-label="全部失败项">
          全部
        </ToggleGroupItem>
      </ToggleGroup>

      <form onSubmit={submitSearch}>
        <FieldGroup className="gap-3 lg:grid lg:grid-cols-[minmax(220px,1fr)_180px_200px_160px_auto] lg:items-end">
          <Field className="gap-1.5">
            <FieldLabel htmlFor="failure-search">搜索</FieldLabel>
            <Input
              id="failure-search"
              value={searchValue}
              placeholder="Tweet ID、作者或错误信息"
              onChange={(event) => setSearchValue(event.target.value)}
            />
          </Field>
          <Field className="gap-1.5">
            <FieldLabel htmlFor="failure-status">失败状态</FieldLabel>
            <Select id="failure-status" value={status} onChange={(event) => onFilterChange("status", event.target.value)}>
              <option value="">全部状态</option>
              <option value="failed_retryable">可重试失败</option>
              <option value="failed_permanent">永久失败</option>
              <option value="corrupt">文件损坏</option>
            </Select>
          </Field>
          <Field className="gap-1.5">
            <FieldLabel htmlFor="failure-category">错误分类</FieldLabel>
            <Select
              id="failure-category"
              value={errorCategory}
              onChange={(event) => onFilterChange("error_category", event.target.value)}
            >
              <option value="">全部分类</option>
              {categories.map((category) => (
                <option key={category.error_category} value={category.error_category}>
                  {category.error_category}（{category.count}）
                </option>
              ))}
            </Select>
          </Field>
          <Field className="gap-1.5">
            <FieldLabel htmlFor="failure-sort">排序</FieldLabel>
            <Select id="failure-sort" value={sort} onChange={(event) => onFilterChange("sort", event.target.value)}>
              <option value="recent">最近失败</option>
              <option value="oldest">最早失败</option>
              <option value="retries">重试次数</option>
            </Select>
          </Field>
          <div className="flex gap-2">
            <Button type="submit" variant="outline">
              <Search data-icon="inline-start" />
              搜索
            </Button>
            <Button type="button" variant="ghost" disabled={!hasFilters} onClick={onReset}>
              <RotateCcw data-icon="inline-start" />
              重置
            </Button>
          </div>
        </FieldGroup>
      </form>
    </div>
  );
}
