from __future__ import annotations

from datetime import datetime, timezone
from threading import Lock
from typing import Any

from services.app_data_store import app_data_store
from services.project_service import project_service


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ConversationService:
    def __init__(self) -> None:
        self._lock = Lock()

    @staticmethod
    def _clean(value: object) -> str:
        return str(value or "").strip()

    def _load(self) -> list[dict[str, Any]]:
        data = app_data_store.load_document("conversations", {"items": []})
        if isinstance(data, dict):
            data = data.get("items")
        return data if isinstance(data, list) else []

    def _save(self, items: list[dict[str, Any]]) -> None:
        app_data_store.save_document("conversations", {"items": items})

    def _public_item(self, item: dict[str, Any]) -> dict[str, Any]:
        project_id = self._clean(item.get("project_id") or item.get("projectId")) or project_service.DEFAULT_PROJECT_ID
        return {
            "id": self._clean(item.get("id")),
            "projectId": project_id,
            "project_id": project_id,
            "project_name": self._clean(item.get("project_name")) or "默认项目",
            "subject_id": self._clean(item.get("subject_id")),
            "subject_name": self._clean(item.get("subject_name")),
            "role": self._clean(item.get("role")) or "user",
            "title": self._clean(item.get("title")) or "未命名对话",
            "createdAt": self._clean(item.get("createdAt") or item.get("created_at")) or _now_iso(),
            "updatedAt": self._clean(item.get("updatedAt") or item.get("updated_at")) or _now_iso(),
            "turns": item.get("turns") if isinstance(item.get("turns"), list) else [],
        }

    def _normalize_item(self, identity: dict[str, object], item: dict[str, Any]) -> dict[str, Any] | None:
        conversation_id = self._clean(item.get("id"))
        if not conversation_id:
            return None
        is_admin = identity.get("role") == "admin"
        subject_id = (
            self._clean(item.get("subject_id"))
            if is_admin and self._clean(item.get("subject_id"))
            else self._clean(identity.get("id")) or "anonymous"
        )
        subject_name = (
            self._clean(item.get("subject_name"))
            if is_admin and self._clean(item.get("subject_name"))
            else self._clean(identity.get("name")) or subject_id
        )
        role = self._clean(item.get("role")) if is_admin and self._clean(item.get("role")) else self._clean(identity.get("role")) or "user"
        project = project_service.ensure_project(identity, self._clean(item.get("projectId") or item.get("project_id")))
        now = _now_iso()
        created_at = self._clean(item.get("createdAt") or item.get("created_at")) or now
        updated_at = self._clean(item.get("updatedAt") or item.get("updated_at")) or created_at
        return {
            "id": conversation_id,
            "subject_id": subject_id,
            "subject_name": subject_name,
            "role": role,
            "project_id": self._clean(project.get("id")) or project_service.DEFAULT_PROJECT_ID,
            "project_name": self._clean(project.get("name")) or "默认项目",
            "title": self._clean(item.get("title")) or "未命名对话",
            "createdAt": created_at,
            "updatedAt": updated_at,
            "turns": item.get("turns") if isinstance(item.get("turns"), list) else [],
        }

    def list_conversations(
        self,
        identity: dict[str, object],
        *,
        project_id: str = "",
        limit: int = 500,
    ) -> list[dict[str, Any]]:
        subject_id = self._clean(identity.get("id"))
        is_admin = identity.get("role") == "admin"
        normalized_project_id = self._clean(project_id)
        limit = max(1, min(1000, int(limit or 500)))
        with self._lock:
            items = self._load()
        visible = items if is_admin else [item for item in items if self._clean(item.get("subject_id")) == subject_id]
        if normalized_project_id:
            visible = [
                item
                for item in visible
                if self._clean(item.get("project_id") or item.get("projectId") or project_service.DEFAULT_PROJECT_ID)
                == normalized_project_id
            ]
        return sorted(
            [self._public_item(item) for item in visible if self._clean(item.get("id"))],
            key=lambda item: str(item.get("updatedAt") or ""),
            reverse=True,
        )[:limit]

    def save_conversations(self, identity: dict[str, object], conversations: list[dict[str, Any]]) -> list[dict[str, Any]]:
        subject_id = self._clean(identity.get("id"))
        is_admin = identity.get("role") == "admin"
        normalized_items = [
            item
            for source in conversations
            if isinstance(source, dict)
            for item in [self._normalize_item(identity, source)]
            if item is not None
        ]
        incoming_ids = {self._clean(item.get("id")) for item in normalized_items}
        with self._lock:
            existing = self._load()
            protected_ids = {
                self._clean(item.get("id"))
                for item in existing
                if self._clean(item.get("id")) in incoming_ids
                and not is_admin
                and self._clean(item.get("subject_id")) != subject_id
            }
            allowed_items = [item for item in normalized_items if self._clean(item.get("id")) not in protected_ids]
            allowed_ids = {self._clean(item.get("id")) for item in allowed_items}
            kept = [item for item in existing if self._clean(item.get("id")) not in allowed_ids]
            self._save([*allowed_items, *kept])
        return self.list_conversations(identity)

    def upsert_conversation(self, identity: dict[str, object], conversation: dict[str, Any]) -> dict[str, Any]:
        item = self._normalize_item(identity, conversation)
        if item is None:
            raise ValueError("conversation id is required")
        subject_id = self._clean(identity.get("id"))
        is_admin = identity.get("role") == "admin"
        with self._lock:
            items = self._load()
            next_items: list[dict[str, Any]] = []
            replaced = False
            for existing in items:
                if self._clean(existing.get("id")) != self._clean(item.get("id")):
                    next_items.append(existing)
                    continue
                if not is_admin and self._clean(existing.get("subject_id")) != subject_id:
                    raise PermissionError("conversation permission denied")
                next_items.append(item)
                replaced = True
            if not replaced:
                next_items.insert(0, item)
            self._save(next_items)
        return self._public_item(item)

    def delete_conversation(self, identity: dict[str, object], conversation_id: str) -> bool:
        normalized_id = self._clean(conversation_id)
        subject_id = self._clean(identity.get("id"))
        is_admin = identity.get("role") == "admin"
        deleted = False
        with self._lock:
            items = self._load()
            next_items = []
            for item in items:
                if self._clean(item.get("id")) != normalized_id:
                    next_items.append(item)
                    continue
                if not is_admin and self._clean(item.get("subject_id")) != subject_id:
                    raise PermissionError("conversation permission denied")
                deleted = True
            if deleted:
                self._save(next_items)
        return deleted


conversation_service = ConversationService()
