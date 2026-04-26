from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Query
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict

from api.support import require_admin, require_identity
from services.activity_log_service import activity_log_service
from services.app_data_store import app_data_store
from services.config import DATA_DIR, config
from services.image_library_service import image_library_service
from services.object_storage_service import object_storage_service
from services.proxy_service import test_proxy
from services.storage.json_storage import JSONStorageBackend


class SettingsUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="allow")


class ProxyTestRequest(BaseModel):
    url: str = ""


def create_router(app_version: str) -> APIRouter:
    router = APIRouter()

    @router.post("/auth/login")
    async def login(authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        return {
            "ok": True,
            "version": app_version,
            "role": identity.get("role"),
            "subject_id": identity.get("id"),
            "name": identity.get("name"),
            "quota_limit": identity.get("quota_limit"),
            "quota_used": identity.get("quota_used"),
            "quota_remaining": identity.get("quota_remaining"),
        }

    @router.get("/auth/me")
    async def get_current_identity(authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        return {
            "role": identity.get("role"),
            "subject_id": identity.get("id"),
            "name": identity.get("name"),
            "quota_limit": identity.get("quota_limit"),
            "quota_used": identity.get("quota_used"),
            "quota_remaining": identity.get("quota_remaining"),
        }

    @router.get("/api/ui-config")
    async def get_ui_config(authorization: str | None = Header(default=None)):
        require_identity(authorization)
        return {
            "show_image_model_selector": config.show_image_model_selector,
            "default_image_model": config.default_image_model,
        }

    @router.get("/version")
    async def get_version():
        return {"version": app_version}

    @router.get("/api/settings")
    async def get_settings(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return {"config": config.get()}

    @router.post("/api/settings")
    async def save_settings(body: SettingsUpdateRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        updates = body.model_dump(mode="python")
        if (
            "object_storage_secret_access_key" in updates
            and not str(updates.get("object_storage_secret_access_key") or "").strip()
        ):
            updates.pop("object_storage_secret_access_key")
        return {"config": config.update(updates)}

    @router.post("/api/proxy/test")
    async def test_proxy_endpoint(body: ProxyTestRequest, authorization: str | None = Header(default=None)):
        require_admin(authorization)
        candidate = (body.url or "").strip() or config.get_proxy_settings()
        if not candidate:
            raise HTTPException(status_code=400, detail={"error": "proxy url is required"})
        return {"result": await run_in_threadpool(test_proxy, candidate)}

    @router.get("/api/storage/info")
    async def get_storage_info(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        storage = config.get_storage_backend()
        return {
            "backend": storage.get_backend_info(),
            "health": storage.health_check(),
            "app_data": app_data_store.health_check(),
            "object_storage": object_storage_service.health_check(),
        }

    @router.post("/api/storage/migrate-to-database")
    async def migrate_storage_to_database(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            app_data_result = await run_in_threadpool(app_data_store.migrate_local_files_to_database)
            json_storage = JSONStorageBackend(DATA_DIR / "accounts.json", DATA_DIR / "auth_keys.json")
            target_storage = config.get_storage_backend()
            accounts = await run_in_threadpool(json_storage.load_accounts)
            auth_keys = await run_in_threadpool(json_storage.load_auth_keys)
            if accounts:
                await run_in_threadpool(target_storage.save_accounts, accounts)
            if auth_keys:
                await run_in_threadpool(target_storage.save_auth_keys, auth_keys)
            return {
                "result": {
                    **app_data_result,
                    "accounts": len(accounts),
                    "auth_keys": len(auth_keys),
                }
            }
        except Exception as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.post("/api/object-storage/test")
    async def test_object_storage(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        try:
            return {"result": await run_in_threadpool(object_storage_service.test_upload)}
        except Exception as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc

    @router.get("/api/logs")
    async def list_activity_logs(
            authorization: str | None = Header(default=None),
            limit: int = Query(default=200, ge=1, le=1000),
            level: str = "",
            status: str = "",
            event: str = "",
            q: str = "",
    ):
        require_admin(authorization)
        return {
            "items": activity_log_service.list_logs(
                limit=limit,
                level=level,
                status=status,
                event=event,
                query=q,
            )
        }

    @router.get("/api/logs/summary")
    async def get_activity_log_summary(authorization: str | None = Header(default=None)):
        require_admin(authorization)
        return {"summary": activity_log_service.summary()}

    @router.get("/api/library")
    async def list_library_items(
            authorization: str | None = Header(default=None),
            limit: int = Query(default=300, ge=1, le=1000),
    ):
        identity = require_identity(authorization)
        return {"items": image_library_service.list_images(identity=identity, limit=limit)}

    return router

