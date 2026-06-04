"""In-process pub/sub for streaming workflow progress to SSE subscribers.

The bus fans workflow status/event updates out to any SSE subscribers for a
given conversation. It is intentionally in-process and best-effort: under a
multi-worker Gunicorn deployment each worker owns its own ``EventBus``, so the
SSE endpoint also polls DynamoDB as the source of truth. The bus simply makes
same-worker delivery low-latency.

Note: asyncio primitives (Lock/Queue) are created lazily inside async methods.
The codebase runs on Python 3.9 where instantiating ``asyncio.Lock()`` at
import time (no running loop) raises, so nothing is created in ``__init__``.
"""

import asyncio
from typing import Dict, List, Optional


class EventBus:
    """Per-conversation fan-out of workflow events to asyncio.Queue subscribers."""

    def __init__(self) -> None:
        self._subscribers: Dict[str, List[asyncio.Queue]] = {}
        self._lock: Optional[asyncio.Lock] = None

    def _get_lock(self) -> asyncio.Lock:
        # Created lazily inside a running loop (Python 3.9 safe).
        if self._lock is None:
            self._lock = asyncio.Lock()
        return self._lock

    async def subscribe(self, conversation_id: str) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        async with self._get_lock():
            self._subscribers.setdefault(conversation_id, []).append(queue)
        return queue

    async def unsubscribe(self, conversation_id: str, queue: asyncio.Queue) -> None:
        async with self._get_lock():
            queues = self._subscribers.get(conversation_id)
            if not queues:
                return
            if queue in queues:
                queues.remove(queue)
            if not queues:
                self._subscribers.pop(conversation_id, None)

    async def publish(self, conversation_id: str, event: dict) -> None:
        async with self._get_lock():
            queues = list(self._subscribers.get(conversation_id, []))
        for queue in queues:
            queue.put_nowait(event)


# Module-level singleton shared across the worker process.
event_bus = EventBus()
