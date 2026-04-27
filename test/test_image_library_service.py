import base64
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

from services.image_library_service import ImageLibraryService


class FakeStore:
    def __init__(self):
        self.document = {"items": []}

    def load_document(self, name, default):
        return self.document if name == "library" else default

    def save_document(self, name, data):
        if name == "library":
            self.document = data


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
        image_data = base64.b64encode(b"fake-png").decode("ascii")
        self.service.record_images(
            identity={"id": "user-1", "name": "User", "role": "user"},
            prompt="hello",
            model="gpt-image-2",
            mode="generate",
            size="1:1",
            images=[{"b64_json": image_data}],
        )

        items = self.service.list_images(identity={"id": "user-1", "role": "user"})

        self.assertEqual(len(items), 1)
        self.assertIn("image_url", items[0])
        self.assertNotIn("b64_json", items[0])
        self.assertTrue((Path(self.temp_dir.name) / items[0]["image_url"].removeprefix("/images/")).exists())


if __name__ == "__main__":
    unittest.main()
