"""进程内事件总线与 SSE 格式化辅助函数。

主要用于把队列、扫描等内部状态变化广播给 WebUI 的事件流接口。
"""

from __future__ import annotations

import json
import logging
import uuid
from collections.abc import Iterable
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

    def matches(self, topic: str) -> bool:
        """判断当前订阅是否接收某个 topic。"""

        return self.topics is None or topic in self.topics

    def put(self, event: ArchiveEvent) -> None:
        """向订阅队列投递事件，满队列时丢弃最旧事件。"""

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
        """阻塞获取下一条事件。"""

        return self._queue.get(timeout=timeout)

    def close(self) -> None:
        """关闭订阅并从 broker 中注销。"""

        if self._closed:
            return
        self._closed = True
        self._broker.unsubscribe(self)


class EventBroker:
    """简单的进程内发布订阅总线。"""

    def __init__(self, max_queue_size: int = 100) -> None:
        self._max_queue_size = max_queue_size
        self._epoch = uuid.uuid4().hex
        self._lock = Lock()
        self._next_id = 1
        self._subscriptions: set[EventSubscription] = set()

    def subscribe(self, topics: Iterable[str] | None = None) -> EventSubscription:
        """创建一个新的事件订阅。"""

        normalized = normalize_topics(topics)
        subscription = EventSubscription(self, normalized, self._max_queue_size)
        with self._lock:
            self._subscriptions.add(subscription)
        return subscription

    def unsubscribe(self, subscription: EventSubscription) -> None:
        """移除一个订阅。"""

        with self._lock:
            self._subscriptions.discard(subscription)

    def publish(self, topic: str, event_type: str, payload: dict[str, Any] | None = None) -> ArchiveEvent:
        """发布一条事件给所有匹配订阅者。"""

        event = ArchiveEvent(
            id=self._allocate_id(),
            epoch=self._epoch,
            topic=topic,
            type=event_type,
            payload=json_safe_payload(payload or {}),
            created_at=datetime.now(UTC).isoformat(),
        )
        with self._lock:
            subscriptions = [subscription for subscription in self._subscriptions if subscription.matches(topic)]
        for subscription in subscriptions:
            subscription.put(event)
        return event

    def watermark(self) -> tuple[str, int]:
        """返回当前进程事件 epoch 与已分配的全局 sequence 水位。"""

        with self._lock:
            return self._epoch, self._next_id - 1

    def _allocate_id(self) -> int:
        """分配单调递增的事件 ID。"""

        with self._lock:
            event_id = self._next_id
            self._next_id += 1
            return event_id


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
