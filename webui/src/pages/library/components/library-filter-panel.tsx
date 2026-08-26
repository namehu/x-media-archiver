import { useId } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { AuthorCombobox } from "@/components/author-combobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

export type LibraryFilters = {
  author: string;
  text: string;
  media_status: string;
  media_type: string;
};

export const DEFAULT_LIBRARY_FILTERS: LibraryFilters = {
  author: "",
  text: "",
  media_status: "verified",
  media_type: "",
};

type LibraryFilterPanelProps = {
  filters: LibraryFilters;
  activeCount: number;
  onFiltersChange: (filters: LibraryFilters) => void;
  onApply: () => void;
  onReset: () => void;
};

export function LibraryFilterPanel({ filters, activeCount, onFiltersChange, onApply, onReset }: LibraryFilterPanelProps) {
  const fieldId = useId();

  return (
    <form
      className="flex min-h-0 flex-1 flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        onApply();
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-fg-primary">
          <SlidersHorizontal className="size-5" aria-hidden="true" />
          筛选条件
        </div>
        <Badge tone={activeCount ? "default" : "secondary"}>
          {activeCount ? `${activeCount} 项` : "默认"}
        </Badge>
      </div>

      <FieldGroup className="gap-5">
        <Field className="gap-2">
          <FieldLabel htmlFor={`${fieldId}-author`}>作者</FieldLabel>
          <AuthorCombobox
            id={`${fieldId}-author`}
            value={filters.author}
            onChange={(author) => onFiltersChange({ ...filters, author })}
          />
        </Field>

        <Field className="gap-2">
          <FieldLabel htmlFor={`${fieldId}-text`}>Tweet 文本</FieldLabel>
          <Input
            id={`${fieldId}-text`}
            className="text-base sm:text-sm"
            placeholder="搜索正文关键词"
            value={filters.text}
            onChange={(event) => onFiltersChange({ ...filters, text: event.target.value })}
          />
        </Field>

        <Separator />

        <Field className="gap-2">
          <FieldLabel htmlFor={`${fieldId}-media-status`}>文件状态</FieldLabel>
          <Select
            value={filters.media_status}
            onValueChange={(mediaStatus) => onFiltersChange({ ...filters, media_status: mediaStatus })}
          >
            <SelectTrigger id={`${fieldId}-media-status`}>
              <SelectValue placeholder="选择文件状态" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="verified">已校验</SelectItem>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="downloaded">已下载</SelectItem>
                <SelectItem value="missing">文件缺失</SelectItem>
                <SelectItem value="corrupt">文件损坏</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>

        <Field className="gap-2">
          <FieldLabel htmlFor={`${fieldId}-media-type`}>媒体类型</FieldLabel>
          <Select
            value={filters.media_type || "all"}
            onValueChange={(mediaType) =>
              onFiltersChange({ ...filters, media_type: mediaType === "all" ? "" : mediaType })
            }
          >
            <SelectTrigger id={`${fieldId}-media-type`}>
              <SelectValue placeholder="全部媒体" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">全部媒体</SelectItem>
                <SelectItem value="photo">图片</SelectItem>
                <SelectItem value="video">视频</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
      </FieldGroup>

      <div className="mt-auto grid grid-cols-[1fr_auto] gap-2 border-t border-border-subtle pt-4">
        <Button type="submit">
          <Search data-icon="inline-start" />
          查看结果
        </Button>
        <Button type="button" variant="outline" aria-label="重置筛选" onClick={onReset}>
          <X data-icon="inline-start" />
          重置
        </Button>
      </div>
    </form>
  );
}
