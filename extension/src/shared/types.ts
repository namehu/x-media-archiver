export type TweetRecord = {
  tweet_id: string;
  url: string;
  author_username: string;
  author_display_name: string;
  datetime: string | null;
  text: string;
  source_type: string;
  source_url: string;
  collected_at: string;
};

export type SnapshotStats = {
  source_url?: string;
  source_type?: string;
  started_at?: string | null;
  finished_at?: string | null;
  scroll_count?: number;
  seen_article_count?: number;
  unique_tweet_count?: number;
  duplicate_count?: number;
  empty_rounds?: number;
  auto_running?: boolean;
};

export type Snapshot = {
  tweets: TweetRecord[];
  stats: SnapshotStats;
};

export type MessageType = "SCAN" | "START_AUTO" | "STOP_AUTO" | "CLEAR" | "GET_STATE";
