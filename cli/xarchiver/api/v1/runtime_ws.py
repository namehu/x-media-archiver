"""只读 Runtime WebSocket 通道。"""

from __future__ import annotations

import asyncio
import json
import logging
from contextlib import suppress
from datetime import UTC, datetime

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.encoders import jsonable_encoder

from xarchiver.api.middleware import valid_origin
from xarchiver.config import get_settings
from xarchiver.core.events import ArchiveEvent, AsyncEventSubscription, event_broker
from xarchiver.core.runtime_channel import (
    project_runtime_events,
    runtime_channel_metrics,
)
from xarchiver.services.auth import SESSION_COOKIE, authenticate_session
from xarchiver.services.runtime import get_runtime_snapshot

router = APIRouter(tags=["runtime"])
logger = logging.getLogger(__name__)

WS_PROTOCOL_VERSION = 1
WS_HEARTBEAT_SECONDS = 15.0
WS_SESSION_RECHECK_SECONDS = 300.0
WS_SNAPSHOT_REFRESH_SECONDS = 60.0
WS_BATCH_WINDOW_SECONDS = 0.2
WS_BATCH_EVENT_LIMIT = 100


@router.websocket("/runtime/ws")
async def runtime_websocket(websocket: WebSocket) -> None:
    """推送 snapshot、runtime patch 与失效通知；第一版不接收业务命令。"""

    settings = get_settings()
    if not settings.runtime_ws_enabled:
        await _accept_and_close(websocket, 1013)
        return
    if not valid_origin(websocket.headers.get("origin"), websocket.headers.get("host", "")):
        runtime_channel_metrics.increment("origin_rejections")
        await _accept_and_close(websocket, 1008)
        return

    token = websocket.cookies.get(SESSION_COOKIE)
    if settings.auth_mode != "disabled":
        try:
            current_user = await asyncio.to_thread(authenticate_session, token)
        except Exception:
            runtime_channel_metrics.increment("auth_rejections")
            await _accept_and_close(websocket, 1011)
            return
        if current_user is None:
            runtime_channel_metrics.increment("auth_rejections")
            await _accept_and_close(websocket, 1008)
            return

    await websocket.accept()
    subscription = event_broker.subscribe_async()
    runtime_channel_metrics.connected()
    connection_sequence = 0
    last_event_sequence = 0
    last_epoch = ""
    last_reported_drops = 0

    async def send(message_type: str, payload: dict[str, object], *, epoch: str, sequence: int) -> None:
        nonlocal connection_sequence
        connection_sequence += 1
        body = {
            "protocol": WS_PROTOCOL_VERSION,
            "type": message_type,
            "epoch": epoch,
            "sequence": sequence,
            "connection_sequence": connection_sequence,
            "sent_at": datetime.now(UTC).isoformat(),
            "payload": payload,
        }
        encoded = json.dumps(jsonable_encoder(body), ensure_ascii=False, separators=(",", ":"))
        try:
            await websocket.send_text(encoded)
        except Exception:
            runtime_channel_metrics.increment("send_errors")
            raise
        runtime_channel_metrics.increment("messages_sent")
        runtime_channel_metrics.increment("bytes_sent", len(encoded.encode("utf-8")))
        metric = {
            "runtime.snapshot": "snapshots_sent",
            "runtime.patch": "patches_sent",
            "runtime.invalidate": "invalidations_sent",
            "system.heartbeat": "heartbeats_sent",
            "system.resync_required": "resyncs_sent",
        }.get(message_type)
        if metric:
            runtime_channel_metrics.increment(metric)

    async def send_snapshot() -> tuple[str, int]:
        snapshot = await asyncio.to_thread(get_runtime_snapshot)
        epoch = str(snapshot["epoch"])
        sequence = int(snapshot["sequence"])
        await send("runtime.snapshot", snapshot, epoch=epoch, sequence=sequence)
        return epoch, sequence

    async def monitor_client() -> None:
        """消费断开帧，并拒绝 v1 只读通道上的客户端消息。"""

        try:
            while True:
                message = await websocket.receive()
                if message["type"] == "websocket.disconnect":
                    return
                if message["type"] == "websocket.receive" and (
                    message.get("text") is not None or message.get("bytes") is not None
                ):
                    await websocket.close(code=1008, reason="runtime_channel_is_read_only")
                    return
        except (WebSocketDisconnect, RuntimeError, OSError):
            return

    def record_queue_overflow() -> None:
        nonlocal last_reported_drops
        dropped_events = int(subscription.diagnostics()["dropped_events"])
        runtime_channel_metrics.increment("queue_overflows")
        runtime_channel_metrics.increment(
            "dropped_events",
            max(0, dropped_events - last_reported_drops),
        )
        last_reported_drops = dropped_events

    receiver_task = asyncio.create_task(monitor_client())
    try:
        last_epoch, last_event_sequence = await send_snapshot()
        loop = asyncio.get_running_loop()
        now = loop.time()
        next_heartbeat_at = now + WS_HEARTBEAT_SECONDS
        next_auth_check_at = now + WS_SESSION_RECHECK_SECONDS
        next_snapshot_at = now + WS_SNAPSHOT_REFRESH_SECONDS

        while True:
            if subscription.consume_overflowed():
                record_queue_overflow()
                await send(
                    "system.resync_required",
                    {"reason": "outbound_queue_overflow"},
                    epoch=last_epoch,
                    sequence=last_event_sequence,
                )
                last_epoch, last_event_sequence = await send_snapshot()
                next_snapshot_at = loop.time() + WS_SNAPSHOT_REFRESH_SECONDS
                continue

            now = loop.time()
            if now >= next_auth_check_at:
                if settings.auth_mode != "disabled":
                    current_user = await asyncio.to_thread(authenticate_session, token)
                    if current_user is None:
                        await websocket.close(code=1008)
                        return
                next_auth_check_at = now + WS_SESSION_RECHECK_SECONDS

            if now >= next_snapshot_at:
                last_epoch, last_event_sequence = await send_snapshot()
                next_snapshot_at = loop.time() + WS_SNAPSHOT_REFRESH_SECONDS
                continue

            if now >= next_heartbeat_at:
                epoch, sequence = event_broker.watermark()
                await send("system.heartbeat", {}, epoch=epoch, sequence=sequence)
                next_heartbeat_at = now + WS_HEARTBEAT_SECONDS

            wait_until = min(next_heartbeat_at, next_auth_check_at, next_snapshot_at)
            try:
                event = await subscription.get(timeout=max(0.05, wait_until - now))
            except TimeoutError:
                continue
            if event.epoch != last_epoch:
                await send(
                    "system.resync_required",
                    {"reason": "epoch_changed"},
                    epoch=event.epoch,
                    sequence=event.id,
                )
                last_epoch, last_event_sequence = await send_snapshot()
                next_snapshot_at = loop.time() + WS_SNAPSHOT_REFRESH_SECONDS
                continue
            if event.id <= last_event_sequence:
                continue

            events = await _collect_event_batch(subscription, event)
            if subscription.consume_overflowed():
                record_queue_overflow()
                await send(
                    "system.resync_required",
                    {"reason": "outbound_queue_overflow"},
                    epoch=last_epoch,
                    sequence=last_event_sequence,
                )
                last_epoch, last_event_sequence = await send_snapshot()
                next_snapshot_at = loop.time() + WS_SNAPSHOT_REFRESH_SECONDS
                continue

            projection = project_runtime_events(events)
            last_event_sequence = max(last_event_sequence, projection.sequence)
            patch = projection.patch_payload()
            if patch:
                await send(
                    "runtime.patch",
                    patch,
                    epoch=projection.epoch,
                    sequence=projection.sequence,
                )
            if projection.invalidations:
                await send(
                    "runtime.invalidate",
                    {"events": projection.invalidations},
                    epoch=projection.epoch,
                    sequence=projection.sequence,
                )
    except (WebSocketDisconnect, RuntimeError, OSError):
        return
    except Exception:
        logger.exception("Runtime WebSocket failed.")
        try:
            await send(
                "system.error",
                {"code": "runtime_channel_error"},
                epoch=last_epoch,
                sequence=last_event_sequence,
            )
            await websocket.close(code=1011)
        except Exception:
            pass
    finally:
        receiver_task.cancel()
        with suppress(asyncio.CancelledError):
            await receiver_task
        subscription.close()
        runtime_channel_metrics.disconnected()


async def _collect_event_batch(
    subscription: AsyncEventSubscription,
    first_event: ArchiveEvent,
) -> list[ArchiveEvent]:
    events = [first_event]
    deadline = asyncio.get_running_loop().time() + WS_BATCH_WINDOW_SECONDS
    while len(events) < WS_BATCH_EVENT_LIMIT:
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            break
        try:
            events.append(await subscription.get(timeout=remaining))
        except TimeoutError:
            break
    return events


async def _accept_and_close(websocket: WebSocket, code: int) -> None:
    await websocket.accept()
    await websocket.close(code=code)
