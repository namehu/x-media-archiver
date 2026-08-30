import type { FeedFilters, FeedSort } from "./components/feed-filter-panel";

const FEED_QUERY_KEYS: Array<keyof FeedFilters> = [
  "source_id",
  "source_type",
  "author",
  "text",
  "media_type",
  "sort",
  "seed",
];

export function readFeedFilters(params: URLSearchParams): FeedFilters {
  const sort = parseFeedSort(params.get("sort"));
  return {
    source_id: params.get("source_id") ?? "",
    source_type: params.get("source_type") ?? "",
    author: params.get("author") ?? "",
    text: params.get("text") ?? "",
    media_type: params.get("media_type") ?? "",
    sort,
    seed: params.get("seed") ?? "",
  };
}

export function writeFeedFilters(current: URLSearchParams, filters: FeedFilters) {
  const next = new URLSearchParams(current);
  for (const key of FEED_QUERY_KEYS) next.delete(key);

  if (filters.source_id) next.set("source_id", filters.source_id);
  if (filters.source_type) next.set("source_type", filters.source_type);
  if (filters.author.trim()) next.set("author", filters.author.trim());
  if (filters.text.trim()) next.set("text", filters.text.trim());
  if (filters.media_type) next.set("media_type", filters.media_type);
  if (filters.sort !== "newest") next.set("sort", filters.sort);
  if (filters.seed) next.set("seed", filters.seed);
  return next;
}

export function ensureRandomSeed(filters: FeedFilters) {
  // random 模式需要显式 seed，既用于服务端稳定排序，也用于前端列表和预览状态的 URL 持久化。
  if (filters.sort !== "random" || filters.seed) return filters;
  return { ...filters, seed: crypto.randomUUID() };
}

export function sameFeedFilters(left: FeedFilters, right: FeedFilters) {
  return FEED_QUERY_KEYS.every((key) => left[key] === right[key]);
}

function parseFeedSort(value: string | null): FeedSort {
  return value === "random" ? "random" : "newest";
}
