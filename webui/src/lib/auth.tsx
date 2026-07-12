import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiError, apiGet, apiPost, apiRequest } from "@/lib/api";
import type { AuthSession } from "@/lib/api";
import { LoginPage } from "@/pages/login";
import { SetupPage } from "@/pages/setup";

type AuthContextValue = {
  session: AuthSession;
  logout: () => Promise<void>;
  changePassword: (currentPassword: string, newPassword: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthGate({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const sessionQuery = useQuery({
    queryKey: ["auth-session"],
    queryFn: () => apiGet<AuthSession>("/api/v1/auth/session"),
    retry: false,
    staleTime: 60_000,
  });

  const replaceSession = useCallback(
    (session: AuthSession) => {
      queryClient.removeQueries({
        predicate: (query) => query.queryKey[0] !== "auth-session",
      });
      queryClient.setQueryData(["auth-session"], session);
    },
    [queryClient],
  );

  useEffect(() => {
    const unauthorized = () => {
      replaceSession({ status: "anonymous", auth_mode: "password", user: null });
    };
    window.addEventListener("xma:unauthorized", unauthorized);
    return () => window.removeEventListener("xma:unauthorized", unauthorized);
  }, [replaceSession]);

  const runAction = async (action: () => Promise<AuthSession>) => {
    setPending(true);
    setActionError(null);
    try {
      replaceSession(await action());
    } catch (error) {
      setActionError(authErrorCode(error));
    } finally {
      setPending(false);
    }
  };

  const value = useMemo<AuthContextValue | null>(() => {
    const session = sessionQuery.data;
    if (!session || session.status !== "authenticated") return null;
    return {
      session,
      logout: async () => {
        await apiRequest<void>("/api/v1/auth/logout", { method: "POST" });
        replaceSession({ status: "anonymous", auth_mode: "password", user: null });
      },
      changePassword: async (currentPassword: string, newPassword: string) => {
        const updated = await apiPost<AuthSession>("/api/v1/auth/password", {
          current_password: currentPassword,
          new_password: newPassword,
        });
        replaceSession(updated);
      },
    };
  }, [replaceSession, sessionQuery.data]);

  if (sessionQuery.isPending) {
    return <div className="min-h-screen bg-bg-surface" aria-label="加载中" />;
  }
  if (sessionQuery.isError || !sessionQuery.data) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-bg-surface p-4">
        <Card className="w-full max-w-md">
          <CardHeader><CardTitle>无法检查登录状态</CardTitle></CardHeader>
          <CardContent>
            <Alert variant="destructive">
              <AlertTitle>认证失败</AlertTitle>
              <AlertDescription>认证 API 暂时不可用，请检查服务状态后重试。</AlertDescription>
            </Alert>
          </CardContent>
          <CardFooter>
            <Button onClick={() => void sessionQuery.refetch()}>重试</Button>
          </CardFooter>
        </Card>
      </main>
    );
  }
  if (sessionQuery.data.status === "uninitialized") {
    return (
      <SetupPage
        error={actionError}
        pending={pending}
        onSubmit={(setupToken, username, password) =>
          runAction(() => apiPost<AuthSession>("/api/v1/auth/setup", { setup_token: setupToken, username, password }))
        }
      />
    );
  }
  if (sessionQuery.data.status === "anonymous") {
    return (
      <LoginPage
        error={actionError}
        pending={pending}
        onSubmit={(username, password) =>
          runAction(() => apiPost<AuthSession>("/api/v1/auth/login", { username, password }))
        }
      />
    );
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside an authenticated AuthGate");
  return value;
}

function authErrorCode(error: unknown) {
  if (error instanceof ApiError) return error.code || String(error.detail || "unknown");
  return "unknown";
}
