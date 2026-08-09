import asyncio
import unittest
from queue import Empty

from api_route_helpers import iter_app_routes
from starlette.requests import Request
from starlette.responses import StreamingResponse

from xarchiver.api.app import create_app
from xarchiver.api.deps import parse_event_topics
from xarchiver.core.events import EventBroker, format_sse_event, format_sse_heartbeat


class EventBrokerTests(unittest.TestCase):
    def test_subscription_filters_by_topic(self) -> None:
        broker = EventBroker()
        archive_events = broker.subscribe(["archive_runs"])
        source_events = broker.subscribe(["source_scans"])
        try:
            broker.publish("archive_runs", "archive.run.submitted", {"run_id": 1})
            broker.publish("source_scans", "source.scan.completed", {"scan_run_id": 2})

            self.assertEqual(archive_events.get(timeout=0.1).payload["run_id"], 1)
            with self.assertRaises(Empty):
                archive_events.get(timeout=0.1)

            self.assertEqual(source_events.get(timeout=0.1).payload["scan_run_id"], 2)
        finally:
            archive_events.close()
            source_events.close()

    def test_sse_format_includes_event_metadata_and_payload(self) -> None:
        broker = EventBroker()
        event = broker.publish("archive_runs", "archive.run.submitted", {"run_id": 9})

        text = format_sse_event(event)

        self.assertIn(f"id: {event.id}\n", text)
        self.assertIn("event: archive.run.submitted\n", text)
        self.assertIn(f'"sequence":{event.id}', text)
        self.assertIn(f'"epoch":"{event.epoch}"', text)
        self.assertIn('"topic":"archive_runs"', text)
        self.assertIn('"run_id":9', text)

    def test_sse_heartbeat_is_visible_to_event_source(self) -> None:
        text = format_sse_heartbeat("epoch-1", 12)

        self.assertIn("event: system.heartbeat\n", text)
        self.assertIn('"epoch":"epoch-1"', text)
        self.assertIn('"sequence":12', text)


class AsyncEventBrokerTests(unittest.IsolatedAsyncioTestCase):
    async def test_async_subscription_is_bounded_and_marks_overflow(self) -> None:
        broker = EventBroker()
        subscription = broker.subscribe_async(max_queue_size=2)
        try:
            broker.publish("archive_runs", "run.updated", {"run_id": 1})
            broker.publish("archive_runs", "run.updated", {"run_id": 2})
            broker.publish("archive_runs", "run.updated", {"run_id": 3})
            await asyncio.sleep(0)

            self.assertTrue(subscription.consume_overflowed())
            self.assertEqual((await subscription.get(timeout=0.1)).payload["run_id"], 3)
            diagnostics = subscription.diagnostics()
            self.assertEqual(diagnostics["queue_high_water"], 2)
            self.assertEqual(diagnostics["dropped_events"], 2)
        finally:
            subscription.close()

    async def test_async_subscription_rejects_single_event_over_byte_limit(self) -> None:
        broker = EventBroker()
        subscription = broker.subscribe_async(max_queue_bytes=200)
        try:
            broker.publish("archive_runs", "run.updated", {"message": "x" * 1000})
            await asyncio.sleep(0)

            self.assertTrue(subscription.consume_overflowed())
            with self.assertRaises(TimeoutError):
                await subscription.get(timeout=0.01)
            self.assertEqual(subscription.diagnostics()["dropped_events"], 1)
        finally:
            subscription.close()


class EventRouteTests(unittest.TestCase):
    def test_events_route_returns_text_event_stream(self) -> None:
        route = next(
            route
            for route in iter_app_routes(create_app())
            if getattr(route, "path", None) == "/api/v1/events"
        )
        request = Request(
            {
                "type": "http",
                "method": "GET",
                "path": "/api/v1/events",
                "headers": [],
                "query_string": b"",
            }
        )

        response = asyncio.run(route.endpoint(request, topics="archive_runs, source_scans"))

        self.assertIsInstance(response, StreamingResponse)
        self.assertEqual(response.media_type, "text/event-stream")
        self.assertEqual(parse_event_topics("archive_runs, source_scans"), ["archive_runs", "source_scans"])
        asyncio.run(response.body_iterator.aclose())


if __name__ == "__main__":
    unittest.main()
