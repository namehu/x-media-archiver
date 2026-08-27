import { useAuth } from "@/lib/auth";

const PRIVACY_DISABLED_TWEET_LINK_TITLE = "隐私模式下已禁用 Tweet 外链";
const PRIVACY_DISABLED_AUTHOR_LINK_TITLE = "隐私模式下已禁用作者主页跳转";
const PRIVACY_MEDIA_ALT = "媒体已隐藏";
const PRIVACY_SELECTION_LABEL = "选择媒体";
const PRIVACY_DATA_VALUE = "private";

export function usePrivacyRedactionEnabled() {
  return useAuth().mediaPrivacyMode;
}

export function getPrivacyRedactProps(enabled: boolean) {
  return enabled ? ({ "data-privacy-redact": "" } as const) : {};
}

export function getPrivacyExternalHref(enabled: boolean, value?: string | null) {
  return enabled ? undefined : value || undefined;
}

export function getPrivacyAuthorProfileHref(enabled: boolean, username?: string | null) {
  if (enabled || !username) return undefined;
  return `https://x.com/${username}`;
}

export function getPrivacyDetailRoute(_enabled: boolean, tweetId?: string | null) {
  if (!tweetId) return undefined;
  return `/tweets/${tweetId}`;
}

export function getPrivacyMediaAlt(enabled: boolean, value?: string | null) {
  if (enabled) return PRIVACY_MEDIA_ALT;
  return value?.trim() || "媒体预览";
}

export function getPrivacySelectionLabel(enabled: boolean, value?: string | null) {
  if (enabled) return PRIVACY_SELECTION_LABEL;
  return value?.trim() || "选择 Tweet";
}

export function getPrivacyDataValue(enabled: boolean, value?: string | null) {
  if (enabled) return PRIVACY_DATA_VALUE;
  return value?.trim() || PRIVACY_DATA_VALUE;
}

export function getPrivacyLinkTitle(enabled: boolean, kind: "author" | "tweet", fallback: string) {
  if (!enabled) return fallback;
  return kind === "author" ? PRIVACY_DISABLED_AUTHOR_LINK_TITLE : PRIVACY_DISABLED_TWEET_LINK_TITLE;
}

export function getPrivacyDetailLinkLabel(_enabled?: boolean) {
  return "Tweet 详情";
}
