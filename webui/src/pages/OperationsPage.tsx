import { Badge } from "../components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { useSearchParams } from "react-router-dom";
import { useI18n } from "../lib/i18n";
import { OperationResultPanel } from "./operations/components/OperationResultPanel";
import { useMaintenanceOps } from "./operations/hooks/useMaintenanceOps";
import { useSystemHealth } from "./operations/hooks/useSystemHealth";
import { CookiesTab } from "./operations/tabs/CookiesTab";
import { DatabaseTab } from "./operations/tabs/DatabaseTab";
import { LogsTab } from "./operations/tabs/LogsTab";
import { MaintenanceTab } from "./operations/tabs/MaintenanceTab";
import { SystemStatusTab } from "./operations/tabs/SystemStatusTab";

export function OperationsPage() {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const healthQuery = useSystemHealth();
  const ops = useMaintenanceOps();
  const activeTab = searchParams.get("tab") || "maintenance";
  const streamId = Number(searchParams.get("streamId") || "");
  const selectedStreamId = Number.isFinite(streamId) && streamId > 0 ? streamId : null;
  const setActiveTab = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", value);
    if (value !== "logs") next.delete("streamId");
    setSearchParams(next);
  };

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-fg-primary">{t("nav.operations")}</h1>
          <p className="mt-1 text-sm text-fg-secondary">
            {t("operations.systemStatus")} · {t("operations.maintenance")} · DB pool
          </p>
        </div>
        <Badge tone={ops.isPending ? "warning" : "secondary"}>
          {ops.isPending ? t("operations.running") : t("health.idle")}
        </Badge>
      </section>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="maintenance">{t("operations.maintenanceTab")}</TabsTrigger>
          <TabsTrigger value="cookies">{t("operations.cookiesTab")}</TabsTrigger>
          <TabsTrigger value="system">{t("operations.systemStatus")}</TabsTrigger>
          <TabsTrigger value="database">{t("operations.databaseTab")}</TabsTrigger>
          <TabsTrigger value="logs">{t("operations.logsTab")}</TabsTrigger>
        </TabsList>

        <TabsContent value="maintenance">
          <MaintenanceTab
            mutationPending={ops.isPending}
            verifyLimit={ops.verifyLimit}
            setVerifyLimit={ops.setVerifyLimit}
            confirmFullScan={ops.confirmFullScan}
            setConfirmFullScan={ops.setConfirmFullScan}
            requeueStatuses={ops.requeueStatuses}
            setRequeueStatuses={ops.setRequeueStatuses}
            requeueLimit={ops.requeueLimit}
            setRequeueLimit={ops.setRequeueLimit}
            recoverTimeout={ops.recoverTimeout}
            setRecoverTimeout={ops.setRecoverTimeout}
            run={ops.run}
          />
        </TabsContent>

        <TabsContent value="cookies">
          <CookiesTab />
        </TabsContent>

        <TabsContent value="system">
          <SystemStatusTab health={healthQuery.data} isError={healthQuery.isError} onRetry={() => healthQuery.refetch()} />
        </TabsContent>

        <TabsContent value="database">
          <DatabaseTab
            mutationPending={ops.isPending}
            exportKind={ops.exportKind}
            setExportKind={ops.setExportKind}
            exportStatus={ops.exportStatus}
            setExportStatus={ops.setExportStatus}
            health={healthQuery.data}
            run={ops.run}
          />
        </TabsContent>

        <TabsContent value="logs">
          <LogsTab initialStreamId={selectedStreamId} />
        </TabsContent>
      </Tabs>

      <OperationResultPanel result={ops.lastResult} error={ops.error} isPending={ops.isPending} />
    </div>
  );
}
