import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { SourceSchedulePolicyInput } from "../hooks/use-source-bulk-tasks";

type FrequencyPreset = "360" | "720" | "daily" | "weekly";

export function SourceScheduleDialog({
  open,
  onOpenChange,
  selectedCount,
  pending,
  error,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  pending: boolean;
  error: unknown;
  onCreate: (input: Omit<SourceSchedulePolicyInput, "source_ids" | "source_filter">) => void;
}) {
  const [label, setLabel] = useState("普通来源每日更新");
  const [action, setAction] = useState<SourceSchedulePolicyInput["action"]>("refresh_latest");
  const [frequency, setFrequency] = useState<FrequencyPreset>("daily");
  const [localTime, setLocalTime] = useState("03:00");
  const [weekday, setWeekday] = useState("0");
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLabel("普通来源每日更新");
    setAction("refresh_latest");
    setFrequency("daily");
    setLocalTime("03:00");
    setWeekday("0");
    setEnabled(false);
  }, [open]);

  const submit = () => {
    const interval = frequency === "360" || frequency === "720";
    onCreate({
      label: label.trim(),
      action,
      frequency_kind: interval ? "interval" : frequency,
      interval_minutes: interval ? Number(frequency) : undefined,
      local_time: interval ? undefined : localTime,
      weekday: frequency === "weekly" ? Number(weekday) : undefined,
      timezone: "Asia/Shanghai",
      enabled,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>创建定时策略</DialogTitle>
          <DialogDescription>把当前选择的 {selectedCount} 个来源分配到同一策略。策略默认只更新最新推文。</DialogDescription>
        </DialogHeader>
        <FieldGroup className="gap-4">
          <Field>
            <FieldLabel htmlFor="source-schedule-label">策略名称</FieldLabel>
            <Input
              id="source-schedule-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="例如：重点来源每 6 小时"
            />
          </Field>
          <Field>
            <FieldLabel>执行动作</FieldLabel>
            <Select value={action} onValueChange={(value) => setAction(value as SourceSchedulePolicyInput["action"])}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="refresh_latest">只更新最新推文</SelectItem>
                  <SelectItem value="refresh_and_download_new">更新并下载本轮新增</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>不会下载历史缺失积压；定时下载默认每来源最多 50 条、每任务最多 1000 条。</FieldDescription>
          </Field>
          <Field>
            <FieldLabel>执行频率</FieldLabel>
            <Select value={frequency} onValueChange={(value) => setFrequency(value as FrequencyPreset)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="360">每 6 小时</SelectItem>
                  <SelectItem value="720">每 12 小时</SelectItem>
                  <SelectItem value="daily">每天</SelectItem>
                  <SelectItem value="weekly">每周</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          {frequency === "daily" || frequency === "weekly" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {frequency === "weekly" ? (
                <Field>
                  <FieldLabel>星期</FieldLabel>
                  <Select value={weekday} onValueChange={setWeekday}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="0">星期一</SelectItem>
                        <SelectItem value="1">星期二</SelectItem>
                        <SelectItem value="2">星期三</SelectItem>
                        <SelectItem value="3">星期四</SelectItem>
                        <SelectItem value="4">星期五</SelectItem>
                        <SelectItem value="5">星期六</SelectItem>
                        <SelectItem value="6">星期日</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
              ) : null}
              <Field>
                <FieldLabel htmlFor="source-schedule-time">北京时间</FieldLabel>
                <Input id="source-schedule-time" type="time" value={localTime} onChange={(event) => setLocalTime(event.target.value)} />
              </Field>
            </div>
          ) : null}
          <Field orientation="horizontal">
            <div>
              <FieldLabel htmlFor="source-schedule-enabled">创建后立即启用</FieldLabel>
              <FieldDescription>停机期间错过的多次执行只会合并补跑一次。</FieldDescription>
            </div>
            <Switch id="source-schedule-enabled" checked={enabled} onCheckedChange={setEnabled} />
          </Field>
        </FieldGroup>
        {error ? <p className="mt-4 text-sm text-danger">{String(error)}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button type="button" disabled={pending || !label.trim() || selectedCount === 0} onClick={submit}>
            <CalendarClock data-icon="inline-start" />创建策略
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
