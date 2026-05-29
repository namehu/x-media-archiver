import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import type { ArchiveSubmission } from "../lib/api";
import { useFormatters, useI18n } from "../lib/i18n";
import { CreateSource } from "./sources/components/CreateSource";
import { SourceDetailPanel } from "./sources/components/SourceDetailPanel";
import { SourcesList } from "./sources/components/SourcesList";
import { useDownloadPolicy, useSourceDetail } from "./sources/hooks/useSourceDetail";
import { useSourceActions } from "./sources/hooks/useSourceScan";
import { useCreateSource, useSourcesQuery } from "./sources/hooks/useSourcesQuery";

export function SourcesPage() {
  const { t } = useI18n();
  const { statusLabel } = useFormatters();
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

  const sourcesQuery = useSourcesQuery(sourceStatusFilter, sourceTypeFilter, offset);
  const detailQuery = useSourceDetail(selectedSourceId);
  const policyQuery = useDownloadPolicy();
  const selected = detailQuery.data;
  const activeScanRun = selected?.scan_runs?.find((run) => run.status === "running");

  const refresh = async (sourceId?: number) => {
    if (sourceId) setSelectedSourceId(sourceId);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["sources"] }),
      queryClient.invalidateQueries({ queryKey: ["source"] }),
      queryClient.invalidateQueries({ queryKey: ["archive-runs"] }),
    ]);
  };

  const createMutation = useCreateSource(async (source) => {
    setCreateResetKey((key) => key + 1);
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
    if (Number.isFinite(sourceId) && sourceId > 0) setSelectedSourceId(sourceId);
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
    setSearchParams({ sourceId: String(sourceId) });
  };

  return (
    <div className="space-y-5">
      <CreateSource
        t={t}
        isPending={createMutation.isPending}
        error={createMutation.error}
        resetKey={createResetKey}
        onCreate={(input) => createMutation.mutate(input)}
      />
      <section className="grid gap-4 lg:grid-cols-[minmax(340px,0.9fr)_minmax(0,1.3fr)]">
        <SourcesList
          t={t}
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
        />
        <SourceDetailPanel
          source={selected}
          policy={policyQuery.data}
          now={now}
          feedback={feedback}
          scanFeedback={scanFeedback}
          t={t}
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
      </section>
    </div>
  );
}
