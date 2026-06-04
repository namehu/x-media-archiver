import type { ArchiveSourceDetail, SourceDiscovery } from "@/lib/api";
import { scanStatusLabel, scanTriggerLabel, sourceTypeLabel } from "@/lib/formatters";

export function unwrapActionResult(response: Record<string, unknown>) {
  const result = response.result;
  return result && typeof result === "object" ? (result as Record<string, unknown>) : response;
}

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
  const state = source.cursor_state?.automation_state;
  const mode = source.cursor_state?.active_scan_mode;
  const modeLabel =
    mode === "latest_refresh" ? "补充最新推文" : mode === "from_start" ? "从头扫描/补断层" : "历史扫描";
  if (state === "completed") return `${modeLabel}已完成`;
  if (source.status === "completed") return "历史扫描已完成";
  if (state === "stopped") return `${modeLabel}已停止`;
  if (!source.cursor_state?.automation_enabled) return "未启动";
  if (source.status === "paused" || state === "paused") return `${modeLabel}已暂停`;
  if (state === "waiting_downloads") return `${modeLabel}等待下载队列清空`;
  if (state === "retry_wait") return `${modeLabel}错误后等待重试`;
  if (state === "rate_limited") return `${modeLabel}限流后已暂停`;
  if (state === "auth_required") return `${modeLabel}需认证，已暂停`;
  if (state === "running" && source.next_scan_at) return `${modeLabel}等待随机间隔后扫描`;
  return `${modeLabel}后台扫描中`;
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

export function sourceStatusTone(status: string) {
  if (status === "active") return "success" as const;
  if (status === "paused") return "warning" as const;
  if (status === "failed") return "danger" as const;
  return "secondary" as const;
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
