import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import type { FailureActionsResponse } from "@/lib/api";
import { apiGet } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/utils";
import { FAILURE_ACTION_LABELS, FAILURE_REASON_LABELS } from "../failure-labels";

export function FailureHistoryDialog({ tweetId, onOpenChange }: { tweetId: string | null; onOpenChange: (open: boolean) => void }) {
  const query = useQuery({
    queryKey: ["failure-actions", tweetId],
    queryFn: () => apiGet<FailureActionsResponse>(`/api/v1/library/failures/${tweetId}/actions`),
    enabled: Boolean(tweetId),
  });

  return (
    <Dialog open={Boolean(tweetId)} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(720px,calc(100vh-32px))] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>失败处置记录</DialogTitle>
          <DialogDescription>{tweetId ? `Tweet ${tweetId} 的忽略、恢复、重试与自动解决历史。` : "失败处置历史"}</DialogDescription>
        </DialogHeader>
        {query.isLoading ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-20" />)}
          </div>
        ) : query.error ? (
          <Alert variant="destructive">
            <AlertTitle>处置记录加载失败</AlertTitle>
            <AlertDescription>{String(query.error)}</AlertDescription>
          </Alert>
        ) : query.data?.rows.length ? (
          <ol className="flex flex-col gap-3">
            {query.data.rows.map((event) => (
              <li key={event.id} className="rounded-lg border border-border-subtle bg-bg-surface p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge tone={event.action === "ignore" ? "warning" : event.action === "retry" ? "default" : "success"}>
                      {FAILURE_ACTION_LABELS[event.action] ?? event.action}
                    </Badge>
                    <span className="text-xs text-fg-secondary">操作前：{event.previous_status}</span>
                  </div>
                  <time className="text-xs tabular-nums text-fg-tertiary">{formatDateTime(event.created_at)}</time>
                </div>
                {event.reason ? <p className="mt-2 text-sm text-fg-secondary">原因：{FAILURE_REASON_LABELS[event.reason] ?? event.reason}</p> : null}
                {event.note ? <p className="mt-1 whitespace-pre-wrap text-sm text-fg-secondary">备注：{event.note}</p> : null}
                {event.archive_run_id ? (
                  <Link className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand hover:text-brand-hover" to={`/queue?run=${event.archive_run_id}`}>
                    归档运行 #{event.archive_run_id}
                    <ExternalLink className="size-4" />
                  </Link>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="rounded-lg border border-border-subtle bg-bg-surface p-4 text-sm text-fg-secondary">暂无处置记录。</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
