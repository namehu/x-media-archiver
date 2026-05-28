import asyncio
import unittest
from queue import Empty

from starlette.requests import Request
from starlette.responses import StreamingResponse

from xarchiver.api.app import create_app
from xarchiver.api.deps import parse_event_topics
from xarchiver.core.events import EventBroker, format_sse_event


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
        self.assertIn('"topic":"archive_runs"', text)
        self.assertIn('"run_id":9', text)


class EventRouteTests(unittest.TestCase):
    def test_events_route_returns_text_event_stream(self) -> None:
        route = next(route for route in create_app().routes if getattr(route, "path", None) == "/api/v1/events")
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
