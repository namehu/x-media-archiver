from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class RouteView:
    path: str
    methods: set[str]
    endpoint: Any


def iter_app_routes(app) -> Iterator[Any]:
    """Flatten FastAPI routers across eager and delayed include_router versions."""
    for route in app.routes:
        original_router = getattr(route, "original_router", None)
        include_context = getattr(route, "include_context", None)
        if original_router is None or include_context is None:
            yield route
            continue
        prefix = include_context.prefix
        for nested in original_router.routes:
            yield RouteView(
                path=f"{prefix}{nested.path}",
                methods=set(getattr(nested, "methods", set())),
                endpoint=nested.endpoint,
            )
