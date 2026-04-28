from __future__ import annotations

import json
import os
from pathlib import Path
from threading import Lock
from typing import Any

from sqlalchemy import Column, Integer, String, Text, create_engine, func, inspect, or_, text
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


class ProjectDataModel(Base):
    __tablename__ = "projects"

    id = Column(String(80), primary_key=True)
    subject_id = Column(String(120), nullable=False, index=True)
    updated_at = Column(String(40), nullable=False, index=True)
    data = Column(Text, nullable=False)


class ConversationDataModel(Base):
    __tablename__ = "conversations"

    id = Column(String(80), primary_key=True)
    subject_id = Column(String(120), nullable=False, index=True)
    project_id = Column(String(80), nullable=False, index=True)
    updated_at = Column(String(40), nullable=False, index=True)
    data = Column(Text, nullable=False)


class ImageLibraryDataModel(Base):
    __tablename__ = "image_library"

    id = Column(String(80), primary_key=True)
    subject_id = Column(String(120), nullable=False, index=True)
    project_id = Column(String(80), nullable=False, index=True)
    mode = Column(String(40), nullable=False, default="", index=True)
    model = Column(String(80), nullable=False, default="", index=True)
    created_at = Column(String(40), nullable=False, index=True)
    data = Column(Text, nullable=False)


