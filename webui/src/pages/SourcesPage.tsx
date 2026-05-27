import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, type ArchiveSource, type ArchiveSubmission, type DownloadPolicy } from "../lib/api";
import { useFormatters, useI18n } from "../lib/i18n";
import { formatDateTime } from "../lib/utils";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/Card";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";

export function SourcesPage() {
  const { t } = useI18n();
  const { statusLabel } = useFormatters();
  const queryClient = useQueryClient();
  const [sourceType, setSourceType] = useState("profile");
  const [sourceUrl, setSourceUrl] = useState("");
  const [label, setLabel] = useState("");
  const [selectedSourceId, setSelectedSourceId] = useState<number | null>(null);
  const [recordUrls, setRecordUrls] = useState("");
  const [scanLimit, setScanLimit] = useState("20");
  const [submitLimit, setSubmitLimit] = useState("20");
  const [feedback, setFeedback] = useState<ArchiveSubmission | null>(null);
  const [scanFeedback, setScanFeedback] = useState<Record<string, unknown> | null>(null);

  const sourcesQuery = useQuery({
    queryKey: ["sources"],
    queryFn: () => apiGet<{ rows: ArchiveSource[]; count: number }>("/api/sources"),
    refetchInterval: 5000,
  });
  const detailQuery = useQuery({
    queryKey: ["source", selectedSourceId],
    queryFn: () => apiGet<ArchiveSource>(`/api/sources/${selectedSourceId}`),
    enabled: selectedSourceId !== null,
    refetchInterval: 5000,
  });
  const policyQuery = useQuery({
    queryKey: ["download-policy"],
    queryFn: () => apiGet<DownloadPolicy>("/api/settings/download-policy"),
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
      apiPost<ArchiveSource>("/api/sources", {
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
      apiPost<ArchiveSubmission>(`/api/sources/${sourceId}/records`, { records }),
    onSuccess: async (result) => {
      setFeedback(result);
      setRecordUrls("");
      await refresh(result.source_id as number | undefined);
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ sourceId, status }: { sourceId: number; status: "active" | "paused" }) =>
      apiPost<ArchiveSource>(`/api/sources/${sourceId}/status`, { status }),
    onSuccess: async (source) => refresh(source.id),
  });
  const scanMutation = useMutation({
    mutationFn: ({ sourceId, limit, restart }: { sourceId: number; limit: number; restart?: boolean }) =>
      apiPost<Record<string, unknown>>(`/api/sources/${sourceId}/scan`, { limit, restart }),
    onSuccess: async (response) => {
      const result = unwrapActionResult(response);
      setScanFeedback(result);
      await refresh(Number(result.source_id) || selectedSourceId || undefined);
    },
  });
  const submitDiscoveredMutation = useMutation({
    mutationFn: ({ sourceId, limit }: { sourceId: number; limit?: number }) =>
      apiPost<ArchiveSubmission>(`/api/sources/${sourceId}/submit-discovered`, { limit }),
    onSuccess: async (result) => {
      setFeedback(result);
      await refresh(result.source_id);
    },
  });

  const selected = detailQuery.data;
  const sourceRecords = parseRecordUrls(recordUrls);
  const canCreate = sourceUrl.trim().length > 0 && !createMutation.isPending;
  const canSubmit = Boolean(selectedSourceId && sourceRecords.length && !submitMutation.isPending);
  const canScan = Boolean(selectedSourceId && selected?.status !== "paused" && !scanMutation.isPending);
  const canSubmitDiscovered = Boolean(
    selectedSourceId && (selected?.unsubmitted_tweet_count || 0) > 0 && !submitDiscoveredMutation.isPending,
  );

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
              <Badge>{sourcesQuery.data?.count ?? 0}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {sourcesQuery.data?.rows.map((source) => (
              <button
                type="button"
                key={source.id}
                className="flex w-full items-center justify-between gap-3 rounded-md border border-border bg-white p-3 text-left hover:bg-muted"
                onClick={() => setSelectedSourceId(source.id)}
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{source.label || source.source_url}</div>
                  <div className="text-xs text-muted-foreground">
                    {sourceTypeLabel(source.source_type, t)} · {source.author_username || "-"} ·{" "}
                    {t("sources.discovered")}: {source.discovered_tweet_count ?? source.discovered_count ?? 0}
                  </div>
                </div>
                <Badge>{statusLabel(source.status)}</Badge>
              </button>
            ))}
            {sourcesQuery.data?.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("sources.empty")}</p>
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
                  <div className="grid gap-2 rounded-md border border-border p-3 text-sm sm:grid-cols-3">
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
                </div>

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
                    disabled={statusMutation.isPending || selected.status === "paused"}
                    onClick={() => statusMutation.mutate({ sourceId: selected.id, status: "paused" })}
                  >
                    {t("sources.pause")}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={statusMutation.isPending || selected.status === "active"}
                    onClick={() => statusMutation.mutate({ sourceId: selected.id, status: "active" })}
                  >
                    {t("sources.resume")}
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

                <div className="flex flex-wrap gap-2 rounded-md border border-border p-3">
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

                <div className="space-y-3">
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
  if (isLikelyCompleted(cursorState)) return "-";
  const start = Math.max(1, Number(cursorState?.next_start_index) || 1);
  const limit = Math.max(1, Math.min(200, fallbackLimit));
  return `${start}-${start + limit - 1}`;
}

function formatScanState(cursorState: ArchiveSource["cursor_state"], t: (key: string) => string) {
  if (isLikelyCompleted(cursorState)) return t("sources.scanCompleted");
  if (cursorState?.last_reached_known_region) return t("sources.scanKnownRegion");
  return t("sources.scanContinuing");
}

function isLikelyCompleted(cursorState: ArchiveSource["cursor_state"]) {
  if (!cursorState) return false;
  if (cursorState.last_completed) return true;
  const rawCount = Number(cursorState.last_raw_record_count ?? cursorState.last_discovered_count ?? 0);
  const limit = Number(cursorState.last_limit || 0);
  return limit > 0 && rawCount >= 0 && rawCount < limit;
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
