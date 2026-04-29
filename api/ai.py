from __future__ import annotations

import time
import base64
from typing import Callable, Iterator

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
from services.image_concurrency_service import ImageConcurrencyLimitError, image_concurrency_service
from services.image_job_service import image_job_service
from services.image_result_resolver import format_image_api_result
from utils.helper import is_image_chat_request, sse_json_stream


ImageJobProgressCallback = Callable[[str, str, int | None], None]


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


def _encode_job_images(images: list[tuple[bytes, str, str]]) -> list[dict[str, str]]:
    return [
        {
            "data": base64.b64encode(image_data).decode("ascii"),
            "filename": filename,
            "content_type": content_type,
        }
        for image_data, filename, content_type in images
    ]


def _decode_job_images(items: object) -> list[tuple[bytes, str, str]]:
    if not isinstance(items, list):
        return []
    images: list[tuple[bytes, str, str]] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        data = str(item.get("data") or "")
        try:
            image_data = base64.b64decode(data)
        except Exception:
            continue
        if image_data:
            images.append(
                (
                    image_data,
                    str(item.get("filename") or "image.png"),
                    str(item.get("content_type") or "image/png"),
                )
            )
    return images


def _stream_chunk_has_image_result(chunk: object) -> bool:
    if not isinstance(chunk, dict):
        return False
    data = chunk.get("data")
    if isinstance(data, list) and any(isinstance(item, dict) for item in data):
        return True
    item = chunk.get("item")
    if (
            isinstance(item, dict)
            and item.get("type") == "image_generation_call"
            and (item.get("result") or item.get("status") == "completed")
    ):
        return True
    response = chunk.get("response")
    output = response.get("output") if isinstance(response, dict) else None
    if isinstance(output, list):
        return any(
            isinstance(item, dict)
            and item.get("type") == "image_generation_call"
            and (item.get("result") or item.get("status") == "completed")
            for item in output
        )
    return False


def _stream_with_deferred_quota(
        chunks: Iterator[dict[str, object]],
        *,
        identity: dict[str, object],
        amount: int,
        consume_on_completion: bool = False,
) -> Iterator[dict[str, object]]:
    has_result = False
    for chunk in chunks:
        if _stream_chunk_has_image_result(chunk):
            has_result = True
        yield chunk
    if has_result or consume_on_completion:
        auth_service.consume_quota(identity, amount)


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


