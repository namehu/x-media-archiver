import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, type ArchiveRunDetail, type ArchiveRunPageResponse, type ArchiveSubmission } from "../lib/api";
import { useFormatters, useI18n } from "../lib/i18n";
import { formatDateTime } from "../lib/utils";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { PaginationBar } from "../components/ui/PaginationBar";
import { Select } from "../components/ui/Select";

type ParsedLine = {
  line: number;
  value: string;
  url?: string;
  tweetId?: string;
  status: "valid" | "duplicate" | "invalid";
};

const PAGE_SIZE = 50;

export function ArchiveQueuePage() {
  const { t } = useI18n();
  const { statusLabel, errorLabel, triggerLabel } = useFormatters();
  const queryClient = useQueryClient();
  const [urls, setUrls] = useState("");
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<ArchiveSubmission | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [tweetFilter, setTweetFilter] = useState("");
  const [failedOnly, setFailedOnly] = useState(false);
  const [offset, setOffset] = useState(0);

  const preview = useMemo(() => parseUrlInput(urls), [urls]);
  const validRecords = preview.rows
    .filter((row) => row.status === "valid" && row.url)
    .map((row) => ({ url: row.url as string }));
  const runsQuery = useQuery({
    queryKey: ["archive-runs", statusFilter, tweetFilter, failedOnly, offset],
    queryFn: () =>
      apiGet<ArchiveRunPageResponse>(
        `/api/v1/archive-runs?${runQueryString(statusFilter, tweetFilter, failedOnly, PAGE_SIZE, offset)}`,
      ),
    refetchInterval: 15000,
  });
  const detailQuery = useQuery({
    queryKey: ["archive-run", selectedRunId],
    queryFn: () => apiGet<ArchiveRunDetail>(`/api/v1/archive-runs/${selectedRunId}`),
    enabled: selectedRunId !== null,
    refetchInterval: 15000,
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
      apiPost<ArchiveSubmission>("/api/v1/archive-runs", { trigger_type: "webui", records }),
    onSuccess: async (result) => {
      setFeedback(result);
      setParseError(null);
      setUrls("");
      await refresh(result.run_id);
    },
  });
  const retryMutation = useMutation({
    mutationFn: (runId: number) => apiPost<ArchiveSubmission>(`/api/v1/archive-runs/${runId}/retry`, {}),
    onSuccess: async (result) => {
      setFeedback(result);
      await refresh(result.run_id);
    },
  });

  const pending = submitMutation.isPending || retryMutation.isPending;
  const canSubmit = validRecords.length > 0 && preview.invalidCount === 0 && !pending;
  const submitUrls = () => {
    if (canSubmit) submitMutation.mutate(validRecords);
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>{t("queue.submitTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
            <textarea
              className="min-h-28 w-full resize-y rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary"
              placeholder="https://x.com/user/status/123"
              value={urls}
              onChange={(event) => setUrls(event.target.value)}
            />
            <div className="flex flex-col gap-3">
              <Button type="button" disabled={!canSubmit} onClick={submitUrls}>
                {t("queue.submitUrls")}
              </Button>
              <Input
                type="file"
                accept=".txt,.jsonl"
                disabled={pending}
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  if (!file) return;
                  try {
                    setUrls(parseFileToText(file.name, await file.text()));
                    setFeedback(null);
                    setParseError(null);
                  } catch (error) {
                    setFeedback(null);
                    setParseError(`${t("queue.fileParseError")}: ${String(error)}`);
                  } finally {
                    event.target.value = "";
                  }
                }}
              />
            </div>
          </div>

          <InputPreview preview={preview} />
          {preview.invalidCount > 0 ? (
            <p className="text-sm text-destructive">{t("queue.submitDisabledByInvalid")}</p>
          ) : null}
          {urls.trim() && validRecords.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("queue.noValidUrls")}</p>
          ) : null}
          {parseError || submitMutation.error || retryMutation.error ? (
            <p className="text-sm text-destructive">
              {parseError || String(submitMutation.error || retryMutation.error)}
            </p>
          ) : null}
          {feedback ? (
            <div className="rounded-md bg-muted p-3 text-sm">
              {t("queue.feedback", {
                runId: feedback.run_id,
                status: statusLabel(feedback.status),
                queued: feedback.tasks.queued_count,
                skipped: feedback.tasks.skipped_verified_count,
                linked: feedback.tasks.linked_pending_count,
              })}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <section className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>{t("queue.runs")}</CardTitle>
              <Badge>{runsQuery.data?.total_count ?? 0}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 md:grid-cols-[1fr_1fr_auto]">
              <Select
                value={statusFilter}
                onChange={(event) => {
                  setOffset(0);
                  setStatusFilter(event.target.value);
                }}
              >
                <option value="">{t("queue.filterStatus")}</option>
                <option value="queued">{statusLabel("queued")}</option>
                <option value="running">{statusLabel("running")}</option>
                <option value="completed">{statusLabel("completed")}</option>
                <option value="completed_with_failures">{statusLabel("completed_with_failures")}</option>
                <option value="failed">{statusLabel("failed")}</option>
              </Select>
              <Input
                placeholder={t("queue.searchTweet")}
                value={tweetFilter}
                onChange={(event) => {
                  setOffset(0);
                  setTweetFilter(event.target.value);
                }}
              />
              <label className="flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm">
                <input
                  type="checkbox"
                  checked={failedOnly}
                  onChange={(event) => {
                    setOffset(0);
                    setFailedOnly(event.target.checked);
                  }}
                />
                <span className="whitespace-nowrap">{t("queue.onlyFailed")}</span>
              </label>
            </div>
            {(statusFilter || tweetFilter || failedOnly) ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setStatusFilter("");
                  setTweetFilter("");
                  setFailedOnly(false);
                  setOffset(0);
                }}
              >
                {t("queue.clearFilters")}
              </Button>
            ) : null}
            {runsQuery.data ? (
              <PaginationBar
                offset={offset}
                count={runsQuery.data.count}
                totalCount={runsQuery.data.total_count}
                pageSize={PAGE_SIZE}
                onOffsetChange={setOffset}
              />
            ) : null}
            {runsQuery.data?.rows.map((run) => (
              <button
                type="button"
                key={run.id}
                className="flex w-full items-center justify-between gap-3 rounded-md border border-border bg-white p-3 text-left hover:bg-muted"
                onClick={() => setSelectedRunId(run.id)}
              >
                <div>
                  <div className="text-sm font-medium">{t("queue.run", { id: run.id })}</div>
                  <div className="text-xs text-muted-foreground">
                    {triggerLabel(run.trigger_type)} · {formatDateTime(run.started_at)}
                  </div>
                </div>
                <Badge>{statusLabel(run.status)}</Badge>
              </button>
            ))}
            {runsQuery.data?.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("queue.empty")}</p>
            ) : null}
            {runsQuery.data && runsQuery.data.rows.length > 0 ? (
              <PaginationBar
                offset={offset}
                count={runsQuery.data.count}
                totalCount={runsQuery.data.total_count}
                pageSize={PAGE_SIZE}
                onOffsetChange={setOffset}
              />
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("queue.detail")}</CardTitle>
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
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span>{t("tweet.retryCount")}: {item.retry_count}</span>
                          {item.last_attempt_at ? <span>{t("queue.lastAttempt")}: {formatDateTime(item.last_attempt_at)}</span> : null}
                          {item.next_attempt_at ? <span>{t("queue.nextAttempt")}: {formatDateTime(item.next_attempt_at)}</span> : null}
                        </div>
                        {item.error_category || item.error_message ? (
                          <div className="mt-1 text-xs text-destructive">
                            {errorLabel(item.error_category || item.error_message)}
                          </div>
                        ) : null}
                        {item.attempts?.length ? (
                          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                            <div className="font-medium text-foreground">{t("queue.itemAttempts")}</div>
                            {item.attempts.map((attempt) => (
                              <div key={attempt.id}>
                                {attempt.engine || "-"} · {statusLabel(attempt.status)} ·{" "}
                                {errorLabel(attempt.error_category || attempt.error_message)} ·{" "}
                                {formatDateTime(attempt.finished_at)}
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <Badge>{statusLabel(item.status)}</Badge>
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
                    {t("queue.retryFailed")}
                  </Button>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t("queue.selectRun")}</p>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function InputPreview({ preview }: { preview: ReturnType<typeof parseUrlInput> }) {
  const { t } = useI18n();
  if (preview.totalLines === 0) return null;
  return (
    <div className="rounded-md bg-muted p-3 text-sm">
      <div className="mb-2 font-medium">{t("queue.inputPreview")}</div>
      <div className="grid gap-2 sm:grid-cols-4">
        <Metric label={t("queue.totalLines")} value={preview.totalLines} />
        <Metric label={t("queue.validUrls")} value={preview.validCount} />
        <Metric label={t("queue.duplicateUrls")} value={preview.duplicateCount} />
        <Metric label={t("queue.invalidLines")} value={preview.invalidCount} />
      </div>
      {preview.invalid.length ? <LineList title={t("queue.invalidLineList")} rows={preview.invalid} /> : null}
      {preview.duplicates.length ? <LineList title={t("queue.duplicateLineList")} rows={preview.duplicates} /> : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between gap-3 rounded-md bg-white px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function LineList({ title, rows }: { title: string; rows: ParsedLine[] }) {
  return (
    <div className="mt-3 space-y-1">
      <div className="text-xs font-medium text-destructive">{title}</div>
      {rows.slice(0, 5).map((row) => (
        <div key={`${row.line}-${row.value}`} className="break-all text-xs text-muted-foreground">
          #{row.line}: {row.value}
        </div>
      ))}
    </div>
  );
}

function parseUrlInput(value: string) {
  const seen = new Set<string>();
  const rows: ParsedLine[] = value
    .split(/\r?\n/)
    .map((line, index) => ({ line: index + 1, value: line.trim() }))
    .filter((line) => line.value && !line.value.startsWith("#"))
    .map((line) => {
      const tweetId = extractTweetId(line.value);
      if (!tweetId) return { ...line, status: "invalid" as const };
      if (seen.has(tweetId)) return { ...line, url: line.value, tweetId, status: "duplicate" as const };
      seen.add(tweetId);
      return { ...line, url: line.value, tweetId, status: "valid" as const };
    });
  const invalid = rows.filter((row) => row.status === "invalid");
  const duplicates = rows.filter((row) => row.status === "duplicate");
  return {
    rows,
    invalid,
    duplicates,
    totalLines: rows.length,
    validCount: rows.filter((row) => row.status === "valid").length,
    duplicateCount: duplicates.length,
    invalidCount: invalid.length,
  };
}

function extractTweetId(url: string) {
  return url.match(/(?:twitter\.com|x\.com)\/[^/\s]+\/status\/(\d+)/i)?.[1] ?? null;
}

function parseFileToText(filename: string, text: string) {
  if (!filename.toLowerCase().endsWith(".jsonl")) return text;
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => {
      const record = JSON.parse(line) as { url?: string };
      if (!record.url) throw new Error("missing url");
      return record.url;
    })
    .join("\n");
}

function runQueryString(status: string, tweetId: string, failedOnly: boolean, limit: number, offset: number) {
  const search = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (status) search.set("run_status", status);
  if (tweetId.trim()) search.set("tweet_id", tweetId.trim());
  if (failedOnly) search.set("failed_only", "true");
  return search.toString();
}

function hasFailure(run: ArchiveRunDetail) {
  return run.items.some((item) => item.status === "failed_permanent");
}

function RunSummary({ run }: { run: ArchiveRunDetail }) {
  const { t } = useI18n();
  const tasks = run.result?.tasks;
  if (!tasks) return <Badge>{t("queue.legacy")}</Badge>;
  const metrics = [
    [t("queue.metric.queued"), tasks.queued_count],
    [t("queue.metric.skipped"), tasks.skipped_verified_count],
    [t("queue.metric.linked"), tasks.linked_pending_count],
    [t("queue.metric.verified"), tasks.verified_count],
    [t("queue.metric.failed"), tasks.failed_count],
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
