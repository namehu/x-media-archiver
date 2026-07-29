export type TweetFilters = {
  media: "all" | "video" | "photo";
  download: "all" | "pending" | "active" | "completed" | "failed";
};

export const DEFAULT_TWEET_FILTERS: TweetFilters = {
  media: "all",
  download: "all",
};

export type DownloadMediaType = "video" | "photo";

export type DownloadSubmitInput = {
  sourceId: number;
  scope: "selected" | "download_missing" | "retry_failed" | "redownload_filter";
  tweetIds?: string[];
  limit?: number;
  mediaType?: DownloadMediaType;
};
