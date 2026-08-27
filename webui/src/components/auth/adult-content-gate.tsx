import { AlertCircle, ArrowRight, EyeOff, ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";

export function AdultContentGate({
  authMode,
  error,
  pendingAction,
  onAcknowledge,
  onEnablePrivacy,
  onLogout,
}: {
  authMode: "password" | "disabled";
  error: string | null;
  pendingAction: "acknowledge" | "privacy" | null;
  onAcknowledge: () => Promise<void>;
  onEnablePrivacy: () => Promise<void>;
  onLogout: () => Promise<void>;
}) {
  const pending = pendingAction !== null;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg-surface px-4 py-8 sm:px-6">
      <Card className="w-full max-w-[620px] overflow-hidden border-border-strong shadow-4">
        <div className="h-1.5 bg-brand" aria-hidden="true" />
        <CardHeader className="gap-5 px-6 pb-5 pt-7 sm:px-9 sm:pt-9">
          <div className="flex items-center gap-4">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-lg font-bold text-brand">
              18+
            </div>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-brand">浏览前确认</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-fg-primary">成人内容提示</h1>
            </div>
          </div>
          <div>
            <h2 className="text-xl font-semibold tracking-tight text-fg-primary sm:text-2xl">此归档可能包含成人内容</h2>
            <p className="mt-3 text-sm leading-6 text-fg-secondary sm:text-base sm:leading-7">
              继续查看表示你确认自己已年满 18 岁，并了解归档中的文字、图片或视频可能具有敏感性。这是一次用户确认，不是技术年龄验证。
            </p>
          </div>
        </CardHeader>

        <CardContent className="space-y-4 px-6 pb-7 sm:px-9">
          <div className="flex gap-3 rounded-xl border border-border-subtle bg-bg-surface p-4">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden="true" />
            <p className="text-sm leading-6 text-fg-secondary">
              当前标签页只需确认一次。刷新或切换页面不会重复提示，新标签页会重新确认。
            </p>
          </div>

          {error ? (
            <Alert variant="destructive" className="border-danger/30 bg-danger/5">
              <AlertCircle className="size-4" aria-hidden="true" />
              <AlertTitle>暂时无法继续</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          <div className="grid gap-3">
            <Button
              size="lg"
              className="h-12 w-full justify-between rounded-xl px-5"
              autoFocus
              disabled={pending}
              onClick={() => void onAcknowledge()}
            >
              <span>{pendingAction === "acknowledge" ? "正在确认..." : "我已年满 18 岁，查看原始内容"}</span>
              <ArrowRight aria-hidden="true" />
            </Button>
            <Button
              variant="secondary"
              size="lg"
              className="h-12 w-full justify-start rounded-xl px-5"
              disabled={pending}
              onClick={() => void onEnablePrivacy()}
            >
              <EyeOff data-icon="inline-start" aria-hidden="true" />
              {pendingAction === "privacy" ? "正在保存偏好..." : "开启隐私模式后继续"}
            </Button>
          </div>
        </CardContent>

        <CardFooter className="justify-center border-t border-border-subtle bg-bg-surface px-6 py-4 sm:px-9">
          {authMode === "password" ? (
            <Button variant="ghost" size="sm" className="text-fg-tertiary" disabled={pending} onClick={() => void onLogout()}>
              退出登录
            </Button>
          ) : (
            <p className="text-center text-xs leading-5 text-fg-tertiary">未满 18 岁时，请不要继续浏览此归档。</p>
          )}
        </CardFooter>
      </Card>
    </main>
  );
}
