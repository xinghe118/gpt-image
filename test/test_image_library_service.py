import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from services.image_library_service import ImageLibraryService


class FakeStore:
    def __init__(self):
        self.document = {"items": []}

    @property
    def database_enabled(self):
        return False

    def load_document(self, name, default):
        return self.document if name == "library" else default

    def save_document(self, name, data):
        if name == "library":
            self.document = data

    def load_library(self):
        return list(self.document.get("items", []))

    def save_library(self, items):
        self.document = {"items": list(items)}

    def list_library_page(self, **kwargs):
        return None

    def delete_library_item(self, image_id):
        self.document = {
            "items": [item for item in self.document.get("items", []) if item.get("id") != image_id]
        }


class ImageLibraryServiceTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.store = FakeStore()
        self.service = ImageLibraryService()
        self.store_patcher = mock.patch("services.image_library_service.app_data_store", self.store)
        self.config_patcher = mock.patch(
            "services.image_library_service.config",
            SimpleNamespace(images_dir=Path(self.temp_dir.name)),
        )
        self.store_patcher.start()
        self.config_patcher.start()
        self.addCleanup(self.store_patcher.stop)
        self.addCleanup(self.config_patcher.stop)

    def test_records_images_as_urls_without_returning_base64_in_list(self):
        image_data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
        self.service.record_images(
            identity={"id": "user-1", "name": "User", "role": "user"},
            prompt="hello",
            model="gpt-image-2",
            mode="generate",
            size="1:1",
            images=[{"b64_json": image_data}],
        )

        result = self.service.list_images(identity={"id": "user-1", "role": "user"})
        items = result["items"]

        self.assertEqual(len(items), 1)
        self.assertIn("image_url", items[0])
        self.assertIn("thumb_url", items[0])
        self.assertNotIn("b64_json", items[0])
        self.assertTrue((Path(self.temp_dir.name) / items[0]["image_url"].removeprefix("/images/")).exists())
        self.assertTrue((Path(self.temp_dir.name) / items[0]["thumb_url"].removeprefix("/images/")).exists())

    def test_user_can_delete_own_image_and_files(self):
        image_data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
        self.service.record_images(
            identity={"id": "user-1", "name": "User", "role": "user"},
            prompt="hello",
            model="gpt-image-2",
            mode="generate",
            size="1:1",
            images=[{"b64_json": image_data}],
        )
        item = self.service.list_images(identity={"id": "user-1", "role": "user"})["items"][0]
        image_path = Path(self.temp_dir.name) / item["image_url"].removeprefix("/images/")
        thumb_path = Path(self.temp_dir.name) / item["thumb_url"].removeprefix("/images/")

        deleted = self.service.delete_image(identity={"id": "user-1", "role": "user"}, image_id=item["id"])

        self.assertIsNotNone(deleted)
        self.assertEqual(self.service.list_images(identity={"id": "user-1", "role": "user"})["items"], [])
        self.assertFalse(image_path.exists())
        self.assertFalse(thumb_path.exists())

    def test_user_cannot_delete_other_users_image(self):
        self.store.document = {
            "items": [
                {
                    "id": "image-1",
                    "subject_id": "user-1",
                    "image_url": "/images/library/image-1.png",
                    "thumb_url": "/images/library/thumbs/image-1.webp",
                }
            ]
        }

        with self.assertRaises(PermissionError):
            self.service.delete_image(identity={"id": "user-2", "role": "user"}, image_id="image-1")

        self.assertEqual(len(self.store.document["items"]), 1)


if __name__ == "__main__":
    unittest.main()
