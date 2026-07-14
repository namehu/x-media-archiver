import { useState, type FormEvent } from "react";
import { Archive } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
    <main className="flex min-h-screen w-full bg-bg-surface">
      {/* 左侧：品牌展示区 / 装饰区 */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-zinc-900 p-10 text-white lg:flex">
        {/* 背景装饰：流光溢彩的网格与模糊渐变效果，呼应多媒体/艺术氛围 */}
        <div className="absolute inset-0 z-0 bg-gradient-to-br from-brand via-purple-600 to-pink-600 opacity-90 mix-blend-multiply" />
        <div className="absolute -left-[10%] -top-[10%] h-[40%] w-[40%] animate-breathe rounded-full bg-blue-500 opacity-50 mix-blend-screen blur-[100px]" />
        <div
          className="absolute -bottom-[10%] -right-[10%] h-[40%] w-[40%] animate-breathe rounded-full bg-pink-500 opacity-50 mix-blend-screen blur-[100px]"
          style={{ animationDelay: "1s" }}
        />

        {/* 顶部 Logo 区 */}
        <div className="relative z-10 flex items-center gap-3 text-2xl font-bold tracking-tight">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 backdrop-blur-md">
            <Archive className="h-6 w-6" />
          </div>
          x-media-archiver
        </div>

        {/* 底部 Slogan */}
        <div className="relative z-10 mt-auto">
          <blockquote className="space-y-3">
            <p className="text-xl font-medium leading-relaxed shadow-sm">
              "构建属于你自己的本地媒体库，永久保存那些珍贵的数字记忆。"
            </p>
            <footer className="text-sm font-medium opacity-70">Local First • Privacy Focused</footer>
          </blockquote>
        </div>
      </div>

      {/* 右侧：登录表单区 */}
      <div className="flex flex-1 items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm space-y-8">
          <div className="flex flex-col space-y-2 text-center lg:text-left">
            <h1 className="text-3xl font-semibold tracking-tight text-fg-primary">欢迎回来</h1>
            <p className="text-sm text-fg-tertiary">使用此归档实例的管理员账号继续。</p>
          </div>

          <form onSubmit={submit} className="space-y-6">
            {error ? (
              <Alert variant="destructive" className="animate-in fade-in slide-in-from-top-2">
                <AlertTitle>认证失败</AlertTitle>
                <AlertDescription>{authErrorMessage(error)}</AlertDescription>
              </Alert>
            ) : null}

            <FieldGroup className="space-y-4">
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

            <Button className="h-11 w-full text-base font-medium" type="submit" disabled={pending}>
              {pending ? "正在登录..." : "登 录"}
            </Button>
          </form>
        </div>
      </div>
    </main>
  );
}
