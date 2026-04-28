from __future__ import annotations

import unittest

from services.openai_backend_api import OpenAIBackendAPI


class OpenAIBackendImageReferenceTests(unittest.TestCase):
    def test_extracts_image_refs_from_assistant_attachments(self) -> None:
        client = OpenAIBackendAPI("test-token")
        conversation = {
            "mapping": {
                "node-1": {
                    "message": {
                        "author": {"role": "assistant"},
                        "create_time": 1,
                        "metadata": {
                            "attachments": [
                                {"asset_pointer": "file-service://file-abc_123"},
                                {"asset_pointer": "sediment://att-xyz"},
                            ]
                        },
                        "content": {
                            "content_type": "multimodal_text",
                            "parts": [{"asset_pointer": "file-service://file-def_456"}],
                        },
                    }
                }
            }
        }

        records = client._extract_image_tool_records(conversation)

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0]["file_ids"], ["file-abc_123", "file-def_456"])
        self.assertEqual(records[0]["sediment_ids"], ["att-xyz"])

    def test_extracts_direct_image_urls_from_nested_payload(self) -> None:
        client = OpenAIBackendAPI("test-token")
        file_ids, sediment_ids, direct_urls = client._extract_image_references(
            {
                "result": {
                    "download_url": "https://example.com/files/image.png?sig=1",
                    "text": "not an image https://example.com/home",
                }
            }
        )

        self.assertEqual(file_ids, [])
        self.assertEqual(sediment_ids, [])
        self.assertEqual(direct_urls, ["https://example.com/files/image.png?sig=1"])

    def test_extracts_failure_reason_from_conversation(self) -> None:
        client = OpenAIBackendAPI("test-token")
        conversation = {
            "mapping": {
                "node-1": {
                    "message": {
                        "author": {"role": "assistant"},
                        "create_time": 1,
                        "metadata": {"status": "failed"},
                        "content": {"parts": ["Cannot create the requested image."]},
                    }
                }
            }
        }

        reason = client._extract_image_failure_reason(conversation)

        self.assertIn("failed", reason)
        self.assertIn("Cannot create", reason)


if __name__ == "__main__":
    unittest.main()
