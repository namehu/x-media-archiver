import { RotateCcw } from "lucide-react";
import { Button } from "../../../components/ui-next/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui-next/card";
import { Checkbox } from "../../../components/ui-next/checkbox";
import { Input } from "../../../components/ui-next/input";
import { useI18n } from "../../../lib/i18n";
import { REQUEUE_STATUSES, type BooleanSetter, type OperationRun, type RequeueStatusesSetter, type StringSetter } from "../types";
import { numberOrNull } from "../utils";

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
  const { t } = useI18n();

  return (
    <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>{t("operations.requeue")}</CardTitle>
          <CardDescription>{t("operations.requeueStatuses")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2">
            {REQUEUE_STATUSES.map((status) => (
              <label key={status} className="flex items-center gap-2 rounded-md border border-border-subtle bg-bg-surface px-3 py-2 text-sm">
                <Checkbox
                  checked={requeueStatuses.includes(status)}
                  onCheckedChange={(checked) => {
                    setRequeueStatuses((current) => (checked ? [...current, status] : current.filter((item) => item !== status)));
                  }}
                />
                {t(`common.status.${status}`)}
              </label>
            ))}
          </div>
          <Input placeholder={t("operations.limit")} inputMode="numeric" value={requeueLimit} onChange={(event) => setRequeueLimit(event.target.value)} />
          <Button
            type="button"
            disabled={mutationPending}
            onClick={() =>
              run("/api/v1/actions/requeue", t("operations.requeue"), {
                statuses: requeueStatuses.length ? requeueStatuses : null,
                limit: numberOrNull(requeueLimit),
              })
            }
          >
            <RotateCcw className="h-4 w-4" />
            {t("operations.requeue")}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("operations.recoverInterrupted")}</CardTitle>
          <CardDescription>{t("operations.timeoutMinutes")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input placeholder={t("operations.timeoutMinutes")} inputMode="numeric" value={recoverTimeout} onChange={(event) => setRecoverTimeout(event.target.value)} />
          <Button type="button" variant="secondary" disabled={mutationPending} onClick={() => run("/api/v1/actions/recover-interrupted", t("operations.recoverInterrupted"), { timeout_minutes: numberOrNull(recoverTimeout) })}>
            {t("operations.recover")}
          </Button>
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle>{t("operations.maintenance")}</CardTitle>
          <CardDescription>{t("operations.exportNote")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-danger/20 bg-danger/10 p-3 text-sm text-danger">{t("operations.fullScanWarning")}</div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={confirmFullScan} onCheckedChange={(checked) => setConfirmFullScan(Boolean(checked))} />
            {t("operations.confirmFullScan")}
          </label>
          <div className="grid gap-3 md:grid-cols-[1fr_auto_auto]">
            <Input placeholder={t("operations.verifyLimit")} inputMode="numeric" value={verifyLimit} onChange={(event) => setVerifyLimit(event.target.value)} />
            <Button
              type="button"
              variant="secondary"
              disabled={mutationPending || !confirmFullScan}
              onClick={() => run("/api/v1/maintenance/verify", t("operations.fullVerify"), { limit: numberOrNull(verifyLimit), confirm_full_scan: confirmFullScan })}
            >
              {t("operations.fullVerify")}
            </Button>
            <Button
              type="button"
              variant="secondary"
              disabled={mutationPending || !confirmFullScan}
              onClick={() => run("/api/v1/maintenance/backfill", t("operations.fullBackfill"), { confirm_full_scan: confirmFullScan, normalize_files: true })}
            >
              {t("operations.fullBackfill")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
