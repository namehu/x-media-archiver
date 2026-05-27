import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, type ArchiveRun, type ArchiveRunDetail, type ArchiveSubmission } from "../lib/api";
import { formatDateTime } from "../lib/utils";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { Input } from "../components/ui/Input";

export function ArchiveQueuePage() {
  const queryClient = useQueryClient();
  const [urls, setUrls] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<ArchiveSubmission | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const runsQuery = useQuery({
    queryKey: ["archive-runs"],
    queryFn: () => apiGet<{ rows: ArchiveRun[]; count: number }>("/api/archive-runs"),
    refetchInterval: 3000,
  });
  const detailQuery = useQuery({
    queryKey: ["archive-run", selectedRunId],
    queryFn: () => apiGet<ArchiveRunDetail>(`/api/archive-runs/${selectedRunId}`),
    enabled: selectedRunId !== null,
    refetchInterval: 3000,
  });

  const refresh = async (runId?: number) => {
    if (runId) setSelectedRunId(runId);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["archive-runs"] }),
      queryClient.invalidateQueries({ queryKey: ["archive-run"] }),
      queryClient.invalidateQueries({ queryKey: ["summary"] }),
      queryClient.invalidateQueries({ queryKey: ["media"] }),
      queryClient.invalidateQueries({ queryKey: ["failures"] }),
    ]);
  };
  const submitMutation = useMutation({
    mutationFn: (records: Array<{ url: string } & Record<string, unknown>>) =>
      apiPost<ArchiveSubmission>("/api/archive-runs", { trigger_type: "webui", records }),
    onSuccess: async (result) => {
      setFeedback(result);
      setParseError(null);
      setUrls("");
      await refresh(result.run_id);
    },
  });
  const retryMutation = useMutation({
    mutationFn: (runId: number) => apiPost<ArchiveSubmission>(`/api/archive-runs/${runId}/retry`, {}),
    onSuccess: async (result) => {
      setFeedback(result);
      await refresh(result.run_id);
    },
  });

  const pending = submitMutation.isPending || retryMutation.isPending;
  const submitUrls = () => {
    const records = parseUrls(urls);
    if (records.length) submitMutation.mutate(records);
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Submit Archive Batch</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[1fr_auto]">
          <textarea
            className="min-h-28 w-full resize-y rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary"
            placeholder="https://x.com/user/status/123"
            value={urls}
            onChange={(event) => setUrls(event.target.value)}
          />
          <div className="flex flex-col gap-3">
            <Button type="button" disabled={pending || parseUrls(urls).length === 0} onClick={submitUrls}>
              Submit URLs
            </Button>
            <Input
              type="file"
              accept=".txt,.jsonl"
              disabled={pending}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                try {
                  submitMutation.mutate(parseFile(file.name, await file.text()));
                } catch (error) {
                  setFeedback(null);
                  setParseError(String(error));
                } finally {
                  event.target.value = "";
                }
              }}
            />
          </div>
          {parseError || submitMutation.error || retryMutation.error ? (
            <p className="text-sm text-destructive lg:col-span-2">
              {parseError || String(submitMutation.error || retryMutation.error)}
            </p>
          ) : null}
          {feedback ? (
            <div className="rounded-md bg-muted p-3 text-sm lg:col-span-2">
              Run #{feedback.run_id} · {feedback.status} · {feedback.tasks.queued_count} queued ·{" "}
              {feedback.tasks.skipped_verified_count} already archived · {feedback.tasks.linked_pending_count} already queued
            </div>
          ) : null}
        </CardContent>
      </Card>

      <section className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>Runs</CardTitle>
              <Badge>{runsQuery.data?.count ?? 0}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            {runsQuery.data?.rows.map((run) => (
              <button
                type="button"
                key={run.id}
                className="flex w-full items-center justify-between gap-3 rounded-md border border-border bg-white p-3 text-left hover:bg-muted"
                onClick={() => setSelectedRunId(run.id)}
              >
                <div>
                  <div className="text-sm font-medium">Run #{run.id}</div>
                  <div className="text-xs text-muted-foreground">
                    {run.trigger_type} · {formatDateTime(run.started_at)}
                  </div>
                </div>
                <Badge>{run.status}</Badge>
              </button>
            ))}
            {runsQuery.data?.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">No archive runs.</p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Run Detail</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {detailQuery.data ? (
              <>
                <RunSummary run={detailQuery.data} />
                <div className="space-y-2">
                  {detailQuery.data.items.map((item) => (
                    <div key={item.id} className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
                      <div className="min-w-0">
                        <div className="break-all text-sm">{item.tweet_id}</div>
                        {item.error_message ? (
                          <div className="mt-1 text-xs text-destructive">{item.error_message}</div>
                        ) : null}
                      </div>
                      <Badge>{item.status}</Badge>
                    </div>
                  ))}
                </div>
                {hasFailure(detailQuery.data) ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => retryMutation.mutate(detailQuery.data.id)}
                  >
                    Retry Failed Items
                  </Button>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">Select a run.</p>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function parseUrls(value: string) {
  return value
    .split(/\r?\n/)
    .map((url) => url.trim())
    .filter((url) => url && !url.startsWith("#"))
    .map((url) => ({ url }));
}

function parseFile(filename: string, text: string) {
  if (filename.toLowerCase().endsWith(".jsonl")) {
    return text
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as { url: string } & Record<string, unknown>);
  }
  return parseUrls(text);
}

function hasFailure(run: ArchiveRunDetail) {
  return run.items.some((item) => item.status === "failed_permanent");
}

function RunSummary({ run }: { run: ArchiveRunDetail }) {
  const tasks = run.result?.tasks;
  if (!tasks) return <Badge>legacy run</Badge>;
  const metrics = [
    ["Queued", tasks.queued_count],
    ["Already archived", tasks.skipped_verified_count],
    ["Already queued", tasks.linked_pending_count],
    ["Verified", tasks.verified_count],
    ["Failed", tasks.failed_count],
  ];
  return (
    <div className="grid gap-2 rounded-md bg-muted p-3 sm:grid-cols-2">
      {metrics.map(([label, value]) => (
        <div className="flex justify-between gap-3 text-sm" key={label}>
          <span className="text-muted-foreground">{label}</span>
          <span className="font-medium">{value}</span>
        </div>
      ))}
    </div>
  );
}
