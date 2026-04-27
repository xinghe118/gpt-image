from __future__ import annotations

import base64
import binascii
import uuid
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any

from services.app_data_store import app_data_store
from services.config import config


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

    def _public_item(self, item: dict[str, Any]) -> dict[str, Any]:
        public_item = {key: value for key, value in item.items() if key != "b64_json"}
        public_item["image_url"] = self._clean(public_item.get("image_url")) or self._image_url(self._clean(item.get("id")))
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
    ) -> list[dict[str, Any]]:
        subject_id = self._clean(identity.get("id")) or "anonymous"
        subject_name = self._clean(identity.get("name")) or subject_id
        role = self._clean(identity.get("role")) or "user"
        created_at = _now_iso()
        records: list[dict[str, Any]] = []
        for index, image in enumerate(images):
            b64_json = self._clean(image.get("b64_json") if isinstance(image, dict) else "")
            if not b64_json:
                continue
            record_id = uuid.uuid4().hex
            try:
                image_url = self._persist_image(record_id, b64_json)
            except ValueError:
                continue
            records.append(
                {
                    "id": record_id,
                    "subject_id": subject_id,
                    "subject_name": subject_name,
                    "role": role,
                    "prompt": prompt,
                    "model": model,
                    "mode": mode,
                    "size": size or "",
                    "created_at": created_at,
                    "index": index,
                    "image_url": image_url,
                    "revised_prompt": self._clean(image.get("revised_prompt") if isinstance(image, dict) else ""),
                }
            )
        if not records:
            return []
        with self._lock:
            items = self._load()
            self._save([*records, *items])
        return records

    def list_images(self, *, identity: dict[str, object], limit: int = 300) -> list[dict[str, Any]]:
        subject_id = self._clean(identity.get("id"))
        is_admin = identity.get("role") == "admin"
        with self._lock:
            items = self._load()
            visible_items = items if is_admin else [item for item in items if self._clean(item.get("subject_id")) == subject_id]
            limited_items = visible_items[: max(1, min(1000, int(limit or 300)))]
            if self._materialize_legacy_images(limited_items):
                self._save(items)
        return [self._public_item(item) for item in limited_items]


image_library_service = ImageLibraryService()
