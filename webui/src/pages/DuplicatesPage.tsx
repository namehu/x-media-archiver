import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiGet, type MediaRow } from "../lib/api";
import { formatBytes } from "../lib/utils";
import { Badge } from "../components/ui/Badge";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";

export function DuplicatesPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["duplicates"],
    queryFn: () => apiGet<{ duplicate_groups: number; rows: MediaRow[] }>("/api/duplicates"),
  });

  if (isLoading) return <State text="Loading duplicates" />;
  if (error) return <State text={String(error)} />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Duplicates ({data?.duplicate_groups ?? 0} groups)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {data?.rows.length === 0 ? <p className="text-sm text-muted-foreground">No duplicate media found.</p> : null}
        {data?.rows.map((row, index) => (
          <div key={`${row.sha256}-${row.tweet_id}-${index}`} className="rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="break-all text-sm font-medium">{row.sha256}</div>
                <div className="text-sm text-muted-foreground">
                  {formatBytes(row.file_size)} · {row.media_type || "media"}
                </div>
              </div>
              <Badge>{row.duplicate_count ?? "-"} files</Badge>
            </div>
            <div className="mt-2 flex flex-wrap gap-3 text-sm">
              <Link className="font-medium text-primary" to={`/tweets/${row.tweet_id}`}>
                Tweet detail
              </Link>
              <code className="break-all text-xs text-muted-foreground">{row.local_path || "-"}</code>
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
