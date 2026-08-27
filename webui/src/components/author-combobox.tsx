import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, LoaderCircle, X } from "lucide-react";
import { apiGet, mediaQueryString, type AuthorOption, type AuthorOptionsResponse } from "@/lib/api";
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

type AuthorComboboxProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
};

export function AuthorCombobox({ id, value, onChange }: AuthorComboboxProps) {
  const privacyRedactionEnabled = usePrivacyRedactionEnabled();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedOption, setSelectedOption] = useState<AuthorOption | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timeout);
  }, [search]);

  useEffect(() => {
    if (!value || selectedOption?.author_username !== value) setSelectedOption(null);
  }, [selectedOption?.author_username, value]);

  const authorsQuery = useQuery({
    queryKey: ["library-authors", debouncedSearch],
    queryFn: () => {
      const query = mediaQueryString({ q: debouncedSearch, limit: "20" });
      return apiGet<AuthorOptionsResponse>(`/api/v1/library/authors?${query}`);
    },
    enabled: open,
    staleTime: 60_000,
  });

  const isSearchPending = search !== debouncedSearch;
  const options = isSearchPending ? [] : (authorsQuery.data?.rows ?? []);
  const triggerLabel = selectedOption?.author_display_name
    ? `${selectedOption.author_display_name} · @${selectedOption.author_username}`
    : value
      ? `@${value}`
      : "选择作者";

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
            aria-label="选择作者"
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
            <CommandInput value={search} onValueChange={setSearch} placeholder="搜索用户名或显示名" />
            <CommandList>
              <CommandEmpty>
                {isSearchPending || authorsQuery.isFetching ? (
                  <span className="inline-flex items-center gap-2">
                    <LoaderCircle className="size-4 animate-spin" />
                    正在搜索作者…
                  </span>
                ) : authorsQuery.isError ? (
                  "作者列表加载失败"
                ) : (
                  "没有匹配的作者"
                )}
              </CommandEmpty>
              <CommandGroup heading={search.trim() ? "搜索结果" : "常用作者"}>
                {options.map((option) => (
                  <CommandItem
                    key={option.author_username.toLowerCase()}
                    value={option.author_username}
                    onSelect={() => {
                      setSelectedOption(option);
                      onChange(option.author_username);
                      setOpen(false);
                      setSearch("");
                    }}
                  >
                    <Check
                      className={cn(
                        "size-4 shrink-0",
                        value.toLowerCase() === option.author_username.toLowerCase()
                          ? "opacity-100"
                          : "opacity-0",
                      )}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium" {...getPrivacyRedactProps(privacyRedactionEnabled)}>
                        {option.author_display_name || `@${option.author_username}`}
                      </span>
                      <span className="block truncate text-xs text-fg-secondary" {...getPrivacyRedactProps(privacyRedactionEnabled)}>
                        @{option.author_username} · {option.media_count.toLocaleString()} 项媒体
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
        <Button type="button" variant="outline" size="icon" aria-label="清除作者" onClick={() => onChange("")}>
          <X data-icon="inline-start" />
        </Button>
      ) : null}
    </div>
  );
}
