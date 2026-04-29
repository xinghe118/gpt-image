from __future__ import annotations

import re
from typing import Any


def _clean(value: object) -> str:
    return str(value or "").strip()


def _extract_upstream_reason(message: str) -> str:
    match = re.search(r"upstream_reason=(.*)$", message, flags=re.IGNORECASE | re.DOTALL)
    return _clean(match.group(1)) if match else ""


def friendly_error_message(value: object, *, status_code: int | None = None) -> str:
    message = _clean(value)
    lower = message.lower()
    upstream_reason = _extract_upstream_reason(message).lower()

    if not message:
        return "操作失败，请稍后重试。"

    if "authorization is invalid" in lower:
        return "登录密钥无效或已过期，请重新登录。"
    if "admin permission required" in lower or "permission denied" in lower:
        return "当前密钥没有权限执行这个操作。"
    if "not found" in lower:
        return "目标数据不存在或已经被删除。"

    if "no downloadable image result found" in lower:
        if any(text in upstream_reason for text in ["can't assist", "cannot assist", "unable to assist", "policy"]):
            return "上游拒绝了这次生成。请调整提示词或参考图，避开真人敏感内容、未成年人、暴力、色情或违规用途后再试。"
        if upstream_reason:
            return "上游没有返回可用图片，请调整提示词或参考图后重试。"
        return "本次没有生成可下载图片。可能是上游生成失败或结果超时，请稍后重试。"

    if "no available image quota" in lower:
        return "当前账号池没有可用图片额度，请更换账号或等待额度恢复。"
    if "user key quota exhausted" in lower:
        return "当前用户密钥额度已用完，请联系管理员调整额度。"
    if "current plan allows at most" in lower:
        return "当前用户套餐不支持这么多张图片，请减少生成张数。"
    if "current plan does not allow image edits" in lower:
        return "当前用户套餐不支持图生图或图片编辑。"
    if "current plan does not allow model" in lower:
        return "当前用户套餐不支持所选模型。"

    if "image file is required" in lower:
        return "请先上传参考图片。"
    if "image file is empty" in lower:
        return "上传的图片为空，请重新选择图片。"
    if "prompt is required" in lower or "input text is required" in lower:
        return "请输入提示词后再提交。"
    if "n must be between" in lower:
        return "生成张数超出允许范围，请调整后重试。"

    if "network error" in lower or "connection refused" in lower:
        return "网络连接失败，请检查服务器、代理或上游连接后重试。"
    if "request failed with status code 524" in lower or "timeout" in lower:
        return "请求处理超时，图片可能仍在上游生成中。请稍后重试或降低生成张数。"
    if "request failed with status code 502" in lower or status_code == 502:
        return "上游图片服务暂时不可用，请稍后重试。"
    if "request failed with status code 500" in lower or status_code == 500:
        return "服务器处理失败，请稍后重试；如果持续出现，请查看日志中心。"

    return message


def error_code_for(status_code: int, message: object) -> str:
    lower = _clean(message).lower()
    if status_code == 401:
        return "AUTH_INVALID"
    if status_code == 403:
        return "PERMISSION_DENIED"
    if status_code == 404:
        return "NOT_FOUND"
    if status_code == 429:
        return "RATE_OR_QUOTA_LIMITED"
    if "quota" in lower or "额度" in lower:
        return "QUOTA_LIMITED"
    if "timeout" in lower or "524" in lower:
        return "UPSTREAM_TIMEOUT"
    if "no downloadable image result found" in lower:
        return "IMAGE_RESULT_MISSING"
    if status_code >= 500:
        return "SERVER_ERROR"
    return "REQUEST_ERROR"


def public_error_payload(
        *,
        status_code: int,
        message: object,
        code: str | None = None,
        expose_raw: bool = False,
) -> dict[str, Any]:
    raw = _clean(message)
    friendly = friendly_error_message(raw, status_code=status_code)
    detail: dict[str, Any] = {
        "code": code or error_code_for(status_code, raw),
        "error": friendly,
        "message": friendly,
    }
    if expose_raw and raw and raw != friendly:
        detail["raw_error"] = raw
    return {"detail": detail}
