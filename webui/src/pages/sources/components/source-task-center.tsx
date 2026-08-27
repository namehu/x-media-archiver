import { AlertCircle, CheckCircle2, Clock3, Pause, Play, RotateCcw, Square, XCircle, type LucideIcon } from "lucide-react";
import type { SourceBulkTask, SourceBulkTaskItem } from "@/lib/api";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn, formatDateTime } from "@/lib/utils";

type StatusTone = "default" | "secondary" | "success" | "warning" | "danger";
type TaskStatusPresentation = {
  label: string;
  tone: StatusTone;
  canPause: boolean;
  canResume: boolean;
  canCancel: boolean;
};

const TASK_STATUS_PRESENTATION = {
  queued: { label: "等待执行", tone: "default", canPause: true, canResume: false, canCancel: true },
  running: { label: "执行中", tone: "default", canPause: true, canResume: false, canCancel: true },
  pausing: { label: "暂停中", tone: "secondary", canPause: false, canResume: false, canCancel: true },
  paused: { label: "已暂停", tone: "secondary", canPause: false, canResume: true, canCancel: true },
  blocked: { label: "需要处理", tone: "danger", canPause: false, canResume: true, canCancel: true },
  completed: { label: "已完成", tone: "success", canPause: false, canResume: false, canCancel: false },
  completed_with_issues: { label: "存在异常", tone: "danger", canPause: false, canResume: false, canCancel: false },
  cancelled: { label: "已取消", tone: "secondary", canPause: false, canResume: false, canCancel: false },
} satisfies Record<SourceBulkTask["status"], TaskStatusPresentation>;

const TASK_TYPE_LABELS = {
  refresh_latest: "更新最新推文",
  download_missing: "下载当前缺失项",
  refresh_and_download_new: "更新并下载新增",
} satisfies Record<SourceBulkTask["task_type"], string>;

const ITEM_STATUS_PRESENTATION = {
  queued: { label: "等待执行", tone: "secondary", icon: Clock3 },
  scanning: { label: "正在更新", tone: "default", icon: Clock3 },
  waiting_download: { label: "等待下载", tone: "warning", icon: Clock3 },
  downloading: { label: "正在下载", tone: "default", icon: Clock3 },
  succeeded: { label: "成功", tone: "success", icon: CheckCircle2 },
  skipped: { label: "已跳过", tone: "secondary", icon: Clock3 },
  failed: { label: "失败", tone: "danger", icon: XCircle },
  cancelled: { label: "已取消", tone: "secondary", icon: Clock3 },
} satisfies Record<SourceBulkTaskItem["status"], { label: string; tone: StatusTone; icon: LucideIcon }>;

