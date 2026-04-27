from __future__ import annotations

import base64
import binascii
import io
import uuid
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any

from PIL import Image

from services.app_data_store import app_data_store
from services.config import config
from services.project_service import project_service


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ImageLibraryService:
    def __init__(self):
        self._lock = Lock()

    @staticmethod
    def _clean(value: object) -> str:
        return str(value or "").strip()

    def _load(self) -> list[dict[str, Any]]:
        data = app_data_store.load_document("library", {"items": []})
        if isinstance(data, dict):
            data = data.get("items")
        return data if isinstance(data, list) else []

    def _save(self, items: list[dict[str, Any]]) -> None:
        app_data_store.save_document("library", {"items": items})

    @staticmethod
    def _image_url(record_id: str) -> str:
        return f"/images/library/{record_id}.png"

    @staticmethod
    def _image_path(record_id: str) -> Path:
        return config.images_dir / "library" / f"{record_id}.png"

    @staticmethod
    def _thumb_url(record_id: str) -> str:
        return f"/images/library/thumbs/{record_id}.webp"

    @staticmethod
    def _thumb_path(record_id: str) -> Path:
        return config.images_dir / "library" / "thumbs" / f"{record_id}.webp"

    def _decode_image(self, b64_json: str) -> bytes:
        value = self._clean(b64_json)
        if value.startswith("data:"):
            _, _, value = value.partition(",")
        try:
            return base64.b64decode(value)
        except (binascii.Error, ValueError) as exc:
            raise ValueError("invalid base64 image data") from exc

    def _persist_image(self, record_id: str, b64_json: str) -> str:
        image_data = self._decode_image(b64_json)
        path = self._image_path(record_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(image_data)
        return self._image_url(record_id)

    def _persist_thumb(self, record_id: str, b64_json: str) -> str:
        image_data = self._decode_image(b64_json)
        path = self._thumb_path(record_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with Image.open(io.BytesIO(image_data)) as image:
                image.thumbnail((640, 640))
                if image.mode not in {"RGB", "RGBA"}:
                    image = image.convert("RGB")
                image.save(path, format="WEBP", quality=78, method=4)
        except Exception as exc:
            raise ValueError("invalid image data") from exc
        return self._thumb_url(record_id)

    def _public_item(self, item: dict[str, Any]) -> dict[str, Any]:
        public_item = {key: value for key, value in item.items() if key != "b64_json"}
        public_item["image_url"] = self._clean(public_item.get("image_url")) or self._image_url(self._clean(item.get("id")))
        public_item["thumb_url"] = self._clean(public_item.get("thumb_url")) or self._clean(public_item.get("image_url"))
        return public_item

    def _materialize_legacy_images(self, items: list[dict[str, Any]]) -> bool:
        changed = False
        for item in items:
            record_id = self._clean(item.get("id"))
            b64_json = self._clean(item.get("b64_json"))
            if not record_id or not b64_json:
                continue
            try:
                item["image_url"] = self._persist_image(record_id, b64_json)
                item["thumb_url"] = self._persist_thumb(record_id, b64_json)
            except ValueError:
                continue
            item.pop("b64_json", None)
            changed = True
        return changed

    def record_images(
        self,
        *,
        identity: dict[str, object],
        prompt: str,
        model: str,
        mode: str,
        size: str | None,
        images: list[dict[str, object]],
        project_id: str | None = None,
    ) -> list[dict[str, Any]]:
        subject_id = self._clean(identity.get("id")) or "anonymous"
        subject_name = self._clean(identity.get("name")) or subject_id
        role = self._clean(identity.get("role")) or "user"
        project = project_service.touch_project(identity, project_id)
        normalized_project_id = self._clean(project.get("id")) or project_service.DEFAULT_PROJECT_ID
        project_name = self._clean(project.get("name")) or "默认项目"
        created_at = _now_iso()
        records: list[dict[str, Any]] = []
        for index, image in enumerate(images):
            b64_json = self._clean(image.get("b64_json") if isinstance(image, dict) else "")
            if not b64_json:
                continue
            record_id = uuid.uuid4().hex
            try:
                image_url = self._persist_image(record_id, b64_json)
                thumb_url = self._persist_thumb(record_id, b64_json)
            except ValueError:
                continue
            records.append(
                {
                    "id": record_id,
                    "subject_id": subject_id,
                    "subject_name": subject_name,
                    "role": role,
                    "project_id": normalized_project_id,
                    "project_name": project_name,
                    "prompt": prompt,
                    "model": model,
                    "mode": mode,
                    "size": size or "",
                    "created_at": created_at,
                    "index": index,
                    "image_url": image_url,
                    "thumb_url": thumb_url,
                    "revised_prompt": self._clean(image.get("revised_prompt") if isinstance(image, dict) else ""),
                }
            )
        if not records:
            return []
        with self._lock:
            items = self._load()
            self._save([*records, *items])
        return records

    def list_images(
        self,
        *,
        identity: dict[str, object],
        limit: int = 300,
        offset: int = 0,
        query: str = "",
        mode: str = "",
        project_id: str = "",
    ) -> dict[str, Any]:
        subject_id = self._clean(identity.get("id"))
        is_admin = identity.get("role") == "admin"
        limit = max(1, min(100, int(limit or 48)))
        offset = max(0, int(offset or 0))
        normalized_query = self._clean(query).lower()
        normalized_mode = self._clean(mode).lower()
        normalized_project_id = self._clean(project_id)
        with self._lock:
            items = self._load()
            visible_items = items if is_admin else [item for item in items if self._clean(item.get("subject_id")) == subject_id]
            if normalized_project_id:
                visible_items = [
                    item
                    for item in visible_items
                    if self._clean(item.get("project_id") or project_service.DEFAULT_PROJECT_ID) == normalized_project_id
                ]
            if normalized_mode:
                visible_items = [item for item in visible_items if self._clean(item.get("mode")).lower() == normalized_mode]
            if normalized_query:
                visible_items = [
                    item
                    for item in visible_items
                    if normalized_query
                    in " ".join(
                        [
                            self._clean(item.get("prompt")),
                            self._clean(item.get("model")),
                            self._clean(item.get("size")),
                            self._clean(item.get("subject_name")),
                            self._clean(item.get("project_name")),
                        ]
                    ).lower()
                ]
            total = len(visible_items)
            limited_items = visible_items[offset: offset + limit]
            if self._materialize_legacy_images(limited_items):
                self._save(items)
        return {
            "items": [self._public_item(item) for item in limited_items],
            "total": total,
            "limit": limit,
            "offset": offset,
            "has_more": offset + limit < total,
        }

    def move_image_to_project(
        self,
        *,
        identity: dict[str, object],
        image_id: str,
        project_id: str,
    ) -> dict[str, Any] | None:
        record_id = self._clean(image_id)
        subject_id = self._clean(identity.get("id"))
        is_admin = identity.get("role") == "admin"
        project = project_service.touch_project(identity, project_id)
        normalized_project_id = self._clean(project.get("id")) or project_service.DEFAULT_PROJECT_ID
        project_name = self._clean(project.get("name")) or "默认项目"
        with self._lock:
            items = self._load()
            updated: dict[str, Any] | None = None
            for item in items:
                if self._clean(item.get("id")) != record_id:
                    continue
                if not is_admin and self._clean(item.get("subject_id")) != subject_id:
                    raise PermissionError("image permission denied")
                item["project_id"] = normalized_project_id
                item["project_name"] = project_name
                updated = self._public_item(item)
                break
            if updated is None:
                return None
            self._save(items)
            return updated


image_library_service = ImageLibraryService()
