import type { ArchiveSourceDetail } from "@/lib/api";
import { ApiError } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { getDebugRedactProps, useDebugRedactionEnabled } from "@/lib/debug-redaction";
import { formatDateTime } from "@/lib/utils";
import { Trash2 } from "lucide-react";
import * as React from "react";
import { formatHistoryState, formatNextRange, formatScanState } from "../../utils";
import { DetailRow } from "./detail-row";

export function SourceDetailContent({
  source,
  now,
  detailUpdatedAt,
  scanLimit,
  deletePending,
  deleteError,
  onDelete,
}: {
  source: ArchiveSourceDetail;
  now: number;
  detailUpdatedAt: number;
  scanLimit: number;
  deletePending: boolean;
  deleteError: unknown;
  onDelete: (sourceId: number) => void;
}) {
  const debugRedactionEnabled = useDebugRedactionEnabled();
  const isDeleted = Boolean(source.deleted_at);
  const historyEnabled = Boolean(source.cursor_state?.automation_enabled);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = React.useState(false);

  return (
    <div className="flex flex-col gap-3">
      {isDeleted ? (
        <Alert>
          <AlertTitle>此来源已软删除</AlertTitle>
          <AlertDescription>
            已发现 Tweet、媒体文件、下载任务和扫描历史仍然保留。重新新增相同 URL 会恢复这个来源。
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="overflow-hidden rounded-xl border border-border-subtle bg-bg-surface text-sm">
        <DetailRow label="更新时间" value={formatDateTime(source.updated_at)} />
        {source.deleted_at ? <DetailRow label="删除时间" value={formatDateTime(source.deleted_at)} /> : null}
        <DetailRow label="下一批范围" value={formatNextRange(source.cursor_state, scanLimit)} />
        <DetailRow label="扫描状态" value={formatScanState(source.cursor_state)} />
        <DetailRow label="任务状态" value={formatHistoryState(source)} />
        {historyEnabled && source.next_scan_at ? (
          <DetailRow label="下次自动扫描" value={formatDateTime(source.next_scan_at)} />
        ) : null}
        <DetailRow
          label="最近发现"
          value={<span {...getDebugRedactProps(debugRedactionEnabled)}>{source.last_seen_tweet_id || "-"}</span>}
        />
        {source.cursor_state?.last_range_start ? (
          <DetailRow
            label="上次扫描范围"
            value={(
              <span {...getDebugRedactProps(debugRedactionEnabled)}>
                {source.cursor_state.last_range_start}-{source.cursor_state.last_range_end}
              </span>
            )}
          />
        ) : null}
        <DetailRow label="详情刷新" value={formatDateTime(new Date(detailUpdatedAt || now).toISOString())} />
        <DetailRow label="累计新增 Tweet" value={source.scan_summary?.added_tweet_count ?? 0} />
        <DetailRow label="最近成功扫描" value={formatDateTime(source.scan_summary?.last_success_at)} />
        <DetailRow label="最近扫描错误" value={formatDateTime(source.scan_summary?.last_error_at)} />
      </div>
      {!isDeleted ? (
      <section className="rounded-lg border border-danger/30 bg-bg-surface p-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-danger">删除来源</h3>
            <p className="mt-1 text-xs leading-5 text-fg-secondary">
              从来源列表隐藏此配置并停止后续自动扫描，不删除已归档 Tweet、媒体文件、下载任务或扫描历史。
            </p>
          </div>
          <Button
            type="button"
            variant="destructive"
            className="shrink-0"
            disabled={deletePending}
            onClick={() => setConfirmDeleteOpen(true)}
          >
            <Trash2 data-icon="inline-start" aria-hidden="true" />
            删除来源
          </Button>
        </div>
      </section>
      ) : null}
      {!isDeleted ? (
      <AlertDialog open={confirmDeleteOpen} onOpenChange={(open) => !deletePending && setConfirmDeleteOpen(open)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除此来源？</AlertDialogTitle>
            <AlertDialogDescription className="flex flex-col gap-2">
              <span>来源会从列表中隐藏，自动扫描会被停用。</span>
              <span>已归档 Tweet、媒体文件、下载任务、发现记录和扫描历史会保留。</span>
              <span>如果此来源仍有扫描或下载任务运行，系统会拒绝删除。</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError ? (
            <Alert variant="destructive">
              <AlertTitle>{sourceDeleteErrorMessage(deleteError)}</AlertTitle>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletePending}>取消</AlertDialogCancel>
            <AlertDialogAction
              className="bg-danger text-white hover:brightness-105"
              disabled={deletePending}
              onClick={(event) => {
                event.preventDefault();
                onDelete(source.id);
              }}
            >
              {deletePending ? "正在删除" : "确认删除来源"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      ) : null}
    </div>
  );
}

function sourceDeleteErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === "source_delete_active_work" || error.message.includes("source_delete_active_work")) {
      return "删除失败：请先停止或等待此来源的扫描和下载任务结束。";
    }
    if (error.code === "source_not_found" || error.message.includes("source_not_found")) {
      return "删除失败：来源不存在或已被删除。";
    }
    return `删除失败：${error.message}`;
  }
  if (error instanceof Error) return `删除失败：${error.message}`;
  return "删除失败，请稍后重试。";
}
