"""Runtime WebSocket 消息投影与有界诊断计数。"""

from __future__ import annotations

from dataclasses import dataclass, field
from threading import Lock
from typing import Any

from xarchiver.core.events import ArchiveEvent, event_broker

PROGRESS_EVENT_TYPES = {"archive.run.progress", "source.scan.log"}
LOG_EVENT_TYPES = {"operation.log.appended"}
SCAN_STATUS_BY_EVENT = {
    "source.scan.started": "running",
    "source.scan.completed": "succeeded",
    "source.scan.failed": "failed",
    "source.scan.waiting_downloads": "waiting_downloads",
}
INVALIDATION_KEYS = {
    "run_id",
    "archive_run_id",
    "source_id",
    "scan_run_id",
    "source_scan_run_id",
    "stream_id",
    "log_stream_id",
    "operation_id",
    "tweet_ids",
}


@dataclass
class RuntimeProjection:
    sequence: int = 0
    epoch: str = ""
    runs: dict[int, dict[str, Any]] = field(default_factory=dict)
    items: dict[int, dict[str, Any]] = field(default_factory=dict)
    scans: dict[int, dict[str, Any]] = field(default_factory=dict)
    worker: dict[str, Any] | None = None
    queue: dict[str, Any] | None = None
    global_state: dict[str, Any] | None = None
    invalidations: list[dict[str, Any]] = field(default_factory=list)

    def patch_payload(self) -> dict[str, Any] | None:
        payload: dict[str, Any] = {}
        if self.runs:
            payload["runs"] = list(self.runs.values())
        if self.items:
            payload["items"] = list(self.items.values())
        if self.scans:
            payload["scans"] = list(self.scans.values())
        if self.worker is not None:
            payload["worker"] = self.worker
        if self.queue is not None:
            payload["queue"] = self.queue
        if self.global_state is not None:
            payload["global"] = self.global_state
        return payload or None


def project_runtime_events(events: list[ArchiveEvent]) -> RuntimeProjection:
    projection = RuntimeProjection()
    for event in events:
        projection.sequence = max(projection.sequence, event.id)
        projection.epoch = event.epoch
        if event.type in LOG_EVENT_TYPES:
            continue
        payload = event.payload
        _merge_entity(projection.runs, payload.get("run"))
        for item in payload.get("items", []) if isinstance(payload.get("items"), list) else []:
            _merge_entity(projection.items, item, aliases=("archive_run_item_id",))
        _merge_scan_event(projection, event)
        if isinstance(payload.get("worker"), dict):
            projection.worker = dict(payload["worker"])
        if isinstance(payload.get("queue"), dict):
            projection.queue = dict(payload["queue"])
        if isinstance(payload.get("global"), dict):
            projection.global_state = dict(payload["global"])
        if event.type not in PROGRESS_EVENT_TYPES:
            projection.invalidations.append(compact_invalidation_event(event))
    return projection


def compact_invalidation_event(event: ArchiveEvent) -> dict[str, Any]:
    payload = {key: event.payload[key] for key in INVALIDATION_KEYS if key in event.payload}
    return {"topic": event.topic, "type": event.type, "payload": payload}


def _merge_entity(
    target: dict[int, dict[str, Any]],
    value: object,
    *,
    aliases: tuple[str, ...] = (),
) -> None:
    if not isinstance(value, dict):
        return
    entity_id = _positive_int(value.get("id"))
    if entity_id is None:
        for alias in aliases:
            entity_id = _positive_int(value.get(alias))
            if entity_id is not None:
                break
    if entity_id is None:
        return
    target[entity_id] = {**target.get(entity_id, {}), **value, "id": entity_id}


def _merge_scan_event(projection: RuntimeProjection, event: ArchiveEvent) -> None:
    payload = event.payload
    _merge_entity(projection.scans, payload.get("scan"), aliases=("scan_run_id", "source_scan_run_id"))
    if not event.type.startswith("source.scan."):
        return
    scan_id = _positive_int(payload.get("scan_run_id") or payload.get("source_scan_run_id"))
    if scan_id is None:
        return
    patch: dict[str, Any] = {"id": scan_id}
    for key in (
        "source_id",
        "progress_message",
        "log_stream_id",
        "last_log_at",
        "finished_at",
        "discovered_tweet_count",
        "new_tweet_count",
        "duplicate_tweet_count",
        "discovered_media_count",
        "error_category",
        "error_message",
    ):
        if key in payload:
            patch[key] = payload[key]
    if "status" in payload:
        patch["status"] = payload["status"]
    elif event.type in SCAN_STATUS_BY_EVENT:
        patch["status"] = SCAN_STATUS_BY_EVENT[event.type]
    projection.scans[scan_id] = {**projection.scans.get(scan_id, {}), **patch}


def _positive_int(value: object) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int) and value > 0:
        return value
    if isinstance(value, str) and value.isdigit() and int(value) > 0:
        return int(value)
    return None


class RuntimeChannelMetrics:
    def __init__(self) -> None:
        self._lock = Lock()
        self._values: dict[str, int] = {
            "active_connections": 0,
            "accepted_connections": 0,
            "messages_sent": 0,
            "bytes_sent": 0,
            "snapshots_sent": 0,
            "patches_sent": 0,
            "invalidations_sent": 0,
            "heartbeats_sent": 0,
            "resyncs_sent": 0,
            "queue_overflows": 0,
            "dropped_events": 0,
            "auth_rejections": 0,
            "origin_rejections": 0,
            "send_errors": 0,
        }

    def increment(self, key: str, amount: int = 1) -> None:
        with self._lock:
            self._values[key] = self._values.get(key, 0) + amount

    def connected(self) -> None:
        with self._lock:
            self._values["active_connections"] += 1
            self._values["accepted_connections"] += 1

    def disconnected(self) -> None:
        with self._lock:
            self._values["active_connections"] = max(0, self._values["active_connections"] - 1)

    def snapshot(self) -> dict[str, int]:
        with self._lock:
            return dict(self._values)


runtime_channel_metrics = RuntimeChannelMetrics()


def get_runtime_transport_diagnostics() -> dict[str, object]:
    return {
        "broker": event_broker.diagnostics(),
        "websocket": runtime_channel_metrics.snapshot(),
    }
