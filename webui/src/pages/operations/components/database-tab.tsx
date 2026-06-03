import { Activity, Database, HardDrive, Server } from "lucide-react";
import type { HealthDetail } from "../../../lib/api";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { StatCard } from "../../../components/ui/stat-card";
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
  const pool = health?.db_pool;

  return (
    <section className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="活跃连接" value={pool?.active ?? "-"} detail={`max ${pool?.max_size ?? "-"}`} icon={<Database className="h-4 w-4" />} />
        <StatCard label="空闲连接" value={pool?.idle ?? "-"} detail={`min ${pool?.min_size ?? "-"}`} icon={<Server className="h-4 w-4" />} tone="success" />
        <StatCard label="等待连接" value={pool?.waiting ?? "-"} detail="等待获取连接的请求" icon={<Activity className="h-4 w-4" />} tone={pool?.waiting ? "warning" : "brand"} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>导出</CardTitle>
          <CardDescription>上方 CSV 导出读取数据库快照，不扫描媒体文件内容。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <select className="h-9 rounded-md border border-border-strong bg-bg-elevated px-3 text-sm text-fg-primary outline-none focus-visible:ring-2 focus-visible:ring-brand/50" value={exportKind} onChange={(event) => setExportKind(event.target.value)}>
            <option value="media">媒体 CSV</option>
            <option value="failures">失败 CSV</option>
            <option value="duplicates">重复 CSV</option>
          </select>
          <select className="h-9 rounded-md border border-border-strong bg-bg-elevated px-3 text-sm text-fg-primary outline-none focus-visible:ring-2 focus-visible:ring-brand/50" value={exportStatus} onChange={(event) => setExportStatus(event.target.value)}>
            <option value="verified">已校验</option>
            <option value="all">全部状态</option>
            <option value="downloaded">已下载</option>
            <option value="missing">文件缺失</option>
            <option value="corrupt">文件损坏</option>
          </select>
          <Button type="button" disabled={mutationPending} onClick={() => run("/api/v1/actions/export", "导出", { kind: exportKind, status: exportStatus })}>
            <HardDrive className="h-4 w-4" />
            导出数据库快照
          </Button>
        </CardContent>
      </Card>
    </section>
  );
}
