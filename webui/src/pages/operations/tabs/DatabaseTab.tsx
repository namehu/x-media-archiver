import { Activity, Database, HardDrive, Server } from "lucide-react";
import type { HealthDetail } from "../../../lib/api";
import { Button } from "../../../components/ui-next/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui-next/card";
import { StatCard } from "../../../components/ui-next/stat-card";
import { useI18n } from "../../../lib/i18n";
import type { OperationRun, StringSetter } from "../types";

type DatabaseTabProps = {
  mutationPending: boolean;
  exportKind: string;
  setExportKind: StringSetter;
  exportStatus: string;
  setExportStatus: StringSetter;
  health?: HealthDetail;
  run: OperationRun;
};

export function DatabaseTab({ mutationPending, exportKind, setExportKind, exportStatus, setExportStatus, health, run }: DatabaseTabProps) {
  const { t } = useI18n();
  const pool = health?.db_pool;

  return (
    <section className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label={t("operations.dbPoolActive")} value={pool?.active ?? "-"} detail={`max ${pool?.max_size ?? "-"}`} icon={<Database className="h-4 w-4" />} />
        <StatCard label={t("operations.dbPoolIdle")} value={pool?.idle ?? "-"} detail={`min ${pool?.min_size ?? "-"}`} icon={<Server className="h-4 w-4" />} tone="success" />
        <StatCard label={t("operations.dbPoolWaiting")} value={pool?.waiting ?? "-"} detail={t("operations.dbPoolWaitingHint")} icon={<Activity className="h-4 w-4" />} tone={pool?.waiting ? "warning" : "brand"} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("operations.export")}</CardTitle>
          <CardDescription>{t("operations.exportNote")}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <select className="h-9 rounded-md border border-border-strong bg-bg-elevated px-3 text-sm text-fg-primary outline-none focus-visible:ring-2 focus-visible:ring-brand/50" value={exportKind} onChange={(event) => setExportKind(event.target.value)}>
            <option value="media">{t("operations.exportMedia")}</option>
            <option value="failures">{t("operations.exportFailures")}</option>
            <option value="duplicates">{t("operations.exportDuplicates")}</option>
          </select>
          <select className="h-9 rounded-md border border-border-strong bg-bg-elevated px-3 text-sm text-fg-primary outline-none focus-visible:ring-2 focus-visible:ring-brand/50" value={exportStatus} onChange={(event) => setExportStatus(event.target.value)}>
            <option value="verified">{t("common.status.verified")}</option>
            <option value="all">{t("common.status.all")}</option>
            <option value="downloaded">{t("common.status.downloaded")}</option>
            <option value="missing">{t("common.status.missing")}</option>
            <option value="corrupt">{t("common.status.corrupt")}</option>
          </select>
          <Button type="button" disabled={mutationPending} onClick={() => run("/api/v1/actions/export", t("operations.export"), { kind: exportKind, status: exportStatus })}>
            <HardDrive className="h-4 w-4" />
            {t("operations.exportSnapshot")}
          </Button>
        </CardContent>
      </Card>
    </section>
  );
}
