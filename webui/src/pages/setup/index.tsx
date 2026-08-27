import { useState, type FormEvent } from "react";
import { AuthShell } from "@/components/auth/auth-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authErrorMessage } from "@/lib/auth-messages";

type SetupPageProps = {
  error?: string | null;
  pending: boolean;
  onSubmit: (token: string, username: string, password: string) => Promise<void>;
};

export function SetupPage({ error, pending, onSubmit }: SetupPageProps) {
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const mismatch = Boolean(confirmation && password !== confirmation);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirmation) return;
    void onSubmit(token, username, password);
  };

  return (
    <AuthShell>
      <Card className="overflow-hidden shadow-3">
        <CardHeader className="p-6 pb-5 sm:p-8 sm:pb-6">
          <p className="text-xs font-semibold text-brand">首次初始化</p>
          <h1 className="text-xl font-semibold tracking-tight text-fg-primary">初始化管理员</h1>
          <CardDescription>此实例尚未设置管理员，请完成一次性初始化。</CardDescription>
        </CardHeader>
        <form onSubmit={submit}>
          <CardContent className="flex flex-col gap-5 px-6 pb-6 sm:px-8">
            <Alert>
              <AlertTitle>从容器日志获取令牌</AlertTitle>
              <AlertDescription>
                查看 app 容器启动日志，复制 One-time setup token 后完成初始化。令牌在重启后会变化。
              </AlertDescription>
            </Alert>
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>认证失败</AlertTitle>
                <AlertDescription>{authErrorMessage(error)}</AlertDescription>
              </Alert>
            ) : null}
            <FieldGroup>
              <Field data-invalid={error === "invalid_setup_token"}>
                <FieldLabel htmlFor="setup-token">一次性设置令牌</FieldLabel>
                <Input
                  id="setup-token"
                  type="password"
                  autoComplete="off"
                  minLength={20}
                  maxLength={256}
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  aria-invalid={error === "invalid_setup_token"}
                  required
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="setup-username">用户名</FieldLabel>
                <Input
                  id="setup-username"
                  autoComplete="username"
                  pattern={"[A-Za-z0-9._\\-]{3,64}"}
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  required
                />
                <FieldDescription>使用 3–64 个字母、数字、点、横杠或下划线。</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="setup-password">密码</FieldLabel>
                <Input
                  id="setup-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
                <FieldDescription>密码长度为 12–128 个字符。</FieldDescription>
              </Field>
              <Field data-invalid={mismatch}>
                <FieldLabel htmlFor="setup-confirmation">确认密码</FieldLabel>
                <Input
                  id="setup-confirmation"
                  type="password"
                  autoComplete="new-password"
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  aria-invalid={mismatch}
                  required
                />
                {mismatch ? <FieldError>{authErrorMessage("password_mismatch")}</FieldError> : null}
              </Field>
            </FieldGroup>
          </CardContent>
          <CardFooter className="border-t border-border-subtle bg-bg-surface px-6 py-5 sm:px-8">
            <Button className="w-full" type="submit" disabled={pending || mismatch}>
              {pending ? "正在初始化..." : "创建管理员"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </AuthShell>
  );
}
