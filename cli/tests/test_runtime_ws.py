import asyncio
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import WebSocketDisconnect

from xarchiver.api.v1.runtime_ws import runtime_websocket


class FakeSubscription:
    def __init__(self, *, overflow: bool = False) -> None:
        self.overflow = overflow
        self.closed = False

    def consume_overflowed(self) -> bool:
        if self.overflow:
            self.overflow = False
            return True
        return False

    async def get(self, timeout: float | None = None):
        raise WebSocketDisconnect()

    def close(self) -> None:
        self.closed = True

    def diagnostics(self) -> dict[str, int]:
        return {"dropped_events": 2 if not self.overflow else 0}


class TimeoutThenDisconnectSubscription(FakeSubscription):
    def __init__(self) -> None:
        super().__init__()
        self.get_calls = 0

    async def get(self, timeout: float | None = None):
        self.get_calls += 1
        if self.get_calls == 1:
            await asyncio.sleep(timeout or 0)
            raise TimeoutError
        raise WebSocketDisconnect()


class FakeWebSocket:
    def __init__(self, *, origin: str = "https://archive.example", host: str = "archive.example") -> None:
        self.headers = {"origin": origin, "host": host}
        self.cookies = {"xma_session": "session-token"}
        self.accepted = False
        self.close_code: int | None = None
        self.sent: list[dict[str, object]] = []

    async def accept(self) -> None:
        self.accepted = True

    async def close(self, code: int = 1000) -> None:
        self.close_code = code

    async def send_text(self, value: str) -> None:
        self.sent.append(json.loads(value))

    async def receive(self):
        raise WebSocketDisconnect()


def runtime_snapshot(sequence: int = 4) -> dict[str, object]:
    return {
        "epoch": "epoch-1",
        "sequence": sequence,
        "recent_window_seconds": 120,
        "worker": {"stop_requested": False, "write_lock_held": False},
        "queue": {},
        "sources": {},
        "global": {},
        "runs": [],
        "items": [],
        "scans": [],
        "recent_activity": [],
    }


class RuntimeWebSocketTests(unittest.TestCase):
    def settings(self, *, enabled: bool = True, auth_mode: str = "disabled") -> SimpleNamespace:
        return SimpleNamespace(runtime_ws_enabled=enabled, auth_mode=auth_mode)

    def test_disabled_channel_closes_with_try_again_later(self) -> None:
        websocket = FakeWebSocket()
        with patch("xarchiver.api.v1.runtime_ws.get_settings", return_value=self.settings(enabled=False)):
            asyncio.run(runtime_websocket(websocket))

        self.assertTrue(websocket.accepted)
        self.assertEqual(websocket.close_code, 1013)

    def test_invalid_origin_and_session_close_with_policy_violation(self) -> None:
        invalid_origin = FakeWebSocket(origin="https://evil.example")
        with patch("xarchiver.api.v1.runtime_ws.get_settings", return_value=self.settings()):
            asyncio.run(runtime_websocket(invalid_origin))
        self.assertEqual(invalid_origin.close_code, 1008)

        invalid_session = FakeWebSocket()
        with (
            patch(
                "xarchiver.api.v1.runtime_ws.get_settings",
                return_value=self.settings(auth_mode="password"),
            ),
            patch("xarchiver.api.v1.runtime_ws.authenticate_session", return_value=None),
        ):
            asyncio.run(runtime_websocket(invalid_session))
        self.assertEqual(invalid_session.close_code, 1008)

    def test_first_message_is_snapshot_and_subscription_is_cleaned_up(self) -> None:
        websocket = FakeWebSocket()
        subscription = FakeSubscription()
        call_order: list[str] = []

        def subscribe():
            call_order.append("subscribe")
            return subscription

        def snapshot():
            call_order.append("snapshot")
            return runtime_snapshot()

        with (
            patch("xarchiver.api.v1.runtime_ws.get_settings", return_value=self.settings()),
            patch("xarchiver.api.v1.runtime_ws.get_runtime_snapshot", side_effect=snapshot),
            patch("xarchiver.api.v1.runtime_ws.event_broker.subscribe_async", side_effect=subscribe),
        ):
            asyncio.run(runtime_websocket(websocket))

        self.assertEqual(websocket.sent[0]["type"], "runtime.snapshot")
        self.assertEqual(websocket.sent[0]["sequence"], 4)
        self.assertEqual(websocket.sent[0]["connection_sequence"], 1)
        self.assertEqual(call_order, ["subscribe", "snapshot"])
        self.assertTrue(subscription.closed)

    def test_overflow_requests_resync_then_sends_fresh_snapshot(self) -> None:
        websocket = FakeWebSocket()
        subscription = FakeSubscription(overflow=True)
        snapshots = [runtime_snapshot(4), runtime_snapshot(9)]
        with (
            patch("xarchiver.api.v1.runtime_ws.get_settings", return_value=self.settings()),
            patch("xarchiver.api.v1.runtime_ws.get_runtime_snapshot", side_effect=snapshots),
            patch("xarchiver.api.v1.runtime_ws.event_broker.subscribe_async", return_value=subscription),
        ):
            asyncio.run(runtime_websocket(websocket))

        self.assertEqual(
            [message["type"] for message in websocket.sent],
            ["runtime.snapshot", "system.resync_required", "runtime.snapshot"],
        )
        self.assertEqual(websocket.sent[-1]["sequence"], 9)

    def test_long_lived_connection_receives_periodic_bounded_snapshot(self) -> None:
        websocket = FakeWebSocket()
        subscription = TimeoutThenDisconnectSubscription()
        snapshots = [runtime_snapshot(4), runtime_snapshot(8)]
        with (
            patch("xarchiver.api.v1.runtime_ws.get_settings", return_value=self.settings()),
            patch("xarchiver.api.v1.runtime_ws.get_runtime_snapshot", side_effect=snapshots),
            patch("xarchiver.api.v1.runtime_ws.event_broker.subscribe_async", return_value=subscription),
            patch("xarchiver.api.v1.runtime_ws.WS_SNAPSHOT_REFRESH_SECONDS", 0.001),
        ):
            asyncio.run(runtime_websocket(websocket))

        self.assertEqual(
            [message["type"] for message in websocket.sent],
            ["runtime.snapshot", "runtime.snapshot"],
        )
        self.assertEqual(websocket.sent[-1]["sequence"], 8)
        self.assertEqual(websocket.sent[-1]["connection_sequence"], 2)

    def test_session_is_rechecked_and_expired_connection_is_closed(self) -> None:
        websocket = FakeWebSocket()
        subscription = FakeSubscription()
        with (
            patch(
                "xarchiver.api.v1.runtime_ws.get_settings",
                return_value=self.settings(auth_mode="password"),
            ),
            patch(
                "xarchiver.api.v1.runtime_ws.authenticate_session",
                side_effect=[{"id": 1, "username": "admin"}, None],
            ),
            patch("xarchiver.api.v1.runtime_ws.get_runtime_snapshot", return_value=runtime_snapshot()),
            patch("xarchiver.api.v1.runtime_ws.event_broker.subscribe_async", return_value=subscription),
            patch("xarchiver.api.v1.runtime_ws.WS_SESSION_RECHECK_SECONDS", 0),
        ):
            asyncio.run(runtime_websocket(websocket))

        self.assertEqual(websocket.close_code, 1008)


if __name__ == "__main__":
    unittest.main()
