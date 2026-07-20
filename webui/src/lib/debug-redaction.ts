import { useLocation } from "react-router-dom";
import { resolveDebuggerMode } from "./debugger-mode";

const DEBUG_DISABLED_TWEET_LINK_TITLE = "调试模式下已禁用 Tweet 外链";
const DEBUG_DISABLED_AUTHOR_LINK_TITLE = "调试模式下已禁用作者主页跳转";
const DEBUG_MEDIA_ALT = "调试模式媒体预览";
const DEBUG_SELECTION_LABEL = "选择媒体";
const DEBUG_DATA_VALUE = "debug";
const DEBUG_DETAIL_LINK_LABEL = "调试模式下已禁用 Tweet 详情";

export function useDebugRedactionEnabled() {
  const location = useLocation();
  return resolveDebuggerMode(location.search).enabled;
}

export function isTweetDetailPath(pathname: string) {
  return /^\/tweets\/[^/]+$/i.test(pathname);
}

export function getDebugRedactProps(enabled: boolean) {
  return enabled ? ({ "data-debug-redact": "" } as const) : {};
}

export function getDebugExternalHref(enabled: boolean, value?: string | null) {
  return enabled ? undefined : value || undefined;
}

export function getDebugAuthorProfileHref(enabled: boolean, username?: string | null) {
  if (enabled || !username) return undefined;
  return `https://x.com/${username}`;
}

export function getDebugDetailRoute(enabled: boolean, tweetId?: string | null) {
  if (enabled || !tweetId) return undefined;
  return `/tweets/${tweetId}`;
}

export function getDebugMediaAlt(enabled: boolean, value?: string | null) {
  if (enabled) return DEBUG_MEDIA_ALT;
  return value?.trim() || "媒体预览";
}

export function getDebugSelectionLabel(enabled: boolean, value?: string | null) {
  if (enabled) return DEBUG_SELECTION_LABEL;
  return value?.trim() || "选择 Tweet";
}

export function getDebugDataValue(enabled: boolean, value?: string | null) {
  if (enabled) return DEBUG_DATA_VALUE;
  return value?.trim() || DEBUG_DATA_VALUE;
}

export function getDebugLinkTitle(enabled: boolean, kind: "author" | "tweet", fallback: string) {
  if (!enabled) return fallback;
  return kind === "author" ? DEBUG_DISABLED_AUTHOR_LINK_TITLE : DEBUG_DISABLED_TWEET_LINK_TITLE;
}

export function getDebugDetailLinkLabel(enabled: boolean) {
  return enabled ? DEBUG_DETAIL_LINK_LABEL : "Tweet 详情";
}
