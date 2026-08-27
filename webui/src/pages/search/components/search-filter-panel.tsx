import { useId } from "react";
import { Check, RotateCcw } from "lucide-react";
import type {
  ArchiveSourceListItem,
  TweetSearchCollectionOption,
  TweetSearchTagOption,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { countSearchRefinements, type SearchFilters } from "../search-state";
import { HashtagCombobox } from "./hashtag-combobox";

const statusOptions = [
  ["verified", "已校验"],
  ["all", "全部状态"],
  ["pending", "待处理"],
  ["downloading", "下载中"],
  ["downloaded", "已下载"],
  ["partial", "部分完成"],
  ["failed_retryable", "可重试失败"],
  ["failed_permanent", "永久失败"],
  ["missing", "文件缺失"],
  ["corrupt", "文件损坏"],
  ["skipped", "已跳过"],
] as const;

export function SearchFilterPanel({
  filters,
  sources,
  tags,
  collections,
  sourcesTruncated = false,
  onFiltersChange,
  onApply,
  onReset,
}: {
  filters: SearchFilters;
  sources: ArchiveSourceListItem[];
  tags: TweetSearchTagOption[];
  collections: TweetSearchCollectionOption[];
  sourcesTruncated?: boolean;
  onFiltersChange: (filters: SearchFilters) => void;
  onApply: () => void;
  onReset: () => void;
}) {
  const fieldId = useId();
  const activeCount = countSearchRefinements(filters);

  return (
    <form
      className="flex flex-col gap-6 px-5 pb-5 sm:px-6 sm:pb-6"
      onSubmit={(event) => {
        event.preventDefault();
        onApply();
      }}
    >
      <FieldGroup className="gap-7">
        <FieldSet className="gap-4">
          <FieldLegend className="text-sm font-semibold text-fg-primary">内容范围</FieldLegend>
          <Field className="gap-2">
            <FieldLabel htmlFor={`${fieldId}-source`}>来源</FieldLabel>
            <Select
              value={filters.source_id || "all"}
              onValueChange={(value) => onFiltersChange({ ...filters, source_id: value === "all" ? "" : value })}
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
            {sourcesTruncated ? (
              <p className="text-xs text-fg-tertiary">仅显示前 200 个来源；可先在来源页停用或整理来源。</p>
            ) : null}
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field className="gap-2">
              <FieldLabel htmlFor={`${fieldId}-date-from`}>起始日期</FieldLabel>
              <Input
                id={`${fieldId}-date-from`}
                type="date"
                value={filters.date_from}
                onChange={(event) => onFiltersChange({ ...filters, date_from: event.target.value })}
              />
            </Field>
            <Field className="gap-2">
              <FieldLabel htmlFor={`${fieldId}-date-to`}>结束日期</FieldLabel>
              <Input
                id={`${fieldId}-date-to`}
                type="date"
                value={filters.date_to}
                onChange={(event) => onFiltersChange({ ...filters, date_to: event.target.value })}
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field className="gap-2">
              <FieldLabel htmlFor={`${fieldId}-media-type`}>媒体</FieldLabel>
              <Select
                value={filters.media_type || "all"}
                onValueChange={(value) => onFiltersChange({ ...filters, media_type: value === "all" ? "" : value })}
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
            <Field className="gap-2">
              <FieldLabel htmlFor={`${fieldId}-status`}>归档状态</FieldLabel>
              <Select
                value={filters.tweet_status}
                onValueChange={(value) => onFiltersChange({ ...filters, tweet_status: value })}
              >
                <SelectTrigger id={`${fieldId}-status`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {statusOptions.map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </div>
        </FieldSet>

        <FieldSet className="gap-4">
          <FieldLegend className="text-sm font-semibold text-fg-primary">整理信息</FieldLegend>
          <Field className="gap-2">
            <FieldLabel htmlFor={`${fieldId}-hashtag`}>平台 Hashtag</FieldLabel>
            <HashtagCombobox
              id={`${fieldId}-hashtag`}
              value={filters.hashtag}
              onChange={(value) => onFiltersChange({ ...filters, hashtag: value })}
            />
            <p className="text-xs text-fg-tertiary">一次选择一个 Hashtag 进行精确筛选。</p>
          </Field>

          <Field className="gap-2">
            <FieldLabel htmlFor={`${fieldId}-tag`}>自定义标签</FieldLabel>
            <Select
              value={filters.tag_id || "all"}
              onValueChange={(value) => onFiltersChange({ ...filters, tag_id: value === "all" ? "" : value })}
            >
              <SelectTrigger id={`${fieldId}-tag`}>
                <SelectValue placeholder="全部自定义标签" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">全部自定义标签</SelectItem>
                  {tags.map((tag) => (
                    <SelectItem key={tag.id} value={String(tag.id)}>
                      {tag.name}（{tag.tweet_count}）
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>

          <Field className="gap-2">
            <FieldLabel htmlFor={`${fieldId}-collection`}>合集</FieldLabel>
            <Select
              value={filters.collection_id || "all"}
              onValueChange={(value) =>
                onFiltersChange({ ...filters, collection_id: value === "all" ? "" : value })
              }
            >
              <SelectTrigger id={`${fieldId}-collection`}>
                <SelectValue placeholder="全部合集" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">全部合集</SelectItem>
                  {collections.map((collection) => (
                    <SelectItem key={collection.id} value={String(collection.id)}>
                      {collection.name}（{collection.tweet_count}）
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </FieldSet>

        <FieldSet className="gap-4">
          <FieldLegend className="text-sm font-semibold text-fg-primary">结果顺序</FieldLegend>
          <Field className="gap-2">
            <FieldLabel htmlFor={`${fieldId}-sort`} className="sr-only">排序</FieldLabel>
            <Select value={filters.sort} onValueChange={(value) => onFiltersChange({ ...filters, sort: value })}>
              <SelectTrigger id={`${fieldId}-sort`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="auto">智能排序</SelectItem>
                  <SelectItem value="relevance">相关度</SelectItem>
                  <SelectItem value="newest">最新发布</SelectItem>
                  <SelectItem value="oldest">最早发布</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </FieldSet>
      </FieldGroup>

      <div className="sticky bottom-0 -mx-5 flex gap-2 border-t border-border-subtle bg-bg-elevated px-5 pb-1 pt-4 sm:-mx-6 sm:px-6">
        <Button type="submit" className="flex-1">
          <Check data-icon="inline-start" />
          应用筛选
        </Button>
        <Button type="button" variant="outline" disabled={!activeCount} onClick={onReset}>
          <RotateCcw data-icon="inline-start" />
          恢复默认
        </Button>
      </div>
    </form>
  );
}
