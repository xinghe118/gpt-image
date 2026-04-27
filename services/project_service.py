from __future__ import annotations

import uuid
from datetime import datetime, timezone
from threading import Lock
from typing import Any

from services.app_data_store import app_data_store


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ProjectService:
    DEFAULT_PROJECT_ID = "default"

    def __init__(self) -> None:
        self._lock = Lock()

    @staticmethod
    def _clean(value: object) -> str:
        return str(value or "").strip()

    def _load(self) -> list[dict[str, Any]]:
        data = app_data_store.load_document("projects", {"items": []})
        if isinstance(data, dict):
            data = data.get("items")
        return data if isinstance(data, list) else []

    def _save(self, items: list[dict[str, Any]]) -> None:
        app_data_store.save_document("projects", {"items": items})

    def default_project(self, identity: dict[str, object]) -> dict[str, Any]:
        subject_id = self._clean(identity.get("id")) or "anonymous"
        subject_name = self._clean(identity.get("name")) or subject_id
        return {
            "id": self.DEFAULT_PROJECT_ID,
            "subject_id": subject_id,
            "subject_name": subject_name,
            "name": "默认项目",
            "description": "未分组的历史内容会自动归到这里。",
            "created_at": _now_iso(),
            "updated_at": _now_iso(),
            "archived": False,
            "is_default": True,
        }

    def _public_item(self, item: dict[str, Any]) -> dict[str, Any]:
        return {
            "id": self._clean(item.get("id")) or self.DEFAULT_PROJECT_ID,
            "subject_id": self._clean(item.get("subject_id")),
            "subject_name": self._clean(item.get("subject_name")),
            "name": self._clean(item.get("name")) or "未命名项目",
            "description": self._clean(item.get("description")),
            "created_at": self._clean(item.get("created_at")),
            "updated_at": self._clean(item.get("updated_at")),
            "archived": bool(item.get("archived")),
            "is_default": bool(item.get("is_default")),
        }

    def ensure_project(self, identity: dict[str, object], project_id: str | None = None) -> dict[str, Any]:
        normalized_id = self._clean(project_id) or self.DEFAULT_PROJECT_ID
        if normalized_id == self.DEFAULT_PROJECT_ID:
            return self.default_project(identity)

        subject_id = self._clean(identity.get("id"))
        is_admin = identity.get("role") == "admin"
        with self._lock:
            for item in self._load():
                if self._clean(item.get("id")) != normalized_id:
                    continue
                if is_admin or self._clean(item.get("subject_id")) == subject_id:
                    return self._public_item(item)
                break
        return self.default_project(identity)

    def list_projects(self, identity: dict[str, object]) -> list[dict[str, Any]]:
        subject_id = self._clean(identity.get("id"))
        is_admin = identity.get("role") == "admin"
        with self._lock:
            items = self._load()
        visible = items if is_admin else [item for item in items if self._clean(item.get("subject_id")) == subject_id]
        default = self.default_project(identity)
        result = [default, *[self._public_item(item) for item in visible if not bool(item.get("archived"))]]
        seen: set[str] = set()
        unique: list[dict[str, Any]] = []
        for item in result:
            project_id = self._clean(item.get("id"))
            if project_id and project_id not in seen:
                seen.add(project_id)
                unique.append(item)
        return sorted(unique, key=lambda item: str(item.get("updated_at") or ""), reverse=True)

    def create_project(self, identity: dict[str, object], name: str, description: str = "") -> dict[str, Any]:
        clean_name = self._clean(name)
        if not clean_name:
            raise ValueError("project name is required")
        now = _now_iso()
        item = {
            "id": uuid.uuid4().hex,
            "subject_id": self._clean(identity.get("id")) or "anonymous",
            "subject_name": self._clean(identity.get("name")) or self._clean(identity.get("id")) or "anonymous",
            "name": clean_name[:80],
            "description": self._clean(description)[:300],
            "created_at": now,
            "updated_at": now,
            "archived": False,
            "is_default": False,
        }
        with self._lock:
            items = self._load()
            self._save([item, *items])
        return self._public_item(item)

    def update_project(
        self,
        identity: dict[str, object],
        project_id: str,
        *,
        name: str | None = None,
        description: str | None = None,
        archived: bool | None = None,
    ) -> dict[str, Any] | None:
        normalized_id = self._clean(project_id)
        if not normalized_id or normalized_id == self.DEFAULT_PROJECT_ID:
            raise ValueError("default project cannot be modified")
        subject_id = self._clean(identity.get("id"))
        is_admin = identity.get("role") == "admin"
        now = _now_iso()
        with self._lock:
            items = self._load()
            updated: dict[str, Any] | None = None
            for item in items:
                if self._clean(item.get("id")) != normalized_id:
                    continue
                if not is_admin and self._clean(item.get("subject_id")) != subject_id:
                    raise PermissionError("project permission denied")
                if name is not None:
                    clean_name = self._clean(name)
                    if not clean_name:
                        raise ValueError("project name is required")
                    item["name"] = clean_name[:80]
                if description is not None:
                    item["description"] = self._clean(description)[:300]
                if archived is not None:
                    item["archived"] = bool(archived)
                item["updated_at"] = now
                updated = self._public_item(item)
                break
            if updated is None:
                return None
            self._save(items)
            return updated

    def touch_project(self, identity: dict[str, object], project_id: str | None) -> dict[str, Any]:
        normalized_id = self._clean(project_id)
        project = self.ensure_project(identity, normalized_id)
        if project.get("is_default"):
            return project
        now = _now_iso()
        with self._lock:
            items = self._load()
            for item in items:
                if self._clean(item.get("id")) == self._clean(project.get("id")):
                    item["updated_at"] = now
                    project = self._public_item(item)
                    break
            self._save(items)
        return project


project_service = ProjectService()
