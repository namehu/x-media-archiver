import { useId } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Field, FieldGroup, FieldLabel } from "../../../components/ui/field";
import { Input } from "../../../components/ui/input";
import { Separator } from "../../../components/ui/separator";
import { AuthorCombobox } from "../../../components/author-combobox";

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
    <Card className="lg:sticky lg:top-4">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <SlidersHorizontal className="h-4 w-4 text-brand" />
            筛选
          </CardTitle>
          <Badge tone={activeCount ? "default" : "secondary"}>{activeCount ? `${activeCount} 项` : "默认"}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            onApply();
          }}
        >
          <FieldGroup className="gap-4">
            <Field className="gap-2">
              <FieldLabel htmlFor={`${fieldId}-author`} className="text-xs text-fg-secondary">
                作者
              </FieldLabel>
              <AuthorCombobox
                id={`${fieldId}-author`}
                value={filters.author}
                onChange={(author) => onFiltersChange({ ...filters, author })}
              />
            </Field>

            <Field className="gap-2">
              <FieldLabel htmlFor={`${fieldId}-text`} className="text-xs text-fg-secondary">
                Tweet 文本
              </FieldLabel>
              <Input
                id={`${fieldId}-text`}
                placeholder="关键词"
                value={filters.text}
                onChange={(event) => onFiltersChange({ ...filters, text: event.target.value })}
              />
            </Field>

            <Separator />

            <Field className="gap-2">
              <FieldLabel htmlFor={`${fieldId}-media-status`} className="text-xs text-fg-secondary">
                文件状态
              </FieldLabel>
              <select
                id={`${fieldId}-media-status`}
                className="h-9 w-full rounded-md border border-border-strong bg-bg-elevated px-3 text-sm text-fg-primary outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                value={filters.media_status}
                onChange={(event) => onFiltersChange({ ...filters, media_status: event.target.value })}
              >
                <option value="verified">已校验</option>
                <option value="all">全部状态</option>
                <option value="downloaded">已下载</option>
                <option value="missing">文件缺失</option>
                <option value="corrupt">文件损坏</option>
              </select>
            </Field>

            <Field className="gap-2">
              <FieldLabel htmlFor={`${fieldId}-media-type`} className="text-xs text-fg-secondary">
                媒体类型
              </FieldLabel>
              <select
                id={`${fieldId}-media-type`}
                className="h-9 w-full rounded-md border border-border-strong bg-bg-elevated px-3 text-sm text-fg-primary outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
                value={filters.media_type}
                onChange={(event) => onFiltersChange({ ...filters, media_type: event.target.value })}
              >
                <option value="">全部媒体</option>
                <option value="photo">图片</option>
                <option value="video">视频</option>
              </select>
            </Field>

            <div className="grid grid-cols-[1fr_auto] gap-2 pt-1">
              <Button type="submit">
                <Search className="h-4 w-4" />
                应用筛选
              </Button>
              <Button type="button" variant="outline" size="icon" aria-label="重置筛选" onClick={onReset}>
                <X className="h-4 w-4" />
              </Button>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
