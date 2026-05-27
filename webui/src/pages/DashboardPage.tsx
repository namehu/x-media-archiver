import { useQuery } from "@tanstack/react-query";
import { apiGet, type Summary } from "../lib/api";
import { useI18n, useFormatters } from "../lib/i18n";
import { formatBytes, formatDateTime } from "../lib/utils";
import { Badge } from "../components/ui/Badge";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";

export function DashboardPage() {
  const { t } = useI18n();
  const { statusLabel } = useFormatters();
  const { data, isLoading, error } = useQuery({
    queryKey: ["summary"],
    queryFn: () => apiGet<Summary>("/api/summary"),
  });

  if (isLoading) return <PageState title={t("dashboard.loading")} />;
  if (error || !data) return <PageState title={t("common.apiUnavailable")} detail={String(error)} />;

  const statusEntries = Object.entries(data.tweet_status_counts).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard label={t("dashboard.mediaAssets")} value={data.media_count} />
        <MetricCard label={t("dashboard.failureQueue")} value={data.failure_count} />
        <MetricCard label={t("dashboard.tweetStatuses")} value={statusEntries.length} />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>{t("dashboard.statusDistribution")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {statusEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("dashboard.noTweets")}</p>
            ) : (
              statusEntries.map(([status, count]) => (
                <div key={status} className="flex items-center justify-between gap-3">
                  <Badge>{statusLabel(status)}</Badge>
                  <span className="text-sm font-medium">{count}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("dashboard.recentExports")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.exports.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("dashboard.noExports")}</p>
            ) : (
              data.exports.map((file) => (
                <div key={file.path} className="rounded-md border border-border p-3">
                  <div className="break-all text-sm font-medium">{file.name}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {formatBytes(file.size)} · {formatDateTime(file.modified_at)}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <CardTitle>{t("dashboard.archiveDirectory")}</CardTitle>
        </CardHeader>
        <CardContent>
          <code className="break-all text-sm text-muted-foreground">{data.archive_dir}</code>
        </CardContent>
      </Card>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className="mt-2 text-3xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

function PageState({ title, detail }: { title: string; detail?: string }) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="font-medium">{title}</div>
        {detail ? <p className="mt-2 text-sm text-muted-foreground">{detail}</p> : null}
      </CardContent>
    </Card>
  );
}
