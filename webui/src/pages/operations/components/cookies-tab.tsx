import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Save, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { apiDelete, apiGet, apiPost, type CookieConfig } from "../../../lib/api";
import { formatDateTime } from "../../../lib/utils";
import { errorMessage } from "../utils";

const MAX_COOKIE_FILE_BYTES = 1024 * 1024;

const cookiesSourceLabel: Record<string, string> = {
  database: "数据库",
  file: "COOKIE_FILE",
  none: "无",
};

const validationStatusLabel: Record<CookieConfig["validation_status"], string> = {
  unchecked: "未检测",
  valid: "有效",
  invalid: "无效",
  expired: "已过期",
  error: "检测失败",
};

const validationMessageLabel: Record<string, string> = {
  cookie_not_checked: "尚未向 X 验证当前 Cookies。",
  cookie_check_valid: "已通过 X Bookmarks 最小化认证探测。",
  cookie_check_auth_required: "X 拒绝了当前登录状态，请重新导出 Cookies。",
  cookie_check_network_error: "访问 X 时发生网络错误，不能据此判断 Cookies 已失效。",
  cookie_check_rate_limited: "X 返回限流，当前无法判断 Cookies 是否有效。",
  cookie_check_timeout: "访问 X 超时，当前无法判断 Cookies 是否有效。",
  cookie_check_command_not_found: "服务端未找到 gallery-dl，无法执行检测。",
  cookie_check_failed: "gallery-dl 检测失败，请稍后重试或查看服务日志。",
  cookie_auth_token_expired: "auth_token 的声明有效期已经结束。",
  cookie_ct0_expired: "ct0 的声明有效期已经结束。",
};

