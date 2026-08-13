import type { QueryClient } from "@tanstack/react-query";

export type ServerEvent = {
  id?: number;
  sequence?: number;
  epoch?: string;
  topic?: string;
  type?: string;
  event_type?: string;
  payload?: Record<string, unknown>;
  created_at?: string;
};

const RUNTIME_PERSISTENT_QUERY_ROOTS = new Set([
  "summary",
  "media",
  "posts",
  "tweet",
  "failures",
  "duplicates",
  "sources",
  "source",
  "source-downloads",
  "source-discovered",
  "source-scan-runs",
  "archive-runs",
  "archive-run",
  "health-detail",
  "library-insights",
]);

export function invalidateRuntimePersistentQueries(queryClient: QueryClient) {
  return queryClient.invalidateQueries({
    predicate: (query) => {
      const root = query.queryKey[0];
      return typeof root === "string" && RUNTIME_PERSISTENT_QUERY_ROOTS.has(root);
    },
    refetchType: "active",
  });
}

export function invalidateForEvent(queryClient: QueryClient, event: ServerEvent) {
  const topic = event.topic || "";
  const eventType = event.type || event.event_type || "";
  const payload = event.payload || {};

  if (eventType === "archive.run.progress" || eventType === "source.scan.log" || eventType.startsWith("operation.log.")) {
    return;
  }

  if (
    topic.startsWith("run") ||
    topic === "archive_runs" ||
    eventType.startsWith("run.") ||
    eventType.startsWith("archive.run.")
  ) {
    const runId = numberFromPayload(payload, "run_id", "archive_run_id", "id");
    void queryClient.invalidateQueries({ queryKey: ["archive-runs"] });
    void queryClient.invalidateQueries(runId ? { queryKey: ["archive-run", runId], exact: true } : { queryKey: ["archive-run"] });
    void queryClient.invalidateQueries({ queryKey: ["source-downloads"] });
    if (shouldRefreshSourceDiscoveriesForRunEvent(eventType)) {
      void queryClient.invalidateQueries({ queryKey: ["source-discovered"] });
    }
    void queryClient.invalidateQueries({ queryKey: ["summary"] });
    void queryClient.invalidateQueries({ queryKey: ["library-insights"] });
    void queryClient.invalidateQueries({ queryKey: ["health-detail"] });
    if (shouldRefreshLibraryForRunEvent(eventType)) {
      void queryClient.invalidateQueries({ queryKey: ["media"] });
      void queryClient.invalidateQueries({ queryKey: ["posts"] });
      void queryClient.invalidateQueries({ queryKey: ["failures"] });
      void queryClient.invalidateQueries({ queryKey: ["duplicates"] });
    }
    return;
  }

  if (topic.startsWith("source") || topic === "sources" || topic === "source_scans" || eventType.startsWith("source.")) {
    const sourceId = numberFromPayload(payload, "source_id", "id");
    void queryClient.invalidateQueries({ queryKey: ["sources"] });
    void queryClient.invalidateQueries(sourceId ? { queryKey: ["source", sourceId] } : { queryKey: ["source"] });
    if (shouldRefreshArchiveRunsForSourceEvent(eventType)) {
      void queryClient.invalidateQueries({ queryKey: ["archive-runs"] });
    }
    if (shouldRefreshSourceDownloadsForSourceEvent(eventType)) {
      void queryClient.invalidateQueries({ queryKey: sourceId ? ["source-downloads", sourceId] : ["source-downloads"] });
    }
    if (shouldRefreshSourceDiscoveriesForSourceEvent(eventType)) {
      void queryClient.invalidateQueries({ queryKey: sourceId ? ["source-discovered", sourceId] : ["source-discovered"] });
    }
    if (shouldRefreshSourceScanRunsForSourceEvent(eventType)) {
      void queryClient.invalidateQueries({ queryKey: sourceId ? ["source-scan-runs", sourceId] : ["source-scan-runs"] });
    }
    void queryClient.invalidateQueries({ queryKey: ["summary"] });
    void queryClient.invalidateQueries({ queryKey: ["library-insights"] });
    void queryClient.invalidateQueries({ queryKey: ["health-detail"] });
    return;
  }

  if (topic.startsWith("worker") || eventType.startsWith("worker.")) {
    void queryClient.invalidateQueries({ queryKey: ["archive-runs"] });
    void queryClient.invalidateQueries({ queryKey: ["sources"] });
    void queryClient.invalidateQueries({ queryKey: ["summary"] });
    void queryClient.invalidateQueries({ queryKey: ["library-insights"] });
    void queryClient.invalidateQueries({ queryKey: ["health-detail"] });
  }

  if (topic === "library" || eventType.startsWith("library.")) {
    const deletedTweetIds = stringArrayFromPayload(payload, "tweet_ids");
    if (eventType === "library.media_deleted" && deletedTweetIds.length) {
      markDeletedPostsInCache(queryClient, deletedTweetIds);
    }
    void queryClient.invalidateQueries({ queryKey: ["media"] });
    if (eventType !== "library.media_deleted" || !deletedTweetIds.length) {
      void queryClient.invalidateQueries({ queryKey: ["posts"] });
    }
    void queryClient.invalidateQueries({ queryKey: ["tweet"] });
    void queryClient.invalidateQueries({ queryKey: ["summary"] });
    void queryClient.invalidateQueries({ queryKey: ["library-insights"] });
    void queryClient.invalidateQueries({ queryKey: ["failures"] });
    void queryClient.invalidateQueries({ queryKey: ["duplicates"] });
    void queryClient.invalidateQueries({ queryKey: ["source-discovered"] });
  }

}

