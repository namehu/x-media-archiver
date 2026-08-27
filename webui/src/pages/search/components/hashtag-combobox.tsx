import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, LoaderCircle, RotateCcw, X } from "lucide-react";
import {
  apiGet,
  mediaQueryString,
  type TweetHashtagOption,
  type TweetHashtagOptionsResponse,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getPrivacyRedactProps, usePrivacyRedactionEnabled } from "@/lib/privacy-redaction";
import { cn } from "@/lib/utils";

const HASHTAG_OPTION_LIMIT = 20;

export function HashtagCombobox({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const privacyRedactionEnabled = usePrivacyRedactionEnabled();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedOption, setSelectedOption] = useState<TweetHashtagOption | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    if (!value || selectedOption?.name !== value) setSelectedOption(null);
  }, [selectedOption?.name, value]);

  const hashtagsQuery = useQuery({
    queryKey: ["tweet-hashtag-options", debouncedSearch],
    queryFn: () => {
      const query = mediaQueryString({ q: debouncedSearch, limit: String(HASHTAG_OPTION_LIMIT) });
      return apiGet<TweetHashtagOptionsResponse>(`/api/v1/library/search/hashtags?${query}`);
    },
    enabled: open,
    staleTime: 60_000,
    retry: false,
  });

  const isSearchPending = search !== debouncedSearch;
  const options = isSearchPending ? [] : (hashtagsQuery.data?.rows ?? []);
  const triggerLabel = value ? `#${selectedOption?.name ?? value.replace(/^#/, "")}` : "选择平台 Hashtag";

  return (
    <div className="flex min-w-0 gap-2">
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          setOpen(nextOpen);
          if (!nextOpen) {
            setSearch("");
            setDebouncedSearch("");
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            id={id}
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label="选择平台 Hashtag"
            className="min-w-0 flex-1 justify-between px-3"
          >
            <span
              className={cn("truncate", !value && "text-fg-tertiary")}
              {...getPrivacyRedactProps(privacyRedactionEnabled && Boolean(value))}
            >
              {triggerLabel}
            </span>
            <ChevronsUpDown data-icon="inline-end" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
          <Command shouldFilter={false}>
            <CommandInput value={search} onValueChange={setSearch} placeholder="搜索平台 Hashtag" />
            <CommandList>
              <CommandEmpty>
                {isSearchPending || hashtagsQuery.isFetching ? (
                  <span className="inline-flex items-center gap-2">
                    <LoaderCircle className="size-4 animate-spin" />
                    正在搜索平台 Hashtag…
                  </span>
                ) : hashtagsQuery.isError ? (
                  <span className="inline-flex flex-col items-center gap-2">
                    <span>平台 Hashtag 加载失败</span>
                    <Button type="button" variant="outline" size="sm" onClick={() => void hashtagsQuery.refetch()}>
                      <RotateCcw data-icon="inline-start" />
                      重试
                    </Button>
                  </span>
                ) : (
                  "没有匹配的平台 Hashtag"
                )}
              </CommandEmpty>
              <CommandGroup heading={search.trim() ? "搜索结果" : "常用平台 Hashtag"}>
                {options.map((option) => (
                  <CommandItem
                    key={option.normalized_name}
                    value={option.normalized_name}
                    onSelect={() => {
                      setSelectedOption(option);
                      onChange(option.name);
                      setOpen(false);
                      setSearch("");
                    }}
                  >
                    <Check
                      className={cn(
                        "size-4 shrink-0",
                        value.replace(/^#/, "").toLocaleLowerCase() === option.name.toLocaleLowerCase()
                          ? "opacity-100"
                          : "opacity-0",
                      )}
                    />
                    <span className="min-w-0 flex-1" {...getPrivacyRedactProps(privacyRedactionEnabled)}>
                      <span className="block truncate font-medium">#{option.name}</span>
                      <span className="block truncate text-xs text-fg-secondary">
                        {option.tweet_count.toLocaleString()} 条 Tweet
                      </span>
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value ? (
        <Button type="button" variant="outline" size="icon" aria-label="清除平台 Hashtag" onClick={() => onChange("")}>
          <X />
        </Button>
      ) : null}
    </div>
  );
}
