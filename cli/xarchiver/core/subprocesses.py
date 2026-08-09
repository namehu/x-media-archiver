"""Bounded cleanup helpers for subprocess groups."""

from __future__ import annotations

import logging
import os
import signal
import subprocess
import time

logger = logging.getLogger(__name__)


def stop_process_group(
    process: subprocess.Popen[str],
    *,
    timeout_seconds: float,
    include_process_group: bool = False,
) -> None:
    """Send TERM, wait for a deadline, then KILL the process or its POSIX group."""

    process_running = process.poll() is None
    group_running = include_process_group and _process_group_exists(process)
    if not process_running and not group_running:
        return
    _signal_process(process, force=False, include_process_group=include_process_group)
    if _wait_for_exit(
        process,
        timeout_seconds=timeout_seconds,
        include_process_group=include_process_group,
    ):
        return
    _signal_process(process, force=True, include_process_group=include_process_group)
    if not _wait_for_exit(
        process,
        timeout_seconds=timeout_seconds,
        include_process_group=include_process_group,
    ):
        logger.error("Failed to kill subprocess or process group: pid=%s", process.pid)


def _signal_process(
    process: subprocess.Popen[str],
    *,
    force: bool,
    include_process_group: bool,
) -> None:
    if include_process_group and os.name == "posix" and isinstance(getattr(process, "pid", None), int):
        try:
            os.killpg(process.pid, signal.SIGKILL if force else signal.SIGTERM)
            return
        except ProcessLookupError:
            return
        except OSError:
            logger.warning("Failed to signal subprocess group: pid=%s", process.pid, exc_info=True)
    try:
        (process.kill if force else process.terminate)()
    except OSError:
        logger.warning("Failed to signal subprocess: pid=%s", process.pid, exc_info=True)


def _wait_for_exit(
    process: subprocess.Popen[str],
    *,
    timeout_seconds: float,
    include_process_group: bool,
) -> bool:
    deadline = time.monotonic() + timeout_seconds
    while True:
        process_running = process.poll() is None
        group_running = include_process_group and _process_group_exists(process)
        if not process_running and not group_running:
            return True
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return False
        if process_running:
            try:
                process.wait(timeout=min(0.05, remaining))
            except subprocess.TimeoutExpired:
                pass
            except OSError:
                logger.warning("Failed while waiting for subprocess: pid=%s", process.pid, exc_info=True)
        else:
            time.sleep(min(0.05, remaining))


def _process_group_exists(process: subprocess.Popen[str]) -> bool:
    if os.name != "posix" or not isinstance(getattr(process, "pid", None), int):
        return process.poll() is None
    try:
        os.killpg(process.pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True
