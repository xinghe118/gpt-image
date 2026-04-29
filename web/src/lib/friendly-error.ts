function extractUpstreamReason(message: string) {
  const match = message.match(/upstream_reason=(.*)$/i);
  return match?.[1]?.trim() || "";
}

export function toFriendlyErrorMessage(value: unknown) {
  const raw = value instanceof Error ? value.message : String(value || "");
  const message = raw.trim();
  const lower = message.toLowerCase();
  const upstreamReason = extractUpstreamReason(message).toLowerCase();

  if (lower.includes("no downloadable image result found")) {
    if (
      upstreamReason.includes("can't assist") ||
      upstreamReason.includes("cannot assist") ||
      upstreamReason.includes("unable to assist") ||
      upstreamReason.includes("policy")
    ) {
      return "上游拒绝了这次生成。请调整提示词或参考图，避开真人敏感内容、未成年人、暴力、色情或违规用途后再试。";
    }
    if (upstreamReason) {
      return "上游没有返回可用图片，请调整提示词或参考图后重试。";
    }
    return "本次没有生成可下载图片。可能是上游生成失败或结果超时，请稍后重试。";
  }

  if (lower.includes("no available image quota")) {
    return "当前账号池没有可用图片额度，请更换账号或等待额度恢复。";
  }

  if (lower.includes("user key quota exhausted")) {
    return "当前用户密钥额度已用完，请联系管理员调整额度。";
  }

  if (lower.includes("authorization is invalid")) {
    return "登录密钥无效或已过期，请重新登录。";
  }

  if (lower.includes("admin permission required") || lower.includes("permission denied")) {
    return "当前密钥没有权限执行这个操作。";
  }

  if (lower.includes("image file is required")) {
    return "请先上传参考图片。";
  }

  if (lower.includes("image file is empty")) {
    return "上传的图片为空，请重新选择图片。";
  }

  if (lower.includes("prompt is required") || lower.includes("input text is required")) {
    return "请输入提示词后再提交。";
  }

  if (lower.includes("current plan allows at most")) {
    return "当前用户套餐不支持这么多张图片，请减少生成张数。";
  }

  if (lower.includes("current plan does not allow image edits")) {
    return "当前用户套餐不支持图生图或图片编辑。";
  }

  if (lower.includes("current plan does not allow model")) {
    return "当前用户套餐不支持所选模型。";
  }

  if (lower.includes("network error")) {
    return "网络连接失败，请检查服务器、代理或上游连接后重试。";
  }

  if (lower.includes("request failed with status code 524") || lower.includes("timeout")) {
    return "请求处理超时，图片可能仍在上游生成中。请稍后重试或降低生成张数。";
  }

  if (lower.includes("request failed with status code 502") || lower.includes("request failed with status code 500")) {
    return "图片服务暂时异常，请稍后重试。";
  }

  return message || "操作失败，请稍后重试。";
}
