import { apiUrl } from "./api";

export type RuntimeTransportKind = "websocket" | "polling";
export type RuntimeTransportStatus = "connecting" | "connected" | "reconnecting" | "resyncing" | "stale" | "offline";

export type RuntimeWsEnvelope = {
  protocol: number;
  type: string;
  epoch: string;
  sequence: number;
  connection_sequence: number;
  sent_at: string;
  payload: Record<string, unknown>;
};

type RuntimeTransportCallbacks = {
  onStatus: (status: RuntimeTransportStatus, transport: RuntimeTransportKind) => void;
  onWebSocketEnvelope: (envelope: RuntimeWsEnvelope, byteLength: number) => void;
  onReconnect: () => void;
  onClose: (code: number | null) => void;
};

const WS_RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 15_000, 30_000];
const WS_CONNECT_TIMEOUT_MS = 5000;
const WS_FAILURES_BEFORE_POLLING = 3;
const WS_PROBE_INTERVAL_MS = 60_000;

export class RuntimeTransportController {
  private callbacks: RuntimeTransportCallbacks;
  private websocket: WebSocket | null = null;
  private activeTransport: RuntimeTransportKind | null = null;
  private stopped = false;
  private readyWebSocket: WebSocket | null = null;
  private websocketFailures = 0;
  private reconnectAttempt = 0;
  private connectTimeout: number | null = null;
  private reconnectTimer: number | null = null;
  private probeTimer: number | null = null;

  constructor(callbacks: RuntimeTransportCallbacks) {
    this.callbacks = callbacks;
  }

  start() {
    this.stopped = false;
    window.addEventListener("online", this.handleResume);
    document.addEventListener("visibilitychange", this.handleVisibility);
    if (typeof WebSocket === "undefined") {
      this.activatePolling();
      return;
    }
    this.openWebSocket(false);
  }

  stop() {
    this.stopped = true;
    window.removeEventListener("online", this.handleResume);
    document.removeEventListener("visibilitychange", this.handleVisibility);
    this.clearTimers();
    const websocket = this.websocket;
    this.websocket = null;
    this.readyWebSocket = null;
    if (websocket) this.closeWebSocket(websocket, 1000, "runtime_provider_unmounted");
    this.activeTransport = null;
  }

  reconnectNow() {
    if (this.stopped) return;
    this.clearTimer("reconnect");
    this.clearTimer("probe");
    this.clearTimer("connect");
    const probe = this.activeTransport === "polling";
    const websocket = this.websocket;
    this.websocket = null;
    this.readyWebSocket = null;
    if (websocket) this.closeWebSocket(websocket, 1012, "runtime_resync");
    if (!probe && this.activeTransport === "websocket") {
      this.activeTransport = null;
      this.callbacks.onStatus("reconnecting", "websocket");
    }
    this.openWebSocket(probe);
  }

  get active() {
    return this.activeTransport;
  }