export function SourceTaskCenter({
  open,
  onOpenChange,
  tasks,
  selectedTask,
  selectedTaskId,
  loading,
  controlPending,
  retryPending,
  onSelectTask,
  onControl,
  onRetry,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tasks: SourceBulkTask[];
  selectedTask?: SourceBulkTask;
  selectedTaskId: number | null;
  loading: boolean;
  controlPending: boolean;
  retryPending: boolean;
  onSelectTask: (taskId: number) => void;
  onControl: (taskId: number, action: "pause" | "resume" | "cancel") => void;
  onRetry: (taskId: number) => void;
}) {
  const detail = selectedTask ?? tasks.find((task) => task.id === selectedTaskId);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[min(100vw,840px)] p-0">
        <SheetHeader className="border-b border-border-subtle px-6 py-4">
          <SheetTitle>来源批量任务</SheetTitle>
          <SheetDescription>任务关闭页面后仍会继续执行，可在这里查看逐来源结果和控制状态。</SheetDescription>
        </SheetHeader>
        <div className="grid min-h-0 flex-1 md:grid-cols-[260px_minmax(0,1fr)]">
          <ScrollArea className="border-b border-border-subtle md:border-b-0 md:border-r">
            <div className="flex flex-col p-3">
              {tasks.length ? (
                tasks.map((task) => (
                  <Button
                    key={task.id}
                    type="button"
                    variant="ghost"
                    className={cn(
                      "h-auto w-full flex-col items-stretch rounded-none border-b border-border-subtle p-3 text-left last:border-b-0",
                      selectedTaskId === task.id && "bg-brand-soft",
                    )}
                    onClick={() => onSelectTask(task.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-fg-primary">{taskTypeLabel(task.task_type)}</span>
                      <Badge tone={taskTone(task.status)}>{taskStatusLabel(task.status)}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-fg-secondary">{formatDateTime(task.created_at)}</p>
                    <Progress className="mt-2" value={Math.round(task.progress * 100)} />
                  </Button>
                ))
              ) : (
                <p className="px-2 py-8 text-center text-sm text-fg-secondary">还没有批量任务。</p>
              )}
            </div>
          </ScrollArea>
          <ScrollArea>
            {loading && !detail ? <p className="p-6 text-sm text-fg-secondary">正在加载任务…</p> : null}
            {detail ? (
              <TaskDetail
                task={detail}
                controlPending={controlPending}
                retryPending={retryPending}
                onControl={onControl}
                onRetry={onRetry}
              />
            ) : null}
          </ScrollArea>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function TaskDetail({
  task,
  controlPending,
  retryPending,
  onControl,
  onRetry,
}: {
  task: SourceBulkTask;
  controlPending: boolean;
  retryPending: boolean;
  onControl: (taskId: number, action: "pause" | "resume" | "cancel") => void;
  onRetry: (taskId: number) => void;
}) {
  const failedCount = task.counts.failed ?? 0;
  const statusPresentation = TASK_STATUS_PRESENTATION[task.status];
  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-fg-primary">{taskTypeLabel(task.task_type)}</h3>
            <Badge tone={taskTone(task.status)}>{taskStatusLabel(task.status)}</Badge>
          </div>
          <p className="mt-1 text-xs text-fg-secondary">
            #{task.id} · {task.trigger_type === "scheduled" ? "定时触发" : task.trigger_type === "retry" ? "失败重试" : "人工触发"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {statusPresentation.canPause ? (
            <Button type="button" size="sm" variant="outline" disabled={controlPending} onClick={() => onControl(task.id, "pause")}>
              <Pause data-icon="inline-start" />暂停
            </Button>
          ) : null}
          {statusPresentation.canResume ? (
            <Button type="button" size="sm" variant="outline" disabled={controlPending} onClick={() => onControl(task.id, "resume")}>
              <Play data-icon="inline-start" />继续
            </Button>
          ) : null}
          {statusPresentation.canCancel ? (
            <Button type="button" size="sm" variant="outline" disabled={controlPending} onClick={() => onControl(task.id, "cancel")}>
              <Square data-icon="inline-start" />取消
            </Button>
          ) : null}
          {failedCount > 0 ? (
            <Button type="button" size="sm" disabled={retryPending} onClick={() => onRetry(task.id)}>
              <RotateCcw data-icon="inline-start" />仅重试失败项
            </Button>
          ) : null}
        </div>
      </div>
      <div>
        <div className="mb-2 flex justify-between gap-3 text-sm text-fg-secondary">
          <span>已完成 {task.settled_count} / {task.total_count}</span>
          <span className="tabular-nums">{Math.round(task.progress * 100)}%</span>
        </div>
        <Progress value={Math.round(task.progress * 100)} />
      </div>
      <div className="grid grid-cols-2 overflow-hidden rounded-xl border border-border-subtle sm:grid-cols-4">
        <TaskMetric label="成功" value={task.counts.succeeded ?? 0} />
        <TaskMetric label="跳过" value={task.counts.skipped ?? 0} />
        <TaskMetric label="失败" value={failedCount} />
        <TaskMetric label="已取消" value={task.counts.cancelled ?? 0} />
      </div>
      {task.error_message ? (
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>批量任务执行异常</AlertTitle>
          <AlertDescription>{task.error_message}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-2">
        <h4 className="text-sm font-semibold text-fg-primary">逐来源结果</h4>
        {task.items?.length ? (
          <div className="overflow-hidden rounded-xl border border-border-subtle">
            {task.items.map((item) => <TaskItemRow key={item.id} item={item} />)}
          </div>
        ) : null}
        {!task.items?.length ? <p className="py-6 text-center text-sm text-fg-secondary">正在读取来源任务项…</p> : null}
      </div>
    </div>
  );
}

function TaskMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-b border-r border-border-subtle bg-bg-surface p-3 last:border-r-0 sm:border-b-0">
      <p className="text-xs text-fg-secondary">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-fg-primary">{value}</p>
    </div>
  );
}

function TaskItemRow({ item }: { item: SourceBulkTaskItem }) {
  const presentation = ITEM_STATUS_PRESENTATION[item.status];
  const Icon = presentation.icon;
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border-subtle bg-bg-surface p-3 last:border-b-0">
      <div className="flex min-w-0 items-start gap-2">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-fg-tertiary" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-fg-primary">{item.label || `来源 #${item.source_id}`}</p>
          <p className="mt-0.5 text-xs text-fg-secondary">
            新增 {item.new_tweet_count} · 已提交 {item.submitted_count}
          </p>
          {item.error_message || item.skip_reason ? (
            <p className="mt-1 text-xs text-danger">{item.error_message || skipReasonLabel(item.skip_reason)}</p>
          ) : null}
        </div>
      </div>
      <Badge tone={presentation.tone}>{presentation.label}</Badge>
    </div>
  );
}

export function taskTypeLabel(type: SourceBulkTask["task_type"]) {
  return TASK_TYPE_LABELS[type];
}

export function taskStatusLabel(status: SourceBulkTask["status"]) {
  return TASK_STATUS_PRESENTATION[status].label;
}

function taskTone(status: SourceBulkTask["status"]) {
  return TASK_STATUS_PRESENTATION[status].tone;
}

function skipReasonLabel(reason?: string | null) {
  const labels: Record<string, string> = {
    source_not_found_or_deleted: "来源不存在或已删除",
    source_deleted: "来源已删除",
    source_scan_not_supported: "该来源类型不支持扫描",
    source_paused: "来源已暂停",
    source_scan_in_progress: "已有扫描任务",
    source_bulk_task_in_progress: "已有批量任务",
    scheduled_task_download_cap_reached: "已达到本次定时任务下载上限",
  };
  return reason ? labels[reason] || reason : "";
}
