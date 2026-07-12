import { useState, type FormEvent } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
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
    <main className="flex min-h-screen items-center justify-center bg-bg-surface p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>登录 x-media-archiver</CardTitle>
          <CardDescription>使用此归档实例的管理员账号继续。</CardDescription>
        </CardHeader>
        <form onSubmit={submit}>
          <CardContent className="flex flex-col gap-4">
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>认证失败</AlertTitle>
                <AlertDescription>{authErrorMessage(error)}</AlertDescription>
              </Alert>
            ) : null}
            <FieldGroup>
              <Field data-invalid={Boolean(error)}>
                <FieldLabel htmlFor="login-username">用户名</FieldLabel>
                <Input
                  id="login-username"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  aria-invalid={Boolean(error)}
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
                  required
                />
                {error ? <FieldError>{authErrorMessage(error)}</FieldError> : null}
              </Field>
            </FieldGroup>
          </CardContent>
          <CardFooter>
            <Button className="w-full" type="submit" disabled={pending}>
              {pending ? "正在登录..." : "登录"}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </main>
  );
}
