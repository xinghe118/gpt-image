from __future__ import annotations

import threading
import uuid
from datetime import datetime, timezone
from typing import Callable

from services.app_data_store import app_data_store
from services.error_messages import friendly_error_message


class ImageJobService:
    STALE_RUNNING_SECONDS = 2 * 60 * 60

    def __init__(self):
        self._lock = threading.Lock()
        self._jobs: dict[str, dict[str, object]] = {}
        self._tasks: dict[str, Callable[[], dict[str, object]]] = {}
        self._restore_persisted_jobs()

    @staticmethod
    def _now_iso() -> str:
        return datetime.now(timezone.utc).isoformat()

    @staticmethod
    def _parse_iso(value: object) -> datetime | None:
        text = str(value or "").strip()
        if not text:
            return None
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return None
        if parsed.tzinfo is None:
            return parsed.replace(tzinfo=timezone.utc)
        return parsed

    def _is_stale(self, job: dict[str, object]) -> bool:
        if job.get("status") not in {"pending", "running"}:
            return False
        timestamp = self._parse_iso(job.get("updated_at") or job.get("started_at") or job.get("created_at"))
        if timestamp is None:
            return False
        return (datetime.now(timezone.utc) - timestamp).total_seconds() > self.STALE_RUNNING_SECONDS

    def _fail_stale_job(self, job: dict[str, object], message: str | None = None) -> dict[str, object]:
        now = self._now_iso()
        updated = {
            **job,
            "status": "failed",
            "updated_at": now,
            "finished_at": job.get("finished_at") or now,
            "error": message or "任务长时间没有更新，已自动标记为失败。请重新提交或点击重试。",
            "retryable": isinstance(job.get("payload"), dict),
        }
        app_data_store.save_image_job(updated)
        return updated

    def _restore_persisted_jobs(self) -> None:
        for job in app_data_store.load_image_jobs(300, include_all=True):
            if job.get("status") in {"pending", "running"}:
                job = self._fail_stale_job(job, "任务在服务重启时中断，请重新提交或重试。")
            if isinstance(job.get("job_id"), str):
                self._jobs[str(job["job_id"])] = job

    def create(
            self,
            *,
            identity: dict[str, object],
            task: Callable[[], dict[str, object]],
            kind: str,
            metadata: dict[str, object] | None = None,
            payload: dict[str, object] | None = None,
    ) -> dict[str, object]:
        job_id = uuid.uuid4().hex
        now = self._now_iso()
        job = {
            "job_id": job_id,
            "kind": kind,
            "status": "pending",
            "subject_id": str(identity.get("id") or ""),
            "role": str(identity.get("role") or ""),
            "created_at": now,
            "updated_at": now,
            "started_at": "",
            "finished_at": "",
            "attempts": 0,
            "retryable": False,
            "result": None,
            "error": "",
            "metadata": metadata or {},
            "payload": payload or {},
            "identity": {
                "id": str(identity.get("id") or ""),
                "name": str(identity.get("name") or ""),
                "role": str(identity.get("role") or ""),
                "plan": str(identity.get("plan") or ""),
                "quota_limit": identity.get("quota_limit"),
                "quota_used": identity.get("quota_used"),
                "quota_remaining": identity.get("quota_remaining"),
            },
        }
        with self._lock:
            self._jobs[job_id] = job
            self._tasks[job_id] = task
            app_data_store.save_image_job(job)
            if len(self._jobs) > 300:
                for old_job_id in list(self._jobs.keys())[:100]:
                    if self._jobs.get(old_job_id, {}).get("status") in {"succeeded", "failed"}:
                        self._jobs.pop(old_job_id, None)
                        self._tasks.pop(old_job_id, None)

        thread = threading.Thread(target=self._run, args=(job_id, task), name=f"image-job-{job_id[:8]}", daemon=True)
        thread.start()
        return self.get(job_id) or job

    def _run(self, job_id: str, task: Callable[[], dict[str, object]]) -> None:
        current = self.get(job_id)
        attempts = int(current.get("attempts") or 0) + 1 if current else 1
        self._update(
            job_id,
            status="running",
            started_at=self._now_iso(),
            finished_at="",
            retryable=False,
            attempts=attempts,
        )
        try:
            self._update(job_id, status="succeeded", result=task(), error="", finished_at=self._now_iso(), retryable=False)
        except Exception as exc:
            self._update(
                job_id,
                status="failed",
                error=friendly_error_message(exc),
                raw_error=str(exc),
                finished_at=self._now_iso(),
                retryable=True,
            )

    def _update(self, job_id: str, **updates: object) -> None:
        with self._lock:
            current = self._jobs.get(job_id)
            if not current:
                return
            updated = {**current, **updates, "updated_at": self._now_iso()}
            self._jobs[job_id] = updated
            app_data_store.save_image_job(updated)

    def get(self, job_id: str) -> dict[str, object] | None:
        with self._lock:
            job = self._jobs.get(job_id)
        if job:
            if self._is_stale(job):
                job = self._fail_stale_job(job)
                with self._lock:
                    self._jobs[job_id] = job
            return dict(job)
        stored = app_data_store.load_image_job(job_id)
        if stored and self._is_stale(stored):
            stored = self._fail_stale_job(stored)
        return dict(stored) if stored else None

    def list(self, identity: dict[str, object], limit: int = 100) -> list[dict[str, object]]:
        include_all = identity.get("role") == "admin"
        subject_id = str(identity.get("id") or "")
        items = app_data_store.load_image_jobs(limit, subject_id=subject_id, include_all=include_all)
        next_items: list[dict[str, object]] = []
        for item in items:
            if self._is_stale(item):
                item = self._fail_stale_job(item)
            next_items.append(item)
        return next_items

    def retry(
            self,
            job_id: str,
            identity: dict[str, object],
            task_builder: Callable[[dict[str, object]], Callable[[], dict[str, object]] | None] | None = None,
    ) -> dict[str, object] | None:
        with self._lock:
            job = self._jobs.get(job_id)
            task = self._tasks.get(job_id)
            if not job:
                stored = app_data_store.load_image_job(job_id)
                if stored:
                    job = stored
                    self._jobs[job_id] = stored
            if job and not task and task_builder is not None:
                task = task_builder(job)
                if task is not None:
                    self._tasks[job_id] = task
            if not job or not task:
                return None
            if identity.get("role") != "admin" and str(job.get("subject_id") or "") != str(identity.get("id") or ""):
                raise PermissionError("image job permission denied")
            if job.get("status") != "failed":
                raise ValueError("only failed image jobs can be retried")
            now = self._now_iso()
            self._jobs[job_id] = {
                **job,
                "status": "pending",
                "updated_at": now,
                "started_at": "",
                "finished_at": "",
                "result": None,
                "error": "",
                "raw_error": "",
                "retryable": False,
            }
            app_data_store.save_image_job(self._jobs[job_id])
        thread = threading.Thread(target=self._run, args=(job_id, task), name=f"image-job-retry-{job_id[:8]}", daemon=True)
        thread.start()
        return self.get(job_id)


image_job_service = ImageJobService()
