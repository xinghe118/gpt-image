from __future__ import annotations

import json
import os
from pathlib import Path
from threading import Lock
from typing import Any

from sqlalchemy import Column, Integer, String, Text, create_engine, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

from services.config import DATA_DIR

Base = declarative_base()


class AppDocumentModel(Base):
    __tablename__ = "app_documents"

    key = Column(String(120), primary_key=True)
    data = Column(Text, nullable=False)


class ActivityLogModel(Base):
    __tablename__ = "activity_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    log_id = Column(String(80), unique=True, nullable=False, index=True)
    created_at = Column(String(40), nullable=False, index=True)
    level = Column(String(20), nullable=False, index=True)
    status = Column(String(20), nullable=False, index=True)
    event = Column(String(80), nullable=False, index=True)
    data = Column(Text, nullable=False)


def _database_url() -> str:
    configured = os.getenv("DATABASE_URL", "").strip()
    if configured:
        return configured
    return f"sqlite:///{DATA_DIR / 'accounts.db'}"


def _uses_database() -> bool:
    backend = os.getenv("STORAGE_BACKEND", "json").lower().strip()
    return backend in {"sqlite", "postgres", "postgresql", "mysql", "database"}


def _read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


class AppDataStore:
    def __init__(self) -> None:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        self._lock = Lock()
        self._database_enabled = _uses_database()
        self._engine = None
        self._session_factory = None
        if self._database_enabled:
            self._engine = create_engine(_database_url(), pool_pre_ping=True, pool_recycle=3600)
            Base.metadata.create_all(self._engine)
            self._session_factory = sessionmaker(bind=self._engine)

    @property
    def database_enabled(self) -> bool:
        return self._database_enabled

    def _session(self):
        if not self._session_factory:
            raise RuntimeError("database app data store is not enabled")
        return self._session_factory()

    def load_document(self, key: str, default: Any) -> Any:
        if not self._database_enabled:
            return _read_json(DATA_DIR / f"{key}.json", default)

        session = self._session()
        try:
            row = session.get(AppDocumentModel, key)
            if row is None:
                return default
            try:
                return json.loads(row.data)
            except Exception:
                return default
        finally:
            session.close()

    def save_document(self, key: str, data: Any) -> None:
        if not self._database_enabled:
            path = DATA_DIR / f"{key}.json"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            return

        session = self._session()
        try:
            row = session.get(AppDocumentModel, key)
            payload = json.dumps(data, ensure_ascii=False)
            if row is None:
                row = AppDocumentModel(key=key, data=payload)
                session.add(row)
            else:
                row.data = payload
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def append_activity_log(self, item: dict[str, Any]) -> None:
        if not self._database_enabled:
            path = DATA_DIR / "activity_logs.jsonl"
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps(item, ensure_ascii=False, separators=(",", ":")) + "\n")
            return

        session = self._session()
        try:
            session.add(
                ActivityLogModel(
                    log_id=str(item.get("id") or ""),
                    created_at=str(item.get("created_at") or ""),
                    level=str(item.get("level") or "info"),
                    status=str(item.get("status") or "ok"),
                    event=str(item.get("event") or ""),
                    data=json.dumps(item, ensure_ascii=False),
                )
            )
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def list_activity_logs(self, limit: int = 1000) -> list[dict[str, Any]]:
        if not self._database_enabled:
            path = DATA_DIR / "activity_logs.jsonl"
            if not path.exists():
                return []
            lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
            items: list[dict[str, Any]] = []
            for line in reversed(lines):
                try:
                    item = json.loads(line)
                except Exception:
                    continue
                if isinstance(item, dict):
                    items.append(item)
                    if len(items) >= limit:
                        break
            return items

        session = self._session()
        try:
            rows = session.query(ActivityLogModel).order_by(ActivityLogModel.id.desc()).limit(limit).all()
            items: list[dict[str, Any]] = []
            for row in rows:
                try:
                    item = json.loads(row.data)
                except Exception:
                    continue
                if isinstance(item, dict):
                    items.append(item)
            return items
        finally:
            session.close()

    def migrate_local_files_to_database(self) -> dict[str, int | str]:
        if not self._database_enabled:
            raise RuntimeError("database storage is not enabled")

        migrated: dict[str, int | str] = {
            "library": 0,
            "activity_logs": 0,
            "cpa_config": 0,
            "sub2api_config": 0,
            "backend": "database",
        }

        with self._lock:
            library = _read_json(DATA_DIR / "library.json", {})
            if isinstance(library, dict) and isinstance(library.get("items"), list):
                self.save_document("library", library)
                migrated["library"] = len(library["items"])

            cpa_config = _read_json(DATA_DIR / "cpa_config.json", [])
            if isinstance(cpa_config, (list, dict)):
                self.save_document("cpa_config", cpa_config)
                migrated["cpa_config"] = len(cpa_config) if isinstance(cpa_config, list) else 1

            sub2api_config = _read_json(DATA_DIR / "sub2api_config.json", [])
            if isinstance(sub2api_config, list):
                self.save_document("sub2api_config", sub2api_config)
                migrated["sub2api_config"] = len(sub2api_config)

            log_path = DATA_DIR / "activity_logs.jsonl"
            if log_path.exists():
                count = 0
                for line in log_path.read_text(encoding="utf-8", errors="ignore").splitlines():
                    try:
                        item = json.loads(line)
                    except Exception:
                        continue
                    if isinstance(item, dict):
                        self.append_activity_log(item)
                        count += 1
                migrated["activity_logs"] = count

        return migrated

    def health_check(self) -> dict[str, Any]:
        if not self._database_enabled:
            return {"status": "healthy", "backend": "files", "data_dir": str(DATA_DIR)}

        try:
            session = self._session()
            try:
                session.execute(text("SELECT 1"))
                return {
                    "status": "healthy",
                    "backend": "database",
                    "documents": session.query(AppDocumentModel).count(),
                    "activity_logs": session.query(ActivityLogModel).count(),
                }
            finally:
                session.close()
        except Exception as exc:
            return {"status": "unhealthy", "backend": "database", "error": str(exc)}


app_data_store = AppDataStore()
