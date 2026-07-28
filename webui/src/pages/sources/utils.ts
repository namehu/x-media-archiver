import type { ArchiveSourceDetail, ArchiveSourceListItem, SourceDiscovery } from "@/lib/api";
import { scanStatusLabel, scanTriggerLabel, sourceTypeLabel } from "@/lib/formatters";

export function unwrapActionResult(response: Record<string, unknown>) {
  const result = response.result;
  return result && typeof result === "object" ? (result as Record<string, unknown>) : response;
}

export const SOURCE_TYPES = ["profile", "user_media", "likes", "bookmarks", "search", "manual"] as const;
export const SOURCE_DELETED_FILTERS = ["active", "deleted", "all"] as const;
export type SourceDeletedFilter = (typeof SOURCE_DELETED_FILTERS)[number];

export function parseRecordUrls(value: string) {
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

export function sourceQueryString(
  type: string,
  deleted: SourceDeletedFilter,
  sortBy: "updated_at" | "created_at",
  sortDirection: "asc" | "desc",
  limit: number,
  offset: number,
) {
  const search = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (type) search.set("source_type", type);
  if (deleted !== "active") search.set("deleted", deleted);
  search.set("sort_by", sortBy);
  search.set("sort_direction", sortDirection);
  return search.toString();
}

export function formatNextRange(cursorState: ArchiveSourceDetail["cursor_state"], fallbackLimit: number) {
  const session = activeScanSession(cursorState);
  if (Boolean(session?.completed ?? cursorState?.last_completed)) return "-";
  const start = Math.max(1, Number(session?.next_start_index ?? cursorState?.next_start_index) || 1);
  const limit = Math.max(1, Math.min(200, fallbackLimit));
  return `${start}-${start + limit - 1}`;
}

export function formatScanState(cursorState: ArchiveSourceDetail["cursor_state"]) {
  const session = activeScanSession(cursorState);
  if (Boolean(session?.completed ?? cursorState?.last_completed)) return "可能已到结尾";
  if (Boolean(session?.last_reached_known_region ?? cursorState?.last_reached_known_region)) return "已进入重复区";
  return "可继续扫描";
}

export function formatHistoryState(source: ArchiveSourceDetail) {
  return sourceScanStatus(source).label;
}

export function sourceScanStatus(source: ArchiveSourceListItem) {
  if (source.deleted_at) return { key: "deleted", label: "已删除", tone: "danger" as const };

  const state = source.cursor_state?.automation_state;
  const automationEnabled = Boolean(source.cursor_state?.automation_enabled);

  if (source.status === "failed") return { key: "failed", label: "扫描失败", tone: "danger" as const };
  if (source.status === "paused" || ["paused", "rate_limited", "auth_required"].includes(state || "")) {
    return { key: "paused", label: "已暂停", tone: "warning" as const };
  }
  if (state === "stopped") return { key: "stopped", label: "已停止", tone: "secondary" as const };
  if (automationEnabled || ["running", "waiting_downloads", "retry_wait"].includes(state || "")) {
    return { key: "running", label: "扫描中", tone: "success" as const };
  }
  if (
    source.status === "completed" ||
    state === "completed" ||
    Boolean(source.cursor_state?.last_completed) ||
    Number(source.scan_batch_count || 0) > 0
  ) {
    return { key: "completed", label: "扫描完成", tone: "default" as const };
  }
  return { key: "pending", label: "待扫描", tone: "secondary" as const };
}

function activeScanSession(cursorState: ArchiveSourceDetail["cursor_state"]) {
  const mode = cursorState?.active_scan_mode;
  const session = mode ? cursorState?.scan_sessions?.[mode] : undefined;
  return session && typeof session === "object" ? session : undefined;
}

export function formatRunRange(start?: number | null, end?: number | null) {
  return start && end ? `${start}-${end}` : "-";
}

export function formatElapsed(startedAt?: string | null, now = Date.now()) {
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

export function scanStatusTone(status: string) {
  if (["rate_limited", "auth_required", "network_error", "failed"].includes(status)) return "danger" as const;
  if (status === "succeeded" || status === "completed_empty_batch" || status === "completed_end_of_source")
    return "default" as const;
  if (status === "waiting_downloads") return "warning" as const;
  return "secondary" as const;
}

type ScanMode = "history" | "latest_refresh" | "from_start";

export function scanModeLabel(mode: ScanMode) {
  if (mode === "latest_refresh") return "补充最新推文";
  if (mode === "from_start") return "从头扫描/补断层";
  return "历史扫描";
}

export function getActiveScanMode(source: ArchiveSourceDetail): ScanMode {
  const mode = source.cursor_state?.active_scan_mode;
  if (mode === "latest_refresh" || mode === "from_start" || mode === "history") return mode;
  return "history";
}

export function preferredScanLimit(source: ArchiveSourceDetail, policy?: { source_scan_batch_size?: number | null }) {
  const candidates = [
    source.cursor_state?.scan_sessions?.[getActiveScanMode(source)]?.limit,
    source.cursor_state?.automation_limit,
    source.cursor_state?.last_limit,
    source.active_scan_run?.requested_limit,
    policy?.source_scan_batch_size,
    20,
  ];
  const MIN = 5;
  const MAX = 200;
  for (const candidate of candidates) {
    const value = Number(candidate);
    if (Number.isFinite(value) && value >= 1) return Math.max(MIN, Math.min(MAX, Math.floor(value)));
  }
  return 20;
}

export function formatDiscoveredMedia(payload: SourceDiscovery["raw_payload"]) {
  const count = Number(payload?.media_count || 0);
  if (!count) return "媒体数量未知";
  const types = new Set(payload?.media_types || []);
  if (types.has("photo") && types.has("video")) return `图片/视频 ${count}`;
  if (types.has("video")) return `视频 ${count}`;
  if (types.has("photo")) return `图片 ${count}`;
  return `媒体 ${count}`;
}
