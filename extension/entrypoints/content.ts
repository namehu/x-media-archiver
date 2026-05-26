import type { MessageType, Snapshot, TweetRecord } from "../src/shared/types";

const TARGET = "x-media-archiver-content";

export default defineContentScript({
  matches: ["https://x.com/*", "https://twitter.com/*"],
  runAt: "document_idle",
  main() {
    const state = {
      tweets: new Map<string, TweetRecord>(),
      duplicateCount: 0,
      seenArticleCount: 0,
      emptyRounds: 0,
      scrollCount: 0,
      autoRunning: false,
      autoTimer: null as number | null,
      sourceUrl: window.location.href,
      sourceType: inferSourceType(window.location.href),
      startedAt: null as string | null,
      finishedAt: null as string | null
    };

    function inferSourceType(url: string) {
      if (url.includes("/bookmarks")) return "bookmarks";
      if (url.includes("/likes")) return "likes";
      if (url.includes("/search")) return "search";
      if (url.includes("/home")) return "home";
      if (/\/[^/]+\/media(?:$|[/?#])/.test(new URL(url).pathname)) return "user_media";
      return "page";
    }

    function normalizeTweetUrl(href: string) {
      const url = new URL(href, window.location.href);
      const match = url.pathname.match(/^\/([^/]+)\/status\/(\d+)/);
      if (!match) return null;
      const [, username, tweetId] = match;
      return {
        tweetId,
        username,
        url: `https://x.com/${username}/status/${tweetId}`
      };
    }

    function findTweetLink(article: Element) {
      const links = Array.from(article.querySelectorAll<HTMLAnchorElement>('a[href*="/status/"]'));
      for (const link of links) {
        try {
          const normalized = normalizeTweetUrl(link.getAttribute("href") || "");
          if (normalized) return normalized;
        } catch (_error) {
          continue;
        }
      }
      return null;
    }

    function extractDisplayName(article: Element) {
      const userName = article.querySelector('[data-testid="User-Name"]');
      const text = userName?.textContent || "";
      return text.split("@")[0]?.trim() || "";
    }

    function extractTweetText(article: Element) {
      const tweetText = article.querySelector('[data-testid="tweetText"]');
      return tweetText?.textContent?.trim() || "";
    }

    function extractTweet(article: Element): TweetRecord | null {
      const link = findTweetLink(article);
      if (!link) return null;
      const time = article.querySelector("time");
      return {
        tweet_id: link.tweetId,
        url: link.url,
        author_username: link.username,
        author_display_name: extractDisplayName(article),
        datetime: time ? time.getAttribute("datetime") : null,
        text: extractTweetText(article),
        source_type: state.sourceType,
        source_url: state.sourceUrl,
        collected_at: new Date().toISOString()
      };
    }

    function scanCurrentPage() {
      if (!state.startedAt) state.startedAt = new Date().toISOString();
      state.sourceUrl = window.location.href;
      state.sourceType = inferSourceType(window.location.href);

      const articles = Array.from(document.querySelectorAll('article[data-testid="tweet"], article'));
      let added = 0;
      state.seenArticleCount += articles.length;

      for (const article of articles) {
        const tweet = extractTweet(article);
        if (!tweet) continue;
        if (state.tweets.has(tweet.tweet_id)) {
          state.duplicateCount += 1;
          continue;
        }
        state.tweets.set(tweet.tweet_id, tweet);
        added += 1;
      }

      if (added === 0) {
        state.emptyRounds += 1;
      } else {
        state.emptyRounds = 0;
      }

      return { added, total: state.tweets.size };
    }

    function startAutoScroll(options?: { intervalMs?: number; maxScrollCount?: number; maxEmptyRounds?: number }) {
      if (state.autoRunning) return getSnapshot();
      const intervalMs = Number(options?.intervalMs) || 1200;
      const maxScrollCount = Number(options?.maxScrollCount) || 120;
      const maxEmptyRounds = Number(options?.maxEmptyRounds) || 5;

      state.autoRunning = true;
      state.startedAt = state.startedAt || new Date().toISOString();
      scanCurrentPage();

      state.autoTimer = window.setInterval(() => {
        if (!state.autoRunning) return;
        if (state.scrollCount >= maxScrollCount || state.emptyRounds >= maxEmptyRounds) {
          stopAutoScroll();
          return;
        }
        state.scrollCount += 1;
        window.scrollBy({ top: Math.max(window.innerHeight * 0.85, 600), left: 0, behavior: "smooth" });
        window.setTimeout(scanCurrentPage, Math.min(600, intervalMs));
      }, intervalMs);

      return getSnapshot();
    }

    function stopAutoScroll() {
      state.autoRunning = false;
      state.finishedAt = new Date().toISOString();
      if (state.autoTimer) {
        window.clearInterval(state.autoTimer);
        state.autoTimer = null;
      }
      return getSnapshot();
    }

    function clearTweets() {
      state.tweets.clear();
      state.duplicateCount = 0;
      state.seenArticleCount = 0;
      state.emptyRounds = 0;
      state.scrollCount = 0;
      state.startedAt = null;
      state.finishedAt = null;
      return getSnapshot();
    }

    function getSnapshot(): Snapshot {
      return {
        tweets: Array.from(state.tweets.values()).sort((a, b) => a.tweet_id.localeCompare(b.tweet_id)),
        stats: {
          source_url: state.sourceUrl,
          source_type: state.sourceType,
          started_at: state.startedAt,
          finished_at: state.finishedAt,
          scroll_count: state.scrollCount,
          seen_article_count: state.seenArticleCount,
          unique_tweet_count: state.tweets.size,
          duplicate_count: state.duplicateCount,
          empty_rounds: state.emptyRounds,
          auto_running: state.autoRunning
        }
      };
    }

    browser.runtime.onMessage.addListener((message: { target?: string; type?: MessageType; options?: unknown }) => {
      if (!message || message.target !== TARGET) return false;
      if (message.type === "SCAN") {
        scanCurrentPage();
        return Promise.resolve(getSnapshot());
      }
      if (message.type === "START_AUTO") {
        return Promise.resolve(startAutoScroll((message.options || {}) as Parameters<typeof startAutoScroll>[0]));
      }
      if (message.type === "STOP_AUTO") {
        return Promise.resolve(stopAutoScroll());
      }
      if (message.type === "CLEAR") {
        return Promise.resolve(clearTweets());
      }
      if (message.type === "GET_STATE") {
        return Promise.resolve(getSnapshot());
      }
      return false;
    });
  }
});
