import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, type ActionResponse, type InboxImport, type InboxSettings } from "../lib/api";
import { formatBytes, formatDateTime } from "../lib/utils";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { Input } from "../components/ui/Input";

export function InboxPage() {
  const queryClient = useQueryClient();
  const [interval, setInterval] = useState("15");
  const [operationResult, setOperationResult] = useState<ActionResponse | null>(null);
  const importsQuery = useQuery({
    queryKey: ["inbox"],
    queryFn: () => apiGet<{ rows: InboxImport[]; count: number }>("/api/inbox"),
    refetchInterval: 10000,
  });
  const settingsQuery = useQuery({
    queryKey: ["inbox-settings"],
    queryFn: async () => {
      const settings = await apiGet<InboxSettings>("/api/inbox/settings");
      setInterval(String(settings.interval_minutes));
      return settings;
    },
    refetchInterval: 10000,
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["inbox"] }),
      queryClient.invalidateQueries({ queryKey: ["inbox-settings"] }),
      queryClient.invalidateQueries({ queryKey: ["summary"] }),
      queryClient.invalidateQueries({ queryKey: ["media"] }),
      queryClient.invalidateQueries({ queryKey: ["failures"] }),
    ]);
  };

  const actionMutation = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) => apiPost<ActionResponse>(path, body),
    onSuccess: async (result) => {
      setOperationResult(result);
      await refresh();
    },
  });
  const settingsMutation = useMutation({
    mutationFn: ({ enabled, intervalMinutes }: { enabled: boolean; intervalMinutes: number }) =>
      apiPost<InboxSettings>("/api/inbox/settings", {
        enabled,
        interval_minutes: intervalMinutes,
      }),
    onSuccess: refresh,
  });

  const settings = settingsQuery.data;
  const pending = actionMutation.isPending || settingsMutation.isPending;

  return (
    <div className="space-y-5">
      <section className="grid gap-4 lg:grid-cols-[1fr_1.25fr]">
        <Card>
          <CardHeader>
            <CardTitle>Automation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm">Auto process inbox</span>
              <Button
                type="button"
                variant={settings?.enabled ? "primary" : "secondary"}
                disabled={pending || settingsQuery.isLoading}
                onClick={() =>
                  settingsMutation.mutate({
                    enabled: !settings?.enabled,
                    intervalMinutes: positiveInteger(interval, 15),
                  })
                }
              >
                {settings?.enabled ? "Enabled" : "Disabled"}
              </Button>
            </div>
            <label className="block space-y-2 text-sm">
              <span className="text-muted-foreground">Interval minutes</span>
              <Input
                inputMode="numeric"
                value={interval}
                onChange={(event) => setInterval(event.target.value)}
              />
            </label>
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() =>
                settingsMutation.mutate({
                  enabled: settings?.enabled ?? false,
                  intervalMinutes: positiveInteger(interval, 15),
                })
              }
            >
              Save schedule
            </Button>
            <div className="space-y-1 text-xs text-muted-foreground">
              <div>Last scan: {formatDateTime(settings?.last_scan_at)}</div>
              <div>Next scan: {formatDateTime(settings?.next_scan_at)}</div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Inbox actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={pending}
                onClick={() => actionMutation.mutate({ path: "/api/inbox/scan", body: {} })}
              >
                Scan files
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={pending}
                onClick={() =>
                  actionMutation.mutate({
                    path: "/api/inbox/process-pending",
                    body: { limit: null },
                  })
                }
              >
                Process pending
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Place exported .txt or .jsonl files in <code>archive/inbox/</code>. Files with the same
              SHA-256 content are registered only once.
            </p>
            {actionMutation.error ? (
              <pre className="overflow-auto rounded-md bg-muted p-3 text-sm text-destructive">
                {String(actionMutation.error)}
              </pre>
            ) : null}
            {operationResult ? (
              <OperationResult result={operationResult} />
            ) : null}
          </CardContent>
        </Card>
      </section>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <CardTitle>Imported files</CardTitle>
            <Badge>{importsQuery.data?.count ?? 0} files</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          {importsQuery.isLoading ? <p className="text-sm text-muted-foreground">Loading inbox...</p> : null}
          {importsQuery.error ? (
            <p className="text-sm text-destructive">{String(importsQuery.error)}</p>
          ) : null}
          {importsQuery.data?.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No inbox files registered.</p>
          ) : null}
          {importsQuery.data?.rows.map((item) => (
            <div key={item.id} className="rounded-md border border-border p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="break-all text-sm font-medium">{item.filename}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {item.file_type} · {formatBytes(item.file_size)} · {formatDateTime(item.discovered_at)}
                  </div>
                  {item.archive_run_id ? (
                    <div className="mt-1 text-xs text-muted-foreground">Run #{item.archive_run_id}</div>
                  ) : null}
                </div>
                <Badge>{item.status}</Badge>
              </div>
              {item.error_message ? (
                <div className="mt-2 text-sm text-destructive">{item.error_message}</div>
              ) : null}
              {item.status === "completed" && item.result ? <PipelineSummary result={item.result} /> : null}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {(item.status === "pending" || item.status === "failed") && (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={pending}
                    onClick={() =>
                      actionMutation.mutate({
                        path: `/api/inbox/${item.id}/process`,
                        body: { limit: null },
                      })
                    }
                  >
                    {item.status === "failed" ? "Retry" : "Process"}
                  </Button>
                )}
                <code className="break-all text-xs text-muted-foreground">{item.sha256}</code>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function positiveInteger(value: string, fallback: number) {
  const parsed = Number(value.trim());
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 1440 ? parsed : fallback;
}

function OperationResult({ result }: { result: ActionResponse }) {
  const pipeline = extractPipelineResult(result.result);
  if (pipeline) return <PipelineSummary result={pipeline} />;
  return (
    <pre className="max-h-56 overflow-auto rounded-md bg-muted p-3 text-xs">
      {JSON.stringify(result, null, 2)}
    </pre>
  );
}

function extractPipelineResult(result: Record<string, unknown>) {
  const nested = result.result;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return null;
}

function PipelineSummary({ result }: { result: Record<string, unknown> }) {
  if (result.pipeline_version !== "incremental-v1") {
    return (
      <div className="mt-3 rounded-md bg-muted p-3 text-xs text-muted-foreground">
        Legacy full-library run. Counts may include media outside this input file.
      </div>
    );
  }
  const input = result.input as Record<string, number>;
  const download = result.download as Record<string, number>;
  const media = result.media as Record<string, number>;
  const library = result.library_snapshot as Record<string, number>;
  const metrics = [
    ["Input tweets", input.unique_tweet_count],
    ["New tweets", input.new_tweet_count],
    ["Already archived", input.skipped_existing_count],
    ["Download candidates", download.download_candidate_count],
    ["Newly downloaded media", media.backfilled_media_count],
    ["Newly verified media", media.verified_media_count],
  ];
  return (
    <div className="mt-3 space-y-3 rounded-md bg-muted p-3">
      <div className="grid gap-2 sm:grid-cols-2">
        {metrics.map(([label, value]) => (
          <div key={String(label)} className="flex justify-between gap-3 text-sm">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-medium">{value}</span>
          </div>
        ))}
      </div>
      <div className="border-t border-border pt-2 text-xs text-muted-foreground">
        Library total media: {library.media_total} · Library verified media: {library.verified_total}
      </div>
    </div>
  );
}
