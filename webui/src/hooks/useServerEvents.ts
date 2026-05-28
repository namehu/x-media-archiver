import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { apiUrl } from "../lib/api";

export type ServerEventsState = {
  status: "connecting" | "connected" | "offline";
  lastEventAt?: number;
};

type ServerEvent = {
  topic?: string;
  type?: string;
  event_type?: string;
  payload?: Record<string, unknown>;
};

const SERVER_EVENT_TYPES = [
  "run.created",
  "run.running",
  "run.updated",
  "run.items_updated",
  "run.items_failed",
  "source.created",
  "source.updated",
  "source.history",
  "source.scan",
  "source.discovered",
  "source.submitted",
  "worker.lock",
  "archive.run.submitted",
  "archive.run.processing",
  "archive.run.items_processed",
  "archive.run.items_failed",
  "archive.run.completed",
  "archive.run.updated",
  "archive.run.retried",
  "source.status_changed",
  "source.history_scan.started",
  "source.history_scan.stopped",
  "source.scan.started",
  "source.scan.completed",
  "source.scan.discovered",
  "source.scan.waiting_downloads",
  "source.discovered.submitted",
];

const TOPIC_ALIASES: Record<string, string[]> = {
  run: ["archive_runs"],
  source: ["sources", "source_scans"],
};

export function useServerEvents(topics: string[]): ServerEventsState {
  const queryClient = useQueryClient();
  const requestedTopics = topics.join(",");
  const topicKey = useMemo(() => expandTopics(topics).join(","), [requestedTopics]);
  const [state, setState] = useState<ServerEventsState>({ status: "connecting" });
  const lastStatusRef = useRef<ServerEventsState["status"]>("connecting");

  useEffect(() => {
    if (!topicKey || typeof EventSource === "undefined") {
      setState({ status: "offline" });
      return undefined;
    }

    let closed = false;
    const eventSource = new EventSource(apiUrl(`/api/v1/events?topics=${encodeURIComponent(topicKey)}`));

    const setStatus = (status: ServerEventsState["status"], lastEventAt?: number) => {
      lastStatusRef.current = status;
      setState((current) => ({ ...current, status, lastEventAt: lastEventAt ?? current.lastEventAt }));
    };

    const handleEvent = (message: MessageEvent) => {
      if (closed) return;
      setStatus("connected", Date.now());
      const event = parseServerEvent(message);
      invalidateForEvent(queryClient, event);
    };

    eventSource.onopen = () => {
      if (!closed) setStatus("connected");
    };
    eventSource.onerror = () => {
      if (!closed && lastStatusRef.current !== "offline") setStatus("offline");
    };
    eventSource.onmessage = handleEvent;
    for (const eventType of SERVER_EVENT_TYPES) {
      eventSource.addEventListener(eventType, handleEvent);
    }

    return () => {
      closed = true;
      eventSource.close();
    };
  }, [queryClient, topicKey]);

  return state;
}

function parseServerEvent(message: MessageEvent): ServerEvent {
  try {
    const value = JSON.parse(String(message.data || "{}")) as unknown;
    if (value && typeof value === "object") return value as ServerEvent;
  } catch (_error) {
    return {};
  }
  return {};
}

function invalidateForEvent(queryClient: QueryClient, event: ServerEvent) {
  const topic = event.topic || "";
  const eventType = event.type || event.event_type || "";
  const payload = event.payload || {};

  if (
    topic.startsWith("run") ||
    topic === "archive_runs" ||
    eventType.startsWith("run.") ||
    eventType.startsWith("archive.run.")
  ) {
    const runId = numberFromPayload(payload, "run_id", "archive_run_id", "id");
    void queryClient.invalidateQueries({ queryKey: ["archive-runs"] });
    void queryClient.invalidateQueries(runId ? { queryKey: ["archive-run", runId], exact: true } : { queryKey: ["archive-run"] });
    void queryClient.invalidateQueries({ queryKey: ["summary"] });
    void queryClient.invalidateQueries({ queryKey: ["media"] });
    void queryClient.invalidateQueries({ queryKey: ["failures"] });
    void queryClient.invalidateQueries({ queryKey: ["duplicates"] });
    return;
  }

  if (topic.startsWith("source") || topic === "sources" || topic === "source_scans" || eventType.startsWith("source.")) {
    const sourceId = numberFromPayload(payload, "source_id", "id");
    void queryClient.invalidateQueries({ queryKey: ["sources"] });
    void queryClient.invalidateQueries(
      sourceId ? { queryKey: ["source", sourceId], exact: true } : { queryKey: ["source"] },
    );
    void queryClient.invalidateQueries({ queryKey: ["archive-runs"] });
    void queryClient.invalidateQueries({ queryKey: ["summary"] });
    return;
  }

  if (topic.startsWith("worker") || eventType.startsWith("worker.")) {
    void queryClient.invalidateQueries({ queryKey: ["archive-runs"] });
    void queryClient.invalidateQueries({ queryKey: ["sources"] });
    void queryClient.invalidateQueries({ queryKey: ["summary"] });
  }
}

function expandTopics(topics: string[]) {
  const expanded = new Set<string>();
  for (const topic of topics) {
    expanded.add(topic);
    for (const alias of TOPIC_ALIASES[topic] || []) {
      expanded.add(alias);
    }
  }
  return Array.from(expanded);
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
