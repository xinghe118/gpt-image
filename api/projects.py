from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from api.support import require_identity
from services.project_service import project_service


class ProjectCreateRequest(BaseModel):
    name: str = ""
    description: str = ""


def create_router() -> APIRouter:
    router = APIRouter()

    @router.get("/api/projects")
    async def list_projects(authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        return {"items": project_service.list_projects(identity)}

    @router.post("/api/projects")
    async def create_project(body: ProjectCreateRequest, authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        try:
            item = project_service.create_project(identity, body.name, body.description)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        return {"item": item, "items": project_service.list_projects(identity)}

    return router
