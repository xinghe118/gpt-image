from __future__ import annotations

import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Callable

from fastapi import APIRouter, File, Form, Header, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

from api.support import raise_image_quota_error, require_identity, resolve_image_base_url
from services.account_service import account_service
from services.activity_log_service import activity_log_service
from services.auth_service import auth_service
from services.chatgpt_service import ChatGPTService, ImageGenerationError
from services.image_library_service import image_library_service
from services.quota_ledger_service import quota_ledger_service
from utils.helper import is_image_chat_request, sse_json_stream


class ImageGenerationRequest(BaseModel):
    prompt: str = Field(..., min_length=1)
    model: str = "gpt-image-2"
    n: int = Field(default=1, ge=1, le=4)
    size: str | None = None
    response_format: str = "b64_json"
    history_disabled: bool = True
    stream: bool | None = None
    project_id: str | None = None


class ChatCompletionRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    model: str | None = None
    prompt: str | None = None
    n: int | None = None
    stream: bool | None = None
    modalities: list[str] | None = None
    messages: list[dict[str, object]] | None = None


class ResponseCreateRequest(BaseModel):
    model_config = ConfigDict(extra="allow")
    model: str | None = None
    input: object | None = None
    tools: list[dict[str, object]] | None = None
    tool_choice: object | None = None
    stream: bool | None = None


class ImageJobService:
    def __init__(self):
        self._lock = threading.Lock()
        self._jobs: dict[str, dict[str, object]] = {}

    @staticmethod
    def _now_iso() -> str:
        return datetime.now(timezone.utc).isoformat()

    def create(self, *, identity: dict[str, object], task: Callable[[], dict[str, object]]) -> dict[str, object]:
        job_id = uuid.uuid4().hex
        now = self._now_iso()
        job = {
            "job_id": job_id,
            "status": "pending",
            "subject_id": str(identity.get("id") or ""),
            "created_at": now,
            "updated_at": now,
            "result": None,
            "error": "",
        }
        with self._lock:
            self._jobs[job_id] = job
            if len(self._jobs) > 300:
                for old_job_id in list(self._jobs.keys())[:100]:
                    if self._jobs.get(old_job_id, {}).get("status") in {"succeeded", "failed"}:
                        self._jobs.pop(old_job_id, None)

        thread = threading.Thread(target=self._run, args=(job_id, task), name=f"image-job-{job_id[:8]}", daemon=True)
        thread.start()
        return self.get(job_id) or job

    def _run(self, job_id: str, task: Callable[[], dict[str, object]]) -> None:
        self._update(job_id, status="running")
        try:
            self._update(job_id, status="succeeded", result=task(), error="")
        except Exception as exc:
            self._update(job_id, status="failed", error=str(exc))

    def _update(self, job_id: str, **updates: object) -> None:
        with self._lock:
            current = self._jobs.get(job_id)
            if not current:
                return
            self._jobs[job_id] = {**current, **updates, "updated_at": self._now_iso()}

    def get(self, job_id: str) -> dict[str, object] | None:
        with self._lock:
            job = self._jobs.get(job_id)
            return dict(job) if job else None


image_job_service = ImageJobService()


def _normalize_image_amount(value: object, default: int = 1) -> int:
    try:
        return max(1, min(10, int(value or default)))
    except (TypeError, ValueError):
        return default


def _ensure_image_request_allowed(identity: dict[str, object], *, model: str, amount: int, mode: str) -> None:
    try:
        auth_service.ensure_request_allowed(identity, model=model, amount=amount, mode=mode)
    except ValueError as exc:
        raise HTTPException(status_code=403, detail={"error": str(exc)}) from exc


def _has_image_generation_tool(payload: dict[str, object]) -> bool:
    tools = payload.get("tools")
    if not isinstance(tools, list):
        return False
    return any(isinstance(tool, dict) and tool.get("type") == "image_generation" for tool in tools)


