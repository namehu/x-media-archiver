import { ApiError, type ActionResponse } from "../../lib/api";

type Translate = (key: string, params?: Record<string, string | number>) => string;
type SummaryItem = { label: string; value: string; wide?: boolean };

export function textValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

export function stringOrNumber(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

export function formatError(category: string | null | undefined, message: string | null | undefined, t: Translate) {
  if (category) {
    const key = `common.error.${category}`;
    const translated = t(key);
    return translated === key ? category : translated;
  }
  return textValue(message);
}

export function resultSummaryItems(result: ActionResponse, t: Translate) {
  const data = result.result ?? {};
  const items: SummaryItem[] = [];
  const add = (key: string, value: unknown, options: { wide?: boolean } = {}) => {
    if (value === null || value === undefined || value === "") return;
    items.push({ label: t(`operations.resultField.${key}`), value: resultValue(value), wide: options.wide });
  };

  add("runId", data.run_id);
  add("queued", nestedValue(data, "tasks", "queued_count"));
  add("skipped", nestedValue(data, "tasks", "skipped_verified_count"));
  add("linked", nestedValue(data, "tasks", "linked_pending_count"));
  add("requeued", data.requeued);
  add("checked", data.checked);
  add("verified", data.verified);
  add("missing", data.missing);
  add("corrupt", data.corrupt);
  add("scanned", data.scanned);
  add("upserted", data.upserted);
  add("skipped", data.skipped);
  add("tweetsRecovered", data.tweets_recovered);
  add("jobsRecovered", data.jobs_recovered);
  add("itemsRecovered", data.items_recovered);
  add("rows", data.rows);
  add("duplicateGroups", data.duplicate_groups);
  add("status", data.status);
  add("path", data.path, { wide: true });

  if (!items.length) {
    for (const [key, value] of Object.entries(data)) {
      if (isSummaryValue(value)) add(key, value, { wide: typeof value === "string" && value.length > 36 });
    }
  }
  return items;
}

export function actionLabel(action: string, t: Translate) {
  const key = `operations.action.${action}`;
  const translated = t(key);
  return translated === key ? action : translated;
}

export function errorMessage(error: unknown) {
  if (error instanceof ApiError) {
    const parts = [error.message];
    if (error.code) parts.push(error.code);
    if (error.status) parts.push(String(error.status));
    return parts.join(" · ");
  }
  if (error instanceof Error) return error.message;
  return String(error);
}

export function numberOrNull(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function nestedValue(data: Record<string, unknown>, key: string, childKey: string) {
  const child = data[key];
  if (!child || typeof child !== "object" || Array.isArray(child)) return undefined;
  return (child as Record<string, unknown>)[childKey];
}

function isSummaryValue(value: unknown) {
  return value === null || ["string", "number", "boolean"].includes(typeof value) || Array.isArray(value);
}

function resultValue(value: unknown) {
  if (Array.isArray(value)) return `${value.length}`;
  if (typeof value === "boolean") return value ? "true" : "false";
  return textValue(value);
}
