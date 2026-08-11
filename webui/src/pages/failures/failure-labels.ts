export const FAILURE_REASON_LABELS: Record<string, string> = {
  not_needed: "暂不需要",
  unavailable: "内容不可访问",
  unsupported: "工具暂不支持",
  duplicate: "重复内容",
  other: "其他",
};

export const FAILURE_ACTION_LABELS: Record<string, string> = {
  ignore: "忽略",
  restore: "恢复",
  retry: "手动重试",
  resolved: "成功后自动解决",
};

export const FAILURE_SKIP_REASON_LABELS: Record<string, string> = {
  not_found: "记录不存在",
  not_failure: "已不再是失败状态",
  already_ignored: "已经忽略",
  not_ignored: "尚未忽略",
  processing: "正在下载中",
};
