export type SearchFilters = {
  q: string;
  source_id: string;
  date_from: string;
  date_to: string;
  media_type: string;
  tweet_status: string;
  tag_id: string;
  collection_id: string;
  sort: string;
};

export const DEFAULT_SEARCH_FILTERS: SearchFilters = {
  q: "",
  source_id: "",
  date_from: "",
  date_to: "",
  media_type: "",
  tweet_status: "verified",
  tag_id: "",
  collection_id: "",
  sort: "auto",
};

export const SEARCH_FILTER_KEYS = Object.keys(DEFAULT_SEARCH_FILTERS) as Array<keyof SearchFilters>;

export function readSearchFilters(params: URLSearchParams): SearchFilters {
  return {
    q: params.get("q") ?? "",
    source_id: params.get("source_id") ?? "",
    date_from: params.get("date_from") ?? "",
    date_to: params.get("date_to") ?? "",
    media_type: params.get("media_type") ?? "",
    tweet_status: params.get("tweet_status") ?? "verified",
    tag_id: params.get("tag_id") ?? "",
    collection_id: params.get("collection_id") ?? "",
    sort: params.get("sort") ?? "auto",
  };
}

export function countSearchFilters(filters: SearchFilters) {
  return [
    filters.q,
    filters.source_id,
    filters.date_from || filters.date_to,
    filters.media_type,
    filters.tweet_status !== "verified" ? filters.tweet_status : "",
    filters.tag_id,
    filters.collection_id,
    filters.sort !== "auto" ? filters.sort : "",
  ].filter(Boolean).length;
}