export function createEventInvalidationScheduler(queryClient: QueryClient, delayMs = 250) {
  const pending = new Map<string, ServerEvent>();
  let timer: number | null = null;
  const flush = () => {
    timer = null;
    const events = [...pending.values()];
    pending.clear();
    for (const event of events) invalidateForEvent(queryClient, event);
  };
  return {
    schedule(event: ServerEvent) {
      const eventType = event.type || event.event_type || "";
      if (eventType === "archive.run.progress" || eventType === "source.scan.log" || eventType.startsWith("operation.log.")) return;
      const payload = event.payload || {};
      const identity = [
        event.topic || "",
        eventType,
        stringFromPayload(payload, "operation_id") ||
          numberFromPayload(payload, "run_id", "archive_run_id", "source_id", "scan_run_id") ||
          "",
      ].join(":");
      pending.set(identity, mergeScheduledEvents(pending.get(identity), event));
      if (timer === null) timer = window.setTimeout(flush, delayMs);
    },
    dispose() {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      pending.clear();
    },
  };
}

function shouldRefreshSourceDiscoveriesForRunEvent(eventType: string) {
  return [
    "archive.run.submitted",
    "archive.run.items_processed",
    "archive.run.items_failed",
    "archive.run.completed",
    "archive.run.updated",
    "archive.run.retried",
    "archive.run.items_cancelled",
    "archive.run.stopped",
  ].includes(eventType);
}

function shouldRefreshLibraryForRunEvent(eventType: string) {
  return [
    "archive.run.items_processed",
    "archive.run.items_failed",
    "archive.run.completed",
    "archive.run.updated",
    "archive.run.retried",
    "archive.run.stopped",
  ].includes(eventType);
}

function shouldRefreshArchiveRunsForSourceEvent(eventType: string) {
  return ["source.discovered.submitted", "source.download.submitted"].includes(eventType);
}

function shouldRefreshSourceDownloadsForSourceEvent(eventType: string) {
  return ["source.discovered.submitted", "source.download.submitted"].includes(eventType);
}

function shouldRefreshSourceDiscoveriesForSourceEvent(eventType: string) {
  return [
    "source.created",
    "source.deleted",
    "source.restored",
    "source.scan.discovered",
    "source.scan.completed",
    "source.discovered.submitted",
    "source.download.submitted",
  ].includes(eventType);
}

function shouldRefreshSourceScanRunsForSourceEvent(eventType: string) {
  return (
    eventType.startsWith("source.scan.") ||
    eventType.startsWith("source.scan_session.") ||
    eventType.startsWith("source.history_scan.")
  );
}

function numberFromPayload(payload: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function stringArrayFromPayload(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function stringFromPayload(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function mergeScheduledEvents(current: ServerEvent | undefined, next: ServerEvent): ServerEvent {
  if (!current) return next;
  const currentPayload = current.payload || {};
  const nextPayload = next.payload || {};
  const tweetIds = [...new Set([
    ...stringArrayFromPayload(currentPayload, "tweet_ids"),
    ...stringArrayFromPayload(nextPayload, "tweet_ids"),
  ])];
  return {
    ...current,
    ...next,
    payload: {
      ...currentPayload,
      ...nextPayload,
      ...(tweetIds.length ? { tweet_ids: tweetIds } : {}),
    },
  };
}

function markDeletedPostsInCache(queryClient: QueryClient, tweetIds: string[]) {
  const deletedTweetIds = new Set(tweetIds);
  queryClient.setQueriesData({ queryKey: ["posts"] }, (current: unknown) => markDeletedPosts(current, deletedTweetIds));
}

function markDeletedPosts(current: unknown, deletedTweetIds: Set<string>): unknown {
  if (!current || typeof current !== "object" || !("pages" in current)) return current;
  const infiniteData = current as {
    pages?: Array<{ rows?: Array<Record<string, unknown>> }>;
    pageParams?: unknown[];
  };
  if (!Array.isArray(infiniteData.pages)) return current;

  let changed = false;
  const pages = infiniteData.pages.map((page) => {
    if (!Array.isArray(page.rows)) return page;
    let pageChanged = false;
    const rows = page.rows.map((row) => {
      const tweetId = typeof row.tweet_id === "string" ? row.tweet_id : "";
      if (!deletedTweetIds.has(tweetId)) return row;
      pageChanged = true;
      return { ...row, media: [] };
    });
    if (!pageChanged) return page;
    changed = true;
    return { ...page, rows };
  });

  return changed ? { ...infiniteData, pages } : current;
}
