const STATUS_MAP: Record<string, string> = {
  verified: "已校验",
  pending: "待处理",
  processing: "处理中",
  running: "运行中",
  queued: "已入队",
  blocked: "等待前序任务",
  completed: "已完成",
  completed_with_failures: "完成但有失败",
  failed: "失败",
  active: "启用",
  paused: "已暂停",
  stopped: "已停止",
  failed_retryable: "可重试失败",
  failed_permanent: "永久失败",
  skipped_verified: "已归档跳过",
  linked_pending: "已有关联任务",
  cancelled: "已取消",
  downloaded: "已下载",
  downloading: "下载中",
  missing: "文件缺失",
  corrupt: "文件损坏",
  unknown: "未知错误",
};

const MEDIA_TYPE_MAP: Record<string, string> = {
  all: "全部媒体",
  photo: "图片",
  video: "视频",
  media: "媒体",
};

const ERROR_MAP: Record<string, string> = {
  invalid_url: "URL 无效或内容不存在",
  download_no_output: "下载器没有产出文件",
  auth_required: "需要登录或 cookies 无效",
  rate_limited: "访问频率受限",
  network_error: "网络错误",
  unsupported_media: "没有可下载媒体",
  unknown: "未知错误",
  command_not_found: "下载器命令不存在",
  worker_error: "队列执行异常",
};

const TRIGGER_MAP: Record<string, string> = {
  webui: "网页提交",
  cli_urls: "CLI URL 文件",
  cli_jsonl: "CLI JSONL 文件",
  manual_retry: "手动重试",
  manual_requeue: "手动重新入队",
  source_collector: "来源采集",
  source_download: "来源下载",
};

export function statusLabel(status?: string | null): string {
  if (!status) return "-";
  return STATUS_MAP[status] ?? status;
}

export function mediaTypeLabel(mediaType?: string | null): string {
  if (!mediaType) return "媒体";
  return MEDIA_TYPE_MAP[mediaType] ?? mediaType;
}

export function errorLabel(error?: string | null): string {
  if (!error) return "-";
  return ERROR_MAP[error] ?? error;
}

export function triggerLabel(trigger?: string | null): string {
  if (!trigger) return "-";
  return TRIGGER_MAP[trigger] ?? trigger;
}

// 来源类型映射
const SOURCE_TYPE_LABELS: Record<string, string> = {
  all: "全部来源",
  profile: "博主主页",
  user_media: "博主媒体页",
  likes: "点赞",
  bookmarks: "书签",
  search: "搜索",
  manual: "手动",
};

export function sourceTypeLabel(type: string): string {
  return SOURCE_TYPE_LABELS[type] ?? type;
}

// 扫描触发方式映射
const SCAN_TRIGGER_LABELS: Record<string, string> = {
  history_worker: "后台历史扫描",
  manual_next: "手工下一批",
  latest_refresh: "补充最新推文",
  from_start_repair: "从头扫描/补断层",
};

export function scanTriggerLabel(trigger: string): string {
  return SCAN_TRIGGER_LABELS[trigger] ?? trigger;
}

// 扫描状态映射
const SCAN_STATUS_LABELS: Record<string, string> = {
  running: "执行中",
  waiting_downloads: "等待下载队列",
  succeeded: "成功",
  completed_empty_batch: "空批，已到结尾",
  completed_end_of_source: "末批完成，已到结尾",
  rate_limited: "限流暂停",
  auth_required: "需要认证",
  network_error: "网络错误",
  failed: "失败",
};

export function scanStatusLabel(status: string): string {
  return SCAN_STATUS_LABELS[status] ?? status;
}

// 操作动作名称映射
const ACTION_LABELS: Record<string, string> = {
  requeue: "重新入队",
  "recover-interrupted": "恢复中断任务",
  "export-media": "导出媒体 CSV",
  "export-failures": "导出失败 CSV",
  "export-duplicates": "导出重复 CSV",
  "maintenance-verify": "全量文件校验",
  "maintenance-backfill": "全量媒体回填",
  verify: "文件校验",
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

// 结果字段名称映射
const RESULT_FIELD_LABELS: Record<string, string> = {
  runId: "批次 ID",
  queued: "已入队",
  skipped: "已跳过",
  linked: "已有任务",
  requeued: "重新入队",
  checked: "已检查",
  verified: "已校验",
  missing: "缺失",
  corrupt: "损坏",
  scanned: "已扫描",
  upserted: "已回填",
  tweetsRecovered: "恢复 Tweet",
  jobsRecovered: "恢复下载任务",
  itemsRecovered: "恢复队列项",
  rows: "导出行数",
  duplicateGroups: "重复组",
  status: "状态",
  path: "文件路径",
};

export function resultFieldLabel(key: string): string {
  return RESULT_FIELD_LABELS[key] ?? key;
}