class ImageJobDataModel(Base):
    __tablename__ = "image_jobs"

    job_id = Column(String(80), primary_key=True)
    subject_id = Column(String(120), nullable=False, index=True)
    status = Column(String(20), nullable=False, index=True)
    kind = Column(String(40), nullable=False, index=True)
    created_at = Column(String(40), nullable=False, index=True)
    updated_at = Column(String(40), nullable=False, index=True)
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
            self._ensure_schema()
            self._session_factory = sessionmaker(bind=self._engine)

    @property
    def database_enabled(self) -> bool:
        return self._database_enabled

    def _session(self):
        if not self._session_factory:
            raise RuntimeError("database app data store is not enabled")
        return self._session_factory()

    def _ensure_schema(self) -> None:
        if self._engine is None:
            return
        inspector = inspect(self._engine)
        columns = {column["name"] for column in inspector.get_columns("image_library")}
        statements = []
        if "mode" not in columns:
            statements.append("ALTER TABLE image_library ADD COLUMN mode VARCHAR(40) DEFAULT ''")
        if "model" not in columns:
            statements.append("ALTER TABLE image_library ADD COLUMN model VARCHAR(80) DEFAULT ''")
        if not statements:
            return
        with self._engine.begin() as connection:
            for statement in statements:
                connection.execute(text(statement))

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

    @staticmethod
    def _clean(value: object) -> str:
        return str(value or "").strip()

    @staticmethod
    def _decode_row_data(rows: list[Any]) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for row in rows:
            try:
                data = json.loads(row.data)
            except Exception:
                continue
            if isinstance(data, dict):
                items.append(data)
        return items

    def _load_collection_document(self, key: str) -> list[dict[str, Any]]:
        data = self.load_document(key, {"items": []})
        if isinstance(data, dict):
            data = data.get("items")
        return data if isinstance(data, list) else []

    def load_projects(self) -> list[dict[str, Any]]:
        if not self._database_enabled:
            return self._load_collection_document("projects")
        session = self._session()
        try:
            rows = session.query(ProjectDataModel).order_by(ProjectDataModel.updated_at.desc()).all()
            items = self._decode_row_data(rows)
            return items if items else self._load_collection_document("projects")
        finally:
            session.close()

    def save_projects(self, items: list[dict[str, Any]]) -> None:
        if not self._database_enabled:
            self.save_document("projects", {"items": items})
            return
        session = self._session()
        try:
            for item in items:
                item_id = self._clean(item.get("id"))
                if not item_id:
                    continue
                row = session.get(ProjectDataModel, item_id)
                payload = json.dumps(item, ensure_ascii=False)
                if row is None:
                    row = ProjectDataModel(
                        id=item_id,
                        subject_id=self._clean(item.get("subject_id")) or "anonymous",
                        updated_at=self._clean(item.get("updated_at")) or self._clean(item.get("created_at")),
                        data=payload,
                    )
                    session.add(row)
                else:
                    row.subject_id = self._clean(item.get("subject_id")) or row.subject_id
                    row.updated_at = self._clean(item.get("updated_at")) or self._clean(item.get("created_at")) or row.updated_at
                    row.data = payload
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def load_conversations(self) -> list[dict[str, Any]]:
        if not self._database_enabled:
            return self._load_collection_document("conversations")
        session = self._session()
        try:
            rows = session.query(ConversationDataModel).order_by(ConversationDataModel.updated_at.desc()).all()
            items = self._decode_row_data(rows)
            return items if items else self._load_collection_document("conversations")
        finally:
            session.close()

    def save_conversations(self, items: list[dict[str, Any]]) -> None:
        if not self._database_enabled:
            self.save_document("conversations", {"items": items})
            return
        session = self._session()
        try:
            for item in items:
                item_id = self._clean(item.get("id"))
                if not item_id:
                    continue
                row = session.get(ConversationDataModel, item_id)
                payload = json.dumps(item, ensure_ascii=False)
                project_id = self._clean(item.get("project_id") or item.get("projectId")) or "default"
                updated_at = self._clean(item.get("updatedAt") or item.get("updated_at") or item.get("createdAt"))
                if row is None:
                    row = ConversationDataModel(
                        id=item_id,
                        subject_id=self._clean(item.get("subject_id")) or "anonymous",
                        project_id=project_id,
                        updated_at=updated_at,
                        data=payload,
                    )
                    session.add(row)
                else:
                    row.subject_id = self._clean(item.get("subject_id")) or row.subject_id
                    row.project_id = project_id
                    row.updated_at = updated_at or row.updated_at
                    row.data = payload
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def load_library(self) -> list[dict[str, Any]]:
        if not self._database_enabled:
            return self._load_collection_document("library")
        session = self._session()
        try:
            rows = session.query(ImageLibraryDataModel).order_by(ImageLibraryDataModel.created_at.desc()).all()
            items = self._decode_row_data(rows)
            return items if items else self._load_collection_document("library")
        finally:
            session.close()

    def list_library_page(
            self,
            *,
            subject_id: str = "",
            include_all: bool = False,
            limit: int = 48,
            offset: int = 0,
            query: str = "",
            mode: str = "",
            project_id: str = "",
    ) -> dict[str, Any] | None:
        if not self._database_enabled:
            return None

        limit = max(1, min(100, int(limit or 48)))
        offset = max(0, int(offset or 0))
        normalized_subject_id = self._clean(subject_id)
        normalized_project_id = self._clean(project_id)
        normalized_mode = self._clean(mode).lower()
        normalized_query = self._clean(query).lower()
        session = self._session()
        try:
            db_query = session.query(ImageLibraryDataModel)
            if not include_all:
                db_query = db_query.filter(ImageLibraryDataModel.subject_id == normalized_subject_id)
            if normalized_project_id:
                db_query = db_query.filter(ImageLibraryDataModel.project_id == normalized_project_id)
            if normalized_mode:
                db_query = db_query.filter(
                    or_(
                        ImageLibraryDataModel.mode == normalized_mode,
                        ImageLibraryDataModel.data.ilike(f'%"mode": "{normalized_mode}"%'),
                    )
                )
            if normalized_query:
                like = f"%{normalized_query}%"
                db_query = db_query.filter(
                    or_(
                        ImageLibraryDataModel.data.ilike(like),
                        ImageLibraryDataModel.subject_id.ilike(like),
                        ImageLibraryDataModel.project_id.ilike(like),
                        ImageLibraryDataModel.model.ilike(like),
                    )
                )
            total = db_query.count()
            rows = db_query.order_by(ImageLibraryDataModel.created_at.desc()).offset(offset).limit(limit).all()
            return {
                "items": self._decode_row_data(rows),
                "total": total,
                "limit": limit,
                "offset": offset,
                "has_more": offset + limit < total,
            }
        finally:
            session.close()

    def save_library(self, items: list[dict[str, Any]]) -> None:
        if not self._database_enabled:
            self.save_document("library", {"items": items})
            return
        session = self._session()
        try:
            for item in items:
                item_id = self._clean(item.get("id"))
                if not item_id:
                    continue
                row = session.get(ImageLibraryDataModel, item_id)
                payload = json.dumps(item, ensure_ascii=False)
                project_id = self._clean(item.get("project_id")) or "default"
                mode = self._clean(item.get("mode")).lower()
                model = self._clean(item.get("model"))
                created_at = self._clean(item.get("created_at"))
                if row is None:
                    row = ImageLibraryDataModel(
                        id=item_id,
                        subject_id=self._clean(item.get("subject_id")) or "anonymous",
                        project_id=project_id,
                        mode=mode,
                        model=model,
                        created_at=created_at,
                        data=payload,
                    )
                    session.add(row)
                else:
                    row.subject_id = self._clean(item.get("subject_id")) or row.subject_id
                    row.project_id = project_id
                    row.mode = mode
                    row.model = model
                    row.created_at = created_at or row.created_at
                    row.data = payload
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def delete_conversation(self, conversation_id: str) -> None:
        conversation_id = self._clean(conversation_id)
        if not conversation_id or not self._database_enabled:
            return
        session = self._session()
        try:
            row = session.get(ConversationDataModel, conversation_id)
            if row is not None:
                session.delete(row)
                session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def load_image_jobs(self, limit: int = 100, *, subject_id: str = "", include_all: bool = False) -> list[dict[str, Any]]:
        limit = max(1, min(500, int(limit or 100)))
        if not self._database_enabled:
            items = self._load_collection_document("image_jobs")
            if not include_all:
                items = [item for item in items if self._clean(item.get("subject_id")) == subject_id]
            return sorted(items, key=lambda item: self._clean(item.get("updated_at")), reverse=True)[:limit]

        session = self._session()
        try:
            query = session.query(ImageJobDataModel)
            if not include_all:
                query = query.filter(ImageJobDataModel.subject_id == subject_id)
            rows = query.order_by(ImageJobDataModel.updated_at.desc()).limit(limit).all()
            return self._decode_row_data(rows)
        finally:
            session.close()

    def load_image_job(self, job_id: str) -> dict[str, Any] | None:
        job_id = self._clean(job_id)
        if not job_id:
            return None
        if not self._database_enabled:
            for item in self._load_collection_document("image_jobs"):
                if self._clean(item.get("job_id")) == job_id:
                    return item
            return None

        session = self._session()
        try:
            row = session.get(ImageJobDataModel, job_id)
            if row is None:
                return None
            try:
                data = json.loads(row.data)
            except Exception:
                return None
            return data if isinstance(data, dict) else None
        finally:
            session.close()

    def save_image_job(self, item: dict[str, Any]) -> None:
        job_id = self._clean(item.get("job_id"))
        if not job_id:
            return
        if not self._database_enabled:
            items = self._load_collection_document("image_jobs")
            items = [current for current in items if self._clean(current.get("job_id")) != job_id]
            items.insert(0, item)
            self.save_document("image_jobs", {"items": items[:500]})
            return

        session = self._session()
        try:
            payload = json.dumps(item, ensure_ascii=False)
            row = session.get(ImageJobDataModel, job_id)
            if row is None:
                row = ImageJobDataModel(
                    job_id=job_id,
                    subject_id=self._clean(item.get("subject_id")) or "anonymous",
                    status=self._clean(item.get("status")) or "pending",
                    kind=self._clean(item.get("kind")) or "image",
                    created_at=self._clean(item.get("created_at")),
                    updated_at=self._clean(item.get("updated_at")) or self._clean(item.get("created_at")),
                    data=payload,
                )
                session.add(row)
            else:
                row.subject_id = self._clean(item.get("subject_id")) or row.subject_id
                row.status = self._clean(item.get("status")) or row.status
                row.kind = self._clean(item.get("kind")) or row.kind
                row.updated_at = self._clean(item.get("updated_at")) or row.updated_at
                row.data = payload
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

    def project_stats(self, *, subject_id: str = "", include_all: bool = False) -> dict[str, dict[str, Any]]:
        stats: dict[str, dict[str, Any]] = {}

        def bucket(project_id: str) -> dict[str, Any]:
            normalized_id = self._clean(project_id) or "default"
            return stats.setdefault(
                normalized_id,
                {
                    "image_count": 0,
                    "conversation_count": 0,
                    "last_activity_at": "",
                    "cover_url": "",
                },
            )

        if self._database_enabled:
            session = self._session()
            try:
                image_query = session.query(
                    ImageLibraryDataModel.project_id,
                    func.count(ImageLibraryDataModel.id),
                    func.max(ImageLibraryDataModel.created_at),
                )
                if not include_all:
                    image_query = image_query.filter(ImageLibraryDataModel.subject_id == self._clean(subject_id))
                for project_id, image_count, last_created_at in image_query.group_by(ImageLibraryDataModel.project_id).all():
                    current = bucket(project_id)
                    current["image_count"] += int(image_count or 0)
                    created_at = self._clean(last_created_at)
                    if created_at > self._clean(current.get("last_activity_at")):
                        current["last_activity_at"] = created_at

                conversation_query = session.query(
                    ConversationDataModel.project_id,
                    func.count(ConversationDataModel.id),
                    func.max(ConversationDataModel.updated_at),
                )
                if not include_all:
                    conversation_query = conversation_query.filter(ConversationDataModel.subject_id == self._clean(subject_id))
                for project_id, conversation_count, last_updated_at in conversation_query.group_by(ConversationDataModel.project_id).all():
                    current = bucket(project_id)
                    current["conversation_count"] += int(conversation_count or 0)
                    updated_at = self._clean(last_updated_at)
                    if updated_at > self._clean(current.get("last_activity_at")):
                        current["last_activity_at"] = updated_at

                for project_id in list(stats.keys()):
                    cover_query = session.query(ImageLibraryDataModel)
                    if project_id == "default":
                        cover_query = cover_query.filter(
                            or_(
                                ImageLibraryDataModel.project_id == "default",
                                ImageLibraryDataModel.project_id == "",
                            )
                        )
                    else:
                        cover_query = cover_query.filter(ImageLibraryDataModel.project_id == project_id)
                    if not include_all:
                        cover_query = cover_query.filter(ImageLibraryDataModel.subject_id == self._clean(subject_id))
                    row = cover_query.order_by(ImageLibraryDataModel.created_at.desc()).first()
                    if row is None:
                        continue
                    try:
                        data = json.loads(row.data)
                    except Exception:
                        data = {}
                    if isinstance(data, dict):
                        stats[project_id]["cover_url"] = self._clean(data.get("thumb_url") or data.get("image_url"))
                return stats
            finally:
                session.close()

        for item in self.load_library():
            if not include_all and self._clean(item.get("subject_id")) != self._clean(subject_id):
                continue
            current = bucket(self._clean(item.get("project_id")) or "default")
            current["image_count"] += 1
            created_at = self._clean(item.get("created_at"))
            if created_at > self._clean(current.get("last_activity_at")):
                current["last_activity_at"] = created_at
            if not current.get("cover_url"):
                current["cover_url"] = self._clean(item.get("thumb_url") or item.get("image_url"))

        for item in self.load_conversations():
            if not include_all and self._clean(item.get("subject_id")) != self._clean(subject_id):
                continue
            current = bucket(self._clean(item.get("project_id") or item.get("projectId")) or "default")
            current["conversation_count"] += 1
            updated_at = self._clean(item.get("updatedAt") or item.get("updated_at"))
            if updated_at > self._clean(current.get("last_activity_at")):
                current["last_activity_at"] = updated_at

        return stats

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
            "projects": 0,
            "conversations": 0,
            "activity_logs": 0,
            "image_jobs": 0,
            "cpa_config": 0,
            "sub2api_config": 0,
            "backend": "database",
        }

        with self._lock:
            library = _read_json(DATA_DIR / "library.json", {})
            if isinstance(library, dict) and isinstance(library.get("items"), list):
                self.save_library(library["items"])
                migrated["library"] = len(library["items"])

            projects = _read_json(DATA_DIR / "projects.json", {})
            if isinstance(projects, dict) and isinstance(projects.get("items"), list):
                self.save_projects(projects["items"])
                migrated["projects"] = len(projects["items"])

            conversations = _read_json(DATA_DIR / "conversations.json", {})
            if isinstance(conversations, dict) and isinstance(conversations.get("items"), list):
                self.save_conversations(conversations["items"])
                migrated["conversations"] = len(conversations["items"])

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

            image_jobs = _read_json(DATA_DIR / "image_jobs.json", {})
            if isinstance(image_jobs, dict) and isinstance(image_jobs.get("items"), list):
                for item in image_jobs["items"]:
                    if isinstance(item, dict):
                        self.save_image_job(item)
                        migrated["image_jobs"] = int(migrated["image_jobs"]) + 1

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
                    "projects": session.query(ProjectDataModel).count(),
                    "conversations": session.query(ConversationDataModel).count(),
                    "library": session.query(ImageLibraryDataModel).count(),
                    "image_jobs": session.query(ImageJobDataModel).count(),
                    "activity_logs": session.query(ActivityLogModel).count(),
                }
            finally:
                session.close()
        except Exception as exc:
            return {"status": "unhealthy", "backend": "database", "error": str(exc)}


app_data_store = AppDataStore()
