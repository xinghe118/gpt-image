from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, ConfigDict

from api.support import require_identity
from services.conversation_service import conversation_service


class ConversationPayload(BaseModel):
    model_config = ConfigDict(extra="allow")


class ConversationBulkSaveRequest(BaseModel):
    items: list[ConversationPayload] = []


def create_router() -> APIRouter:
    router = APIRouter()

    @router.get("/api/conversations")
    async def list_conversations(
        authorization: str | None = Header(default=None),
        project_id: str = "",
        limit: int = Query(default=500, ge=1, le=1000),
    ):
        identity = require_identity(authorization)
        return {
            "items": conversation_service.list_conversations(
                identity,
                project_id=project_id,
                limit=limit,
            )
        }

    @router.post("/api/conversations")
    async def save_conversations(
        body: ConversationBulkSaveRequest,
        authorization: str | None = Header(default=None),
    ):
        identity = require_identity(authorization)
        items = [item.model_dump(mode="python") for item in body.items]
        return {"items": conversation_service.save_conversations(identity, items)}

    @router.post("/api/conversations/{conversation_id}")
    async def upsert_conversation(
        conversation_id: str,
        body: ConversationPayload,
        authorization: str | None = Header(default=None),
    ):
        identity = require_identity(authorization)
        payload = body.model_dump(mode="python")
        payload["id"] = conversation_id
        try:
            item = conversation_service.upsert_conversation(identity, payload)
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail={"error": str(exc)}) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail={"error": str(exc)}) from exc
        return {"item": item}

    @router.delete("/api/conversations/{conversation_id}")
    async def delete_conversation(conversation_id: str, authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        try:
            deleted = conversation_service.delete_conversation(identity, conversation_id)
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail={"error": str(exc)}) from exc
        if not deleted:
            raise HTTPException(status_code=404, detail={"error": "conversation not found"})
        return {"ok": True}

    return router
