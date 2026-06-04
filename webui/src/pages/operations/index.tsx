import { Badge } from "../../components/ui/badge";
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
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-fg-primary">操作</h1>
          <p className="mt-1 text-sm text-fg-secondary">
            系统状态 · 全量维护 · DB pool
          </p>
        </div>
        <Badge tone={ops.isPending ? "warning" : "secondary"}>
          {ops.isPending ? "运行中..." : "空闲"}
        </Badge>
      </section>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="maintenance">维护操作</TabsTrigger>
          <TabsTrigger value="cookies">Cookies</TabsTrigger>
          <TabsTrigger value="system">系统状态</TabsTrigger>
          <TabsTrigger value="database">数据库工具</TabsTrigger>
          <TabsTrigger value="logs">日志</TabsTrigger>
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
