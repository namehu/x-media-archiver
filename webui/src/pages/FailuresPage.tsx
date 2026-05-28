import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiGet, type FailureRow, type PageResponse } from "../lib/api";
import { useI18n } from "../lib/i18n";
import { formatDateTime } from "../lib/utils";
import { Badge } from "../components/ui/Badge";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { PaginationBar } from "../components/ui/PaginationBar";

const PAGE_SIZE = 100;

export function FailuresPage() {
  const { t } = useI18n();
  const [offset, setOffset] = useState(0);
  const { data, isLoading, error } = useQuery({
    queryKey: ["failures", offset],
    queryFn: () => apiGet<PageResponse<FailureRow>>(`/api/failures?limit=${PAGE_SIZE}&offset=${offset}`),
  });

  if (isLoading) return <State text={t("failures.loading")} />;
  if (error) return <State text={String(error)} />;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>{t("failures.title")}</CardTitle>
          {data ? (
            <PaginationBar
              offset={offset}
              count={data.count}
              totalCount={data.total_count}
              pageSize={PAGE_SIZE}
              onOffsetChange={setOffset}
            />
          ) : null}
        </div>
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
