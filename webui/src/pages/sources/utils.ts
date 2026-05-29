import type { ArchiveSource } from "../../lib/api";

export type TFunction = (key: string, params?: Record<string, string | number>) => string;

export const SOURCE_TYPES = ["profile", "user_media", "likes", "bookmarks", "search", "manual"] as const;

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

export function sourceQueryString(status: string, type: string, limit: number, offset: number) {
  const search = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (status) search.set("source_status", status);
  if (type) search.set("source_type", type);
  return search.toString();
}

export function sourceTypeLabel(type: string, t: TFunction) {
  return t(`sources.type.${type}`);
}

export function inferSourceType(url: string) {
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

export function unwrapActionResult(response: Record<string, unknown>) {
  const result = response.result;
  return result && typeof result === "object" ? (result as Record<string, unknown>) : response;
}

export function formatNextRange(cursorState: ArchiveSource["cursor_state"], fallbackLimit: number) {
  if (cursorState?.last_completed) return "-";
  const start = Math.max(1, Number(cursorState?.next_start_index) || 1);
  const limit = Math.max(1, Math.min(200, fallbackLimit));
  return `${start}-${start + limit - 1}`;
}

export function formatScanState(cursorState: ArchiveSource["cursor_state"], t: TFunction) {
  if (cursorState?.last_completed) return t("sources.scanCompleted");
  if (cursorState?.last_reached_known_region) return t("sources.scanKnownRegion");
  return t("sources.scanContinuing");
}

export function formatHistoryState(source: ArchiveSource, t: TFunction) {
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

export function scanTriggerLabel(trigger: string, t: TFunction) {
  return t(`sources.scanTrigger.${trigger}`);
}

export function scanStatusLabel(status: string, t: TFunction) {
  return t(`sources.scanStatus.${status}`);
}

export function scanStatusTone(status: string) {
  if (["rate_limited", "auth_required", "network_error", "failed"].includes(status)) return "danger" as const;
  if (status === "succeeded" || status === "completed_empty_batch" || status === "completed_end_of_source") return "default" as const;
  if (status === "waiting_downloads") return "warning" as const;
  return "secondary" as const;
}

export function sourceStatusTone(status: string) {
  if (status === "active") return "success" as const;
  if (status === "paused") return "warning" as const;
  if (status === "failed") return "danger" as const;
  return "secondary" as const;
}

export function formatDiscoveredMedia(
  payload: NonNullable<ArchiveSource["discovered"]>[number]["raw_payload"],
  t: TFunction,
) {
  const count = Number(payload?.media_count || 0);
  if (!count) return t("sources.mediaUnknown");
  const types = new Set(payload?.media_types || []);
  if (types.has("photo") && types.has("video")) return t("sources.mediaMixed", { count });
  if (types.has("video")) return t("sources.mediaVideo", { count });
  if (types.has("photo")) return t("sources.mediaPhoto", { count });
  return t("sources.mediaCount", { count });
}
