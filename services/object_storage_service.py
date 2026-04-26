from __future__ import annotations

import hashlib
import hmac
import time
from pathlib import Path
from urllib.parse import quote, urlparse

from curl_cffi import requests

from services.config import config


def _sign(key: bytes, message: str) -> bytes:
    return hmac.new(key, message.encode("utf-8"), hashlib.sha256).digest()


def _signature_key(secret: str, date_stamp: str, region: str) -> bytes:
    date_key = _sign(("AWS4" + secret).encode("utf-8"), date_stamp)
    region_key = _sign(date_key, region)
    service_key = _sign(region_key, "s3")
    return _sign(service_key, "aws4_request")


def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


class ObjectStorageService:
    def config(self) -> dict[str, object]:
        return config.public_object_storage_config()

    def enabled(self) -> bool:
        return bool(config.object_storage_config().get("enabled"))

    def upload_image(self, image_data: bytes, *, file_name: str, content_type: str = "image/png") -> str:
        settings = config.object_storage_config()
        if not settings.get("enabled"):
            raise RuntimeError("object storage is not enabled")

        endpoint = str(settings.get("endpoint") or "").rstrip("/")
        bucket = str(settings.get("bucket") or "").strip()
        region = str(settings.get("region") or "auto").strip() or "auto"
        access_key = str(settings.get("access_key_id") or "").strip()
        secret_key = str(settings.get("secret_access_key") or "").strip()
        prefix = str(settings.get("prefix") or "images").strip().strip("/")
        public_base_url = str(settings.get("public_base_url") or "").strip().rstrip("/")

        if not endpoint or not bucket or not access_key or not secret_key:
            raise RuntimeError("object storage endpoint, bucket and credentials are required")

        relative_dir = Path(time.strftime("%Y"), time.strftime("%m"), time.strftime("%d")).as_posix()
        object_key = "/".join(part for part in [prefix, relative_dir, file_name] if part)
        encoded_key = "/".join(quote(part, safe="") for part in object_key.split("/"))
        parsed = urlparse(endpoint)
        if not parsed.scheme or not parsed.netloc:
            raise RuntimeError("object storage endpoint is invalid")

        url = f"{endpoint}/{bucket}/{encoded_key}"
        canonical_uri = f"/{bucket}/{encoded_key}"
        payload_hash = _sha256_hex(image_data)
        amz_date = time.strftime("%Y%m%dT%H%M%SZ", time.gmtime())
        date_stamp = amz_date[:8]
        host = parsed.netloc
        canonical_headers = (
            f"content-type:{content_type}\n"
            f"host:{host}\n"
            f"x-amz-content-sha256:{payload_hash}\n"
            f"x-amz-date:{amz_date}\n"
        )
        signed_headers = "content-type;host;x-amz-content-sha256;x-amz-date"
        canonical_request = "\n".join(
            [
                "PUT",
                canonical_uri,
                "",
                canonical_headers,
                signed_headers,
                payload_hash,
            ]
        )
        credential_scope = f"{date_stamp}/{region}/s3/aws4_request"
        string_to_sign = "\n".join(
            [
                "AWS4-HMAC-SHA256",
                amz_date,
                credential_scope,
                _sha256_hex(canonical_request.encode("utf-8")),
            ]
        )
        signing_key = _signature_key(secret_key, date_stamp, region)
        signature = hmac.new(signing_key, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()
        authorization = (
            f"AWS4-HMAC-SHA256 Credential={access_key}/{credential_scope}, "
            f"SignedHeaders={signed_headers}, Signature={signature}"
        )

        response = requests.put(
            url,
            data=image_data,
            headers={
                "Authorization": authorization,
                "Content-Type": content_type,
                "Host": host,
                "x-amz-content-sha256": payload_hash,
                "x-amz-date": amz_date,
            },
            timeout=120,
        )
        if response.status_code >= 400:
            raise RuntimeError(f"object storage upload failed: HTTP {response.status_code} {response.text[:200]}")

        if public_base_url:
            return f"{public_base_url}/{encoded_key}"
        return url

    def health_check(self) -> dict[str, object]:
        settings = config.object_storage_config()
        required = ["endpoint", "bucket", "access_key_id", "secret_access_key"]
        missing = [key for key in required if not str(settings.get(key) or "").strip()]
        if not settings.get("enabled"):
            return {"status": "disabled", "enabled": False, "missing": missing}
        if missing:
            return {"status": "incomplete", "enabled": True, "missing": missing}
        return {
            "status": "configured",
            "enabled": True,
            "endpoint": settings.get("endpoint"),
            "bucket": settings.get("bucket"),
            "region": settings.get("region"),
            "public_base_url": settings.get("public_base_url"),
        }

    def test_upload(self) -> dict[str, object]:
        data = b"gpt-image object storage test"
        file_name = f"healthcheck_{int(time.time())}.txt"
        url = self.upload_image(data, file_name=file_name, content_type="text/plain")
        return {"ok": True, "url": url}


object_storage_service = ObjectStorageService()
