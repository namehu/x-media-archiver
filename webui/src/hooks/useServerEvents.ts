import { useRuntimeConnection, type RuntimeConnectionStatus } from "../lib/runtime-provider";
import type { RuntimeTransportKind } from "../lib/runtime-transport";

export type ServerEventsState = {
  status: RuntimeConnectionStatus;
  transport: RuntimeTransportKind;
  lastEventAt?: number;
};

export function useServerEvents(_topics: string[]): ServerEventsState {
  return useRuntimeConnection();
}
