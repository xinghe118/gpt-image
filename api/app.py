from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timezone
from threading import Event
import traceback

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from api import accounts, ai, conversations, projects, system
from api.support import resolve_web_asset, start_limited_account_watcher
from services.account_service import account_service
from services.chatgpt_service import ChatGPTService
from services.config import config


class CacheControlStaticFiles(StaticFiles):
    async def get_response(self, path: str, scope):
        response = await super().get_response(path, scope)
        response.headers.setdefault("Cache-Control", "public, max-age=604800, immutable")
        return response


def create_app() -> FastAPI:
    chatgpt_service = ChatGPTService(account_service)
    app_version = config.app_version

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        stop_event = Event()
        thread = start_limited_account_watcher(stop_event)
        try:
            yield
        finally:
            stop_event.set()
            thread.join(timeout=1)

    app = FastAPI(title="GPT Image", version=app_version, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(ai.create_router(chatgpt_service))
    app.include_router(conversations.create_router())
    app.include_router(projects.create_router())
    app.include_router(accounts.create_router())
    app.include_router(system.create_router(app_version))

    @app.exception_handler(Exception)
    async def handle_unexpected_error(request: Request, exc: Exception):
        error_log = config.images_dir.parent / "server_errors.log"
        error_log.parent.mkdir(parents=True, exist_ok=True)
        with error_log.open("a", encoding="utf-8") as handle:
            handle.write(f"\n[{datetime.now(timezone.utc).isoformat()}] {request.method} {request.url.path}\n")
            handle.write("".join(traceback.format_exception(type(exc), exc, exc.__traceback__)))
            handle.write("\n")
        return JSONResponse(
            status_code=500,
            content={"detail": {"error": f"服务器内部错误：{exc}"}},
        )

    if config.images_dir.exists():
        app.mount("/images", CacheControlStaticFiles(directory=str(config.images_dir)), name="images")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_web(full_path: str):
        asset = resolve_web_asset(full_path)
        if asset is not None:
            if full_path.strip("/").startswith("_next/static/"):
                headers = {"Cache-Control": "public, max-age=31536000, immutable"}
            else:
                headers = {"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"}
            return FileResponse(asset, headers=headers)
        if full_path.strip("/").startswith("_next/"):
            raise HTTPException(status_code=404, detail="Not Found")
        fallback = resolve_web_asset("")
        if fallback is None:
            raise HTTPException(status_code=404, detail="Not Found")
        headers = {"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"}
        return FileResponse(fallback, headers=headers)

    return app
