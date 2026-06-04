import * as React from "react";
import type { ArchiveSourceDetail, ArchiveSubmission, DownloadPolicy, SourceScanRun } from "@/lib/api";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSourceDiscovered, useSourceScanRuns } from "../../hooks/useSourceDetail";
import { SourceScanHistoryTab } from "../source-scan-history-tab";
import { SourceTweetsTab } from "../source-tweets-tab";
import { preferredScanLimit } from "../../utils";
import { SourceHeader } from "./source-header";
import { ScanActions } from "./scan-actions";
import { DownloadActions } from "./download-actions";
import { ManualImport } from "./manual-import";
import { ScanLogDialog } from "./scan-log-dialog";
import { useNumberInput, type NumberInputState } from "./use-number-input";

type ScanMode = "history" | "latest_refresh" | "from_start";

type DetailActions = {
  submitRecords: (input: { sourceId: number; records: Array<{ url: string }> }) => void;
  setStatus: (input: { sourceId: number; status: "active" | "paused" }) => void;
  startSession: (input: { sourceId: number; mode: ScanMode; limit: number; restart?: boolean }) => void;
  pauseSession: (sourceId: number) => void;
  resumeSession: (sourceId: number) => void;
  submitDiscovered: (input: { sourceId: number; limit?: number }) => void;
  stopHistory: (sourceId: number) => void;
  pending: {
    submit: boolean;
    status: boolean;
    submitDiscovered: boolean;
    history: boolean;
  };
  errors: {
    submit: unknown;
    status: unknown;
    submitDiscovered: unknown;
    history: unknown;
  };
};

export function SourceDetailPanel({
  open,
  onOpenChange,
  source,
  policy,
  now,
  detailUpdatedAt,
  feedback,
  scanFeedback,
  statusLabel,
  actions,
  onManualSubmitted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source?: ArchiveSourceDetail;
  policy?: DownloadPolicy;
  now: number;
  detailUpdatedAt: number;
  feedback: ArchiveSubmission | null;
  scanFeedback: Record<string, unknown> | null;
  statusLabel: (status?: string | null) => string;
  actions: DetailActions;
  onManualSubmitted: () => void;
}) {
  const scanLimit = useNumberInput("20");
  const [activeTab, setActiveTab] = React.useState("tweets");
  const [tweetsOffset, setTweetsOffset] = React.useState(0);
  const [historyOffset, setHistoryOffset] = React.useState(0);
  const [logRun, setLogRun] = React.useState<SourceScanRun | null>(null);
  const persistedScanLimit = source ? preferredScanLimit(source, policy) : 20;
  const discoveredQuery = useSourceDiscovered(source?.id ?? null, tweetsOffset, activeTab === "tweets");
  const scanRunsQuery = useSourceScanRuns(
    source?.id ?? null,
    historyOffset,
    activeTab === "history",
    source?.active_scan_run?.status === "running",
  );

  React.useEffect(() => {
    if (!source) return;
    scanLimit.set(String(persistedScanLimit));
  }, [source?.id, persistedScanLimit]);

  React.useEffect(() => {
    setActiveTab("tweets");
    setTweetsOffset(0);
    setHistoryOffset(0);
  }, [source?.id]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="h-dvh w-[min(100vw,780px)] overflow-hidden p-0">
        {!source ? (
          <p className="px-6 py-4 text-sm text-fg-secondary">选择一个来源。</p>
        ) : (
          <>
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex h-full min-h-0 flex-col">
              <SheetHeader className="mb-0 shrink-0 gap-4 px-6 pb-0 pt-6 pr-12">
                <SheetTitle className="sr-only">{source.label || source.author_username || "来源详情"}</SheetTitle>
                <SourceHeader
                  source={source}
                  policy={policy}
                  now={now}
                  detailUpdatedAt={detailUpdatedAt}
                  scanLimit={scanLimit.clamped(200)}
                  statusLabel={statusLabel}
                />
                <TabsList className="flex-wrap">
                  <TabsTrigger value="tweets">最近发现的 Tweet</TabsTrigger>
                  <TabsTrigger value="history">扫描历史（最近 20 批）</TabsTrigger>
                  <TabsTrigger value="config">提交与导入</TabsTrigger>
                </TabsList>
              </SheetHeader>
              <TabsContent
                value="tweets"
                className="min-h-0 flex-1 overflow-hidden px-6 pb-6 pt-4 data-[state=active]:flex data-[state=active]:flex-col"
              >
                <div className="flex min-h-0 flex-1 flex-col gap-4">
                  <div className="shrink-0 space-y-4">
                    <ScanActions
                      source={source}
                      actions={actions}
                      scanFeedback={scanFeedback}
                      scanLimit={scanLimit}
                      onOpenLog={setLogRun}
                    />
                  </div>
                  <div className="min-h-0 flex-1">
                    <SourceTweetsTab
                      data={discoveredQuery.data}
                      isLoading={discoveredQuery.isLoading}
                      error={discoveredQuery.error}
                      offset={tweetsOffset}
                      onOffsetChange={setTweetsOffset}
                      statusLabel={statusLabel}
                    />
                  </div>
                </div>
              </TabsContent>
              <TabsContent
                value="history"
                className="min-h-0 flex-1 overflow-hidden px-6 pb-6 pt-4 data-[state=active]:flex data-[state=active]:flex-col"
              >
                <div className="relative flex min-h-0 flex-1 flex-col border-l-2 border-border-subtle pl-0">
                  <SourceScanHistoryTab
                    data={scanRunsQuery.data}
                    isLoading={scanRunsQuery.isLoading}
                    error={scanRunsQuery.error}
                    offset={historyOffset}
                    onOffsetChange={setHistoryOffset}
                    now={now}
                  />
                </div>
              </TabsContent>
              <TabsContent
                value="config"
                className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4 data-[state=active]:block"
              >
                <div className="space-y-4">
                  <DownloadActions source={source} actions={actions} feedback={feedback} />
                  <ManualImport source={source} actions={actions} feedback={feedback} onSubmitted={onManualSubmitted} />
                </div>
              </TabsContent>
            </Tabs>
            <ScanLogDialog run={logRun} onOpenChange={(open) => !open && setLogRun(null)} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
