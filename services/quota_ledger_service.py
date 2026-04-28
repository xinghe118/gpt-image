from __future__ import annotations

import time
import uuid
from threading import Lock
from typing import Any

from services.app_data_store import app_data_store


class QuotaLedgerService:
    def __init__(self) -> None:
        self._lock = Lock()

    @staticmethod
    def _clean(value: object, limit: int = 240) -> str:
        text = str(value or "").strip().replace("\r", " ").replace("\n", " ")
        return text if len(text) <= limit else text[:limit] + "..."

    def _load(self) -> list[dict[str, Any]]:
        data = app_data_store.load_document("quota_ledger", {"items": []})
        if isinstance(data, dict):
            data = data.get("items")
        return data if isinstance(data, list) else []

    def _save(self, items: list[dict[str, Any]]) -> None:
        app_data_store.save_document("quota_ledger", {"items": items[-10000:]})

    def record_charge(
        self,
        *,
        identity: dict[str, object],
        amount: int,
        event: str,
        model: str = "",
        mode: str = "",
        project_id: str = "",
        prompt: object = "",
        status: str = "charged",
        reason: str = "image_success",
    ) -> dict[str, Any]:
        item = {
            "id": uuid.uuid4().hex,
            "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "subject_id": self._clean(identity.get("id"), 120),
            "subject_name": self._clean(identity.get("name"), 120),
            "role": self._clean(identity.get("role"), 40),
            "plan": self._clean(identity.get("plan"), 40),
            "plan_label": self._clean(identity.get("plan_label"), 80),
            "amount": max(0, int(amount or 0)),
            "status": self._clean(status, 40),
            "reason": self._clean(reason, 80),
            "event": self._clean(event, 80),
            "model": self._clean(model, 80),
            "mode": self._clean(mode, 40),
            "project_id": self._clean(project_id, 120),
            "prompt_preview": self._clean(prompt),
        }
        with self._lock:
            items = self._load()
            items.append(item)
            self._save(items)
        return item

    def list_entries(
        self,
        *,
        identity: dict[str, object],
        limit: int = 100,
        offset: int = 0,
        subject_id: str = "",
        query: str = "",
    ) -> dict[str, Any]:
        limit = max(1, min(int(limit or 100), 500))
        offset = max(0, int(offset or 0))
        is_admin = identity.get("role") == "admin"
        normalized_subject = self._clean(subject_id, 120)
        normalized_query = self._clean(query, 120).lower()
        with self._lock:
            raw_items = list(reversed(self._load()))
        matched = 0
        items: list[dict[str, Any]] = []
        for item in raw_items:
            item_subject = self._clean(item.get("subject_id"), 120)
            if not is_admin and item_subject != self._clean(identity.get("id"), 120):
                continue
            if is_admin and normalized_subject and item_subject != normalized_subject:
                continue
            if normalized_query and normalized_query not in str(item).lower():
                continue
            if matched >= offset and len(items) < limit:
                items.append(item)
            matched += 1
            if matched > offset + limit:
                break
        return {"items": items, "limit": limit, "offset": offset, "has_more": matched > offset + len(items)}

    def summary(self, *, identity: dict[str, object]) -> dict[str, Any]:
        is_admin = identity.get("role") == "admin"
        subject_id = self._clean(identity.get("id"), 120)
        with self._lock:
            items = self._load()
        scoped = [item for item in items if is_admin or self._clean(item.get("subject_id"), 120) == subject_id]
        total_amount = sum(int(item.get("amount") or 0) for item in scoped)
        by_subject: dict[str, dict[str, Any]] = {}
        by_model: dict[str, int] = {}
        for item in scoped:
            amount = int(item.get("amount") or 0)
            subject = self._clean(item.get("subject_id"), 120) or "unknown"
            bucket = by_subject.setdefault(
                subject,
                {
                    "subject_id": subject,
                    "subject_name": self._clean(item.get("subject_name"), 120) or subject,
                    "amount": 0,
                    "count": 0,
                },
            )
            bucket["amount"] += amount
            bucket["count"] += 1
            model = self._clean(item.get("model"), 80) or "unknown"
            by_model[model] = by_model.get(model, 0) + amount
        return {
            "total_amount": total_amount,
            "total_entries": len(scoped),
            "scope": "all" if is_admin else "own",
            "by_subject": sorted(by_subject.values(), key=lambda item: int(item.get("amount") or 0), reverse=True)[:20],
            "by_model": dict(sorted(by_model.items(), key=lambda item: item[1], reverse=True)[:10]),
            "latest": list(reversed(scoped[-10:])),
        }


quota_ledger_service = QuotaLedgerService()
