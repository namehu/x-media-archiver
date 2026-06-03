import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Save, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { apiDelete, apiGet, apiPost, type CookieConfig } from "../../../lib/api";
import { formatDateTime } from "../../../lib/utils";
import { errorMessage } from "../utils";

const cookiesSourceLabel: Record<string, string> = {
  database: "数据库",
  file: "COOKIE_FILE",
  none: "无",
};

export function CookiesTab() {
  const queryClient = useQueryClient();
  const [content, setContent] = useState("");
  const [label, setLabel] = useState("");

  const configQuery = useQuery({
    queryKey: ["settings-cookies"],
    queryFn: () => apiGet<CookieConfig>("/api/v1/settings/cookies"),
  });

  const saveMutation = useMutation({
    mutationFn: () => apiPost<CookieConfig>("/api/v1/settings/cookies", { content, label: label || null }),
    onSuccess: async () => {
      setContent("");
      toast.success("Cookies 已保存");
      await queryClient.invalidateQueries({ queryKey: ["settings-cookies"] });
    },
    onError: (error) => toast.error(`保存 Cookies 失败：${errorMessage(error)}`),
  });

  const clearMutation = useMutation({
    mutationFn: () => apiDelete<CookieConfig>("/api/v1/settings/cookies"),
    onSuccess: async () => {
      setContent("");
      setLabel("");
      toast.success("数据库 Cookies 已清空");
      await queryClient.invalidateQueries({ queryKey: ["settings-cookies"] });
    },
    onError: (error) => toast.error(`清空 Cookies 失败：${errorMessage(error)}`),
  });

  const pending = saveMutation.isPending || clearMutation.isPending;
  const status = configQuery.data;

  async function handleFileChange(file: File | null) {
    if (!file) return;
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
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-bg-surface px-3 py-2 text-sm">
            <span className="text-fg-secondary">配置状态</span>
            <Badge tone={status?.configured ? "success" : "warning"}>
              {status?.configured ? "已配置" : "未配置"}
            </Badge>
          </div>
          <InfoRow label="当前来源" value={status ? cookiesSourceLabel[status.source] ?? "-" : "-"} />
          <InfoRow label="备注" value={status?.label || "-"} />
          <InfoRow label="更新时间" value={formatDateTime(status?.updated_at)} />
          <Button type="button" variant="destructive" disabled={pending || status?.source !== "database"} onClick={() => clearMutation.mutate()}>
            <Trash2 className="h-4 w-4" />
            清空数据库 Cookies
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>更新 Cookies</CardTitle>
          <CardDescription>粘贴或上传 Netscape cookies.txt 内容；正文不会在 API 响应中返回。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
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
            spellCheck={false}
            placeholder="# Netscape HTTP Cookie File\n.x.com\tTRUE\t/\tTRUE\t0\tauth_token\t..."
            onChange={(event) => setContent(event.target.value)}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-fg-secondary">Cookies 会以明文保存在本地 Postgres，请不要暴露本地 API。</p>
            <Button type="button" disabled={pending || !content.trim()} onClick={() => saveMutation.mutate()}>
              <Save className="h-4 w-4" />
              保存 Cookies
            </Button>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 text-sm">
      <span className="text-fg-secondary">{label}</span>
      <span className="max-w-[65%] truncate text-right font-medium text-fg-primary">{value}</span>
    </div>
  );
}