export function CookiesTab() {
  const queryClient = useQueryClient();
  const [content, setContent] = useState("");
  const [label, setLabel] = useState("");

  const configQuery = useQuery({
    queryKey: ["settings-cookies"],
    queryFn: () => apiGet<CookieConfig>("/api/v1/settings/cookies"),
  });

  const checkMutation = useMutation({
    mutationFn: () => apiPost<CookieConfig>("/api/v1/settings/cookies/check", {}),
    onSuccess: (nextStatus) => {
      queryClient.setQueryData(["settings-cookies"], nextStatus);
      if (nextStatus.validation_status === "valid") {
        toast.success("Cookies 检测通过");
      } else if (nextStatus.validation_status === "invalid" || nextStatus.validation_status === "expired") {
        toast.error("Cookies 已失效，请重新导出");
      } else {
        toast.warning("Cookies 检测未完成，请查看状态说明");
      }
    },
    onError: (error) => toast.error(`检测 Cookies 失败：${errorMessage(error)}`),
  });

  const saveMutation = useMutation({
    mutationFn: () => apiPost<CookieConfig>("/api/v1/settings/cookies", { content, label: label || null }),
    onSuccess: (nextStatus) => {
      setContent("");
      queryClient.setQueryData(["settings-cookies"], nextStatus);
      toast.success("Cookies 已保存，正在检测有效性");
      checkMutation.mutate();
    },
    onError: (error) => toast.error(`保存 Cookies 失败：${errorMessage(error)}`),
  });

  const clearMutation = useMutation({
    mutationFn: () => apiDelete<CookieConfig>("/api/v1/settings/cookies"),
    onSuccess: (nextStatus) => {
      setContent("");
      setLabel("");
      queryClient.setQueryData(["settings-cookies"], nextStatus);
      toast.success("数据库 Cookies 已清空");
    },
    onError: (error) => toast.error(`清空 Cookies 失败：${errorMessage(error)}`),
  });

  const pending = saveMutation.isPending || clearMutation.isPending || checkMutation.isPending;
  const status = configQuery.data;
  const validationTone = cookieValidationTone(status?.validation_status);
  const needsReplacement = status?.validation_status === "invalid" || status?.validation_status === "expired";

  async function handleFileChange(file: File | null) {
    if (!file) return;
    if (file.size > MAX_COOKIE_FILE_BYTES) {
      toast.error("Cookies 文件不能超过 1 MiB");
      return;
    }
    setContent(await file.text());
    setLabel(file.name);
  }

  return (
    <section className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
      <Card>
        <CardHeader>
          <CardTitle>Cookies 状态</CardTitle>
          <CardDescription>下载和来源扫描优先使用数据库中的 cookies，未配置时回退到 COOKIE_FILE。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-bg-surface px-3 py-2 text-sm">
            <span className="text-fg-secondary">配置状态</span>
            <Badge tone={status?.configured ? "success" : "warning"}>
              {status?.configured ? "已配置" : "未配置"}
            </Badge>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-bg-surface px-3 py-2 text-sm">
            <span className="text-fg-secondary">有效性</span>
            <Badge tone={validationTone}>
              {status ? validationStatusLabel[status.validation_status] : "加载中"}
            </Badge>
          </div>
          <InfoRow label="当前来源" value={status ? cookiesSourceLabel[status.source] ?? "-" : "-"} />
          <InfoRow label="备注" value={status?.label || "-"} />
          <InfoRow label="更新时间" value={formatDateTime(status?.updated_at)} />
          <InfoRow label="最近检测" value={formatDateTime(status?.validated_at)} />
          <InfoRow
            label="auth_token 有效期"
            value={status?.auth_token_expires_at ? formatDateTime(status.auth_token_expires_at) : "会话 Cookie / 未声明"}
          />
          <p className="rounded-md border border-border-subtle bg-bg-muted px-3 py-2 text-xs leading-5 text-fg-secondary">
            {cookieValidationMessage(status)}
          </p>
          {needsReplacement ? (
            <p className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs leading-5 text-danger">
              请在已登录 X 的浏览器中重新导出 Netscape cookies.txt，然后覆盖保存。
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending || !status?.configured}
              onClick={() => checkMutation.mutate()}
            >
              <RefreshCw className={`h-4 w-4 ${checkMutation.isPending ? "animate-spin" : ""}`} />
              {checkMutation.isPending ? "检测中" : "检测 Cookies"}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending || status?.source !== "database"}
              onClick={() => clearMutation.mutate()}
            >
              <Trash2 className="h-4 w-4" />
              清空数据库 Cookies
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>更新 Cookies</CardTitle>
          <CardDescription>粘贴或上传 Netscape cookies.txt 内容；保存后会自动访问 X Bookmarks 验证登录状态，返回内容不会被保存。</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <Input value={label} placeholder="备注，例如导出日期或账号说明" onChange={(event) => setLabel(event.target.value)} />
            <label className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border border-border-subtle bg-bg-muted px-4 text-sm font-medium text-fg-primary hover:border-border-strong hover:bg-bg-surface">
              <Upload className="h-4 w-4" />
              上传文件
              <input className="sr-only" type="file" accept=".txt,text/plain" onChange={(event) => void handleFileChange(event.target.files?.[0] ?? null)} />
            </label>
          </div>
          <textarea
            className="min-h-72 w-full resize-y rounded-md border border-border-strong bg-bg-elevated p-3 font-mono text-xs text-fg-primary outline-none transition duration-fast placeholder:text-fg-tertiary focus-visible:ring-2 focus-visible:ring-brand/50"
            value={content}
            maxLength={MAX_COOKIE_FILE_BYTES}
            spellCheck={false}
            placeholder="# Netscape HTTP Cookie File\n.x.com\tTRUE\t/\tTRUE\t0\tauth_token\t..."
            onChange={(event) => setContent(event.target.value)}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-fg-secondary">Cookies 会以明文保存在本地 Postgres；系统不会自动刷新或回写 token。</p>
            <Button type="button" disabled={pending || !content.trim()} onClick={() => saveMutation.mutate()}>
              <Save className="h-4 w-4" />
              {saveMutation.isPending ? "保存中" : "保存 Cookies"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function cookieValidationTone(status?: CookieConfig["validation_status"]) {
  if (status === "valid") return "success" as const;
  if (status === "invalid" || status === "expired") return "danger" as const;
  if (status === "error") return "warning" as const;
  return "secondary" as const;
}

function cookieValidationMessage(status?: CookieConfig) {
  if (!status?.configured) return "尚未配置 Cookies。";
  if (status.validation_message && validationMessageLabel[status.validation_message]) {
    return validationMessageLabel[status.validation_message];
  }
  if (status.validation_error_category) {
    return `检测错误：${status.validation_error_category}`;
  }
  return "尚未检测当前 Cookies。";
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-fg-secondary">{label}</span>
      <span className="max-w-[65%] truncate text-right font-medium text-fg-primary">{value}</span>
    </div>
  );
}
