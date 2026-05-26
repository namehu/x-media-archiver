import { useCallback, useEffect, useMemo, useState } from "react";
import type { MessageType, Snapshot } from "../shared/types";
import { t } from "./i18n";

const TARGET = "x-media-archiver-content";

const EMPTY_SNAPSHOT: Snapshot = { tweets: [], stats: {} };
const DEFAULT_AUTO_OPTIONS = {
  intervalMs: "1200",
  maxScrollCount: "120",
  maxEmptyRounds: "5"
};

type AutoOptionKey = keyof typeof DEFAULT_AUTO_OPTIONS;
type AutoScrollOptions = Record<AutoOptionKey, number>;

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

function toAutoScrollOptions(options: typeof DEFAULT_AUTO_OPTIONS): AutoScrollOptions {
  return {
    intervalMs: normalizePositiveInteger(options.intervalMs, 1200, 100),
    maxScrollCount: normalizePositiveInteger(options.maxScrollCount, 120, 1),
    maxEmptyRounds: normalizePositiveInteger(options.maxEmptyRounds, 5, 1)
  };
}

function normalizePositiveInteger(value: string, fallback: number, minimum: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.floor(parsed));
}

export function Popup() {
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY_SNAPSHOT);
  const [status, setStatus] = useState("");
  const [autoOptions, setAutoOptions] = useState(DEFAULT_AUTO_OPTIONS);

  const stats = snapshot.stats || {};
  const tweets = snapshot.tweets || [];
  const hasTweets = tweets.length > 0;
  const autoRunning = Boolean(stats.auto_running);

  const pageLabel = useMemo(() => {
    if (!stats.source_type) return t("pageDisconnected");
    const sourceUrl = stats.source_url ? `: ${stats.source_url}` : "";
    return `${stats.source_type}${sourceUrl}`;
  }, [stats.source_type, stats.source_url]);

  const runAction = useCallback(async (type: MessageType, successText?: (next: Snapshot) => string, options?: unknown) => {
    try {
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

  const exportStats = useCallback(() => {
    const body = `${JSON.stringify(stats, null, 2)}\n`;
    downloadText(`scan_stats_${formatDateForFile()}.json`, body, "application/json;charset=utf-8");
    setStatus(t("statusExportedStats"));
  }, [stats]);

  const updateAutoOption = (key: AutoOptionKey, value: string) => {
    setAutoOptions((current) => ({ ...current, [key]: value }));
  };

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

      <fieldset className="settings" disabled={autoRunning}>
        <legend>{t("autoSettingsTitle")}</legend>
        <div className="settings-grid">
          <AutoOptionInput
            id="max-scroll-count"
            label={t("labelMaxScrollCount")}
            value={autoOptions.maxScrollCount}
            min={1}
            onChange={(value) => updateAutoOption("maxScrollCount", value)}
          />
          <AutoOptionInput
            id="max-empty-rounds"
            label={t("labelMaxEmptyRounds")}
            value={autoOptions.maxEmptyRounds}
            min={1}
            onChange={(value) => updateAutoOption("maxEmptyRounds", value)}
          />
          <AutoOptionInput
            id="interval-ms"
            label={t("labelIntervalMs")}
            value={autoOptions.intervalMs}
            min={100}
            onChange={(value) => updateAutoOption("intervalMs", value)}
          />
        </div>
      </fieldset>

      <section className="controls" aria-label={t("ariaScanControls")}>
        <button type="button" className="primary" onClick={() => runAction("SCAN", (next) => t("statusScanned", String(next.stats.unique_tweet_count || 0)))}>
          {t("buttonScanVisible")}
        </button>
        <button type="button" onClick={() => runAction("START_AUTO", () => t("statusAutoStarted"), toAutoScrollOptions(autoOptions))} disabled={autoRunning}>
          {t("buttonAutoScroll")}
        </button>
        <button type="button" onClick={() => runAction("STOP_AUTO", () => t("statusAutoStopped"))} disabled={!autoRunning}>
          {t("buttonStop")}
        </button>
      </section>

      <section className="controls exports" aria-label={t("ariaExportControls")}>
        <button type="button" onClick={exportTxt} disabled={!hasTweets}>{t("buttonExportUrls")}</button>
        <button type="button" onClick={exportJsonl} disabled={!hasTweets}>{t("buttonExportJsonl")}</button>
        <button type="button" onClick={exportStats}>{t("buttonExportStats")}</button>
        <button type="button" className="danger" onClick={() => runAction("CLEAR", () => t("statusCleared"))}>{t("buttonClear")}</button>
      </section>

      <p className="status-line" role="status">{status}</p>
    </main>
  );
}

function AutoOptionInput({
  id,
  label,
  value,
  min,
  onChange
}: {
  id: string;
  label: string;
  value: string;
  min: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="option" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type="number"
        min={min}
        step={1}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
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
