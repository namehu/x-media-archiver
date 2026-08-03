import { useQuery } from "@tanstack/react-query";
import { apiGet, type HealthDetail } from "../../../lib/api";
import { useRuntimeConnection } from "../../../lib/runtime-provider";

export function useSystemHealth() {
  const runtimeConnection = useRuntimeConnection();
  const shouldFallbackPoll = shouldUseRuntimePollingFallback(runtimeConnection.status);
  return useQuery({
    queryKey: ["health-detail"],
    queryFn: () => apiGet<HealthDetail>("/api/v1/health/detail"),
    refetchInterval: shouldFallbackPoll ? 15000 : false,
  });
}

function shouldUseRuntimePollingFallback(status: string) {
  return status === "offline" || status === "reconnecting" || status === "stale";
}
