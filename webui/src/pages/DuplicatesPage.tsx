import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiGet, type DuplicatesResponse } from "../lib/api";
import { useFormatters, useI18n } from "../lib/i18n";
import { formatBytes } from "../lib/utils";
import { Badge } from "../components/ui/Badge";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { PaginationBar } from "../components/ui/PaginationBar";

const PAGE_SIZE = 100;

export function DuplicatesPage() {
  const { t } = useI18n();
  const { mediaTypeLabel } = useFormatters();
  const [offset, setOffset] = useState(0);
  const { data, isLoading, error } = useQuery({
    queryKey: ["duplicates", offset],
    queryFn: () => apiGet<DuplicatesResponse>(`/api/v1/library/duplicates?limit=${PAGE_SIZE}&offset=${offset}`),
  });

  if (isLoading) return <State text={t("duplicates.loading")} />;
  if (error) return <State text={String(error)} />;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>{t("duplicates.title")} ({data?.duplicate_groups ?? 0} {t("duplicates.groups")})</CardTitle>
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
        {data?.rows.length === 0 ? <p className="text-sm text-muted-foreground">{t("duplicates.empty")}</p> : null}
        {data?.rows.map((row, index) => (
          <div key={`${row.sha256}-${row.tweet_id}-${index}`} className="rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="break-all text-sm font-medium">{row.sha256}</div>
                <div className="text-sm text-muted-foreground">
                  {formatBytes(row.file_size)} · {mediaTypeLabel(row.media_type)}
                </div>
              </div>
              <Badge>{row.duplicate_count ?? "-"} {t("duplicates.files")}</Badge>
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-sm">
              <Link className="font-medium text-primary" to={`/tweets/${row.tweet_id}`}>
                {t("duplicates.tweetDetail")}
              </Link>
              <code className="break-all text-xs text-muted-foreground">{row.local_path || "-"}</code>
            </div>
          </div>
        ))}
        {data && data.rows.length > 0 ? (
          <PaginationBar
            offset={offset}
            count={data.count}
            totalCount={data.total_count}
            pageSize={PAGE_SIZE}
            onOffsetChange={setOffset}
          />
        ) : null}
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
