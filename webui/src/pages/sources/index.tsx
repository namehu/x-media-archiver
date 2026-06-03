import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import type { ArchiveSubmission } from "@/lib/api";
import { statusLabel } from "@/lib/formatters";
import { CreateSource } from "./components/create-source";
import { SourceDetailPanel } from "./components/source-detail-panel";
import { SourcesList } from "./components/sources-list";
import { useDownloadPolicy, useSourceDetail } from "./hooks/useSourceDetail";
import { useSourceActions } from "./hooks/useSourceScan";
import { useCreateSource, useSourcesQuery } from "./hooks/useSourcesQuery";

export function SourcesPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedSourceId, setSelectedSourceId] = useState<number | null>(null);
  const [sourceStatusFilter, setSourceStatusFilter] = useState("");
  const [sourceTypeFilter, setSourceTypeFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const [feedback, setFeedback] = useState<ArchiveSubmission | null>(null);
  const [scanFeedback, setScanFeedback] = useState<Record<string, unknown> | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [createResetKey, setCreateResetKey] = useState(0);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);

  const sourcesQuery = useSourcesQuery(sourceStatusFilter, sourceTypeFilter, offset);
  const detailQuery = useSourceDetail(selectedSourceId);
  const policyQuery = useDownloadPolicy();
  const selected = detailQuery.data;
  const activeScanRun = selected?.active_scan_run;

  const refresh = async (sourceId?: number) => {
    if (sourceId) setSelectedSourceId(sourceId);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["sources"] }),
      queryClient.invalidateQueries({ queryKey: sourceId ? ["source", sourceId] : ["source"] }),
      queryClient.invalidateQueries({ queryKey: sourceId ? ["source-discovered", sourceId] : ["source-discovered"] }),
      queryClient.invalidateQueries({ queryKey: sourceId ? ["source-scan-runs", sourceId] : ["source-scan-runs"] }),
      queryClient.invalidateQueries({ queryKey: ["archive-runs"] }),
    ]);
  };

  const createMutation = useCreateSource(async (source) => {
    setCreateResetKey((key) => key + 1);
    setCreateDialogOpen(false);
    await refresh(source.id);
  });

  const actions = useSourceActions({
    selectedSourceId,
    onFeedback: setFeedback,
    onScanFeedback: setScanFeedback,
    onRefresh: refresh,
  });

  useEffect(() => {
    const sourceId = Number(searchParams.get("sourceId"));
    if (Number.isFinite(sourceId) && sourceId > 0) {
      setSelectedSourceId(sourceId);
      setDetailSheetOpen(true);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!activeScanRun) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [activeScanRun?.id]);

  const selectSource = (sourceId: number) => {
    setFeedback(null);
    setScanFeedback(null);
    setSelectedSourceId(sourceId);
    setDetailSheetOpen(true);
    setSearchParams({ sourceId: String(sourceId) });
  };

  const closeDetail = () => {
    setDetailSheetOpen(false);
    setSelectedSourceId(null);
    setSearchParams({});
  };

  return (
    <div className="space-y-5">
      <SourcesList
        statusLabel={statusLabel}
        data={sourcesQuery.data}
        selectedSourceId={selectedSourceId}
        statusFilter={sourceStatusFilter}
        typeFilter={sourceTypeFilter}
        offset={offset}
        onStatusFilterChange={setSourceStatusFilter}
        onTypeFilterChange={setSourceTypeFilter}
        onOffsetChange={setOffset}
        onSelectSource={selectSource}
        onAddClick={() => setCreateDialogOpen(true)}
      />

      {/* 新增来源弹窗 */}
      <CreateSource
        open={createDialogOpen}
        isPending={createMutation.isPending}
        error={createMutation.error}
        resetKey={createResetKey}
        onCreate={(input) => createMutation.mutate(input)}
        onOpenChange={setCreateDialogOpen}
      />

      <SourceDetailPanel
        open={detailSheetOpen}
        onOpenChange={(open) => {
          if (!open) closeDetail();
        }}
        source={selected}
        policy={policyQuery.data}
        now={now}
        detailUpdatedAt={detailQuery.dataUpdatedAt}
        feedback={feedback}
        scanFeedback={scanFeedback}
        statusLabel={statusLabel}
        actions={{
          submitRecords: actions.submitMutation.mutate,
          setStatus: actions.statusMutation.mutate,
          scan: actions.scanMutation.mutate,
          submitDiscovered: actions.submitDiscoveredMutation.mutate,
          startHistory: actions.historyScanMutation.mutate,
          stopHistory: actions.stopHistoryScanMutation.mutate,
          pending: {
            submit: actions.submitMutation.isPending,
            status: actions.statusMutation.isPending,
            scan: actions.scanMutation.isPending,
            submitDiscovered: actions.submitDiscoveredMutation.isPending,
            history: actions.historyScanMutation.isPending || actions.stopHistoryScanMutation.isPending,
          },
          errors: {
            submit: actions.submitMutation.error,
            status: actions.statusMutation.error,
            scan: actions.scanMutation.error,
            submitDiscovered: actions.submitDiscoveredMutation.error,
            history: actions.historyScanMutation.error || actions.stopHistoryScanMutation.error,
          },
        }}
        onManualSubmitted={() => setFeedback(null)}
      />
    </div>
  );
}
