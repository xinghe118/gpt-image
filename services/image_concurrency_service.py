from __future__ import annotations

from contextlib import contextmanager
from threading import Condition, Lock
import time
from typing import Iterator

from services.config import config


class ImageConcurrencyLimitError(RuntimeError):
    pass


class ImageConcurrencyService:
    def __init__(self) -> None:
        self._lock = Lock()
        self._condition = Condition(self._lock)
        self._active_total = 0
        self._active_by_subject: dict[str, int] = {}

    @staticmethod
    def _subject_key(identity: dict[str, object]) -> str:
        role = str(identity.get("role") or "user")
        subject_id = str(identity.get("id") or "").strip() or "anonymous"
        return f"{role}:{subject_id}"

    def _can_acquire(self, subject_key: str, max_global: int, max_per_subject: int) -> tuple[bool, str]:
        current_subject = self._active_by_subject.get(subject_key, 0)
        if max_global > 0 and self._active_total >= max_global:
            return False, f"系统当前生图任务较多，请稍后重试（全局并发上限 {max_global}）"
        if max_per_subject > 0 and current_subject >= max_per_subject:
            return False, f"当前密钥已有任务在处理中，请稍后重试（单用户并发上限 {max_per_subject}）"
        return True, ""

    @contextmanager
    def acquire(self, identity: dict[str, object], *, wait: bool = False, timeout_seconds: int = 600) -> Iterator[None]:
        subject_key = self._subject_key(identity)

        with self._condition:
            deadline = time.monotonic() + max(1, timeout_seconds)
            while True:
                max_global = config.image_max_concurrent_requests
                max_per_subject = config.image_max_concurrent_per_user
                can_acquire, reason = self._can_acquire(subject_key, max_global, max_per_subject)
                if can_acquire:
                    break
                if not wait:
                    raise ImageConcurrencyLimitError(reason)
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise ImageConcurrencyLimitError(f"{reason}，等待超时")
                self._condition.wait(timeout=min(2.0, remaining))

            current_subject = self._active_by_subject.get(subject_key, 0)
            self._active_total += 1
            self._active_by_subject[subject_key] = current_subject + 1

        try:
            yield
        finally:
            with self._condition:
                self._active_total = max(0, self._active_total - 1)
                current_subject = max(0, self._active_by_subject.get(subject_key, 0) - 1)
                if current_subject:
                    self._active_by_subject[subject_key] = current_subject
                else:
                    self._active_by_subject.pop(subject_key, None)
                self._condition.notify_all()

    def snapshot(self) -> dict[str, object]:
        with self._lock:
            return {
                "active_total": self._active_total,
                "active_subjects": len(self._active_by_subject),
                "max_global": config.image_max_concurrent_requests,
                "max_per_user": config.image_max_concurrent_per_user,
            }


image_concurrency_service = ImageConcurrencyService()
