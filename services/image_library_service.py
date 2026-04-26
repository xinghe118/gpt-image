from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock
from typing import Any

from services.config import DATA_DIR


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ImageLibraryService:
    def __init__(self, path: Path | None = None):
        self.path = path or DATA_DIR / "library.json"
        self._lock = Lock()
        self.path.parent.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _clean(value: object) -> str:
        return str(value or "").strip()

    def _load(self) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except Exception:
            return []
        if isinstance(data, dict):
            data = data.get("items")
        return data if isinstance(data, list) else []

    def _save(self, items: list[dict[str, Any]]) -> None:
        self.path.write_text(json.dumps({"items": items}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

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
            records.append(
                {
                    "id": uuid.uuid4().hex,
                    "subject_id": subject_id,
                    "subject_name": subject_name,
                    "role": role,
                    "prompt": prompt,
                    "model": model,
                    "mode": mode,
                    "size": size or "",
                    "created_at": created_at,
                    "index": index,
                    "b64_json": b64_json,
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
        return visible_items[: max(1, min(1000, int(limit or 300)))]


image_library_service = ImageLibraryService()
