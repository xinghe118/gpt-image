from __future__ import annotations

import hashlib
import hmac
import secrets
import uuid
from datetime import datetime, timezone
from threading import Lock
from typing import Literal

from services.config import config
from services.storage.base import StorageBackend

AuthRole = Literal["admin", "user"]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _hash_key(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


class AuthService:
    def __init__(self, storage: StorageBackend):
        self.storage = storage
        self._lock = Lock()
        self._items = self._load()
        self._last_used_flush_at: dict[str, datetime] = {}

    @staticmethod
    def _clean(value: object) -> str:
        return str(value or "").strip()

    @staticmethod
    def _normalize_quota_limit(value: object) -> int | None:
        if value is None or value == "":
            return None
        try:
            number = int(value)
        except (TypeError, ValueError):
            return None
        return max(0, number)

    @staticmethod
    def _normalize_quota_used(value: object) -> int:
        try:
            number = int(value)
        except (TypeError, ValueError):
            return 0
        return max(0, number)

    def _normalize_item(self, raw: object) -> dict[str, object] | None:
        if not isinstance(raw, dict):
            return None
        role = self._clean(raw.get("role")).lower()
        if role not in {"admin", "user"}:
            return None
        key_hash = self._clean(raw.get("key_hash"))
        if not key_hash:
            return None
        item_id = self._clean(raw.get("id")) or uuid.uuid4().hex[:12]
        name = self._clean(raw.get("name")) or ("管理员密钥" if role == "admin" else "普通用户")
        created_at = self._clean(raw.get("created_at")) or _now_iso()
        last_used_at = self._clean(raw.get("last_used_at")) or None
        quota_limit = self._normalize_quota_limit(raw.get("quota_limit"))
        quota_used = min(self._normalize_quota_used(raw.get("quota_used")), quota_limit) if quota_limit is not None else self._normalize_quota_used(raw.get("quota_used"))
        return {
            "id": item_id,
            "name": name,
            "role": role,
            "key_hash": key_hash,
            "enabled": bool(raw.get("enabled", True)),
            "created_at": created_at,
            "last_used_at": last_used_at,
            "quota_limit": quota_limit,
            "quota_used": quota_used,
        }

    def _load(self) -> list[dict[str, object]]:
        try:
            items = self.storage.load_auth_keys()
        except Exception:
            return []
        if not isinstance(items, list):
            return []
        return [normalized for item in items if (normalized := self._normalize_item(item)) is not None]

    def _save(self) -> None:
        self.storage.save_auth_keys(self._items)

    @staticmethod
    def _public_item(item: dict[str, object]) -> dict[str, object]:
        quota_limit = AuthService._normalize_quota_limit(item.get("quota_limit"))
        quota_used = AuthService._normalize_quota_used(item.get("quota_used"))
        quota_remaining = None if quota_limit is None else max(0, quota_limit - quota_used)
        return {
            "id": item.get("id"),
            "name": item.get("name"),
            "role": item.get("role"),
            "enabled": bool(item.get("enabled", True)),
            "created_at": item.get("created_at"),
            "last_used_at": item.get("last_used_at"),
            "quota_limit": quota_limit,
            "quota_used": quota_used,
            "quota_remaining": quota_remaining,
        }

    def list_keys(self, role: AuthRole | None = None) -> list[dict[str, object]]:
        with self._lock:
            items = [item for item in self._items if role is None or item.get("role") == role]
            return [self._public_item(item) for item in items]

    def create_key(self, *, role: AuthRole, name: str = "", quota_limit: int | None = None) -> tuple[dict[str, object], str]:
        normalized_name = self._clean(name) or ("管理员密钥" if role == "admin" else "普通用户")
        normalized_quota_limit = self._normalize_quota_limit(quota_limit)
        raw_key = f"sk-{secrets.token_urlsafe(24)}"
        item = {
            "id": uuid.uuid4().hex[:12],
            "name": normalized_name,
            "role": role,
            "key_hash": _hash_key(raw_key),
            "enabled": True,
            "created_at": _now_iso(),
            "last_used_at": None,
            "quota_limit": normalized_quota_limit,
            "quota_used": 0,
        }
        with self._lock:
            self._items.append(item)
            self._save()
            return self._public_item(item), raw_key

    def update_key(
        self,
        key_id: str,
        updates: dict[str, object],
        *,
        role: AuthRole | None = None,
    ) -> dict[str, object] | None:
        normalized_id = self._clean(key_id)
        if not normalized_id:
            return None
        with self._lock:
            for index, item in enumerate(self._items):
                if item.get("id") != normalized_id:
                    continue
                if role is not None and item.get("role") != role:
                    return None
                next_item = dict(item)
                if "name" in updates and updates.get("name") is not None:
                    next_item["name"] = self._clean(updates.get("name")) or next_item.get("name") or "普通用户"
                if "enabled" in updates and updates.get("enabled") is not None:
                    next_item["enabled"] = bool(updates.get("enabled"))
                if "quota_limit" in updates:
                    next_item["quota_limit"] = self._normalize_quota_limit(updates.get("quota_limit"))
                if "quota_used" in updates and updates.get("quota_used") is not None:
                    next_item["quota_used"] = self._normalize_quota_used(updates.get("quota_used"))
                quota_limit = self._normalize_quota_limit(next_item.get("quota_limit"))
                if quota_limit is not None:
                    next_item["quota_used"] = min(self._normalize_quota_used(next_item.get("quota_used")), quota_limit)
                self._items[index] = next_item
                self._save()
                return self._public_item(next_item)
        return None

    def ensure_quota_available(self, identity: dict[str, object], amount: int) -> None:
        if identity.get("role") != "user":
            return
        required = max(1, int(amount or 1))
        item_id = self._clean(identity.get("id"))
        with self._lock:
            for item in self._items:
                if item.get("id") != item_id:
                    continue
                quota_limit = self._normalize_quota_limit(item.get("quota_limit"))
                if quota_limit is None:
                    return
                quota_used = self._normalize_quota_used(item.get("quota_used"))
                if quota_limit - quota_used < required:
                    raise ValueError("user key quota exhausted")
                return
        raise ValueError("user key not found")

    def consume_quota(self, identity: dict[str, object], amount: int) -> dict[str, object] | None:
        if identity.get("role") != "user":
            return None
        used_amount = max(1, int(amount or 1))
        item_id = self._clean(identity.get("id"))
        with self._lock:
            for index, item in enumerate(self._items):
                if item.get("id") != item_id:
                    continue
                next_item = dict(item)
                next_item["quota_used"] = self._normalize_quota_used(next_item.get("quota_used")) + used_amount
                quota_limit = self._normalize_quota_limit(next_item.get("quota_limit"))
                if quota_limit is not None:
                    next_item["quota_used"] = min(self._normalize_quota_used(next_item.get("quota_used")), quota_limit)
                self._items[index] = next_item
                self._save()
                return self._public_item(next_item)
        return None

    def delete_key(self, key_id: str, *, role: AuthRole | None = None) -> bool:
        normalized_id = self._clean(key_id)
        if not normalized_id:
            return False
        with self._lock:
            before = len(self._items)
            self._items = [
                item
                for item in self._items
                if not (item.get("id") == normalized_id and (role is None or item.get("role") == role))
            ]
            if len(self._items) == before:
                return False
            self._save()
            return True

    def authenticate(self, raw_key: str) -> dict[str, object] | None:
        candidate = self._clean(raw_key)
        if not candidate:
            return None
        candidate_hash = _hash_key(candidate)
        with self._lock:
            for index, item in enumerate(self._items):
                if not bool(item.get("enabled", True)):
                    continue
                stored_hash = self._clean(item.get("key_hash"))
                if not stored_hash or not hmac.compare_digest(stored_hash, candidate_hash):
                    continue
                next_item = dict(item)
                now = datetime.now(timezone.utc)
                next_item["last_used_at"] = now.isoformat()
                self._items[index] = next_item
                item_id = self._clean(next_item.get("id"))
                last_flush_at = self._last_used_flush_at.get(item_id)
                if last_flush_at is None or (now - last_flush_at).total_seconds() >= 60:
                    try:
                        self._save()
                        self._last_used_flush_at[item_id] = now
                    except Exception:
                        pass
                return self._public_item(next_item)
        return None


auth_service = AuthService(config.get_storage_backend())
