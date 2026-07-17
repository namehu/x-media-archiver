import { ApiError, type ActionResponse, type MediaDeleteResult } from "./api";

export type MediaDeleteResponse = Omit<ActionResponse, "result"> & { result: MediaDeleteResult };

export function formatDeletedBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function mediaDeleteErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 409) return "所选 Tweet 仍有下载任务或其他写操作，请先停止任务后重试。";
    if (error.status === 404) return "部分媒体已不存在，请刷新页面后重新选择。";
    if (error.code === "invalid_media_delete_path" || error.message.includes("invalid_media_delete_path")) {
      return "检测到不安全的媒体路径，未执行删除。";
    }
  }
  return error instanceof Error ? error.message : "删除媒体失败，请重试。";
}
