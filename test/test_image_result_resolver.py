from __future__ import annotations

import unittest

from services.image_result_resolver import format_image_api_result


class ImageResultResolverTests(unittest.TestCase):
    def test_url_response_uses_persisted_image_url(self):
        result = {"created": 1, "data": [{"b64_json": "abc", "revised_prompt": "cat"}]}
        records = [{"image_url": "https://cdn.example/cat.png"}]

        formatted = format_image_api_result(result, records, "url")

        self.assertEqual(formatted["data"], [{"url": "https://cdn.example/cat.png", "revised_prompt": "cat"}])

    def test_url_response_falls_back_to_b64_when_no_record_url(self):
        result = {"created": 1, "data": [{"b64_json": "abc"}]}

        formatted = format_image_api_result(result, [], "url")

        self.assertEqual(formatted["data"], [{"b64_json": "abc", "revised_prompt": ""}])


if __name__ == "__main__":
    unittest.main()
