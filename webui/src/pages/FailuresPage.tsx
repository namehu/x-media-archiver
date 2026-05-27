import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiGet, type FailureRow } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { formatDateTime } from "../lib/utils";
import { Badge } from "../components/ui/Badge";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";

export function FailuresPage() {
  const { t } = useI18n();
  const { data, isLoading, error } = useQuery({
    queryKey: ["failures"],
    queryFn: () => apiGet<{ rows: FailureRow[]; count: number }>("/api/failures"),
  });

  if (isLoading) return <State text={t("failures.loading")} />;
  if (error) return <State text={String(error)} />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("failures.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {data?.rows.length === 0 ? <p className="text-sm text-muted-foreground">{t("failures.empty")}</p> : null}
        {data?.rows.map((row) => (
          <div key={row.tweet_id} className="rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <Link className="font-medium text-primary" to={`/tweets/${row.tweet_id}`}>
                  {row.tweet_id}
                </Link>
                <div className="text-sm text-muted-foreground">@{row.author_username || "-"}</div>
              </div>
              <Badge>{row.latest_error_category || row.last_error || row.tweet_status || "-"}</Badge>
            </div>
            <div className="mt-2 grid gap-2 text-sm text-muted-foreground md:grid-cols-3">
              <span>{t("failures.engine")}: {row.latest_engine || "-"}</span>
              <span>{t("failures.retries")}: {row.retry_count ?? 0}</span>
              <span>{t("failures.finished")}: {formatDateTime(row.latest_finished_at)}</span>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function State({ text }: { text: string }) {
  return (
    <Card>
      <CardContent className="p-5 text-sm text-muted-foreground">{text}</CardContent>
    </Card>
  );
}
