import * as React from "react";
import { ArrowLeft, ExternalLink } from "lucide-react";
import type {
  ArchiveRunControl,
  ArchiveSourceDetail,
  ArchiveSubmission,
  DownloadPolicy,
  SourceDownloadSummary,
  SourceScanRun,
} from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { sourceTypeLabel } from "@/lib/formatters";
import { useSourceDiscovered, useSourceDownloads, useSourceScanRuns } from "../../hooks/useSourceDetail";
import { preferredScanLimit, sourceScanStatus } from "../../utils";
import { SourceScanHistoryTab } from "../source-scan-history-tab";
import { DEFAULT_TWEET_FILTERS, type DownloadSubmitInput } from "../source-tweet-filters";
import { DownloadActions } from "./download-actions";
import { ManualImport } from "./manual-import";
import { ScanLogDialog } from "./scan-log-dialog";
import { SourceDetailContent } from "./source-detail-content";
import { SourceOverviewContent, SourceTweetsContent } from "./source-tweets-content";
import {
  getPrivacyExternalHref,
  getPrivacyRedactProps,
  usePrivacyRedactionEnabled,
} from "@/lib/privacy-redaction";

type ScanMode = "history" | "latest_refresh" | "from_start";

type DetailActions = {
  submitRecords: (input: { sourceId: number; records: Array<{ url: string }> }) => void;
  setStatus: (input: { sourceId: number; status: "active" | "paused" }) => void;
  startSession: (input: { sourceId: number; mode: ScanMode; limit: number; restart?: boolean }) => void;
  pauseSession: (sourceId: number) => void;
  resumeSession: (sourceId: number) => void;
  submitDiscovered: (input: { sourceId: number; limit?: number }) => void;
  submitDownload: (input: DownloadSubmitInput) => Promise<ArchiveSubmission>;
  pauseDownload: (runId: number) => void;
  resumeDownload: (runId: number) => Promise<ArchiveRunControl>;
  stopDownload: (runId: number) => void;
  cancelDownloadItems: (input: { runId: number; tweetIds: string[] }) => void;
  stopHistory: (sourceId: number) => void;
  deleteSource: (sourceId: number) => void;
  pending: {
    submit: boolean;
    status: boolean;
    submitDiscovered: boolean;
    download: boolean;
    history: boolean;
    deleteSource: boolean;
  };
  errors: {
    submit: unknown;
    status: unknown;
    submitDiscovered: unknown;
    download: unknown;
    history: unknown;
    deleteSource: unknown;
  };
};

