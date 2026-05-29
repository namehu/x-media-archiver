import { useQuery } from "@tanstack/react-query";
import { apiGet, type HealthDetail } from "../../../lib/api";

export function useSystemHealth() {
  return useQuery({
    queryKey: ["health-detail"],
    queryFn: () => apiGet<HealthDetail>("/api/v1/health/detail"),
    refetchInterval: 15000,
  });
}
