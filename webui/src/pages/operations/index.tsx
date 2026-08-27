import { Badge } from "../../components/ui/badge";
import { ManagementPageHeader } from "../../components/ui/management-page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../components/ui/tabs";
import { useSearchParams } from "react-router-dom";
import { OperationResultPanel } from "./components/operation-result-panel";
import { useMaintenanceOps } from "./hooks/useMaintenanceOps";
import { useSystemHealth } from "./hooks/useSystemHealth";
import { CookiesTab } from "./components/cookies-tab";
import { DatabaseTab } from "./components/database-tab";
import { LogsTab } from "./components/logs-tab";
import { MaintenanceTab } from "./components/maintenance-tab";
import { SystemStatusTab } from "./components/system-status-tab";

export function OperationsPage() {
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
    <div className="flex flex-col gap-6">
      <ManagementPageHeader
        eyebrow="维护工具"
        title="系统操作"
        description="查看运行状态、执行维护任务，并管理 Cookies、数据库导出与日志。"
        actions={
          <Badge tone={ops.isPending ? "warning" : "secondary"}>
            {ops.isPending ? "操作运行中" : "当前空闲"}
          </Badge>
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsTrigger value="maintenance">维护操作</TabsTrigger>
          <TabsTrigger value="system">系统状态</TabsTrigger>
          <TabsTrigger value="logs">日志</TabsTrigger>
          <TabsTrigger value="cookies">Cookies</TabsTrigger>
          <TabsTrigger value="database">数据库工具</TabsTrigger>
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

      {ops.lastResult || ops.error || ops.isPending ? (
        <OperationResultPanel result={ops.lastResult} error={ops.error} isPending={ops.isPending} />
      ) : null}
    </div>
  );
}
