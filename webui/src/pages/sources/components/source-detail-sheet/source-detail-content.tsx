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
        <DetailRow label="任务状态" value={formatHistoryState(source)} />
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

    </div>
  );
}
