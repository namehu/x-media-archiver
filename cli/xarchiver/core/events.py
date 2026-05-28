from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
import logging
from queue import Empty, Full, Queue
from threading import Lock
from typing import Any, Iterable

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ArchiveEvent:
    id: int
    topic: str
    type: str
    payload: dict[str, Any]
    created_at: str


class EventSubscription:
    def __init__(self, broker: EventBroker, topics: set[str] | None, max_queue_size: int) -> None:
        self._broker = broker
        self.topics = topics
        self._queue: Queue[ArchiveEvent] = Queue(maxsize=max_queue_size)
        self._closed = False

    def matches(self, topic: str) -> bool:
        return self.topics is None or topic in self.topics

    def put(self, event: ArchiveEvent) -> None:
        if self._closed:
            return
        try:
            self._queue.put_nowait(event)
        except Full:
            try:
                self._queue.get_nowait()
            except Empty:
                pass
            self._queue.put_nowait(event)

    def get(self, timeout: float | None = None) -> ArchiveEvent:
        return self._queue.get(timeout=timeout)

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        self._broker.unsubscribe(self)


class EventBroker:
    def __init__(self, max_queue_size: int = 100) -> None:
        self._max_queue_size = max_queue_size
        self._lock = Lock()
        self._next_id = 1
        self._subscriptions: set[EventSubscription] = set()

    def subscribe(self, topics: Iterable[str] | None = None) -> EventSubscription:
        normalized = normalize_topics(topics)
        subscription = EventSubscription(self, normalized, self._max_queue_size)
        with self._lock:
            self._subscriptions.add(subscription)
        return subscription

    def unsubscribe(self, subscription: EventSubscription) -> None:
        with self._lock:
            self._subscriptions.discard(subscription)

    def publish(self, topic: str, event_type: str, payload: dict[str, Any] | None = None) -> ArchiveEvent:
        event = ArchiveEvent(
            id=self._allocate_id(),
            topic=topic,
            type=event_type,
            payload=json_safe_payload(payload or {}),
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        with self._lock:
            subscriptions = [subscription for subscription in self._subscriptions if subscription.matches(topic)]
        for subscription in subscriptions:
            subscription.put(event)
        return event

    def _allocate_id(self) -> int:
        with self._lock:
            event_id = self._next_id
            self._next_id += 1
            return event_id


event_broker = EventBroker()


def publish_event(topic: str, event_type: str, payload: dict[str, Any] | None = None) -> None:
    try:
        event_broker.publish(topic, event_type, payload)
    except Exception:
        logger.exception("Failed to publish archive event.")


def normalize_topics(topics: Iterable[str] | None) -> set[str] | None:
    if topics is None:
        return None
    normalized = {topic.strip() for topic in topics if topic and topic.strip()}
    return normalized or None


def json_safe_payload(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): json_safe_payload(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_safe_payload(item) for item in value]
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def format_sse_event(event: ArchiveEvent) -> str:
    data = json.dumps(
        {
            "id": event.id,
            "topic": event.topic,
            "type": event.type,
            "payload": event.payload,
            "created_at": event.created_at,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return f"id: {event.id}\nevent: {event.type}\ndata: {data}\n\n"
