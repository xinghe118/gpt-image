from __future__ import annotations

import json
import time
import uuid
from pathlib import Path
from threading import Lock
from typing import Any

from services.config import DATA_DIR


class ActivityLogService:
    def __init__(self, log_file: Path | None = None) -> None:
        self.log_file = log_file or DATA_DIR / "activity_logs.jsonl"
        self._lock = Lock()
        self.log_file.parent.mkdir(parents=True, exist_ok=True)

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
        line = json.dumps(item, ensure_ascii=False, separators=(",", ":"))
        with self._lock:
            with self.log_file.open("a", encoding="utf-8") as handle:
                handle.write(line + "\n")
        return item

    def list_logs(
        self,
        *,
        limit: int = 200,
        level: str = "",
        status: str = "",
        event: str = "",
        query: str = "",
    ) -> list[dict[str, Any]]:
        limit = max(1, min(int(limit or 200), 1000))
        if not self.log_file.exists():
            return []
        level = level.strip().lower()
        status = status.strip().lower()
        event = event.strip().lower()
        query = query.strip().lower()
        items: list[dict[str, Any]] = []
        with self._lock:
            lines = self.log_file.read_text(encoding="utf-8", errors="ignore").splitlines()
        for line in reversed(lines):
            try:
                item = json.loads(line)
            except Exception:
                continue
            if not isinstance(item, dict):
                continue
            if level and str(item.get("level") or "").lower() != level:
                continue
            if status and str(item.get("status") or "").lower() != status:
                continue
            if event and event not in str(item.get("event") or "").lower():
                continue
            if query:
                haystack = json.dumps(item, ensure_ascii=False).lower()
                if query not in haystack:
                    continue
            items.append(item)
            if len(items) >= limit:
                break
        return items

    def summary(self) -> dict[str, Any]:
        logs = self.list_logs(limit=1000)
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
