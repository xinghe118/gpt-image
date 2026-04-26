from __future__ import annotations

from dataclasses import dataclass
import json
import os
import sys
from pathlib import Path
from typing import Any

from services.storage.base import StorageBackend

BASE_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BASE_DIR / "data"
CONFIG_FILE = BASE_DIR / "config.json"
VERSION_FILE = BASE_DIR / "VERSION"
LEGACY_ENV_PREFIX = "CHATGPT" + "2API"


@dataclass(frozen=True)
class LoadedSettings:
    auth_key: str
    refresh_account_interval_minute: int


def _normalize_auth_key(value: object) -> str:
    return str(value or "").strip()


def _is_invalid_auth_key(value: object) -> bool:
    return _normalize_auth_key(value) == ""


def _as_bool(value: object, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "on", "yes", "是", "启用", "开启"}
    return bool(value)


def _read_json_object(path: Path, *, name: str) -> dict[str, object]:
    if not path.exists():
        return {}
    if path.is_dir():
        print(
            f"Warning: {name} at '{path}' is a directory, ignoring it and falling back to other configuration sources.",
            file=sys.stderr,
        )
        return {}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _load_settings() -> LoadedSettings:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    raw_config = _read_json_object(CONFIG_FILE, name="config.json")
    auth_key = _normalize_auth_key(
        os.getenv("GPT_IMAGE_AUTH_KEY")
        or os.getenv(f"{LEGACY_ENV_PREFIX}_AUTH_KEY")
        or raw_config.get("auth-key")
    )
    if _is_invalid_auth_key(auth_key):
        raise ValueError(
            "❌ auth-key 未设置！\n"
            "请在环境变量 GPT_IMAGE_AUTH_KEY 中设置，或者在 config.json 中填写 auth-key。"
        )

    try:
        refresh_interval = int(raw_config.get("refresh_account_interval_minute", 5))
    except (TypeError, ValueError):
        refresh_interval = 5

    return LoadedSettings(
        auth_key=auth_key,
        refresh_account_interval_minute=refresh_interval,
    )


class ConfigStore:
    def __init__(self, path: Path):
        self.path = path
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        self.data = self._load()
        self._storage_backend: StorageBackend | None = None
        if _is_invalid_auth_key(self.auth_key):
            raise ValueError(
                "❌ auth-key 未设置！\n"
                "请按以下任意一种方式解决：\n"
                "1. 在 Render 的 Environment 变量中添加：\n"
                "   GPT_IMAGE_AUTH_KEY = your_real_auth_key\n"
                "2. 或者在 config.json 中填写：\n"
                '   "auth-key": "your_real_auth_key"'
            )

    def _load(self) -> dict[str, object]:
        return _read_json_object(self.path, name="config.json")

    def _save(self) -> None:
        self.path.write_text(json.dumps(self.data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    @property
    def auth_key(self) -> str:
        return _normalize_auth_key(
            os.getenv("GPT_IMAGE_AUTH_KEY")
            or os.getenv(f"{LEGACY_ENV_PREFIX}_AUTH_KEY")
            or self.data.get("auth-key")
        )

    @property
    def accounts_file(self) -> Path:
        return DATA_DIR / "accounts.json"

    @property
    def refresh_account_interval_minute(self) -> int:
        try:
            return int(self.data.get("refresh_account_interval_minute", 5))
        except (TypeError, ValueError):
            return 5

    @property
    def images_dir(self) -> Path:
        path = DATA_DIR / "images"
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def base_url(self) -> str:
        return str(
            os.getenv("GPT_IMAGE_BASE_URL")
            or os.getenv(f"{LEGACY_ENV_PREFIX}_BASE_URL")
            or self.data.get("base_url")
            or ""
        ).strip().rstrip("/")

    @property
    def show_image_model_selector(self) -> bool:
        value = self.data.get("show_image_model_selector", True)
        if isinstance(value, str):
            return value.strip().lower() not in {"0", "false", "off", "no", "否", "关闭"}
        return bool(value)

    @property
    def default_image_model(self) -> str:
        return "gpt-image-2"

    def object_storage_config(self) -> dict[str, Any]:
        return {
            "enabled": _as_bool(self.data.get("object_storage_enabled"), False),
            "endpoint": str(self.data.get("object_storage_endpoint") or "").strip().rstrip("/"),
            "bucket": str(self.data.get("object_storage_bucket") or "").strip(),
            "region": str(self.data.get("object_storage_region") or "auto").strip() or "auto",
            "access_key_id": str(self.data.get("object_storage_access_key_id") or "").strip(),
            "secret_access_key": str(self.data.get("object_storage_secret_access_key") or "").strip(),
            "public_base_url": str(self.data.get("object_storage_public_base_url") or "").strip().rstrip("/"),
            "prefix": str(self.data.get("object_storage_prefix") or "images").strip().strip("/"),
        }

    def public_object_storage_config(self) -> dict[str, Any]:
        data = self.object_storage_config()
        secret = data.pop("secret_access_key", "")
        data["has_secret_access_key"] = bool(secret)
        return data

    @property
    def app_version(self) -> str:
        try:
            value = VERSION_FILE.read_text(encoding="utf-8").strip()
        except FileNotFoundError:
            return "0.0.0"
        return value or "0.0.0"

    def get(self) -> dict[str, object]:
        data = dict(self.data)
        data.pop("auth-key", None)
        object_storage = self.public_object_storage_config()
        data.setdefault("show_image_model_selector", self.show_image_model_selector)
        data.setdefault("object_storage_enabled", object_storage["enabled"])
        data.setdefault("object_storage_endpoint", object_storage["endpoint"])
        data.setdefault("object_storage_bucket", object_storage["bucket"])
        data.setdefault("object_storage_region", object_storage["region"])
        data.setdefault("object_storage_access_key_id", object_storage["access_key_id"])
        data.setdefault("object_storage_secret_access_key", "")
        data.setdefault("object_storage_public_base_url", object_storage["public_base_url"])
        data.setdefault("object_storage_prefix", object_storage["prefix"])
        data["object_storage_has_secret_access_key"] = object_storage["has_secret_access_key"]
        return data

    def get_proxy_settings(self) -> str:
        return str(self.data.get("proxy") or "").strip()

    def update(self, data: dict[str, object]) -> dict[str, object]:
        next_data = dict(self.data)
        next_data.update(dict(data or {}))
        self.data = next_data
        self._save()
        return self.get()

    def get_storage_backend(self) -> StorageBackend:
        """获取存储后端实例（单例）"""
        if self._storage_backend is None:
            from services.storage.factory import create_storage_backend
            self._storage_backend = create_storage_backend(DATA_DIR)
        return self._storage_backend


config = ConfigStore(CONFIG_FILE)
