"""进程内事件总线与 SSE 格式化辅助函数。

主要用于把队列、扫描等内部状态变化广播给 WebUI 的事件流接口。
"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from queue import Empty, Full, Queue
from threading import Lock
from typing import Any

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ArchiveEvent:
    """一条可广播的归档事件。"""

    id: int
    epoch: str
    topic: str
    type: str
    payload: dict[str, Any]
    created_at: str


class EventSubscription:
    """单个订阅者对应的队列与过滤条件。"""

    def __init__(self, broker: EventBroker, topics: set[str] | None, max_queue_size: int) -> None:
        self._broker = broker
        self.topics = topics
        self._queue: Queue[ArchiveEvent] = Queue(maxsize=max_queue_size)
        self._closed = False
        self._queue_high_water = 0
        self._dropped_events = 0
        self._overflowed = False

    def matches(self, topic: str) -> bool:
        """判断当前订阅是否接收某个 topic。"""

        return self.topics is None or topic in self.topics

    @property
    def closed(self) -> bool:
        return self._closed

    def put(self, event: ArchiveEvent) -> None:
        """向订阅队列投递事件，满队列时丢弃最旧事件。"""

        if self._closed:
            return
        try:
            self._queue.put_nowait(event)
        except Full:
            self._dropped_events += 1
            self._overflowed = True
            try:
                self._queue.get_nowait()
            except Empty:
                pass
            self._queue.put_nowait(event)
        self._queue_high_water = max(self._queue_high_water, self._queue.qsize())

    def get(self, timeout: float | None = None) -> ArchiveEvent:
        """阻塞获取下一条事件。"""

        return self._queue.get(timeout=timeout)

    def close(self) -> None:
        """关闭订阅并从 broker 中注销。"""

        if self._closed:
            return
        self._closed = True
        self._broker.unsubscribe(self)

    def diagnostics(self) -> dict[str, int | str | bool]:
        return {
            "kind": "sse",
            "queue_depth": self._queue.qsize(),
            "queue_high_water": self._queue_high_water,
            "dropped_events": self._dropped_events,
            "overflowed": self._overflowed,
        }


class AsyncEventSubscription:
    """面向 WebSocket 的线程安全异步订阅队列。"""

    def __init__(
        self,
        broker: EventBroker,
        topics: set[str] | None,
        loop: asyncio.AbstractEventLoop,
        max_queue_size: int,
        max_queue_bytes: int,
    ) -> None:
        self._broker = broker
        self.topics = topics
        self._loop = loop
        self._queue: asyncio.Queue[tuple[ArchiveEvent, int, int]] = asyncio.Queue(maxsize=max_queue_size)
        self._max_queue_size = max_queue_size
        self._max_queue_bytes = max_queue_bytes
        self._state_lock = Lock()
        self._buffered_events = 0
        self._buffered_bytes = 0
        self._generation = 0
        self._loop_generation = 0
        self._queue_high_water = 0
        self._dropped_events = 0
        self._overflowed = False
        self._closed = False

    def matches(self, topic: str) -> bool:
        return not self._closed and (self.topics is None or topic in self.topics)

    @property
    def closed(self) -> bool:
        return self._closed

    def put(self, event: ArchiveEvent) -> None:
        event_size = estimate_event_bytes(event)
        oversized = event_size > self._max_queue_bytes
        callback: Callable[..., None]
        args: tuple[Any, ...]
        generation: int
        with self._state_lock:
            if self._closed:
                return
            if oversized:
                self._mark_overflow_locked(extra_dropped=1)
                generation = self._generation
                callback = self._reset_on_loop
                args = (generation,)
            else:
                if (
                    self._buffered_events >= self._max_queue_size
                    or self._buffered_bytes + event_size > self._max_queue_bytes
                ):
                    self._mark_overflow_locked()
                self._buffered_events += 1
                self._buffered_bytes += event_size
                generation = self._generation
                self._queue_high_water = max(self._queue_high_water, self._buffered_events)
                callback = self._put_on_loop
                args = (event, event_size, generation)
        try:
            self._loop.call_soon_threadsafe(callback, *args)
        except RuntimeError:
            with self._state_lock:
                if not self._closed and not oversized and generation == self._generation:
                    self._buffered_events = max(0, self._buffered_events - 1)
                    self._buffered_bytes = max(0, self._buffered_bytes - event_size)
                self._closed = True

    def _mark_overflow_locked(self, *, extra_dropped: int = 0) -> None:
        self._dropped_events += self._buffered_events + extra_dropped
        self._buffered_events = 0
        self._buffered_bytes = 0
        self._generation += 1
        self._overflowed = True

    def _reset_on_loop(self, generation: int) -> None:
        if generation < self._loop_generation:
            return
        self._clear_queue_on_loop()
        self._loop_generation = generation

    def _put_on_loop(self, event: ArchiveEvent, event_size: int, generation: int) -> None:
        if self._closed or generation < self._loop_generation:
            return
        if generation > self._loop_generation:
            self._clear_queue_on_loop()
            self._loop_generation = generation
        try:
            self._queue.put_nowait((event, event_size, generation))
        except asyncio.QueueFull:
            with self._state_lock:
                if generation == self._generation:
                    self._buffered_events = max(0, self._buffered_events - 1)
                    self._buffered_bytes = max(0, self._buffered_bytes - event_size)
                    self._dropped_events += 1
                    self._overflowed = True

    def _clear_queue_on_loop(self) -> None:
        while not self._queue.empty():
            try:
                self._queue.get_nowait()
            except asyncio.QueueEmpty:
                break

    async def get(self, timeout: float | None = None) -> ArchiveEvent:
        deadline = None if timeout is None else self._loop.time() + timeout
        while True:
            if deadline is None:
                event, event_size, generation = await self._queue.get()
            else:
                remaining = deadline - self._loop.time()
                if remaining <= 0:
                    raise TimeoutError
                event, event_size, generation = await asyncio.wait_for(self._queue.get(), timeout=remaining)
            with self._state_lock:
                if generation != self._generation:
                    continue
                self._buffered_events = max(0, self._buffered_events - 1)
                self._buffered_bytes = max(0, self._buffered_bytes - event_size)
            return event

    def consume_overflowed(self) -> bool:
        with self._state_lock:
            overflowed = self._overflowed
            self._overflowed = False
            return overflowed

    def close(self) -> None:
        with self._state_lock:
            if self._closed:
                return
            self._closed = True
        self._broker.unsubscribe(self)

    def diagnostics(self) -> dict[str, int | str | bool]:
        with self._state_lock:
            return {
                "kind": "ws",
                "queue_depth": self._buffered_events,
                "queue_bytes": self._buffered_bytes,
                "queue_high_water": self._queue_high_water,
                "dropped_events": self._dropped_events,
                "overflowed": self._overflowed,
            }


class EventBroker:
    """简单的进程内发布订阅总线。"""

    def __init__(self, max_queue_size: int = 100) -> None:
        self._max_queue_size = max_queue_size
        self._epoch = uuid.uuid4().hex
        self._lock = Lock()
        self._next_id = 1
        self._subscriptions: set[EventSubscription | AsyncEventSubscription] = set()
        self._published_events = 0
        self._published_by_type: dict[str, int] = {}

    def subscribe(self, topics: Iterable[str] | None = None) -> EventSubscription:
        """创建一个新的事件订阅。"""

        normalized = normalize_topics(topics)
        subscription = EventSubscription(self, normalized, self._max_queue_size)
        with self._lock:
            self._subscriptions.add(subscription)
        return subscription

    def subscribe_async(
        self,
        topics: Iterable[str] | None = None,
        *,
        loop: asyncio.AbstractEventLoop | None = None,
        max_queue_size: int = 256,
        max_queue_bytes: int = 1024 * 1024,
    ) -> AsyncEventSubscription:
        """创建可由 worker 线程安全投递的异步订阅。"""

        subscription = AsyncEventSubscription(
            self,
            normalize_topics(topics),
            loop or asyncio.get_running_loop(),
            max_queue_size,
            max_queue_bytes,
        )
        with self._lock:
            self._subscriptions.add(subscription)
        return subscription

    def unsubscribe(self, subscription: EventSubscription | AsyncEventSubscription) -> None:
        """移除一个订阅。"""

        with self._lock:
            self._subscriptions.discard(subscription)

    def publish(self, topic: str, event_type: str, payload: dict[str, Any] | None = None) -> ArchiveEvent:
        """发布一条事件给所有匹配订阅者。"""

        with self._lock:
            event = ArchiveEvent(
                id=self._next_id,
                epoch=self._epoch,
                topic=topic,
                type=event_type,
                payload=json_safe_payload(payload or {}),
                created_at=datetime.now(UTC).isoformat(),
            )
            self._next_id += 1
            self._published_events += 1
            self._published_by_type[event_type] = self._published_by_type.get(event_type, 0) + 1
            self._subscriptions = {
                subscription for subscription in self._subscriptions if not subscription.closed
            }
            subscriptions = [subscription for subscription in self._subscriptions if subscription.matches(topic)]
            # 在同一把锁内按全局 sequence 投递，避免多个 worker 线程把事件交错入队。
            for subscription in subscriptions:
                subscription.put(event)
        return event

    def watermark(self) -> tuple[str, int]:
        """返回当前进程事件 epoch 与已分配的全局 sequence 水位。"""

        with self._lock:
            return self._epoch, self._next_id - 1

    def diagnostics(self) -> dict[str, Any]:
        with self._lock:
            subscriptions = list(self._subscriptions)
            published_by_type = dict(self._published_by_type)
            epoch = self._epoch
            sequence = self._next_id - 1
            published_events = self._published_events
        details = [subscription.diagnostics() for subscription in subscriptions]
        return {
            "epoch": epoch,
            "sequence": sequence,
            "published_events": published_events,
            "published_by_type": published_by_type,
            "sse_connections": sum(1 for item in details if item["kind"] == "sse"),
            "ws_connections": sum(1 for item in details if item["kind"] == "ws"),
            "queue_high_water": max((int(item["queue_high_water"]) for item in details), default=0),
            "dropped_events": sum(int(item["dropped_events"]) for item in details),
            "subscriptions": details,
        }


event_broker = EventBroker()


def publish_event(topic: str, event_type: str, payload: dict[str, Any] | None = None) -> None:
    """对 broker.publish 的安全包装，避免发布失败影响主流程。"""

    try:
        event_broker.publish(topic, event_type, payload)
    except Exception:
        logger.exception("Failed to publish archive event.")


def normalize_topics(topics: Iterable[str] | None) -> set[str] | None:
    """规范化 topic 集合，并过滤空值。"""

    if topics is None:
        return None
    normalized = {topic.strip() for topic in topics if topic and topic.strip()}
    return normalized or None


def json_safe_payload(value: Any) -> Any:
    """把事件载荷递归转换成可 JSON 序列化的结构。"""

    if isinstance(value, dict):
        return {str(key): json_safe_payload(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_safe_payload(item) for item in value]
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def format_sse_event(event: ArchiveEvent) -> str:
    """把归档事件编码成标准 SSE 文本帧。"""

    data = json.dumps(
        {
            "id": event.id,
            "sequence": event.id,
            "epoch": event.epoch,
            "topic": event.topic,
            "type": event.type,
            "payload": event.payload,
            "created_at": event.created_at,
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )
    return f"id: {event.id}\nevent: {event.type}\ndata: {data}\n\n"


def format_sse_heartbeat(epoch: str, sequence: int) -> str:
    """生成浏览器可见的 SSE 心跳，避免注释帧被 EventSource 忽略。"""

    data = json.dumps(
        {
            "epoch": epoch,
            "sequence": sequence,
            "type": "system.heartbeat",
            "created_at": datetime.now(UTC).isoformat(),
        },
        separators=(",", ":"),
    )
    return f"event: system.heartbeat\ndata: {data}\n\n"


def estimate_event_bytes(event: ArchiveEvent) -> int:
    return len(
        json.dumps(
            {
                "id": event.id,
                "epoch": event.epoch,
                "topic": event.topic,
                "type": event.type,
                "payload": event.payload,
                "created_at": event.created_at,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
    )
