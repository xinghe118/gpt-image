from __future__ import annotations

import unittest
from unittest import mock

from services.conversation_service import ConversationService
from services.project_service import ProjectService


class FakeProjectStore:
    def __init__(self) -> None:
        self.projects: list[dict[str, object]] = []
        self.conversations: list[dict[str, object]] = []
        self.deleted_conversations: list[str] = []

    def load_projects(self):
        return list(self.projects)

    def save_projects(self, items):
        self.projects = list(items)

    def load_conversations(self):
        return list(self.conversations)

    def save_conversations(self, items):
        self.conversations = list(items)

    def delete_conversation(self, conversation_id):
        self.deleted_conversations.append(conversation_id)

    def project_stats(self, **kwargs):
        return {}


class ProjectPermissionTests(unittest.TestCase):
    def setUp(self) -> None:
        self.store = FakeProjectStore()
        self.project_service = ProjectService()
        self.conversation_service = ConversationService()
        self.project_store_patcher = mock.patch("services.project_service.app_data_store", self.store)
        self.conversation_store_patcher = mock.patch("services.conversation_service.app_data_store", self.store)
        self.conversation_project_patcher = mock.patch("services.conversation_service.project_service", self.project_service)
        self.project_store_patcher.start()
        self.conversation_store_patcher.start()
        self.conversation_project_patcher.start()
        self.addCleanup(self.project_store_patcher.stop)
        self.addCleanup(self.conversation_store_patcher.stop)
        self.addCleanup(self.conversation_project_patcher.stop)

    @staticmethod
    def identity(subject_id: str) -> dict[str, object]:
        return {"id": subject_id, "name": subject_id, "role": "user"}

    def test_user_cannot_update_another_users_project(self):
        owner = self.identity("user-a")
        intruder = self.identity("user-b")
        project = self.project_service.create_project(owner, "客户项目")

        with self.assertRaises(PermissionError):
            self.project_service.update_project(intruder, str(project["id"]), name="越权修改")

    def test_user_cannot_upsert_another_users_conversation_id(self):
        owner = self.identity("user-a")
        intruder = self.identity("user-b")
        self.conversation_service.upsert_conversation(
            owner,
            {"id": "conversation-1", "title": "用户 A 的对话", "turns": []},
        )

        with self.assertRaises(PermissionError):
            self.conversation_service.upsert_conversation(
                intruder,
                {"id": "conversation-1", "title": "用户 B 尝试覆盖", "turns": []},
            )

    def test_user_only_lists_own_conversations(self):
        owner = self.identity("user-a")
        other = self.identity("user-b")
        self.conversation_service.upsert_conversation(owner, {"id": "conversation-a", "title": "A", "turns": []})
        self.conversation_service.upsert_conversation(other, {"id": "conversation-b", "title": "B", "turns": []})

        items = self.conversation_service.list_conversations(owner)

        self.assertEqual([item["id"] for item in items], ["conversation-a"])


if __name__ == "__main__":
    unittest.main()
