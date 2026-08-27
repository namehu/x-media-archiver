import { RotateCcw } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Checkbox } from "../../../components/ui/checkbox";
import { Input } from "../../../components/ui/input";
import { statusLabel } from "../../../lib/formatters";
import { REQUEUE_STATUSES, type BooleanSetter, type OperationRun, type RequeueStatusesSetter, type StringSetter } from "../types";
import { numberOrNull } from "../utils";
import { MediaPreviewMaintenance } from "./media-preview-maintenance";

type MaintenanceTabProps = {
  mutationPending: boolean;
  verifyLimit: string;
  setVerifyLimit: StringSetter;
  confirmFullScan: boolean;
  setConfirmFullScan: BooleanSetter;
  requeueStatuses: string[];
  setRequeueStatuses: RequeueStatusesSetter;
  requeueLimit: string;
  setRequeueLimit: StringSetter;
  recoverTimeout: string;
  setRecoverTimeout: StringSetter;
  run: OperationRun;
};

export function MaintenanceTab({
  mutationPending,
  verifyLimit,
  setVerifyLimit,
  confirmFullScan,
  setConfirmFullScan,
  requeueStatuses,
  setRequeueStatuses,
  requeueLimit,
  setRequeueLimit,
  recoverTimeout,
  setRecoverTimeout,
  run,
}: MaintenanceTabProps) {
  return (
    <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
      <MediaPreviewMaintenance />

      <Card>
        <CardHeader>
          <CardTitle>重新入队</CardTitle>
          <CardDescription>重新入队状态</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-2 sm:grid-cols-2">
            {REQUEUE_STATUSES.map((status) => (
              <label key={status} className="flex items-center gap-2 rounded-md border border-border-subtle bg-bg-surface px-3 py-2 text-sm">
                <Checkbox
                  checked={requeueStatuses.includes(status)}
                  onCheckedChange={(checked) => {
                    setRequeueStatuses((current) => (checked ? [...current, status] : current.filter((item) => item !== status)));
                  }}
                />
                {statusLabel(status)}
              </label>
            ))}
          </div>
          <Input placeholder="数量上限" inputMode="numeric" value={requeueLimit} onChange={(event) => setRequeueLimit(event.target.value)} />
          <Button
            type="button"
            disabled={mutationPending}
            onClick={() =>
              run("/api/v1/actions/requeue", "重新入队", {
                statuses: requeueStatuses.length ? requeueStatuses : null,
                limit: numberOrNull(requeueLimit),
              })
            }
          >
            <RotateCcw className="h-4 w-4" />
            重新入队
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>恢复中断任务</CardTitle>
          <CardDescription>超时分钟数</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Input placeholder="超时分钟数" inputMode="numeric" value={recoverTimeout} onChange={(event) => setRecoverTimeout(event.target.value)} />
          <Button type="button" variant="secondary" disabled={mutationPending} onClick={() => run("/api/v1/actions/recover-interrupted", "恢复中断任务", { timeout_minutes: numberOrNull(recoverTimeout) })}>
            恢复
          </Button>
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle>全量维护</CardTitle>
          <CardDescription>上方 CSV 导出读取数据库快照；媒体回填只同步数据库索引，不生成预览图。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-danger">这些操作会扫描整个归档目录，资料库较大时可能产生较高磁盘 IO。</div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={confirmFullScan} onCheckedChange={(checked) => setConfirmFullScan(Boolean(checked))} />
            我确认这是一次全量归档磁盘扫描。
          </label>
          <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
            <Input placeholder="校验数量上限（可选）" inputMode="numeric" value={verifyLimit} onChange={(event) => setVerifyLimit(event.target.value)} />
            <Button
              type="button"
              variant="secondary"
              disabled={mutationPending || !confirmFullScan}
              onClick={() => run("/api/v1/maintenance/verify", "全量文件校验", { limit: numberOrNull(verifyLimit), confirm_full_scan: confirmFullScan })}
            >
              全量文件校验
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={mutationPending || !confirmFullScan}
              onClick={() => run("/api/v1/maintenance/backfill", "全量媒体回填", { confirm_full_scan: confirmFullScan, normalize_files: true })}
            >
              全量媒体回填
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
