from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel

from api.support import require_identity
from services.project_service import project_service


class ProjectCreateRequest(BaseModel):
    name: str = ""
    description: str = ""
    settings: dict[str, object] | None = None


class ProjectUpdateRequest(BaseModel):
    name: str | None = None
    description: str | None = None
    archived: bool | None = None
    settings: dict[str, object] | None = None


def create_router() -> APIRouter:
    router = APIRouter()

    @router.get("/api/projects")
    async def list_projects(
        authorization: str | None = Header(default=None),
        q: str = "",
        limit: int = Query(default=100, ge=1, le=500),
        offset: int = Query(default=0, ge=0),
    ):
        identity = require_identity(authorization)
        items = project_service.list_projects(identity)
        keyword = q.strip().lower()
        if keyword:
            items = [
                item
                for item in items
                if keyword in " ".join(
                    [
                        str(item.get("name") or ""),
                        str(item.get("description") or ""),
                        str(item.get("subject_name") or ""),
                        str(item.get("subject_id") or ""),
                    ]
                ).lower()
            ]
        total = len(items)
        page_items = items[offset : offset + limit]
        return {
            "items": page_items,
            "total": total,
            "limit": limit,
            "offset": offset,
            "has_more": offset + len(page_items) < total,
        }

    @router.get("/api/projects/summary")
    async def project_summary(authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        return {"summary": project_service.summary(identity)}

    @router.post("/api/projects")
    async def create_project(body: ProjectCreateRequest, authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        try:
            item = project_service.create_project(identity, body.name, body.description, body.settings)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        return {"item": item, "items": project_service.list_projects(identity)}

    @router.post("/api/projects/{project_id}")
    async def update_project(
        project_id: str,
        body: ProjectUpdateRequest,
        authorization: str | None = Header(default=None),
    ):
        identity = require_identity(authorization)
        try:
            item = project_service.update_project(
                identity,
                project_id,
                name=body.name,
                description=body.description,
                archived=body.archived,
                settings=body.settings,
            )
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail={"error": str(exc)}) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        if item is None:
            raise HTTPException(status_code=404, detail={"error": "project not found"})
        return {"item": item, "items": project_service.list_projects(identity)}

    @router.delete("/api/projects/{project_id}")
    async def archive_project(project_id: str, authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        try:
            item = project_service.update_project(identity, project_id, archived=True)
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail={"error": str(exc)}) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        if item is None:
            raise HTTPException(status_code=404, detail={"error": "project not found"})
        return {"item": item, "items": project_service.list_projects(identity)}

    return router