def _format_image_api_result(
        result: dict[str, object],
        records: list[dict[str, object]],
        response_format: str,
) -> dict[str, object]:
    data = result.get("data") if isinstance(result.get("data"), list) else []
    formatted: list[dict[str, object]] = []
    for index, item in enumerate(data):
        if not isinstance(item, dict):
            continue
        record = records[index] if index < len(records) else {}
        revised_prompt = str(item.get("revised_prompt") or record.get("revised_prompt") or "").strip()
        if response_format == "url":
            image_url = str(record.get("image_url") or "").strip()
            if image_url:
                formatted.append({"url": image_url, "revised_prompt": revised_prompt})
            continue
        next_item = dict(item)
        if record.get("image_url"):
            next_item["url"] = record.get("image_url")
        formatted.append(next_item)
    return {"created": result.get("created"), "data": formatted}


def _run_generation_request(
        *,
        chatgpt_service: ChatGPTService,
        identity: dict[str, object],
        prompt: str,
        model: str,
        n: int,
        size: str | None,
        response_format: str,
        base_url: str,
        started_at: float,
        project_id: str | None = None,
) -> dict[str, object]:
    try:
        result = chatgpt_service.generate_with_pool(prompt, model, n, size, "b64_json", base_url)
        result_count = len(result.get("data") or [])
        records: list[dict[str, object]] = []
        if result_count > 0:
            auth_service.consume_quota(identity, result_count)
            quota_ledger_service.record_charge(
                identity=identity,
                amount=result_count,
                event="images.generations",
                model=model,
                mode="generate",
                project_id=project_id or "",
                prompt=prompt,
            )
            records = image_library_service.record_images(
                identity=identity,
                prompt=prompt,
                model=model,
                mode="generate",
                size=size,
                images=result.get("data") or [],
                project_id=project_id,
            )
        activity_log_service.record(
            "images.generations",
            route="/v1/images/generations",
            model=model,
            subject_id=str(identity.get("id") or ""),
            role=str(identity.get("role") or ""),
            prompt=prompt,
            duration_ms=int((time.perf_counter() - started_at) * 1000),
            metadata={"stream": False, "n": n, "size": size, "result_count": result_count, "project_id": project_id},
        )
        return _format_image_api_result(result, records, response_format)
    except ImageGenerationError as exc:
        activity_log_service.record(
            "images.generations",
            level="warning",
            status="error",
            route="/v1/images/generations",
            model=model,
            subject_id=str(identity.get("id") or ""),
            role=str(identity.get("role") or ""),
            prompt=prompt,
            duration_ms=int((time.perf_counter() - started_at) * 1000),
            error=str(exc),
            metadata={"stream": False, "n": n, "size": size},
        )
        raise exc


def _run_edit_request(
        *,
        chatgpt_service: ChatGPTService,
        identity: dict[str, object],
        prompt: str,
        images: list[tuple[bytes, str, str]],
        model: str,
        n: int,
        size: str | None,
        response_format: str,
        base_url: str,
        started_at: float,
        project_id: str | None = None,
) -> dict[str, object]:
    try:
        result = chatgpt_service.edit_with_pool(prompt, images, model, n, size, "b64_json", base_url)
        result_count = len(result.get("data") or [])
        records: list[dict[str, object]] = []
        if result_count > 0:
            auth_service.consume_quota(identity, result_count)
            quota_ledger_service.record_charge(
                identity=identity,
                amount=result_count,
                event="images.edits",
                model=model,
                mode="edit",
                project_id=project_id or "",
                prompt=prompt,
            )
            records = image_library_service.record_images(
                identity=identity,
                prompt=prompt,
                model=model,
                mode="edit",
                size=size,
                images=result.get("data") or [],
                project_id=project_id,
            )
        activity_log_service.record(
            "images.edits",
            route="/v1/images/edits",
            model=model,
            subject_id=str(identity.get("id") or ""),
            role=str(identity.get("role") or ""),
            prompt=prompt,
            duration_ms=int((time.perf_counter() - started_at) * 1000),
            metadata={"stream": False, "n": n, "size": size, "image_count": len(images), "result_count": result_count, "project_id": project_id},
        )
        return _format_image_api_result(result, records, response_format)
    except ImageGenerationError as exc:
        activity_log_service.record(
            "images.edits",
            level="warning",
            status="error",
            route="/v1/images/edits",
            model=model,
            subject_id=str(identity.get("id") or ""),
            role=str(identity.get("role") or ""),
            prompt=prompt,
            duration_ms=int((time.perf_counter() - started_at) * 1000),
            error=str(exc),
            metadata={"stream": False, "n": n, "size": size, "image_count": len(images)},
        )
        raise exc


