"""进程内作用域锁管理器。"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterator
from contextlib import contextmanager
from threading import Lock


class LockManager:
    """按作用域名维护一组可复用的线程锁。"""

    def __init__(self) -> None:
        self._locks: defaultdict[str, Lock] = defaultdict(Lock)
        self._meta_lock = Lock()

    @contextmanager
    def acquire(self, scope: str, *, blocking: bool = True) -> Iterator[bool]:
        """获取某个作用域的锁，并以上下文管理器形式自动释放。"""

        # 如果未来 source/run 数量显著增大，可以考虑清理长期不活跃的 scope 锁。
        with self._meta_lock:
            lock = self._locks[scope]
        acquired = lock.acquire(blocking=blocking)
        try:
            yield acquired
        finally:
            if acquired:
                lock.release()

    def locked(self, scope: str = "global") -> bool:
        """判断某个作用域当前是否处于加锁状态。"""

        with self._meta_lock:
            lock = self._locks.get(scope)
        return bool(lock and lock.locked())

    def any_locked(self, *, exclude: set[str] | None = None) -> bool:
        """判断是否存在任意一个未被排除的作用域仍持有锁。"""

        excluded = exclude or set()
        with self._meta_lock:
            locks = [(scope, lock) for scope, lock in self._locks.items()]
        return any(scope not in excluded and lock.locked() for scope, lock in locks)


lock_manager = LockManager()
