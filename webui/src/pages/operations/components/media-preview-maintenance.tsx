import { useEffect, useMemo, useState, type ComponentProps } from "react";
import { AlertCircle, CalendarClock, Image, Loader2, RefreshCw, XCircle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { MediaPreviewJob, MediaPreviewSchedule } from "@/lib/api";
import { statusLabel } from "@/lib/formatters";
import { useMediaPreviewJobs } from "../hooks/use-media-preview-jobs";

type PreviewMode = "reconcile" | "force";

export function MediaPreviewMaintenance() {
  const preview = useMediaPreviewJobs();
  const [confirmMode, setConfirmMode] = useState<PreviewMode | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState<MediaPreviewSchedule | null>(null);

  useEffect(() => {
    if (preview.schedule) setScheduleDraft(preview.schedule);
  }, [preview.schedule]);

  const activeJob = preview.activeJob;
  const progress = activeJob?.total_count
    ? Math.min(100, (activeJob.scanned_count / activeJob.total_count) * 100)
    : 0;
  const recentJobs = preview.jobs.slice(0, 10);
  const latestFailures = useMemo(
    () => preview.jobs.find((job) => job.failed_count > 0)?.result?.failure_samples?.slice(0, 10) ?? [],
    [preview.jobs],
  );

  const saveSchedule = () => {
    if (!scheduleDraft) return;
    preview.saveSchedule({
      enabled: scheduleDraft.enabled,
      frequency_kind: scheduleDraft.frequency_kind,
      interval_minutes: Number(scheduleDraft.interval_minutes),
      local_time: scheduleDraft.local_time.slice(0, 5),
      weekday: Number(scheduleDraft.weekday),
      timezone: scheduleDraft.timezone,
      jitter_seconds: Number(scheduleDraft.jitter_seconds),
    });
  };

  return (
    <Card className="xl:col-span-2">
      <CardHeader className="sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-1.5">
          <CardTitle className="flex items-center gap-2">
            <Image className="size-5" aria-hidden="true" />
            媒体预览图
          </CardTitle>
          <CardDescription>
            独立任务扫描数据库中已下载的媒体，不会由下载行为触发，也不会递归扫描归档目录。
          </CardDescription>
        </div>
        <Badge tone={activeJob ? "warning" : "secondary"}>{activeJob ? "任务运行中" : "当前空闲"}</Badge>
      </CardHeader>

      <CardContent className="flex flex-col gap-0">
        <section className="border-t border-border-subtle py-5 first:border-t-0 first:pt-0">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-fg-primary">当前任务</h3>
                {activeJob ? <JobStatusBadge job={activeJob} /> : null}
                {activeJob ? <span className="text-xs text-fg-tertiary">#{activeJob.id}</span> : null}
              </div>
              {activeJob ? (
                <div className="mt-3 flex flex-col gap-2">
                  <Progress value={progress} aria-label={`预览任务进度 ${Math.round(progress)}%`} />
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-fg-secondary">
                    <span>{activeJob.scanned_count} / {activeJob.total_count} 已检查</span>
                    <span>{activeJob.generated_count} 已生成</span>
                    <span>{activeJob.existing_count} 已存在</span>
                    <span className={activeJob.failed_count ? "text-danger" : undefined}>{activeJob.failed_count} 失败</span>
                  </div>
                  {activeJob.cancel_requested ? <p className="text-xs text-warning">将在当前媒体处理完成后停止。</p> : null}
                </div>
              ) : (
                <p className="mt-2 text-sm text-fg-secondary">没有排队或运行中的预览任务。</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {activeJob ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={preview.isCancelling || activeJob.cancel_requested}
                  onClick={() => preview.cancelJob(activeJob.id)}
                >
                  {preview.isCancelling ? <Loader2 className="animate-spin" /> : <XCircle />}
                  取消任务
                </Button>
              ) : (
                <>
                  <Button type="button" variant="secondary" disabled={preview.isCreating} onClick={() => setConfirmMode("reconcile")}>
                    <RefreshCw />
                    补齐缺失或过期预览
                  </Button>
                  <Button type="button" variant="destructive" disabled={preview.isCreating} onClick={() => setConfirmMode("force")}>
                    强制全部重建
                  </Button>
                </>
              )}
            </div>
          </div>
        </section>

        <section className="border-t border-border-subtle py-5">
          <div className="flex items-center gap-2">
            <CalendarClock className="size-4 text-fg-tertiary" aria-hidden="true" />
            <h3 className="text-sm font-semibold text-fg-primary">定时计划</h3>
          </div>
          {scheduleDraft ? (
            <div className="mt-4 flex flex-col gap-4">
              <label className="flex items-center justify-between gap-4 rounded-lg border border-border-subtle px-3 py-2.5">
                <span>
                  <span className="block text-sm font-medium text-fg-primary">启用自动补齐</span>
                  <span className="block text-xs text-fg-tertiary">到期时只创建 reconcile 任务；若已有任务，会在结束后合并补跑一次。</span>
                </span>
                <Switch
                  checked={scheduleDraft.enabled}
                  onCheckedChange={(enabled) => setScheduleDraft({ ...scheduleDraft, enabled })}
                  aria-label="启用媒体预览图定时计划"
                />
              </label>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                <label className="flex flex-col gap-1.5 text-xs font-medium text-fg-secondary">
                  频率
                  <Select
                    value={scheduleDraft.frequency_kind}
                    onChange={(event) => setScheduleDraft({
                      ...scheduleDraft,
                      frequency_kind: event.target.value as MediaPreviewSchedule["frequency_kind"],
                    })}
                  >
                    <option value="interval">固定间隔</option>
                    <option value="daily">每天</option>
                    <option value="weekly">每周</option>
                  </Select>
                </label>
                {scheduleDraft.frequency_kind === "interval" ? (
                  <ScheduleInput
                    label="间隔（分钟）"
                    type="number"
                    min={60}
                    value={scheduleDraft.interval_minutes}
                    onChange={(value) => setScheduleDraft({ ...scheduleDraft, interval_minutes: Number(value) })}
                  />
                ) : (
                  <ScheduleInput
                    label="本地时间"
                    type="time"
                    value={scheduleDraft.local_time.slice(0, 5)}
                    onChange={(value) => setScheduleDraft({ ...scheduleDraft, local_time: value })}
                  />
                )}
                {scheduleDraft.frequency_kind === "weekly" ? (
                  <label className="flex flex-col gap-1.5 text-xs font-medium text-fg-secondary">
                    星期
                    <Select value={String(scheduleDraft.weekday)} onChange={(event) => setScheduleDraft({ ...scheduleDraft, weekday: Number(event.target.value) })}>
                      <option value="0">星期一</option>
                      <option value="1">星期二</option>
                      <option value="2">星期三</option>
                      <option value="3">星期四</option>
                      <option value="4">星期五</option>
                      <option value="5">星期六</option>
                      <option value="6">星期日</option>
                    </Select>
                  </label>
                ) : null}
                <ScheduleInput
                  label="时区"
                  value={scheduleDraft.timezone}
                  onChange={(value) => setScheduleDraft({ ...scheduleDraft, timezone: value })}
                />
                <ScheduleInput
                  label="随机延迟（秒）"
                  type="number"
                  min={0}
                  max={86400}
                  value={scheduleDraft.jitter_seconds}
                  onChange={(value) => setScheduleDraft({ ...scheduleDraft, jitter_seconds: Number(value) })}
                />
                <div className="flex items-end">
                  <Button className="w-full" type="button" disabled={preview.isSavingSchedule} onClick={saveSchedule}>
                    {preview.isSavingSchedule ? <Loader2 className="animate-spin" /> : null}
                    保存计划
                  </Button>
                </div>
              </div>
              <p className="text-xs text-fg-tertiary">
                {scheduleDraft.next_run_at ? `下次运行：${formatDateTime(scheduleDraft.next_run_at)}` : "当前未安排下次运行。"}
                {scheduleDraft.last_run_at ? ` 最近触发：${formatDateTime(scheduleDraft.last_run_at)}` : ""}
              </p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-fg-secondary">
              {preview.scheduleQuery.isError ? "无法读取定时计划，请稍后重试。" : "正在读取计划…"}
            </p>
          )}
        </section>

        <section className="border-t border-border-subtle pt-5">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-fg-primary">最近任务</h3>
            <span className="text-xs text-fg-tertiary">保留 90 天，且至少保留最近 100 条</span>
          </div>
          {preview.jobsQuery.isError ? (
            <Alert variant="destructive" className="mt-3 border-danger/30 bg-danger/5">
              <AlertCircle className="size-4" aria-hidden="true" />
              <AlertTitle>完整任务历史暂时无法读取</AlertTitle>
              <AlertDescription>
                当前仅显示实时通道最近两分钟内的任务；历史记录不会因此被删除。
              </AlertDescription>
            </Alert>
          ) : null}
          {recentJobs.length ? (
            <div className="mt-3 overflow-x-auto rounded-lg border border-border-subtle">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>任务</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead className="text-right">检查 / 生成 / 失败</TableHead>
                    <TableHead>创建时间</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentJobs.map((job) => (
                    <TableRow key={job.id}>
                      <TableCell>
                        <div className="font-medium">#{job.id} · {modeLabel(job.mode)}</div>
                        <div className="mt-0.5 text-xs text-fg-tertiary">{triggerLabel(job.trigger_type)}</div>
                      </TableCell>
                      <TableCell><JobStatusBadge job={job} /></TableCell>
                      <TableCell className="text-right tabular-nums">{job.scanned_count} / {job.generated_count} / {job.failed_count}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-fg-secondary">{formatDateTime(job.created_at)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : !preview.jobsQuery.isError ? (
            <p className="mt-3 text-sm text-fg-secondary">
              暂无预览任务。
            </p>
          ) : null}
          {latestFailures.length ? (
            <details className="mt-3 rounded-lg border border-danger/20 bg-danger/5 px-3 py-2 text-sm">
              <summary className="cursor-pointer font-medium text-danger">查看最近失败样本（{latestFailures.length}）</summary>
              <ul className="mt-2 grid gap-1 text-xs text-fg-secondary">
                {latestFailures.map((failure) => (
                  <li key={`${failure.media_id}-${failure.error}`} className="font-mono">媒体 #{failure.media_id} · {failure.error}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      </CardContent>

      <AlertDialog open={confirmMode !== null} onOpenChange={(open) => !open && setConfirmMode(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmMode === "force" ? "确认强制重建全部预览？" : "确认扫描全部已索引媒体？"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmMode === "force"
                ? "任务会重建数据库中所有已下载图片和视频的预览，即使现有文件仍然有效。生成期间磁盘与 CPU 使用率会升高。"
                : "任务会按媒体 ID 扫描数据库中的已下载媒体，只补齐缺失、过期或损坏的预览；不会递归扫描 archive/media。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>返回</AlertDialogCancel>
            <AlertDialogAction
              className={confirmMode === "force" ? "bg-danger hover:bg-danger/90" : undefined}
              onClick={() => {
                if (confirmMode) preview.createJob(confirmMode);
                setConfirmMode(null);
              }}
            >
              {confirmMode === "force" ? "强制全部重建" : "开始补齐预览"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function ScheduleInput({ label, value, onChange, ...props }: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
} & Omit<ComponentProps<typeof Input>, "value" | "onChange">) {
  return (
    <label className="flex flex-col gap-1.5 text-xs font-medium text-fg-secondary">
      {label}
      <Input {...props} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function JobStatusBadge({ job }: { job: MediaPreviewJob }) {
  return <Badge tone={statusTone(job.status)}>{statusLabel(job.status)}</Badge>;
}

function statusTone(status: MediaPreviewJob["status"]): BadgeProps["tone"] {
  if (status === "completed") return "success";
  if (status === "completed_with_failures" || status === "queued" || status === "running") return "warning";
  if (status === "failed") return "danger";
  return "secondary";
}

function modeLabel(mode: MediaPreviewJob["mode"]) {
  return mode === "force" ? "强制重建" : "补齐预览";
}

function triggerLabel(trigger: MediaPreviewJob["trigger_type"]) {
  if (trigger === "scheduled") return "定时触发";
  if (trigger === "retry") return "失败重试";
  return "手动触发";
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}