def create_router(chatgpt_service: ChatGPTService) -> APIRouter:
    router = APIRouter()

    @router.get("/v1/models")
    async def list_models(authorization: str | None = Header(default=None)):
        require_identity(authorization)
        try:
            return await run_in_threadpool(chatgpt_service.list_models)
        except Exception as exc:
            raise HTTPException(status_code=502, detail={"error": str(exc)}) from exc

    @router.post("/v1/images/generations")
    async def generate_images(
            body: ImageGenerationRequest,
            request: Request,
            authorization: str | None = Header(default=None),
    ):
        identity = require_identity(authorization)
        started_at = time.perf_counter()
        base_url = resolve_image_base_url(request)
        _ensure_image_request_allowed(identity, model=body.model, amount=body.n, mode="generate")
        try:
            auth_service.ensure_quota_available(identity, body.n)
        except ValueError as exc:
            raise HTTPException(status_code=429, detail={"error": str(exc)}) from exc
        if body.stream:
            try:
                await run_in_threadpool(account_service.get_available_access_token)
            except RuntimeError as exc:
                activity_log_service.record(
                    "images.generations",
                    level="warning",
                    status="error",
                    route="/v1/images/generations",
                    model=body.model,
                    subject_id=str(identity.get("id") or ""),
                    role=str(identity.get("role") or ""),
                    prompt=body.prompt,
                    duration_ms=int((time.perf_counter() - started_at) * 1000),
                    error=str(exc),
                    metadata={"stream": True, "n": body.n, "size": body.size},
                )
                raise_image_quota_error(exc)
            activity_log_service.record(
                "images.generations",
                status="accepted",
                route="/v1/images/generations",
                model=body.model,
                subject_id=str(identity.get("id") or ""),
                role=str(identity.get("role") or ""),
                prompt=body.prompt,
                duration_ms=int((time.perf_counter() - started_at) * 1000),
                metadata={"stream": True, "n": body.n, "size": body.size},
            )
            auth_service.consume_quota(identity, body.n)
            quota_ledger_service.record_charge(
                identity=identity,
                amount=body.n,
                event="images.generations",
                model=body.model,
                mode="generate",
                project_id=body.project_id or "",
                prompt=body.prompt,
                status="accepted",
                reason="stream_accepted",
            )
            return StreamingResponse(
                sse_json_stream(
                    chatgpt_service.stream_image_generation(
                        body.prompt, body.model, body.n, body.size, body.response_format, base_url
                    )
                ),
                media_type="text/event-stream",
            )
        try:
            return await run_in_threadpool(
                _run_generation_request,
                chatgpt_service=chatgpt_service,
                identity=identity,
                prompt=body.prompt,
                model=body.model,
                n=body.n,
                size=body.size,
                response_format=body.response_format,
                base_url=base_url,
                started_at=started_at,
                project_id=body.project_id,
            )
        except ImageGenerationError as exc:
            raise_image_quota_error(exc)

    @router.post("/api/image/jobs/generations")
    async def create_image_generation_job(
            body: ImageGenerationRequest,
            request: Request,
            authorization: str | None = Header(default=None),
    ):
        identity = require_identity(authorization)
        started_at = time.perf_counter()
        base_url = resolve_image_base_url(request)
        _ensure_image_request_allowed(identity, model=body.model, amount=body.n, mode="generate")
        try:
            auth_service.ensure_quota_available(identity, body.n)
        except ValueError as exc:
            raise HTTPException(status_code=429, detail={"error": str(exc)}) from exc
        job = image_job_service.create(
            identity=identity,
            task=lambda: _run_generation_request(
                chatgpt_service=chatgpt_service,
                identity=identity,
                prompt=body.prompt,
                model=body.model,
                n=body.n,
                size=body.size,
                response_format=body.response_format,
                base_url=base_url,
                started_at=started_at,
                project_id=body.project_id,
            ),
        )
        return {"job": job}

    @router.post("/v1/images/edits")
    async def edit_images(
            request: Request,
            authorization: str | None = Header(default=None),
            image: list[UploadFile] | None = File(default=None),
            image_list: list[UploadFile] | None = File(default=None, alias="image[]"),
            prompt: str = Form(...),
            model: str = Form(default="gpt-image-2"),
            n: int = Form(default=1),
            size: str | None = Form(default=None),
            response_format: str = Form(default="b64_json"),
            stream: bool | None = Form(default=None),
            project_id: str | None = Form(default=None),
    ):
        identity = require_identity(authorization)
        started_at = time.perf_counter()
        if n < 1 or n > 4:
            raise HTTPException(status_code=400, detail={"error": "n must be between 1 and 4"})
        _ensure_image_request_allowed(identity, model=model, amount=n, mode="edit")
        try:
            auth_service.ensure_quota_available(identity, n)
        except ValueError as exc:
            raise HTTPException(status_code=429, detail={"error": str(exc)}) from exc
        uploads = [*(image or []), *(image_list or [])]
        if not uploads:
            raise HTTPException(status_code=400, detail={"error": "image file is required"})
        base_url = resolve_image_base_url(request)
        images: list[tuple[bytes, str, str]] = []
        for upload in uploads:
            image_data = await upload.read()
            if not image_data:
                raise HTTPException(status_code=400, detail={"error": "image file is empty"})
            images.append((image_data, upload.filename or "image.png", upload.content_type or "image/png"))
        if stream:
            if not account_service.has_available_account():
                activity_log_service.record(
                    "images.edits",
                    level="warning",
                    status="error",
                    route="/v1/images/edits",
                    model=model,
                    subject_id=str(identity.get("id") or ""),
                    role=str(identity.get("role") or ""),
                    prompt=prompt,
                    duration_ms=int((time.perf_counter() - started_at) * 1000),
                    error="no available image quota",
                    metadata={"stream": True, "n": n, "size": size, "image_count": len(images)},
                )
                raise_image_quota_error(RuntimeError("no available image quota"))
            activity_log_service.record(
                "images.edits",
                status="accepted",
                route="/v1/images/edits",
                model=model,
                subject_id=str(identity.get("id") or ""),
                role=str(identity.get("role") or ""),
                prompt=prompt,
                duration_ms=int((time.perf_counter() - started_at) * 1000),
                metadata={"stream": True, "n": n, "size": size, "image_count": len(images)},
            )
            auth_service.consume_quota(identity, n)
            quota_ledger_service.record_charge(
                identity=identity,
                amount=n,
                event="images.edits",
                model=model,
                mode="edit",
                project_id=project_id or "",
                prompt=prompt,
                status="accepted",
                reason="stream_accepted",
            )
            return StreamingResponse(
                sse_json_stream(chatgpt_service.stream_image_edit(prompt, images, model, n, size, response_format, base_url)),
                media_type="text/event-stream",
            )
        try:
            return await run_in_threadpool(
                _run_edit_request,
                chatgpt_service=chatgpt_service,
                identity=identity,
                prompt=prompt,
                images=images,
                model=model,
                n=n,
                size=size,
                response_format=response_format,
                base_url=base_url,
                started_at=started_at,
                project_id=project_id,
            )
        except ImageGenerationError as exc:
            raise_image_quota_error(exc)

    @router.post("/api/image/jobs/edits")
    async def create_image_edit_job(
            request: Request,
            authorization: str | None = Header(default=None),
            image: list[UploadFile] | None = File(default=None),
            image_list: list[UploadFile] | None = File(default=None, alias="image[]"),
            prompt: str = Form(...),
            model: str = Form(default="gpt-image-2"),
            n: int = Form(default=1),
            size: str | None = Form(default=None),
            response_format: str = Form(default="url"),
            project_id: str | None = Form(default=None),
    ):
        identity = require_identity(authorization)
        started_at = time.perf_counter()
        if n < 1 or n > 4:
            raise HTTPException(status_code=400, detail={"error": "n must be between 1 and 4"})
        _ensure_image_request_allowed(identity, model=model, amount=n, mode="edit")
        try:
            auth_service.ensure_quota_available(identity, n)
        except ValueError as exc:
            raise HTTPException(status_code=429, detail={"error": str(exc)}) from exc
        uploads = [*(image or []), *(image_list or [])]
        if not uploads:
            raise HTTPException(status_code=400, detail={"error": "image file is required"})
        base_url = resolve_image_base_url(request)
        images: list[tuple[bytes, str, str]] = []
        for upload in uploads:
            image_data = await upload.read()
            if not image_data:
                raise HTTPException(status_code=400, detail={"error": "image file is empty"})
            images.append((image_data, upload.filename or "image.png", upload.content_type or "image/png"))
        job = image_job_service.create(
            identity=identity,
            task=lambda: _run_edit_request(
                chatgpt_service=chatgpt_service,
                identity=identity,
                prompt=prompt,
                images=images,
                model=model,
                n=n,
                size=size,
                response_format=response_format,
                base_url=base_url,
                started_at=started_at,
                project_id=project_id,
            ),
        )
        return {"job": job}

    @router.get("/api/image/jobs/{job_id}")
    async def get_image_job(job_id: str, authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        job = image_job_service.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail={"error": "image job not found"})
        if identity.get("role") != "admin" and str(job.get("subject_id") or "") != str(identity.get("id") or ""):
            raise HTTPException(status_code=403, detail={"error": "image job permission denied"})
        return {"job": job}

    @router.post("/v1/chat/completions")
    async def create_chat_completion(body: ChatCompletionRequest, authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        started_at = time.perf_counter()
        payload = body.model_dump(mode="python")
        is_image_request = is_image_chat_request(payload)
        image_amount = _normalize_image_amount(payload.get("n"))
        if is_image_request:
            _ensure_image_request_allowed(identity, model=str(payload.get("model") or ""), amount=image_amount, mode="generate")
            try:
                auth_service.ensure_quota_available(identity, image_amount)
            except ValueError as exc:
                raise HTTPException(status_code=429, detail={"error": str(exc)}) from exc
        if bool(payload.get("stream")):
            if is_image_request:
                try:
                    await run_in_threadpool(account_service.get_available_access_token)
                except RuntimeError as exc:
                    activity_log_service.record(
                        "chat.completions",
                        level="warning",
                        status="error",
                        route="/v1/chat/completions",
                        model=str(payload.get("model") or ""),
                        subject_id=str(identity.get("id") or ""),
                        role=str(identity.get("role") or ""),
                        duration_ms=int((time.perf_counter() - started_at) * 1000),
                        error=str(exc),
                        metadata={"stream": True},
                    )
                    raise_image_quota_error(exc)
                auth_service.consume_quota(identity, image_amount)
                quota_ledger_service.record_charge(
                    identity=identity,
                    amount=image_amount,
                    event="chat.completions",
                    model=str(payload.get("model") or ""),
                    mode="generate",
                    prompt=payload.get("prompt") or "",
                    status="accepted",
                    reason="stream_accepted",
                )
            activity_log_service.record(
                "chat.completions",
                status="accepted",
                route="/v1/chat/completions",
                model=str(payload.get("model") or ""),
                subject_id=str(identity.get("id") or ""),
                role=str(identity.get("role") or ""),
                duration_ms=int((time.perf_counter() - started_at) * 1000),
                metadata={"stream": True},
            )
            return StreamingResponse(
                sse_json_stream(chatgpt_service.stream_chat_completion(payload)),
                media_type="text/event-stream",
            )
        try:
            result = await run_in_threadpool(chatgpt_service.create_chat_completion, payload)
            if is_image_request:
                auth_service.consume_quota(identity, image_amount)
                quota_ledger_service.record_charge(
                    identity=identity,
                    amount=image_amount,
                    event="chat.completions",
                    model=str(payload.get("model") or ""),
                    mode="generate",
                    prompt=payload.get("prompt") or "",
                )
            activity_log_service.record(
                "chat.completions",
                route="/v1/chat/completions",
                model=str(payload.get("model") or ""),
                subject_id=str(identity.get("id") or ""),
                role=str(identity.get("role") or ""),
                duration_ms=int((time.perf_counter() - started_at) * 1000),
                metadata={"stream": False},
            )
            return result
        except Exception as exc:
            activity_log_service.record(
                "chat.completions",
                level="warning",
                status="error",
                route="/v1/chat/completions",
                model=str(payload.get("model") or ""),
                subject_id=str(identity.get("id") or ""),
                role=str(identity.get("role") or ""),
                duration_ms=int((time.perf_counter() - started_at) * 1000),
                error=str(exc),
                metadata={"stream": False},
            )
            raise

    @router.post("/v1/responses")
    async def create_response(body: ResponseCreateRequest, authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        started_at = time.perf_counter()
        payload = body.model_dump(mode="python")
        is_image_request = _has_image_generation_tool(payload)
        if is_image_request:
            _ensure_image_request_allowed(identity, model=str(payload.get("model") or ""), amount=1, mode="generate")
            try:
                auth_service.ensure_quota_available(identity, 1)
            except ValueError as exc:
                raise HTTPException(status_code=429, detail={"error": str(exc)}) from exc
        if bool(payload.get("stream")):
            if is_image_request:
                auth_service.consume_quota(identity, 1)
                quota_ledger_service.record_charge(
                    identity=identity,
                    amount=1,
                    event="responses",
                    model=str(payload.get("model") or ""),
                    mode="generate",
                    prompt=payload.get("input") or "",
                    status="accepted",
                    reason="stream_accepted",
                )
            activity_log_service.record(
                "responses",
                status="accepted",
                route="/v1/responses",
                model=str(payload.get("model") or ""),
                subject_id=str(identity.get("id") or ""),
                role=str(identity.get("role") or ""),
                duration_ms=int((time.perf_counter() - started_at) * 1000),
                metadata={"stream": True},
            )
            return StreamingResponse(
                sse_json_stream(chatgpt_service.stream_response(payload)),
                media_type="text/event-stream",
            )
        try:
            result = await run_in_threadpool(chatgpt_service.create_response, payload)
            if is_image_request:
                auth_service.consume_quota(identity, 1)
                quota_ledger_service.record_charge(
                    identity=identity,
                    amount=1,
                    event="responses",
                    model=str(payload.get("model") or ""),
                    mode="generate",
                    prompt=payload.get("input") or "",
                )
            activity_log_service.record(
                "responses",
                route="/v1/responses",
                model=str(payload.get("model") or ""),
                subject_id=str(identity.get("id") or ""),
                role=str(identity.get("role") or ""),
                duration_ms=int((time.perf_counter() - started_at) * 1000),
                metadata={"stream": False},
            )
            return result
        except Exception as exc:
            activity_log_service.record(
                "responses",
                level="warning",
                status="error",
                route="/v1/responses",
                model=str(payload.get("model") or ""),
                subject_id=str(identity.get("id") or ""),
                role=str(identity.get("role") or ""),
                duration_ms=int((time.perf_counter() - started_at) * 1000),
                error=str(exc),
                metadata={"stream": False},
            )
            raise

    return router
