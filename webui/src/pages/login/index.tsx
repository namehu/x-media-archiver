import { useState, type FormEvent } from "react";
import { LogIn } from "lucide-react";
import { AuthShell } from "@/components/auth/auth-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authErrorMessage } from "@/lib/auth-messages";

type LoginPageProps = {
  error?: string | null;
  pending: boolean;
  onSubmit: (username: string, password: string) => Promise<void>;
};

export function LoginPage({ error, pending, onSubmit }: LoginPageProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void onSubmit(username, password);
  };

  return (
    <AuthShell>
      <Card className="overflow-hidden shadow-3">
        <CardHeader className="p-6 pb-5 sm:p-8 sm:pb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand">Admin access</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-fg-primary">欢迎回来</h1>
          <CardDescription>使用此归档实例的管理员账号继续。</CardDescription>
        </CardHeader>
        <form onSubmit={submit}>
          <CardContent className="flex flex-col gap-6 px-6 pb-6 sm:px-8">
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>认证失败</AlertTitle>
                <AlertDescription>{authErrorMessage(error)}</AlertDescription>
              </Alert>
            ) : null}

            <FieldGroup className="gap-5">
              <Field data-invalid={Boolean(error)}>
                <FieldLabel htmlFor="login-username">用户名</FieldLabel>
                <Input
                  id="login-username"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  aria-invalid={Boolean(error)}
                  className="h-11"
                  required
                />
              </Field>
              <Field data-invalid={Boolean(error)}>
                <FieldLabel htmlFor="login-password">密码</FieldLabel>
                <Input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-invalid={Boolean(error)}
                  className="h-11"
                  required
                />
                {error ? <FieldError>{authErrorMessage(error)}</FieldError> : null}
              </Field>
            </FieldGroup>
          </CardContent>
          <CardFooter className="border-t border-border-subtle bg-bg-surface px-6 py-5 sm:px-8">
            <Button className="h-11 w-full text-base" type="submit" disabled={pending}>
              <LogIn data-icon="inline-start" aria-hidden="true" />
              {pending ? "正在登录..." : "登录"}
            </Button>
          </CardFooter>
        </form>
      </Card>
      <p className="mt-5 text-center text-xs leading-5 text-fg-tertiary">
        凭据仅用于当前归档实例，不会发送到第三方服务。
      </p>
    </AuthShell>
  );
}
