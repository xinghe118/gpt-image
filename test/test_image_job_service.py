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
            service.start_worker()
            current = None
            for _ in range(50):
                current = service.get(str(job["job_id"]))
                if current and current.get("status") == "failed":
                    break
                time.sleep(0.01)
            service.stop_worker()

        self.assertIsNotNone(current)
        self.assertEqual(current["status"], "failed")
        self.assertIn("上游拒绝", str(current["error"]))
        self.assertIn("no downloadable", str(current["raw_error"]))
        self.assertEqual(current["stage"], "failed")
        self.assertIn("上游拒绝", str(current["progress_message"]))

    def test_task_factory_can_update_progress(self):
        store = FakeJobStore()
        with mock.patch("services.image_job_service.app_data_store", store):
            service = ImageJobService()

            def build_task(job_id):
                def task():
                    service.update_progress(
                        job_id,
                        stage="upstream_request",
                        message="正在生成",
                        progress_percent=35,
                    )
                    return {"data": [{"url": "https://example.com/image.png"}]}

                return task

            job = service.create(
                identity={"id": "user-1", "name": "User", "role": "user"},
                task_factory=build_task,
                kind="images.generations",
                payload={"prompt": "hello"},
            )
            service.start_worker()
            current = None
            for _ in range(50):
                current = service.get(str(job["job_id"]))
                if current and current.get("status") == "succeeded":
                    break
                time.sleep(0.01)
            service.stop_worker()

        self.assertIsNotNone(current)
        self.assertEqual(current["status"], "succeeded")
        self.assertEqual(current["stage"], "completed")
        self.assertEqual(current["progress_percent"], 100)

    def test_pending_job_can_be_rebuilt_by_worker_task_builder(self):
        store = FakeJobStore()
        with mock.patch("services.image_job_service.app_data_store", store):
            service = ImageJobService()
            job = service.create(
                identity={"id": "user-1", "name": "User", "role": "user"},
                task=lambda: {"data": [{"url": "https://example.com/original.png"}]},
                kind="images.generations",
                payload={"prompt": "hello"},
            )
            job_id = str(job["job_id"])
            service.stop_worker()

            restored = ImageJobService()
            restored.set_task_builder(
                lambda item: (lambda: {"data": [{"url": f"https://example.com/{item['job_id']}.png"}]})
            )
            restored.start_worker()
            current = None
            for _ in range(50):
                current = restored.get(job_id)
                if current and current.get("status") == "succeeded":
                    break
                time.sleep(0.01)
            restored.stop_worker()

        self.assertIsNotNone(current)
        self.assertEqual(current["status"], "succeeded")
        self.assertEqual(current["result"], {"data": [{"url": f"https://example.com/{job_id}.png"}]})


if __name__ == "__main__":
    unittest.main()
