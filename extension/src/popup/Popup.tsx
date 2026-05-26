import { useCallback, useEffect, useMemo, useState } from "react";
import type { MessageType, Snapshot } from "../shared/types";
import { t } from "./i18n";

const TARGET = "x-media-archiver-content";

const EMPTY_SNAPSHOT: Snapshot = { tweets: [], stats: {} };

async function activeTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function sendToContent(type: MessageType, options?: unknown): Promise<Snapshot> {
  const tab = await activeTab();
  if (!tab?.id) throw new Error(t("errorNoActiveTab"));
  return browser.tabs.sendMessage(tab.id, { target: TARGET, type, options });
}

function formatDateForFile() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function downloadText(filename: string, text: string, mimeType: string) {
  const blob = new Blob([text], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function Popup() {
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY_SNAPSHOT);
  const [status, setStatus] = useState("");

  const stats = snapshot.stats || {};
  const tweets = snapshot.tweets || [];
  const hasTweets = tweets.length > 0;
  const autoRunning = Boolean(stats.auto_running);

  const pageLabel = useMemo(() => {
    if (!stats.source_type) return t("pageDisconnected");
    const sourceUrl = stats.source_url ? `: ${stats.source_url}` : "";
    return `${stats.source_type}${sourceUrl}`;
  }, [stats.source_type, stats.source_url]);

  const runAction = useCallback(async (type: MessageType, successText?: (next: Snapshot) => string) => {
    try {
      const options =
        type === "START_AUTO"
          ? { intervalMs: 1200, maxScrollCount: 120, maxEmptyRounds: 5 }
          : undefined;
      const next = await sendToContent(type, options);
      setSnapshot(next || EMPTY_SNAPSHOT);
      if (successText) setStatus(successText(next || EMPTY_SNAPSHOT));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("errorActionFailed"));
    }
  }, []);

  const exportTxt = useCallback(() => {
    const body = tweets.map((tweet) => tweet.url).join("\n") + (tweets.length ? "\n" : "");
    downloadText(`tweet_urls_${formatDateForFile()}.txt`, body, "text/plain;charset=utf-8");
    setStatus(t("statusExportedUrls", String(tweets.length)));
  }, [tweets]);

  const exportJsonl = useCallback(() => {
    const body = tweets.map((tweet) => JSON.stringify(tweet)).join("\n") + (tweets.length ? "\n" : "");
    downloadText(`tweets_${formatDateForFile()}.jsonl`, body, "application/x-ndjson;charset=utf-8");
    setStatus(t("statusExportedJsonl", String(tweets.length)));
  }, [tweets]);

  useEffect(() => {
    runAction("GET_STATE");
    const timer = window.setInterval(() => runAction("GET_STATE"), 1500);
    return () => window.clearInterval(timer);
  }, [runAction]);

  return (
    <main className="shell">
      <header className="masthead">
        <div>
          <p className="eyebrow">{t("extensionEyebrow")}</p>
          <h1>{t("extensionTitle")}</h1>
        </div>
        <span className={autoRunning ? "pulse running" : "pulse"} aria-label={autoRunning ? t("ariaRunning") : t("ariaIdle")} />
      </header>

      <p className="page-label" title={pageLabel}>{pageLabel}</p>

      <section className="stats" aria-label={t("ariaScanStats")}>
        <Metric value={stats.unique_tweet_count || 0} label={t("metricUnique")} />
        <Metric value={stats.scroll_count || 0} label={t("metricScrolls")} />
        <Metric value={stats.duplicate_count || 0} label={t("metricDuplicates")} />
      </section>

      <section className="controls" aria-label={t("ariaScanControls")}>
        <button type="button" className="primary" onClick={() => runAction("SCAN", (next) => t("statusScanned", String(next.stats.unique_tweet_count || 0)))}>
          {t("buttonScanVisible")}
        </button>
        <button type="button" onClick={() => runAction("START_AUTO", () => t("statusAutoStarted"))} disabled={autoRunning}>
          {t("buttonAutoScroll")}
        </button>
        <button type="button" onClick={() => runAction("STOP_AUTO", () => t("statusAutoStopped"))} disabled={!autoRunning}>
          {t("buttonStop")}
        </button>
      </section>

      <section className="controls" aria-label={t("ariaExportControls")}>
        <button type="button" onClick={exportTxt} disabled={!hasTweets}>{t("buttonExportUrls")}</button>
        <button type="button" onClick={exportJsonl} disabled={!hasTweets}>{t("buttonExportJsonl")}</button>
        <button type="button" className="danger" onClick={() => runAction("CLEAR", () => t("statusCleared"))}>{t("buttonClear")}</button>
      </section>

      <p className="status-line" role="status">{status}</p>
    </main>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="metric">
      <span>{value}</span>
      <label>{label}</label>
    </div>
  );
}
