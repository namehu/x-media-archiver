import { useRuntimeConnection, type RuntimeConnectionStatus } from "../lib/runtime-provider";

export type ServerEventsState = {
  status: RuntimeConnectionStatus;
  lastEventAt?: number;
};

export function useServerEvents(_topics: string[]): ServerEventsState {
  return useRuntimeConnection();
}