def _emit_image_job_progress(
        progress: ImageJobProgressCallback | None,
        stage: str,
        message: str,
        percent: int | None = None,
) -> None:
    if progress is not None:
        progress(stage, message, percent)


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
        wait_for_slot: bool = False,
        progress: ImageJobProgressCallback | None = None,
) -> dict[str, object]:
    try:
        _emit_image_job_progress(progress, "waiting_slot", "等待处理", 20)
        with image_concurrency_service.acquire(identity, wait=wait_for_slot):
            _emit_image_job_progress(progress, "upstream_request", "正在生成", 35)
            result = chatgpt_service.generate_with_pool(prompt, model, n, size, "b64_json", base_url)
        result_count = len(result.get("data") or [])
        records: list[dict[str, object]] = []
        if result_count > 0:
            _emit_image_job_progress(progress, "saving_result", "正在生成", 82)
            auth_service.consume_quota(identity, result_count)
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
        return format_image_api_result(result, records, response_format)
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
    except ImageConcurrencyLimitError as exc:
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
            metadata={"stream": False, "n": n, "size": size, "limit": "concurrency"},
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
        wait_for_slot: bool = False,
        progress: ImageJobProgressCallback | None = None,
) -> dict[str, object]:
    try:
        _emit_image_job_progress(progress, "waiting_slot", "等待处理", 20)
        with image_concurrency_service.acquire(identity, wait=wait_for_slot):
            _emit_image_job_progress(progress, "upstream_request", "正在生成", 35)
            result = chatgpt_service.edit_with_pool(prompt, images, model, n, size, "b64_json", base_url)
        result_count = len(result.get("data") or [])
        records: list[dict[str, object]] = []
        if result_count > 0:
            _emit_image_job_progress(progress, "saving_result", "正在生成", 82)
            auth_service.consume_quota(identity, result_count)
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
        return format_image_api_result(result, records, response_format)
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
    except ImageConcurrencyLimitError as exc:
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
            metadata={"stream": False, "n": n, "size": size, "limit": "concurrency"},
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
            return StreamingResponse(
                sse_json_stream(
                    _stream_with_deferred_quota(
                        chatgpt_service.stream_image_generation(
                            body.prompt, body.model, body.n, body.size, body.response_format, base_url
                        ),
                        identity=identity,
                        amount=body.n,
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
        except ImageConcurrencyLimitError as exc:
            raise HTTPException(status_code=429, detail={"error": str(exc)}) from exc

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
            kind="images.generations",
            metadata={
                "route": "/v1/images/generations",
                "model": body.model,
                "n": body.n,
                "size": body.size or "auto",
                "project_id": body.project_id or "default",
                "response_format": body.response_format,
                "prompt_preview": body.prompt[:220],
            },
            payload={
                "kind": "images.generations",
                "prompt": body.prompt,
                "model": body.model,
                "n": body.n,
                "size": body.size,
                "response_format": body.response_format,
                "base_url": base_url,
                "project_id": body.project_id,
            },
            task_factory=lambda job_id: lambda: _run_generation_request(
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
                wait_for_slot=True,
                progress=lambda stage, message, percent=None: image_job_service.update_progress(
                    job_id,
                    stage=stage,
                    message=message,
                    progress_percent=percent,
                ),
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
            return StreamingResponse(
                sse_json_stream(
                    _stream_with_deferred_quota(
                        chatgpt_service.stream_image_edit(prompt, images, model, n, size, response_format, base_url),
                        identity=identity,
                        amount=n,
                    )
                ),
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
        except ImageConcurrencyLimitError as exc:
            raise HTTPException(status_code=429, detail={"error": str(exc)}) from exc

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
            kind="images.edits",
            metadata={
                "route": "/v1/images/edits",
                "model": model,
                "n": n,
                "size": size or "auto",
                "project_id": project_id or "default",
                "response_format": response_format,
                "image_count": len(images),
                "prompt_preview": prompt[:220],
            },
            payload={
                "kind": "images.edits",
                "prompt": prompt,
                "model": model,
                "n": n,
                "size": size,
                "response_format": response_format,
                "base_url": base_url,
                "project_id": project_id,
                "images": _encode_job_images(images),
            },
            task_factory=lambda job_id: lambda: _run_edit_request(
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
                wait_for_slot=True,
                progress=lambda stage, message, percent=None: image_job_service.update_progress(
                    job_id,
                    stage=stage,
                    message=message,
                    progress_percent=percent,
                ),
            ),
        )
        return {"job": job}

    @router.get("/api/image/jobs")
    async def list_image_jobs(limit: int = 100, authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        return {"items": image_job_service.list(identity, limit)}

    @router.get("/api/image/jobs/{job_id}")
    async def get_image_job(job_id: str, authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        job = image_job_service.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail={"error": "image job not found"})
        if identity.get("role") != "admin" and str(job.get("subject_id") or "") != str(identity.get("id") or ""):
            raise HTTPException(status_code=403, detail={"error": "image job permission denied"})
        return {"job": job}

    @router.post("/api/image/jobs/{job_id}/retry")
    async def retry_image_job(job_id: str, authorization: str | None = Header(default=None)):
        identity = require_identity(authorization)
        existing_job = image_job_service.get(job_id)
        if existing_job is None:
            raise HTTPException(status_code=404, detail={"error": "image job not found"})
        if identity.get("role") != "admin" and str(existing_job.get("subject_id") or "") != str(identity.get("id") or ""):
            raise HTTPException(status_code=403, detail={"error": "image job permission denied"})
        payload = existing_job.get("payload")
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail={"error": "image job cannot be retried"})

        subject_id = str(existing_job.get("subject_id") or "")
        retry_identity = identity
        if subject_id and subject_id != str(identity.get("id") or ""):
            owner_identity = auth_service.get_identity_by_id(subject_id)
            if owner_identity is None:
                raise HTTPException(status_code=409, detail={"error": "image job owner key is missing or disabled"})
            retry_identity = owner_identity
        elif identity.get("role") == "user":
            retry_identity = auth_service.get_identity_by_id(str(identity.get("id") or "")) or identity

        retry_kind = str(payload.get("kind") or existing_job.get("kind") or "")
        retry_model = str(payload.get("model") or "gpt-image-2")
        retry_amount = _normalize_image_amount(payload.get("n"))
        retry_mode = "edit" if retry_kind == "images.edits" else "generate"
        _ensure_image_request_allowed(retry_identity, model=retry_model, amount=retry_amount, mode=retry_mode)
        try:
            auth_service.ensure_quota_available(retry_identity, retry_amount)
        except ValueError as exc:
            raise HTTPException(status_code=429, detail={"error": str(exc)}) from exc

        def build_retry_task(job: dict[str, object]) -> Callable[[], dict[str, object]] | None:
            payload = job.get("payload")
            if not isinstance(payload, dict):
                return None
            run_identity = retry_identity
            base_url = str(payload.get("base_url") or "").strip()
            if not base_url:
                return None
            kind = str(payload.get("kind") or job.get("kind") or "")
            if kind == "images.generations":
                return lambda: _run_generation_request(
                    chatgpt_service=chatgpt_service,
                    identity=run_identity,
                    prompt=str(payload.get("prompt") or ""),
                    model=str(payload.get("model") or "gpt-image-2"),
                    n=_normalize_image_amount(payload.get("n")),
                    size=str(payload.get("size") or "") or None,
                    response_format=str(payload.get("response_format") or "url"),
                    base_url=base_url,
                    started_at=time.perf_counter(),
                    project_id=str(payload.get("project_id") or "") or None,
                    wait_for_slot=True,
                    progress=lambda stage, message, percent=None: image_job_service.update_progress(
                        job_id,
                        stage=stage,
                        message=message,
                        progress_percent=percent,
                    ),
                )
            if kind == "images.edits":
                images = _decode_job_images(payload.get("images"))
                if not images:
                    return None
                return lambda: _run_edit_request(
                    chatgpt_service=chatgpt_service,
                    identity=run_identity,
                    prompt=str(payload.get("prompt") or ""),
                    images=images,
                    model=str(payload.get("model") or "gpt-image-2"),
                    n=_normalize_image_amount(payload.get("n")),
                    size=str(payload.get("size") or "") or None,
                    response_format=str(payload.get("response_format") or "url"),
                    base_url=base_url,
                    started_at=time.perf_counter(),
                    project_id=str(payload.get("project_id") or "") or None,
                    wait_for_slot=True,
                    progress=lambda stage, message, percent=None: image_job_service.update_progress(
                        job_id,
                        stage=stage,
                        message=message,
                        progress_percent=percent,
                    ),
                )
            return None

        try:
            job = image_job_service.retry(job_id, identity, build_retry_task)
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail={"error": str(exc)}) from exc
        except ValueError as exc:
            raise HTTPException(status_code=409, detail={"error": str(exc)}) from exc
        if job is None:
            raise HTTPException(status_code=404, detail={"error": "image job not found or cannot be retried"})
        activity_log_service.record(
            event="image.jobs.retry",
            status="accepted",
            route=f"/api/image/jobs/{job_id}/retry",
            role=str(identity.get("role") or ""),
            subject_id=str(identity.get("id") or ""),
            prompt=f"retry image job {job_id}",
            metadata={"job_id": job_id, "attempts": job.get("attempts")},
        )
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
            stream = chatgpt_service.stream_chat_completion(payload)
            if is_image_request:
                stream = _stream_with_deferred_quota(
                    stream,
                    identity=identity,
                    amount=image_amount,
                    consume_on_completion=True,
                )
            return StreamingResponse(
                sse_json_stream(stream),
                media_type="text/event-stream",
            )
        try:
            result = await run_in_threadpool(chatgpt_service.create_chat_completion, payload)
            if is_image_request:
                auth_service.consume_quota(identity, image_amount)
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
            stream = chatgpt_service.stream_response(payload)
            if is_image_request:
                stream = _stream_with_deferred_quota(
                    stream,
                    identity=identity,
                    amount=1,
                    consume_on_completion=True,
                )
            return StreamingResponse(
                sse_json_stream(stream),
                media_type="text/event-stream",
            )
        try:
            result = await run_in_threadpool(chatgpt_service.create_response, payload)
            if is_image_request:
                auth_service.consume_quota(identity, 1)
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
