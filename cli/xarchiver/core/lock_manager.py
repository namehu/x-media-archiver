from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterator
from contextlib import contextmanager
from threading import Lock


class LockManager:
    def __init__(self) -> None:
        self._locks: defaultdict[str, Lock] = defaultdict(Lock)
        self._meta_lock = Lock()

    @contextmanager
    def acquire(self, scope: str, *, blocking: bool = True) -> Iterator[bool]:
        # TODO: prune inactive scope locks if source/run cardinality grows substantially.
        with self._meta_lock:
            lock = self._locks[scope]
        acquired = lock.acquire(blocking=blocking)
        try:
            yield acquired
        finally:
            if acquired:
                lock.release()

    def locked(self, scope: str = "global") -> bool:
        with self._meta_lock:
            lock = self._locks.get(scope)
        return bool(lock and lock.locked())

    def any_locked(self, *, exclude: set[str] | None = None) -> bool:
        excluded = exclude or set()
        with self._meta_lock:
            locks = [(scope, lock) for scope, lock in self._locks.items()]
        return any(scope not in excluded and lock.locked() for scope, lock in locks)


lock_manager = LockManager()
