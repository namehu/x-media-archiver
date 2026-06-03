import { Virtuoso } from "react-virtuoso";
import type { ArchiveSourceDetail, SourceDiscoveryPageResponse } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { formatDateTime } from "@/lib/utils";
import { useI18n } from "@/lib/i18n";
import { formatDiscoveredMedia } from "../utils";

const PAGE_SIZE = 50;

export function SourceTweetsTab({
  source,
  data,
  isLoading,
  error,
  offset,
  onOffsetChange,
  statusLabel,
}: {
  source: ArchiveSourceDetail;
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
    <div className="flex h-[calc(100vh-390px)] min-h-[300px] flex-col gap-3">
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
        data={tweets}
        itemContent={(_, tweet) => (
          <div className="pb-2">
            <div className="rounded-lg border border-border-subtle bg-bg-surface p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="text-xs text-fg-secondary">
                    @{tweet.author_username || source.author_username || "-"} · {tweet.tweet_id}
                  </div>
                  <div className="whitespace-pre-wrap break-words text-sm leading-6 text-fg-primary">
                    {tweet.text || t("tweet.noText")}
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs text-fg-secondary">
                    {formatDiscoveredMedia(tweet.raw_payload, t)}
                  </div>
                </div>
                <Badge>{statusLabel(tweet.download_status)}</Badge>
              </div>
              <div className="mt-1 text-xs text-fg-secondary">
                {formatDateTime(tweet.discovered_at)} ·{" "}
                {tweet.archive_run_id ? `Run #${tweet.archive_run_id}` : t("sources.notQueued")}
              </div>
            </div>
          </div>
        )}
      />
    </div>
  );
}
