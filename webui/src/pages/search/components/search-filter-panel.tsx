import { useId } from "react";
import { RotateCcw, Search, SlidersHorizontal } from "lucide-react";
import type {
  ArchiveSourceListItem,
  TweetSearchCollectionOption,
  TweetSearchTagOption,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { getDebugRedactProps, useDebugRedactionEnabled } from "@/lib/debug-redaction";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SearchFilters } from "../search-state";
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
  activeCount,
  sourcesTruncated = false,
  onFiltersChange,
  onApply,
  onReset,
}: {
  filters: SearchFilters;
  sources: ArchiveSourceListItem[];
  tags: TweetSearchTagOption[];
  collections: TweetSearchCollectionOption[];
  activeCount: number;
  sourcesTruncated?: boolean;
  onFiltersChange: (filters: SearchFilters) => void;
  onApply: () => void;
  onReset: () => void;
}) {
  const fieldId = useId();
  const debugRedactionEnabled = useDebugRedactionEnabled();

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <SlidersHorizontal data-icon="inline-start" />
            搜索条件
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
            <Field className="gap-2" {...getDebugRedactProps(debugRedactionEnabled)}>
              <FieldLabel htmlFor={`${fieldId}-query`}>关键词</FieldLabel>
              <Input
                id={`${fieldId}-query`}
                value={filters.q}
                placeholder="正文、作者、Hashtag、自定义标签、合集或备注"
                autoComplete="off"
                onChange={(event) => onFiltersChange({ ...filters, q: event.target.value })}
              />
            </Field>

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

            <Field className="gap-2">
              <FieldLabel htmlFor={`${fieldId}-hashtag`}>平台 Hashtag</FieldLabel>
              <HashtagCombobox
                id={`${fieldId}-hashtag`}
                value={filters.hashtag}
                onChange={(value) => onFiltersChange({ ...filters, hashtag: value })}
              />
              <p className="text-xs text-fg-tertiary">只读平台事实，按单个 Hashtag 精确筛选。</p>
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

            <Field className="gap-2">
              <FieldLabel htmlFor={`${fieldId}-sort`}>排序</FieldLabel>
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

            <div className="grid grid-cols-[1fr_auto] gap-2 pt-1">
              <Button type="submit">
                <Search data-icon="inline-start" />
                搜索
              </Button>
              <Button type="button" variant="outline" size="icon" aria-label="重置搜索条件" onClick={onReset}>
                <RotateCcw />
              </Button>
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}
