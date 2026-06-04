import type { ArchiveSourceDetail } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";
import {
  formatHistoryState,
  formatNextRange,
  formatScanState,
} from "../../utils";
import { DetailRow } from "./detail-row";

export function SourceDetailContent({
  source,
  now,
  detailUpdatedAt,
  scanLimit,
}: {
  source: ArchiveSourceDetail;
  now: number;
  detailUpdatedAt: number;
  scanLimit: number;
}) {
  const historyEnabled = Boolean(source.cursor_state?.automation_enabled);

  return (
    <div className="space-y-3">
      <div className="grid gap-2 rounded-lg bg-bg-muted p-3 text-sm">
        <DetailRow label="更新时间" value={formatDateTime(source.updated_at)} />
        <DetailRow label="下一批范围" value={formatNextRange(source.cursor_state, scanLimit)} />
        <DetailRow label="扫描状态" value={formatScanState(source.cursor_state)} />
        <DetailRow label="历史扫描任务" value={formatHistoryState(source)} />
        {historyEnabled && source.next_scan_at ? (
          <DetailRow label="下次自动扫描" value={formatDateTime(source.next_scan_at)} />
        ) : null}
        <DetailRow label="最近发现" value={source.last_seen_tweet_id || "-"} />
        {source.cursor_state?.last_range_start ? (
          <DetailRow
            label="上次扫描范围"
            value={`${source.cursor_state.last_range_start}-${source.cursor_state.last_range_end}`}
          />
        ) : null}
        <DetailRow label="详情刷新" value={formatDateTime(new Date(detailUpdatedAt || now).toISOString())} />
        <DetailRow label="累计新增 Tweet" value={source.scan_summary?.added_tweet_count ?? 0} />
        <DetailRow label="最近成功扫描" value={formatDateTime(source.scan_summary?.last_success_at)} />
        <DetailRow label="最近扫描错误" value={formatDateTime(source.scan_summary?.last_error_at)} />
      </div>

      <ScanPipelineNote />
    </div>
  );
}

function ScanPipelineNote() {
  return (
    <div className="grid gap-2 rounded-lg bg-bg-muted p-3 text-sm text-fg-secondary">
      <h3>
        <span>批次底层流程</span>
      </h3>
      <div className="grid gap-2">
        <span>1. 读取来源 cursor 与下一批范围。</span>
        <span>2. 下载队列忙时先记录等待，不发起扫描。</span>
        <span>3. 下载队列空闲时调用 gallery-dl 枚举当前批次。</span>
        <span>4. 子进程完整返回后解析、去重、落库，再等待 延迟时间 后调度下一批。</span>
      </div>
      <p className="mt-2">
        暂停扫描只暂停后续自动调度，不强制终止已经启动的 gallery-dl 子进程；该批结束后会保留 cursor 与发现记录。
      </p>
    </div>
  );
}
