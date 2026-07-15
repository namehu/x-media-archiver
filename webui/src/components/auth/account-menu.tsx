import { useState, type FormEvent } from "react";
import { UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { authErrorMessage } from "@/lib/auth-messages";

export function AccountMenu() {
  const { session, logout, changePassword } = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const mismatch = Boolean(confirmation && newPassword !== confirmation);

  const signOut = async () => {
    try {
      await logout();
    } catch {
      toast.error("退出失败，请稍后重试。");
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (mismatch) return;
    setPending(true);
    setError(null);
    try {
      await changePassword(currentPassword, newPassword);
      setDialogOpen(false);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmation("");
      toast.success("密码已修改");
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.code || "unknown" : "unknown");
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="sm:w-auto sm:px-3" aria-label="账户菜单">
            <UserRound className="h-4 w-4" />
            <span className="ml-2 hidden sm:inline">{session.user?.username || "管理员"}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel className="px-2 py-1.5 text-xs text-fg-tertiary">
            {session.user?.username || "管理员"}
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="my-1 h-px bg-border-subtle" />
          <DropdownMenuGroup>
            {session.auth_mode === "password" ? (
              <DropdownMenuItem onSelect={() => setDialogOpen(true)}>修改密码</DropdownMenuItem>
            ) : null}
            {session.auth_mode === "password" ? (
              <DropdownMenuItem onSelect={() => void signOut()}>退出登录</DropdownMenuItem>
            ) : null}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>修改密码</DialogTitle>
            <DialogDescription>修改后其他浏览器会话将立即失效。</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit}>
            <FieldGroup>
              <Field data-invalid={error === "invalid_credentials"}>
                <FieldLabel htmlFor="current-password">当前密码</FieldLabel>
                <Input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  aria-invalid={error === "invalid_credentials"}
                  required
                />
                {error ? <FieldError>{authErrorMessage(error)}</FieldError> : null}
              </Field>
              <Field>
                <FieldLabel htmlFor="new-password">新密码</FieldLabel>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={128}
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                />
              </Field>
              <Field data-invalid={mismatch}>
                <FieldLabel htmlFor="new-password-confirmation">确认密码</FieldLabel>
                <Input
                  id="new-password-confirmation"
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
            <DialogFooter>
              <Button type="button" variant="secondary" onClick={() => setDialogOpen(false)}>
                取消
              </Button>
              <Button type="submit" disabled={pending || mismatch}>
                {pending ? "正在修改..." : "修改密码"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
