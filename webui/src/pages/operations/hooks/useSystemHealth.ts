import { useQuery } from "@tanstack/react-query";
import { apiGet, type HealthDetail, type RuntimeTransportDiagnostics } from "../../../lib/api";
import { useRuntimeConnection } from "../../../lib/runtime-provider";

export function useSystemHealth() {
  const runtimeConnection = useRuntimeConnection();
  const shouldFallbackPoll = shouldUseRuntimePollingFallback(
    runtimeConnection.status,
    runtimeConnection.transport,
  );
  return useQuery({
    queryKey: ["health-detail"],
    queryFn: () => apiGet<HealthDetail>("/api/v1/health/detail"),
    refetchInterval: shouldFallbackPoll ? 15000 : false,
  });
}

export function useRuntimeTransportDiagnostics() {
  return useQuery({
    queryKey: ["runtime-transport-diagnostics"],
    queryFn: () => apiGet<RuntimeTransportDiagnostics>("/api/v1/runtime/diagnostics"),
    refetchInterval: 15_000,
  });
}

function shouldUseRuntimePollingFallback(status: string, transport: string) {
  return transport === "polling" || status === "offline" || status === "reconnecting" || status === "stale";
}
