import type { ArchiveSource } from "../../../lib/api";
import { Badge } from "../../../components/ui/badge";
import { formatDateTime } from "../../../lib/utils";
import { formatDiscoveredMedia, type TFunction } from "../utils";

export function SourceTweetsTab({
  source,
  t,
  statusLabel,
}: {
  source: ArchiveSource;
  t: TFunction;
  statusLabel: (status?: string | null) => string;
}) {
  const tweets = source.discovered ?? [];

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-fg-primary">{t("sources.recentDiscovered")}</h3>
      <div className="space-y-2">
        {tweets.map((tweet) => (
          <div key={tweet.id} className="rounded-lg border border-border-subtle bg-bg-surface p-3 text-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="text-xs text-fg-secondary">
                  @{tweet.author_username || source.author_username || "-"} · {tweet.tweet_id}
                </div>
                <div className="whitespace-pre-wrap break-words text-sm leading-6 text-fg-primary">
                  {tweet.text || t("tweet.noText")}
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-fg-secondary">{formatDiscoveredMedia(tweet.raw_payload, t)}</div>
              </div>
              <Badge>{statusLabel(tweet.download_status)}</Badge>
            </div>
            <div className="mt-1 text-xs text-fg-secondary">
              {formatDateTime(tweet.discovered_at)} · {tweet.archive_run_id ? `Run #${tweet.archive_run_id}` : t("sources.notQueued")}
            </div>
          </div>
        ))}
        {tweets.length === 0 ? <p className="text-sm text-fg-secondary">{t("sources.noDiscovered")}</p> : null}
      </div>
    </div>
  );
}