  private openWebSocket(probe: boolean) {
    if (this.stopped) return;
    if (typeof WebSocket === "undefined") {
      this.activatePolling();
      return;
    }
    if (
      this.websocket &&
      (this.websocket.readyState === WebSocket.CONNECTING || this.websocket.readyState === WebSocket.OPEN)
    ) return;

    this.readyWebSocket = null;
    if (!probe) {
      this.callbacks.onStatus(this.reconnectAttempt ? "reconnecting" : "connecting", "websocket");
    }

    let websocket: WebSocket;
    try {
      websocket = new WebSocket(runtimeWebSocketUrl("/api/v1/runtime/ws"));
    } catch (_error) {
      this.handleWebSocketFailure(probe, null);
      return;
    }
    this.websocket = websocket;
    this.connectTimeout = window.setTimeout(() => {
      if (this.websocket === websocket && this.readyWebSocket !== websocket) {
        websocket.close(1013, "snapshot_timeout");
      }
    }, WS_CONNECT_TIMEOUT_MS);

    websocket.onmessage = (message) => {
      if (this.stopped || this.websocket !== websocket || typeof message.data !== "string") return;
      let envelope: RuntimeWsEnvelope;
      try {
        envelope = JSON.parse(message.data) as RuntimeWsEnvelope;
      } catch (_error) {
        websocket.close(1002, "invalid_runtime_message");
        return;
      }
      if (envelope.protocol !== 1 || !envelope.type) {
        websocket.close(1002, "unsupported_runtime_protocol");
        return;
      }
      if (envelope.type === "runtime.snapshot") {
        this.readyWebSocket = websocket;
        this.websocketFailures = 0;
        this.reconnectAttempt = 0;
        this.clearTimer("connect");
        this.clearTimer("probe");
        this.activeTransport = "websocket";
      }
      if (this.activeTransport !== "websocket" || this.readyWebSocket !== websocket) return;
      this.callbacks.onWebSocketEnvelope(envelope, new TextEncoder().encode(message.data).byteLength);
    };

    websocket.onclose = (event) => {
      if (this.websocket !== websocket) return;
      this.websocket = null;
      if (this.readyWebSocket === websocket) this.readyWebSocket = null;
      this.clearTimer("connect");
      this.callbacks.onClose(event.code || null);
      if (this.stopped) return;

      const pollingRemainsActive = this.activeTransport === "polling";
      if (this.activeTransport === "websocket") this.activeTransport = null;
      this.handleWebSocketFailure(pollingRemainsActive || probe, event.code || null);
    };
  }

  private handleWebSocketFailure(probe: boolean, closeCode: number | null) {
    this.websocketFailures += 1;
    this.callbacks.onReconnect();
    if (probe) {
      this.scheduleProbe();
      return;
    }
    if (closeCode === 1013 || this.websocketFailures >= WS_FAILURES_BEFORE_POLLING) {
      this.activatePolling();
      return;
    }
    this.callbacks.onStatus("reconnecting", "websocket");
    this.scheduleReconnect();
  }

  private closeWebSocket(websocket: WebSocket, code: number, reason: string) {
    if (websocket.readyState === WebSocket.CONNECTING) {
      websocket.addEventListener(
        "open",
        () => {
          if (websocket.readyState === WebSocket.OPEN) websocket.close(code, reason);
        },
        { once: true },
      );
      return;
    }
    if (websocket.readyState === WebSocket.OPEN) websocket.close(code, reason);
  }

  private activatePolling() {
    if (this.stopped) return;
    this.clearTimer("connect");
    this.clearTimer("reconnect");
    this.activeTransport = "polling";
    this.callbacks.onStatus("offline", "polling");
    this.scheduleProbe();
  }

  private scheduleReconnect() {
    if (this.stopped || this.reconnectTimer !== null) return;
    const baseDelay = WS_RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, WS_RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectAttempt += 1;
    const jittered = Math.round(baseDelay * (0.8 + Math.random() * 0.4));
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.openWebSocket(false);
    }, jittered);
  }

  private scheduleProbe() {
    if (this.stopped || this.probeTimer !== null || typeof WebSocket === "undefined") return;
    this.probeTimer = window.setTimeout(() => {
      this.probeTimer = null;
      if (this.activeTransport === "polling") this.openWebSocket(true);
    }, WS_PROBE_INTERVAL_MS);
  }

  private handleResume = () => {
    if (this.stopped) return;
    const websocket = this.websocket;
    if (
      websocket &&
      (websocket.readyState === WebSocket.CONNECTING || websocket.readyState === WebSocket.OPEN)
    ) return;
    this.reconnectNow();
  };

  private handleVisibility = () => {
    if (document.visibilityState === "visible") this.handleResume();
  };

  private clearTimer(kind: "connect" | "reconnect" | "probe") {
    const value = kind === "connect" ? this.connectTimeout : kind === "reconnect" ? this.reconnectTimer : this.probeTimer;
    if (value !== null) window.clearTimeout(value);
    if (kind === "connect") this.connectTimeout = null;
    else if (kind === "reconnect") this.reconnectTimer = null;
    else this.probeTimer = null;
  }

  private clearTimers() {
    this.clearTimer("connect");
    this.clearTimer("reconnect");
    this.clearTimer("probe");
  }
}

function runtimeWebSocketUrl(path: string) {
  const url = new URL(apiUrl(path), window.location.href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
