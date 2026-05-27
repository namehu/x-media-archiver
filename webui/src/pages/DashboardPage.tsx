import { useQuery } from "@tanstack/react-query";
import { apiGet, type Summary } from "../lib/api";
import { formatBytes, formatDateTime } from "../lib/utils";
import { Badge } from "../components/ui/Badge";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";

export function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["summary"],
    queryFn: () => apiGet<Summary>("/api/summary"),
  });

  if (isLoading) return <PageState title="Loading archive summary" />;
  if (error || !data) return <PageState title="API unavailable" detail={String(error)} />;

  const statusEntries = Object.entries(data.tweet_status_counts).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="space-y-6">
      <section className="grid gap-4 md:grid-cols-3">
        <MetricCard label="Media assets" value={data.media_count} />
        <MetricCard label="Failure queue" value={data.failure_count} />
        <MetricCard label="Tweet statuses" value={statusEntries.length} />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Status distribution</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {statusEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tweets imported yet.</p>
            ) : (
              statusEntries.map(([status, count]) => (
                <div key={status} className="flex items-center justify-between gap-3">
                  <Badge>{status}</Badge>
                  <span className="text-sm font-medium">{count}</span>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent exports</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.exports.length === 0 ? (
              <p className="text-sm text-muted-foreground">No export files found.</p>
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
          <CardTitle>Archive directory</CardTitle>
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

