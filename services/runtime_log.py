from __future__ import annotations

import logging
from typing import Any


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
)


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)


def log_event(logger: logging.Logger, event: str, message: str, **fields: Any) -> None:
    suffix = ""
    if fields:
        parts = [f"{key}={value}" for key, value in fields.items() if value is not None and value != ""]
        suffix = f" | {' '.join(parts)}" if parts else ""
    logger.info("%s: %s%s", event, message, suffix)
