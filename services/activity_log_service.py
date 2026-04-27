from __future__ import annotations

import time
import uuid
from threading import Lock
from typing import Any

from services.app_data_store import app_data_store


class ActivityLogService:
    def __init__(self) -> None:
        self._lock = Lock()

    @staticmethod
    def _clean_text(value: object, limit: int = 240) -> str:
        text = str(value or "").strip().replace("\r", " ").replace("\n", " ")
        if len(text) <= limit:
            return text
        return text[:limit] + "..."

    def record(
        self,
        event: str,
        *,
        level: str = "info",
        status: str = "ok",
        route: str = "",
        model: str = "",
        subject_id: str = "",
        role: str = "",
        prompt: object = "",
        duration_ms: int | None = None,
        error: object = "",
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        item = {
            "id": uuid.uuid4().hex,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "event": self._clean_text(event, 80),
            "level": self._clean_text(level, 20) or "info",
            "status": self._clean_text(status, 20) or "ok",
            "route": self._clean_text(route, 120),
            "model": self._clean_text(model, 80),
            "subject_id": self._clean_text(subject_id, 80),
            "role": self._clean_text(role, 40),
            "prompt_preview": self._clean_text(prompt),
            "duration_ms": duration_ms,
            "error": self._clean_text(error),
            "metadata": metadata or {},
        }
        with self._lock:
            app_data_store.append_activity_log(item)
        return item

    def list_logs(
        self,
        *,
        limit: int = 200,
        offset: int = 0,
        level: str = "",
        status: str = "",
        event: str = "",
        query: str = "",
    ) -> dict[str, Any]:
        limit = max(1, min(int(limit or 100), 500))
        offset = max(0, int(offset or 0))
        level = level.strip().lower()
        status = status.strip().lower()
        event = event.strip().lower()
        query = query.strip().lower()
        items: list[dict[str, Any]] = []
        with self._lock:
            raw_items = app_data_store.list_activity_logs(limit=max(1000, offset + limit + 1))
        matched = 0
        for item in raw_items:
            if level and str(item.get("level") or "").lower() != level:
                continue
            if status and str(item.get("status") or "").lower() != status:
                continue
            if event and event not in str(item.get("event") or "").lower():
                continue
            if query:
                haystack = str(item).lower()
                if query not in haystack:
                    continue
            if matched >= offset and len(items) < limit:
                items.append(item)
            matched += 1
            if matched > offset + limit:
                break
        return {
            "items": items,
            "limit": limit,
            "offset": offset,
            "has_more": matched > offset + len(items),
        }

    def summary(self) -> dict[str, Any]:
        logs = self.list_logs(limit=1000)["items"]
        total = len(logs)
        failures = sum(1 for item in logs if str(item.get("status") or "").lower() != "ok")
        by_event: dict[str, int] = {}
        by_status: dict[str, int] = {}
        durations: list[int] = []
        for item in logs:
            event = str(item.get("event") or "unknown")
            status = str(item.get("status") or "unknown")
            by_event[event] = by_event.get(event, 0) + 1
            by_status[status] = by_status.get(status, 0) + 1
            duration = item.get("duration_ms")
            if isinstance(duration, int) and duration >= 0:
                durations.append(duration)
        return {
            "total": total,
            "failures": failures,
            "success_rate": None if total == 0 else round(((total - failures) / total) * 100),
            "avg_duration_ms": None if not durations else round(sum(durations) / len(durations)),
            "by_event": by_event,
            "by_status": by_status,
            "latest": logs[:10],
        }


activity_log_service = ActivityLogService()
