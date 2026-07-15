import * as React from "react";
import type { ArchiveSourceDetail, ArchiveSubmission, DownloadPolicy, SourceDownloadSummary, SourceScanRun } from "@/lib/api";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useSourceDiscovered, useSourceDownloads, useSourceScanRuns } from "../../hooks/useSourceDetail";
import { SourceScanHistoryTab } from "../source-scan-history-tab";
import { preferredScanLimit, sourceStatusTone } from "../../utils";
import { SourceDetailContent } from "./source-detail-content";
import { SourceTweetsContent } from "./source-tweets-content";
import { DownloadActions } from "./download-actions";
import { ManualImport } from "./manual-import";
import { ScanLogDialog } from "./scan-log-dialog";
import { useNumberInput, type NumberInputState } from "./use-number-input";
import { Badge } from "@/components/ui/badge";
import { ExternalLink } from "lucide-react";

type ScanMode = "history" | "latest_refresh" | "from_start";

type DetailActions = {
  submitRecords: (input: { sourceId: number; records: Array<{ url: string }> }) => void;
  setStatus: (input: { sourceId: number; status: "active" | "paused" }) => void;
  startSession: (input: { sourceId: number; mode: ScanMode; limit: number; restart?: boolean }) => void;
  pauseSession: (sourceId: number) => void;
  resumeSession: (sourceId: number) => void;
  submitDiscovered: (input: { sourceId: number; limit?: number }) => void;
  submitDownload: (input: { sourceId: number; scope: "selected" | "all_unsubmitted" | "failed"; tweetIds?: string[]; limit?: number }) => void;
  pauseDownload: (runId: number) => void;
  resumeDownload: (runId: number) => void;
  stopDownload: (runId: number) => void;
  cancelDownloadItems: (input: { runId: number; tweetIds: string[] }) => void;
  stopHistory: (sourceId: number) => void;
  pending: {
    submit: boolean;
    status: boolean;
    submitDiscovered: boolean;
    download: boolean;
    history: boolean;
  };
  errors: {
    submit: unknown;
    status: unknown;
    submitDiscovered: unknown;
    download: unknown;
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
  const [logRun, setLogRun] = React.useState<SourceScanRun | null>(null);
  const persistedScanLimit = source ? preferredScanLimit(source, policy) : 20;
  const discoveredQuery = useSourceDiscovered(source?.id ?? null, tweetsOffset, activeTab === "tweets");
  const downloadsQuery = useSourceDownloads(source?.id ?? null, activeTab === "tweets");
  const scanRunsQuery = useSourceScanRuns(
    source?.id ?? null,
    activeTab === "history",
    source?.active_scan_run?.status === "running",
  );
  const scanRuns = scanRunsQuery.data?.pages.flatMap((page) => page.rows) ?? [];

  React.useEffect(() => {
    if (!source) return;
    scanLimit.set(String(persistedScanLimit));
  }, [source?.id, persistedScanLimit]);

  React.useEffect(() => {
    setActiveTab("tweets");
    setTweetsOffset(0);
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

                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge tone={sourceStatusTone(source.status)}>{statusLabel(source.status)}</Badge>
                      <h2 className="text-xl font-semibold text-fg-primary">
                        {source.label || source.author_username || "来源详情"}
                      </h2>
                    </div>
                    {source.source_url ? (
                      <a
                        className="mt-0.5 inline-flex min-w-0 items-center gap-1 break-all text-sm text-brand hover:text-brand-hover"
                        href={source.source_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <span className="break-all">{source.source_url}</span>
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                      </a>
                    ) : (
                      <p className="mt-0.5 text-sm text-fg-secondary">无</p>
                    )}
                  </div>
                </div>

                <TabsList className="flex-wrap">
                  <TabsTrigger value="tweets">发现的 Tweet</TabsTrigger>
                  <TabsTrigger value="details">详情</TabsTrigger>
                  <TabsTrigger value="history">扫描历史</TabsTrigger>
                  <TabsTrigger value="config">提交与导入</TabsTrigger>
                </TabsList>
              </SheetHeader>
              <TabsContent
                value="tweets"
                className="min-h-0 flex-1 overflow-hidden px-6 pb-6 pt-4 data-[state=active]:flex data-[state=active]:flex-col"
              >
                <SourceTweetsContent
                  source={source}
                  actions={actions}
                  now={now}
                  scanFeedback={scanFeedback}
                  scanLimit={scanLimit}
                  onOpenLog={setLogRun}
                  data={discoveredQuery.data}
                  downloads={downloadsQuery.data as SourceDownloadSummary | undefined}
                  isLoading={discoveredQuery.isLoading}
                  error={discoveredQuery.error || downloadsQuery.error}
                  offset={tweetsOffset}
                  onOffsetChange={setTweetsOffset}
                  statusLabel={statusLabel}
                />
              </TabsContent>
              <TabsContent
                value="details"
                className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4 data-[state=active]:block"
              >
                <SourceDetailContent
                  source={source}
                  now={now}
                  detailUpdatedAt={detailUpdatedAt}
                  scanLimit={scanLimit.clamped(200)}
                />
              </TabsContent>
              <TabsContent
                value="history"
                className="min-h-0 flex-1 overflow-hidden px-6 pb-6 pt-4 data-[state=active]:flex data-[state=active]:flex-col"
              >
                <div className="relative flex min-h-0 flex-1 flex-col">
                  <SourceScanHistoryTab
                    runs={scanRuns}
                    isLoading={scanRunsQuery.isLoading}
                    isFetchingNextPage={scanRunsQuery.isFetchingNextPage}
                    hasNextPage={scanRunsQuery.hasNextPage}
                    error={scanRunsQuery.error}
                    onLoadMore={() => scanRunsQuery.fetchNextPage()}
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
