import { Virtuoso } from "react-virtuoso";
import type { SourceDiscoveryPageResponse } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { formatDateTime } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { formatDiscoveredMedia } from "../utils";

const PAGE_SIZE = 50;

export function SourceTweetsTab({
  data,
  isLoading,
  error,
  offset,
  onOffsetChange,
  statusLabel,
}: {
  data?: SourceDiscoveryPageResponse;
  isLoading: boolean;
  error: unknown;
  offset: number;
  onOffsetChange: (offset: number) => void;
  statusLabel: (status?: string | null) => string;
}) {
  const { t } = useI18n();
  const tweets = data?.rows ?? [];

  if (isLoading) {
    return <p className="py-4 text-sm text-fg-secondary">{t("common.loading")}</p>;
  }

  if (error) {
    return <p className="py-4 text-sm text-danger">{String(error)}</p>;
  }

  if (tweets.length === 0) {
    return <p className="py-4 text-sm text-fg-secondary">{t("sources.noDiscovered")}</p>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {data ? (
        <Pagination
          offset={offset}
          count={data.count}
          totalCount={data.total_count}
          pageSize={PAGE_SIZE}
          onOffsetChange={onOffsetChange}
          label={t("common.pagination.range")}
        />
      ) : null}
      <Virtuoso
        className="min-h-0 flex-1"
        style={{ height: "100%" }}
        data={tweets}
        itemContent={(_, tweet) => (
          <div className="pb-2">
            <div className="rounded-lg border border-border-subtle bg-bg-surface p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="whitespace-pre-wrap break-words text-sm leading-6 text-fg-primary">
                    {tweet.text || t("tweet.noText")}
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-fg-secondary">
                    {formatDiscoveredMedia(tweet.raw_payload, t)}
                  </div>
                  <div className="flex flex-wrap gap-x-2 gap-y-1 text-xs text-fg-secondary">
                    <span>{tweet.tweet_id}</span>
                    <span>{formatDateTime(tweet.discovered_at)}</span>
                    <span>{tweet.archive_run_id ? `Run #${tweet.archive_run_id}` : t("sources.notQueued")}</span>
                  </div>
                </div>
                <div className="shrink-0 whitespace-nowrap text-center">
                  <Badge>{statusLabel(tweet.download_status)}</Badge>
                </div>
              </div>
            </div>
          </div>
        )}
      />
    </div>
  );
}