export function SourceDetailPanel({
  source,
  loading,
  error,
  onBack,
  onRetry,
  policy,
  hasDownloadQueueWork,
  now,
  detailUpdatedAt,
  feedback,
  scanFeedback,
  statusLabel,
  actions,
  onManualSubmitted,
}: {
  source?: ArchiveSourceDetail;
  loading: boolean;
  error: unknown;
  onBack: () => void;
  onRetry: () => void;
  policy?: DownloadPolicy;
  hasDownloadQueueWork: boolean;
  now: number;
  detailUpdatedAt: number;
  feedback: ArchiveSubmission | null;
  scanFeedback: Record<string, unknown> | null;
  statusLabel: (status?: string | null) => string;
  actions: DetailActions;
  onManualSubmitted: () => void;
}) {
  const privacyRedactionEnabled = usePrivacyRedactionEnabled();
  const [activeTab, setActiveTab] = React.useState("overview");
  const [logRun, setLogRun] = React.useState<SourceScanRun | null>(null);
  const [tweetFilters, setTweetFilters] = React.useState(DEFAULT_TWEET_FILTERS);
  const persistedScanLimit = source ? preferredScanLimit(source, policy) : 20;
  const isDeleted = Boolean(source?.deleted_at);
  const discoveredQuery = useSourceDiscovered(source?.id ?? null, activeTab === "tweets", isDeleted, tweetFilters);
  const downloadsQuery = useSourceDownloads(
    source?.id ?? null,
    activeTab === "overview" || activeTab === "tweets",
    isDeleted,
  );
  const scanRunsQuery = useSourceScanRuns(
    source?.id ?? null,
    activeTab === "history",
    source?.active_scan_run?.status === "running",
    isDeleted,
  );
  const scanRuns = scanRunsQuery.data?.pages.flatMap((page) => page.rows) ?? [];
  const scanStatus = source ? sourceScanStatus(source) : null;
  const sourceHref = getPrivacyExternalHref(privacyRedactionEnabled, source?.source_url);

  React.useEffect(() => {
    setActiveTab("overview");
    setTweetFilters(DEFAULT_TWEET_FILTERS);
  }, [source?.id]);

  if (loading && !source) {
    return <SourceDetailSkeleton onBack={onBack} />;
  }

  if (error || !source) {
    return (
      <div className="flex flex-col gap-4">
        <Button type="button" variant="ghost" className="self-start" onClick={onBack}>
          <ArrowLeft data-icon="inline-start" aria-hidden="true" />
          返回来源目录
        </Button>
        <ErrorState
          title="无法打开来源"
          detail={error instanceof Error ? error.message : "来源可能已被删除，或当前连接暂时不可用。"}
          onRetry={onRetry}
        />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-6rem)] min-h-[640px] flex-col overflow-hidden rounded-xl border border-border-subtle bg-bg-surface">
      <header className="shrink-0 border-b border-border-subtle px-4 pb-4 pt-3 sm:px-6 sm:pt-4">
        <Button type="button" size="sm" variant="ghost" className="mb-2 -ml-2" onClick={onBack}>
          <ArrowLeft data-icon="inline-start" aria-hidden="true" />
          来源目录
        </Button>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0" {...getPrivacyRedactProps(privacyRedactionEnabled)}>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-bold text-fg-primary sm:text-2xl">
                {source.label || source.author_username || "未知来源"}
              </h1>
              {scanStatus ? <Badge tone={scanStatus.tone}>{scanStatus.label}</Badge> : null}
              {source.deleted_at ? <Badge tone="danger">已删除</Badge> : null}
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-secondary">
              <span>{sourceTypeLabel(source.source_type)}</span>
              <span>@{source.author_username || "-"}</span>
              <span className="tabular-nums">{source.discovered_tweet_count ?? source.discovered_count ?? 0} 条 Tweet</span>
              <span className="tabular-nums">{source.unsubmitted_tweet_count ?? 0} 条待下载</span>
            </div>
          </div>
          {sourceHref ? (
            <a
              className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-border-strong px-3 text-sm font-medium text-fg-primary transition hover:bg-bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
              href={sourceHref}
              target="_blank"
              rel="noreferrer"
              title={sourceHref}
            >
              在 X 中打开
              <ExternalLink aria-hidden="true" className="size-4" />
            </a>
          ) : null}
        </div>
      </header>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col">
        <TabsList className="shrink-0 overflow-x-auto px-4 pt-3 sm:px-6">
          <TabsTrigger className="shrink-0" value="overview">概览</TabsTrigger>
          <TabsTrigger className="shrink-0" value="tweets">发现的 Tweet</TabsTrigger>
          <TabsTrigger className="shrink-0" value="history">扫描历史</TabsTrigger>
          <TabsTrigger className="shrink-0" value="advanced">更多设置</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-5 sm:px-6">
          {downloadsQuery.error ? (
            <Alert variant="destructive" className="mb-4">
              <AlertTitle>下载状态暂时不可用</AlertTitle>
              <AlertDescription>{String(downloadsQuery.error)}</AlertDescription>
            </Alert>
          ) : null}
          <SourceOverviewContent
            source={source}
            actions={actions}
            scanFeedback={scanFeedback}
            scanLimit={persistedScanLimit}
            hasDownloadQueueWork={hasDownloadQueueWork}
            onOpenLog={setLogRun}
            downloads={downloadsQuery.data as SourceDownloadSummary | undefined}
            statusLabel={statusLabel}
            now={now}
            readonly={isDeleted}
          />
        </TabsContent>

        <TabsContent
          value="tweets"
          className="min-h-0 flex-1 overflow-hidden px-4 pb-4 pt-4 data-[state=active]:flex data-[state=active]:flex-col sm:px-6"
        >
          <SourceTweetsContent
            source={source}
            actions={actions}
            pages={discoveredQuery.data?.pages ?? []}
            downloads={downloadsQuery.data as SourceDownloadSummary | undefined}
            isLoading={discoveredQuery.isLoading}
            isFetchingNextPage={discoveredQuery.isFetchingNextPage}
            hasNextPage={discoveredQuery.hasNextPage}
            error={discoveredQuery.error || downloadsQuery.error}
            onLoadMore={() => discoveredQuery.fetchNextPage()}
            statusLabel={statusLabel}
            filters={tweetFilters}
            onFiltersChange={setTweetFilters}
            readonly={isDeleted}
          />
        </TabsContent>

        <TabsContent
          value="history"
          className="min-h-0 flex-1 overflow-hidden px-4 pb-6 pt-4 data-[state=active]:flex data-[state=active]:flex-col sm:px-6"
        >
          <SourceScanHistoryTab
            runs={scanRuns}
            isLoading={scanRunsQuery.isLoading}
            isFetchingNextPage={scanRunsQuery.isFetchingNextPage}
            hasNextPage={scanRunsQuery.hasNextPage}
            error={scanRunsQuery.error}
            onLoadMore={() => scanRunsQuery.fetchNextPage()}
            now={now}
          />
        </TabsContent>

        <TabsContent value="advanced" className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-5 sm:px-6">
          <div className="mx-auto flex max-w-4xl flex-col gap-6">
            {!isDeleted ? (
              <section className="flex flex-col gap-3">
                <div>
                  <h2 className="text-base font-semibold text-fg-primary">提交与导入</h2>
                  <p className="mt-1 text-sm text-fg-secondary">处理已发现的待下载项，或补充粘贴独立 Tweet URL。</p>
                </div>
                <div className="grid gap-4 lg:grid-cols-2">
                  <DownloadActions source={source} actions={actions} feedback={feedback} />
                  <ManualImport source={source} actions={actions} feedback={feedback} onSubmitted={onManualSubmitted} />
                </div>
              </section>
            ) : null}
            <section className="flex flex-col gap-3">
              <div>
                <h2 className="text-base font-semibold text-fg-primary">来源信息</h2>
                <p className="mt-1 text-sm text-fg-secondary">查看游标、扫描范围和来源生命周期；删除操作也在这里完成。</p>
              </div>
              <SourceDetailContent
                source={source}
                now={now}
                detailUpdatedAt={detailUpdatedAt}
                scanLimit={persistedScanLimit}
                deletePending={actions.pending.deleteSource}
                deleteError={actions.errors.deleteSource}
                onDelete={actions.deleteSource}
              />
            </section>
          </div>
        </TabsContent>
      </Tabs>

      <ScanLogDialog run={logRun} onOpenChange={(open) => !open && setLogRun(null)} />
    </div>
  );
}

function SourceDetailSkeleton({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex h-[calc(100dvh-6rem)] min-h-[640px] flex-col overflow-hidden rounded-xl border border-border-subtle bg-bg-surface">
      <div className="border-b border-border-subtle px-4 py-4 sm:px-6">
        <Button type="button" size="sm" variant="ghost" className="mb-3 -ml-2" onClick={onBack}>
          <ArrowLeft data-icon="inline-start" aria-hidden="true" />
          来源目录
        </Button>
        <Skeleton className="h-7 w-56" />
        <Skeleton className="mt-2 h-4 w-80 max-w-full" />
      </div>
      <div className="flex gap-4 border-b border-border-subtle px-4 pt-4 sm:px-6">
        {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-7 w-20" />)}
      </div>
      <div className="grid gap-4 p-4 sm:grid-cols-2 sm:p-6">
        <Skeleton className="h-28" />
        <Skeleton className="h-28" />
        <Skeleton className="h-64 sm:col-span-2" />
      </div>
    </div>
  );
}
