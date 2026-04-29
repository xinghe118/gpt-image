from __future__ import annotations


def format_image_api_result(
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
        image_url = str(record.get("image_url") or item.get("url") or "").strip()
        b64_json = str(item.get("b64_json") or "").strip()

        if response_format == "url":
            if image_url:
                formatted.append({"url": image_url, "revised_prompt": revised_prompt})
            elif b64_json:
                formatted.append({"b64_json": b64_json, "revised_prompt": revised_prompt})
            continue

        next_item = dict(item)
        if image_url:
            next_item["url"] = image_url
        if revised_prompt:
            next_item["revised_prompt"] = revised_prompt
        formatted.append(next_item)
    return {"created": result.get("created"), "data": formatted}
