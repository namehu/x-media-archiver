import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { apiGet, apiPost, type ArchiveSource, type ArchiveSubmission, type DownloadPolicy, type SourcePageResponse } from "../lib/api";
import { useFormatters, useI18n } from "../lib/i18n";
import { formatDateTime } from "../lib/utils";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { PaginationBar } from "../components/ui/PaginationBar";
import { Select } from "../components/ui/Select";

const PAGE_SIZE = 50;

export function SourcesPage() {
  const { t } = useI18n();
  const { statusLabel } = useFormatters();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sourceType, setSourceType] = useState("profile");
  const [sourceUrl, setSourceUrl] = useState("");
  const [label, setLabel] = useState("");
  const [selectedSourceId, setSelectedSourceId] = useState<number | null>(null);
  const [recordUrls, setRecordUrls] = useState("");
  const [scanLimit, setScanLimit] = useState("20");
  const [submitLimit, setSubmitLimit] = useState("20");
  const [feedback, setFeedback] = useState<ArchiveSubmission | null>(null);
  const [scanFeedback, setScanFeedback] = useState<Record<string, unknown> | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [sourceStatusFilter, setSourceStatusFilter] = useState("");
  const [sourceTypeFilter, setSourceTypeFilter] = useState("");
  const [offset, setOffset] = useState(0);

  const sourcesQuery = useQuery({
    queryKey: ["sources", sourceStatusFilter, sourceTypeFilter, offset],
    queryFn: () =>
      apiGet<SourcePageResponse>(
        `/api/v1/sources?${sourceQueryString(sourceStatusFilter, sourceTypeFilter, PAGE_SIZE, offset)}`,
      ),
    refetchInterval: 15000,
  });
  const detailQuery = useQuery({
    queryKey: ["source", selectedSourceId],
    queryFn: () => apiGet<ArchiveSource>(`/api/v1/sources/${selectedSourceId}`),
    enabled: selectedSourceId !== null,
    refetchInterval: 15000,
  });
  const policyQuery = useQuery({
    queryKey: ["download-policy"],
    queryFn: () => apiGet<DownloadPolicy>("/api/v1/settings/download-policy"),
  });

  const refresh = async (sourceId?: number) => {
    if (sourceId) setSelectedSourceId(sourceId);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["sources"] }),
      queryClient.invalidateQueries({ queryKey: ["source"] }),
      queryClient.invalidateQueries({ queryKey: ["archive-runs"] }),
    ]);
  };

  const createMutation = useMutation({
    mutationFn: () =>
      apiPost<ArchiveSource>("/api/v1/sources", {
        source_type: sourceType,
        source_url: sourceUrl,
        label: label || undefined,
      }),
    onSuccess: async (source) => {
      setSourceUrl("");
      setLabel("");
      await refresh(source.id);
    },
  });

  const submitMutation = useMutation({
    mutationFn: ({ sourceId, records }: { sourceId: number; records: Array<{ url: string }> }) =>
      apiPost<ArchiveSubmission>(`/api/v1/sources/${sourceId}/records`, { records }),
    onSuccess: async (result) => {
      setFeedback(result);
      setRecordUrls("");
      await refresh(result.source_id as number | undefined);
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ sourceId, status }: { sourceId: number; status: "active" | "paused" }) =>
      apiPost<ArchiveSource>(`/api/v1/sources/${sourceId}/status`, { status }),
    onSuccess: async (source) => refresh(source.id),
  });
  const scanMutation = useMutation({
    mutationFn: ({ sourceId, limit, restart }: { sourceId: number; limit: number; restart?: boolean }) =>
      apiPost<Record<string, unknown>>(`/api/v1/sources/${sourceId}/scan`, { limit, restart }),
    onSuccess: async (response) => {
      const result = unwrapActionResult(response);
      setScanFeedback(result);
      await refresh(Number(result.source_id) || selectedSourceId || undefined);
    },
  });
  const submitDiscoveredMutation = useMutation({
    mutationFn: ({ sourceId, limit }: { sourceId: number; limit?: number }) =>
      apiPost<ArchiveSubmission>(`/api/v1/sources/${sourceId}/submit-discovered`, { limit }),
    onSuccess: async (result) => {
      setFeedback(result);
      await refresh(result.source_id);
    },
  });
  const historyScanMutation = useMutation({
    mutationFn: ({ sourceId, limit, restart = false }: { sourceId: number; limit: number; restart?: boolean }) =>
      apiPost<ArchiveSource>(`/api/v1/sources/${sourceId}/history-scan`, { limit, restart }),
    onSuccess: async (source) => refresh(source.id),
  });
  const stopHistoryScanMutation = useMutation({
    mutationFn: (sourceId: number) => apiPost<ArchiveSource>(`/api/v1/sources/${sourceId}/history-scan/stop`, {}),
    onSuccess: async (source) => refresh(source.id),
  });

  const selected = detailQuery.data;
  const activeScanRun = selected?.scan_runs?.find((run) => run.status === "running");
  const sourceRecords = parseRecordUrls(recordUrls);
  const canCreate = sourceUrl.trim().length > 0 && !createMutation.isPending;
  const canSubmit = Boolean(selectedSourceId && sourceRecords.length && !submitMutation.isPending);
  const canScan = Boolean(selectedSourceId && selected?.status !== "paused" && !scanMutation.isPending);
  const canSubmitDiscovered = Boolean(
    selectedSourceId && (selected?.unsubmitted_tweet_count || 0) > 0 && !submitDiscoveredMutation.isPending,
  );
  const historyEnabled = Boolean(selected?.cursor_state?.automation_enabled);
  const historyBusy = historyScanMutation.isPending || stopHistoryScanMutation.isPending;

  useEffect(() => {
    const sourceId = Number(searchParams.get("sourceId"));
    if (Number.isFinite(sourceId) && sourceId > 0) setSelectedSourceId(sourceId);
  }, [searchParams]);

  const selectSource = (sourceId: number) => {
    setSelectedSourceId(sourceId);
    setSearchParams({ sourceId: String(sourceId) });
  };

  useEffect(() => {
    if (!activeScanRun) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeScanRun?.id]);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>{t("sources.createTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-[180px_1fr_220px_auto]">
          <label className="space-y-1">
            <Select value={sourceType} onChange={(event) => setSourceType(event.target.value)}>
              <option value="profile">{t("sources.type.profile")}</option>
              <option value="user_media">{t("sources.type.user_media")}</option>
              <option value="likes">{t("sources.type.likes")}</option>
              <option value="bookmarks">{t("sources.type.bookmarks")}</option>
              <option value="search">{t("sources.type.search")}</option>
              <option value="manual">{t("sources.type.manual")}</option>
            </Select>
            <span className="block text-xs text-muted-foreground" title={t("sources.typeHelpTooltip")}>
              {t("sources.typeHelp")}
            </span>
          </label>
          <Input
            placeholder="https://x.com/username/media"
            value={sourceUrl}
            onChange={(event) => {
              const nextUrl = event.target.value;
              setSourceUrl(nextUrl);
              const inferred = inferSourceType(nextUrl);
              if (inferred) setSourceType(inferred);
            }}
          />
          <Input placeholder={t("sources.label")} value={label} onChange={(event) => setLabel(event.target.value)} />
          <Button type="button" disabled={!canCreate} onClick={() => createMutation.mutate()}>
            {t("sources.create")}
          </Button>
          {createMutation.error ? <p className="text-sm text-destructive lg:col-span-4">{String(createMutation.error)}</p> : null}
        </CardContent>
      </Card>

      <section className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>{t("sources.list")}</CardTitle>
              <Badge>{sourcesQuery.data?.total_count ?? 0}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <Select
                value={sourceStatusFilter}
                onChange={(event) => {
                  setOffset(0);
                  setSourceStatusFilter(event.target.value);
                }}
              >
                <option value="">{t("common.status.all")}</option>
                <option value="active">{statusLabel("active")}</option>
                <option value="paused">{statusLabel("paused")}</option>
                <option value="completed">{statusLabel("completed")}</option>
                <option value="failed">{statusLabel("failed")}</option>
              </Select>
              <Select
                value={sourceTypeFilter}
                onChange={(event) => {
                  setOffset(0);
                  setSourceTypeFilter(event.target.value);
                }}
              >
                <option value="">{t("sources.type.all")}</option>
                <option value="profile">{t("sources.type.profile")}</option>
                <option value="user_media">{t("sources.type.user_media")}</option>
                <option value="likes">{t("sources.type.likes")}</option>
                <option value="bookmarks">{t("sources.type.bookmarks")}</option>
                <option value="search">{t("sources.type.search")}</option>
                <option value="manual">{t("sources.type.manual")}</option>
              </Select>
            </div>
            {sourcesQuery.data ? (
              <PaginationBar
                offset={offset}
                count={sourcesQuery.data.count}
                totalCount={sourcesQuery.data.total_count}
                pageSize={PAGE_SIZE}
                onOffsetChange={setOffset}
              />
            ) : null}
            {sourcesQuery.data?.rows.map((source) => (
              <button
                type="button"
                key={source.id}
                className="flex w-full items-center justify-between gap-3 rounded-md border border-border bg-white p-3 text-left hover:bg-muted"
                onClick={() => selectSource(source.id)}
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{source.label || source.source_url}</div>
                  <div className="text-xs text-muted-foreground">
                    {sourceTypeLabel(source.source_type, t)} · {source.author_username || "-"} ·{" "}
                    {t("sources.discovered")}: {source.discovered_tweet_count ?? source.discovered_count ?? 0} /{" "}
                    {source.discovered_media_count ?? 0} {t("sources.mediaUnit")}
                  </div>
                </div>
                <Badge>{statusLabel(source.status)}</Badge>
              </button>
            ))}
            {sourcesQuery.data?.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("sources.empty")}</p>
            ) : null}
            {sourcesQuery.data && sourcesQuery.data.rows.length > 0 ? (
              <PaginationBar
                offset={offset}
                count={sourcesQuery.data.count}
                totalCount={sourcesQuery.data.total_count}
                pageSize={PAGE_SIZE}
                onOffsetChange={setOffset}
              />
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("sources.detail")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {selected ? (
              <>
                {policyQuery.data ? (
                  <div className="grid gap-2 rounded-md border border-border p-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <div className="text-xs text-muted-foreground">{t("sources.policyBatch")}</div>
                      <div>{policyQuery.data.queue_batch_size}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">{t("sources.policyDelay")}</div>
                      <div>
                        {policyQuery.data.downloader_sleep_min_seconds}-{policyQuery.data.downloader_sleep_max_seconds}s
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">{t("sources.policyEngine")}</div>
                      <div>{policyQuery.data.default_download_engine}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">{t("sources.policyScan")}</div>
                      <div>
                        {policyQuery.data.source_scan_batch_size} / {policyQuery.data.source_scan_sleep_min_seconds}-
                        {policyQuery.data.source_scan_sleep_max_seconds}s
                      </div>
                    </div>
                  </div>
                ) : null}
                {activeScanRun ? (
                  <div className="rounded-md border border-primary/30 bg-primary/10 p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="font-medium">{t("sources.activeScanTitle")}</div>
                      <Badge className="border-primary/30 bg-white text-primary">
                        {scanStatusLabel(activeScanRun.status, t)}
                      </Badge>
                    </div>
                    <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                      <span>
                        {t("sources.scanRange")}: {formatRunRange(activeScanRun.range_start, activeScanRun.range_end)}
                      </span>
                      <span>
                        {t("sources.activeScanElapsed")}: {formatElapsed(activeScanRun.started_at, now)}
                      </span>
                      <span>
                        {t("sources.activeScanStarted")}: {formatDateTime(activeScanRun.started_at)}
                      </span>
                      <span>
                        {t("sources.activeScanMode")}: {scanTriggerLabel(activeScanRun.trigger_type, t)}
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-muted-foreground">{t("sources.activeScanHint")}</p>
                  </div>
                ) : null}
                <div className="space-y-2 rounded-md bg-muted p-3 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{t("sources.url")}</span>
                    <span className="break-all text-right">{selected.source_url}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{t("sources.updated")}</span>
                    <span>{formatDateTime(selected.updated_at)}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{t("sources.lastSeen")}</span>
                    <span>{selected.last_seen_tweet_id || "-"}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{t("sources.discoveredTweets")}</span>
                    <span>{selected.discovered_tweet_count ?? selected.discovered_count ?? 0}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{t("sources.discoveredMedia")}</span>
                    <span>{selected.discovered_media_count ?? 0}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{t("sources.unsubmitted")}</span>
                    <span>{selected.unsubmitted_tweet_count ?? 0}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{t("sources.nextRange")}</span>
                    <span>{formatNextRange(selected.cursor_state, Number(scanLimit) || 20)}</span>
                  </div>
                  {selected.cursor_state?.last_range_start ? (
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">{t("sources.lastRange")}</span>
                      <span>
                        {selected.cursor_state.last_range_start}-{selected.cursor_state.last_range_end}
                      </span>
                    </div>
                  ) : null}
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{t("sources.scanState")}</span>
                    <span>{formatScanState(selected.cursor_state, t)}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{t("sources.historyState")}</span>
                    <span>{formatHistoryState(selected, t)}</span>
                  </div>
                  {historyEnabled && selected.next_scan_at ? (
                    <div className="flex justify-between gap-3">
                      <span className="text-muted-foreground">{t("sources.nextScheduled")}</span>
                      <span>{formatDateTime(selected.next_scan_at)}</span>
                    </div>
                  ) : null}
                </div>

                <div className="grid gap-2 rounded-md border border-border p-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <div className="text-xs text-muted-foreground">{t("sources.scanBatches")}</div>
                    <div>{selected.scan_summary?.batch_count ?? 0}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">{t("sources.scanAdded")}</div>
                    <div>{selected.scan_summary?.added_tweet_count ?? 0}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">{t("sources.lastScanSuccess")}</div>
                    <div>{formatDateTime(selected.scan_summary?.last_success_at)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">{t("sources.lastScanError")}</div>
                    <div>{formatDateTime(selected.scan_summary?.last_error_at)}</div>
                  </div>
                </div>

                <div className="space-y-3 rounded-md border border-border p-3">
                  <div className="text-sm font-medium">{t("sources.primaryActions")}</div>
                  <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    disabled={historyBusy || (historyEnabled && selected.status === "active")}
                    onClick={() => {
                      if (selectedSourceId) {
                        historyScanMutation.mutate({
                          sourceId: selectedSourceId,
                          limit: Math.max(1, Math.min(200, Number(scanLimit) || 20)),
                        });
                      }
                    }}
                  >
                    {historyEnabled ? t("sources.historyContinue") : t("sources.historyStart")}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={statusMutation.isPending || selected.status === "paused" || !historyEnabled}
                    onClick={() => statusMutation.mutate({ sourceId: selected.id, status: "paused" })}
                  >
                    {t("sources.pauseHistory")}
                  </Button>
                  {historyScanMutation.error || stopHistoryScanMutation.error ? (
                    <p className="basis-full text-sm text-destructive">
                      {String(historyScanMutation.error || stopHistoryScanMutation.error)}
                    </p>
                  ) : null}
                  </div>
                  <p className="basis-full text-xs text-muted-foreground">{t("sources.historyHint")}</p>
                </div>

                <div className="space-y-3 rounded-md border border-border p-3">
                  <div className="text-sm font-medium">{t("sources.downloadActions")}</div>
                  <div className="flex flex-wrap gap-2">
                  <Input
                    className="w-28"
                    type="number"
                    min={1}
                    max={500}
                    value={submitLimit}
                    onChange={(event) => setSubmitLimit(event.target.value)}
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!canSubmitDiscovered}
                    onClick={() => {
                      if (selectedSourceId) {
                        submitDiscoveredMutation.mutate({
                          sourceId: selectedSourceId,
                          limit: Math.max(1, Math.min(500, Number(submitLimit) || 20)),
                        });
                      }
                    }}
                  >
                    {t("sources.submitUnqueued")}
                  </Button>
                  {submitDiscoveredMutation.error ? (
                    <p className="basis-full text-sm text-destructive">{String(submitDiscoveredMutation.error)}</p>
                  ) : null}
                  </div>
                  <p className="text-xs text-muted-foreground">{t("sources.downloadHint")}</p>
                </div>

                <details className="rounded-md border border-border p-3">
                  <summary className="cursor-pointer text-sm font-medium">{t("sources.advancedActions")}</summary>
                  <div className="mt-3 space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <Input
                        className="w-28"
                        type="number"
                        min={1}
                        max={200}
                        value={scanLimit}
                        onChange={(event) => setScanLimit(event.target.value)}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={!canScan}
                        onClick={() => {
                          if (selectedSourceId) {
                            scanMutation.mutate({
                              sourceId: selectedSourceId,
                              limit: Math.max(1, Math.min(200, Number(scanLimit) || 20)),
                            });
                          }
                        }}
                      >
                        {t("sources.scanNext")}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={!canScan}
                        onClick={() => {
                          if (selectedSourceId) {
                            scanMutation.mutate({
                              sourceId: selectedSourceId,
                              limit: Math.max(1, Math.min(200, Number(scanLimit) || 20)),
                              restart: true,
                            });
                          }
                        }}
                      >
                        {t("sources.scanLatest")}
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={!historyEnabled || historyBusy}
                        onClick={() => {
                          if (selectedSourceId) stopHistoryScanMutation.mutate(selectedSourceId);
                        }}
                      >
                        {t("sources.historyStop")}
                      </Button>
                    </div>
                    {scanMutation.error ? <p className="text-sm text-destructive">{String(scanMutation.error)}</p> : null}
                    {scanFeedback ? (
                      <p className="rounded-md bg-muted p-3 text-sm">
                        {t("sources.scanFeedback", {
                          discovered: Number(scanFeedback.discovered_count || 0),
                          fresh: Number(scanFeedback.new_discovered_count || 0),
                          duplicate: Number(scanFeedback.duplicate_count || 0),
                          state: scanFeedback.completed ? t("sources.scanCompleted") : "",
                        })}
                      </p>
                    ) : null}
                    <p className="text-xs text-muted-foreground">{t("sources.advancedHint")}</p>
                  </div>
                </details>

                <details className="rounded-md border border-border p-3">
                  <summary className="cursor-pointer text-sm font-medium">{t("sources.manualImport")}</summary>
                  <div className="mt-3 space-y-3">
                  <textarea
                    className="min-h-24 w-full resize-y rounded-md border border-border bg-white px-3 py-2 text-sm outline-none focus:border-primary"
                    placeholder="https://x.com/user/status/123"
                    value={recordUrls}
                    onChange={(event) => setRecordUrls(event.target.value)}
                  />
                  <Button
                    type="button"
                    disabled={!canSubmit}
                    onClick={() => {
                      if (selectedSourceId) submitMutation.mutate({ sourceId: selectedSourceId, records: sourceRecords });
                    }}
                  >
                    {t("sources.submitDiscovered")}
                  </Button>
                  {submitMutation.error ? <p className="text-sm text-destructive">{String(submitMutation.error)}</p> : null}
                  {feedback ? (
                    <p className="rounded-md bg-muted p-3 text-sm">
                      {t("sources.submitFeedback", {
                        runId: feedback.run_id,
                        queued: feedback.tasks.queued_count,
                        skipped: feedback.tasks.skipped_verified_count,
                        linked: feedback.tasks.linked_pending_count,
                      })}
                    </p>
                  ) : null}
                  </div>
                </details>

                <div className="space-y-2">
                  <div className="text-sm font-medium">{t("sources.scanHistory")}</div>
                  {selected.scan_runs?.map((run) => (
                    <div key={run.id} className="rounded-md border border-border p-3 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge>{scanTriggerLabel(run.trigger_type, t)}</Badge>
                          <Badge className={scanStatusClassName(run.status)}>{scanStatusLabel(run.status, t)}</Badge>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {run.status === "running"
                            ? t("sources.activeScanElapsedValue", { elapsed: formatElapsed(run.started_at, now) })
                            : formatDateTime(run.finished_at || run.created_at)}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        <span>{t("sources.scanRange")}: {formatRunRange(run.range_start, run.range_end)}</span>
                        <span>{t("sources.activeScanStarted")}: {formatDateTime(run.started_at)}</span>
                        <span>{t("sources.scanFound")}: {run.discovered_tweet_count}</span>
                        <span>{t("sources.scanNew")}: {run.new_tweet_count}</span>
                        <span>{t("sources.scanDuplicate")}: {run.duplicate_tweet_count}</span>
                        <span>{t("sources.scanMedia")}: {run.discovered_media_count}</span>
                      </div>
                      {run.error_message ? (
                        <p className="mt-2 break-words text-xs text-destructive">
                          {run.error_category || t("sources.scanFailed")}: {run.error_message}
                        </p>
                      ) : null}
                    </div>
                  ))}
                  {selected.scan_runs?.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("sources.noScanHistory")}</p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <div className="text-sm font-medium">{t("sources.recentDiscovered")}</div>
                  {selected.discovered?.map((tweet) => (
                    <div key={tweet.id} className="rounded-md border border-border p-3 text-sm">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <div className="text-xs text-muted-foreground">
                            @{tweet.author_username || selected.author_username || "-"} · {tweet.tweet_id}
                          </div>
                          <div className="whitespace-pre-wrap break-words text-sm leading-6">
                            {tweet.text || t("tweet.noText")}
                          </div>
                          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                            {formatDiscoveredMedia(tweet.raw_payload, t)}
                          </div>
                        </div>
                        <Badge>{statusLabel(tweet.download_status)}</Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {formatDateTime(tweet.discovered_at)} ·{" "}
                        {tweet.archive_run_id ? `Run #${tweet.archive_run_id}` : t("sources.notQueued")}
                      </div>
                    </div>
                  ))}
                  {selected.discovered?.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("sources.noDiscovered")}</p>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="text-sm text-muted-foreground">{t("sources.select")}</p>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function parseRecordUrls(value: string) {
  const seen = new Set<string>();
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const tweetId = line.match(/\/status\/(\d+)/)?.[1];
      if (!tweetId || seen.has(tweetId)) return false;
      seen.add(tweetId);
      return true;
    })
    .map((url) => ({ url }));
}

function sourceQueryString(status: string, type: string, limit: number, offset: number) {
  const search = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (status) search.set("source_status", status);
  if (type) search.set("source_type", type);
  return search.toString();
}

function sourceTypeLabel(type: string, t: (key: string) => string) {
  return t(`sources.type.${type}`);
}

function inferSourceType(url: string) {
  try {
    const parsed = new URL(url.trim());
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.includes("search")) return "search";
    if (parts.includes("bookmarks")) return "bookmarks";
    if (parts.includes("likes")) return "likes";
    if (parts[1] === "media") return "user_media";
    if (parts.length === 1 && !["home", "i"].includes(parts[0])) return "profile";
  } catch (_error) {
    return null;
  }
  return null;
}

function unwrapActionResult(response: Record<string, unknown>) {
  const result = response.result;
  return result && typeof result === "object" ? (result as Record<string, unknown>) : response;
}

function formatNextRange(cursorState: ArchiveSource["cursor_state"], fallbackLimit: number) {
  if (cursorState?.last_completed) return "-";
  const start = Math.max(1, Number(cursorState?.next_start_index) || 1);
  const limit = Math.max(1, Math.min(200, fallbackLimit));
  return `${start}-${start + limit - 1}`;
}

function formatScanState(cursorState: ArchiveSource["cursor_state"], t: (key: string) => string) {
  if (cursorState?.last_completed) return t("sources.scanCompleted");
  if (cursorState?.last_reached_known_region) return t("sources.scanKnownRegion");
  return t("sources.scanContinuing");
}

function formatHistoryState(source: ArchiveSource, t: (key: string) => string) {
  const state = source.cursor_state?.automation_state;
  if (source.status === "completed" || state === "completed") return t("sources.historyCompleted");
  if (!source.cursor_state?.automation_enabled) return t("sources.historyIdle");
  if (source.status === "paused" || state === "paused") return t("sources.historyPaused");
  if (state === "waiting_downloads") return t("sources.historyWaitingDownloads");
  if (state === "retry_wait") return t("sources.historyRetryWait");
  if (state === "rate_limited") return t("sources.historyRateLimited");
  if (state === "auth_required") return t("sources.historyAuthRequired");
  if (state === "running" && source.next_scan_at) return t("sources.historyScheduled");
  return t("sources.historyRunning");
}

function formatRunRange(start?: number | null, end?: number | null) {
  return start && end ? `${start}-${end}` : "-";
}

function formatElapsed(startedAt?: string | null, now = Date.now()) {
  if (!startedAt) return "-";
  const started = new Date(startedAt).getTime();
  if (Number.isNaN(started)) return "-";
  const totalSeconds = Math.max(0, Math.floor((now - started) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds.toString().padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${(minutes % 60).toString().padStart(2, "0")}m`;
}

function scanTriggerLabel(trigger: string, t: (key: string) => string) {
  return t(`sources.scanTrigger.${trigger}`);
}

function scanStatusLabel(status: string, t: (key: string) => string) {
  return t(`sources.scanStatus.${status}`);
}

function scanStatusClassName(status: string) {
  if (["rate_limited", "auth_required", "network_error", "failed"].includes(status)) {
    return "border-destructive/30 bg-destructive/10 text-destructive";
  }
  if (status === "succeeded" || status === "completed_empty_batch" || status === "completed_end_of_source") {
    return "border-primary/30 bg-primary/10 text-primary";
  }
  return "";
}

function formatDiscoveredMedia(
  payload: NonNullable<ArchiveSource["discovered"]>[number]["raw_payload"],
  t: (key: string, params?: Record<string, string | number>) => string,
) {
  const count = Number(payload?.media_count || 0);
  if (!count) return t("sources.mediaUnknown");
  const types = new Set(payload?.media_types || []);
  if (types.has("photo") && types.has("video")) return t("sources.mediaMixed", { count });
  if (types.has("video")) return t("sources.mediaVideo", { count });
  if (types.has("photo")) return t("sources.mediaPhoto", { count });
  return t("sources.mediaCount", { count });
}
