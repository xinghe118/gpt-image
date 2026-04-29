from __future__ import annotations

import unittest
import time
from datetime import datetime, timedelta, timezone
from unittest import mock

from services.image_job_service import ImageJobService


class FakeJobStore:
    def __init__(self, jobs: list[dict[str, object]] | None = None) -> None:
        self.jobs = {str(job["job_id"]): dict(job) for job in jobs or []}

    def load_image_jobs(self, limit=100, *, subject_id="", include_all=False):
        items = list(self.jobs.values())
        if not include_all:
            items = [item for item in items if str(item.get("subject_id") or "") == subject_id]
        return items[:limit]

    def load_image_job(self, job_id):
        item = self.jobs.get(str(job_id))
        return dict(item) if item else None

    def save_image_job(self, item):
        self.jobs[str(item["job_id"])] = dict(item)


class ImageJobServiceTests(unittest.TestCase):
    def test_stale_running_job_is_marked_failed_on_list(self):
        old_time = (datetime.now(timezone.utc) - timedelta(hours=3)).isoformat()
        store = FakeJobStore(
            [
                {
                    "job_id": "job-1",
                    "kind": "images.generations",
                    "status": "running",
                    "subject_id": "user-1",
                    "role": "user",
                    "created_at": old_time,
                    "updated_at": old_time,
                    "payload": {"prompt": "hello"},
                }
            ]
        )
        with mock.patch("services.image_job_service.app_data_store", store):
            service = ImageJobService()
            items = service.list({"id": "user-1", "role": "user"})

        self.assertEqual(items[0]["status"], "failed")
        self.assertTrue(items[0]["retryable"])
        self.assertIn("重试", str(items[0]["error"]))

    def test_failed_task_stores_friendly_error_and_raw_error(self):
        store = FakeJobStore()
        with mock.patch("services.image_job_service.app_data_store", store):
            service = ImageJobService()

            def fail_task():
                raise RuntimeError("no downloadable image result found; upstream_reason=policy")

            job = service.create(
                identity={"id": "user-1", "name": "User", "role": "user"},
                task=fail_task,
                kind="images.generations",
                payload={"prompt": "hello"},
            )
            current = None
            for _ in range(50):
                current = service.get(str(job["job_id"]))
                if current and current.get("status") == "failed":
                    break
                time.sleep(0.01)

        self.assertIsNotNone(current)
        self.assertEqual(current["status"], "failed")
        self.assertIn("上游拒绝", str(current["error"]))
        self.assertIn("no downloadable", str(current["raw_error"]))


if __name__ == "__main__":
    unittest.main()
