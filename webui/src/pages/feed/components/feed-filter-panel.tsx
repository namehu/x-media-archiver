import { useId } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import type { ArchiveSourceListItem } from "@/lib/api";
import { AuthorCombobox } from "@/components/author-combobox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type FeedFilters = {
  source_id: string;
  source_type: string;
  author: string;
  text: string;
  media_type: string;
};

export const DEFAULT_FEED_FILTERS: FeedFilters = {
  source_id: "",
  source_type: "",
  author: "",
  text: "",
  media_type: "",
};

export function FeedFilterPanel({
  filters,
  sources,
  activeCount,
  onFiltersChange,
  onApply,
  onReset,
}: {
  filters: FeedFilters;
  sources: ArchiveSourceListItem[];
  activeCount: number;
  onFiltersChange: (filters: FeedFilters) => void;
  onApply: () => void;
  onReset: () => void;
}) {
  const fieldId = useId();

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <SlidersHorizontal data-icon="inline-start" />
            筛选帖子
          </CardTitle>
          <Badge tone={activeCount ? "default" : "secondary"}>{activeCount ? `${activeCount} 项` : "默认"}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onApply();
          }}
        >
          <FieldGroup className="gap-4">
            <Field className="gap-2">
              <FieldLabel htmlFor={`${fieldId}-source`}>来源</FieldLabel>
              <Select
                value={filters.source_id || "all"}
                onValueChange={(sourceId) =>
                  onFiltersChange({
                    ...filters,
                    source_id: sourceId === "all" ? "" : sourceId,
                    source_type: "",
                  })
                }
              >
                <SelectTrigger id={`${fieldId}-source`}>
                  <SelectValue placeholder="全部来源" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">全部来源</SelectItem>
                    {sources.map((source) => (
                      <SelectItem key={source.id} value={String(source.id)}>
                        {source.label || source.author_username || `来源 #${source.id}`}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>

            <Field className="gap-2">
              <FieldLabel htmlFor={`${fieldId}-author`}>作者</FieldLabel>
              <AuthorCombobox
                id={`${fieldId}-author`}
                value={filters.author}
                onChange={(author) => onFiltersChange({ ...filters, author })}
              />
            </Field>

            <Field className="gap-2">
              <FieldLabel htmlFor={`${fieldId}-text`}>帖子文本</FieldLabel>
              <Input
                id={`${fieldId}-text`}
                value={filters.text}
                placeholder="搜索正文关键词"
                onChange={(event) => onFiltersChange({ ...filters, text: event.target.value })}
              />
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

            <div className="grid grid-cols-[1fr_auto] gap-2 pt-1">
              <Button type="submit">
                <Search data-icon="inline-start" />
                应用筛选
              </Button>
              <Button type="button" variant="outline" size="icon" aria-label="重置筛选" onClick={onReset}>
                <X />
              </Button>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
