import { useState } from "react";
import { CalendarClock, Trash2 } from "lucide-react";
import type { SourceSchedulePolicy } from "@/lib/api";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { formatDateTime } from "@/lib/utils";

export function SourceScheduleManager({
  open,
  onOpenChange,
  policies,
  loading,
  pending,
  onToggle,
  onDelete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  policies: SourceSchedulePolicy[];
  loading: boolean;
  pending: boolean;
  onToggle: (policyId: number, enabled: boolean) => void;
  onDelete: (policyId: number) => void;
}) {
  const [deletePolicy, setDeletePolicy] = useState<SourceSchedulePolicy | null>(null);
  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="p-0">
        <SheetHeader className="border-b border-border-subtle px-6 py-4">
          <SheetTitle>定时策略</SheetTitle>
          <SheetDescription>策略按固定时间锚点执行；停机错过的任务只会合并补跑一次。</SheetDescription>
        </SheetHeader>
        <ScrollArea className="flex-1">
          <div className="flex flex-col gap-3 p-6">
            {loading ? <p className="py-8 text-center text-sm text-fg-secondary">正在加载策略…</p> : null}
            {!loading && policies.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <CalendarClock className="h-6 w-6 text-fg-tertiary" />
                <p className="text-sm font-medium text-fg-primary">还没有定时策略</p>
                <p className="text-xs text-fg-secondary">在来源列表中选择来源后创建策略。</p>
              </div>
            ) : null}
            {policies.map((policy) => (
              <div key={policy.id} className="rounded-lg border border-border-subtle bg-bg-surface p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-fg-primary">{policy.label}</h3>
                      <Badge tone={policy.enabled ? "success" : "secondary"}>{policy.enabled ? "已启用" : "已停用"}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-fg-secondary">
                      {policyActionLabel(policy.action)} · {policyFrequencyLabel(policy)} · {policy.source_count} 个来源
                    </p>
                    {policy.action === "refresh_and_download_new" ? (
                      <p className="mt-1 text-[11px] text-fg-tertiary">
                        下载上限：每来源 {policy.max_downloads_per_source} · 每任务 {policy.max_downloads_per_task}
                      </p>
                    ) : null}
                  </div>
                  <Switch
                    aria-label={policy.enabled ? "停用策略" : "启用策略"}
                    checked={policy.enabled}
                    disabled={pending}
                    onCheckedChange={(enabled) => onToggle(policy.id, enabled)}
                  />
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 border-t border-border-subtle pt-3">
                  <p className="text-xs text-fg-secondary">
                    {policy.enabled ? `下次执行：${formatDateTime(policy.next_run_at)}` : "启用后将重新计算下次执行时间"}
                  </p>
                  <Button type="button" size="icon" variant="ghost" disabled={pending} aria-label="删除策略" onClick={() => setDeletePolicy(policy)}>
                    <Trash2 />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
        </SheetContent>
      </Sheet>
      <AlertDialog open={Boolean(deletePolicy)} onOpenChange={(nextOpen) => !nextOpen && setDeletePolicy(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除定时策略？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除“{deletePolicy?.label}”及其来源分配。已经产生的批量任务与审计历史会保留。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={pending}
              onClick={() => {
                if (!deletePolicy) return;
                onDelete(deletePolicy.id);
                setDeletePolicy(null);
              }}
            >
              删除策略
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function policyActionLabel(action: SourceSchedulePolicy["action"]) {
  return action === "refresh_and_download_new" ? "更新并下载新增" : "只更新最新推文";
}

function policyFrequencyLabel(policy: SourceSchedulePolicy) {
  if (policy.frequency_kind === "interval") {
    const hours = Math.round((policy.interval_minutes || 0) / 60);
    return `每 ${hours} 小时`;
  }
  if (policy.frequency_kind === "weekly") {
    const weekdays = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
    return `每${weekdays[policy.weekday ?? 0]} ${String(policy.local_time || "").slice(0, 5)}`;
  }
  return `每天 ${String(policy.local_time || "").slice(0, 5)}`;
}
