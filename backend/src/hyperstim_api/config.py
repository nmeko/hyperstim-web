"""Settings, read only from environment variables."""

import os
from dataclasses import dataclass
from pathlib import Path

DEFAULT_LIMIT_PER_IP = 20  # new analyses per IP per hour when ANALYSIS_LIMIT_PER_IP is unset
DEFAULT_LIMIT_PER_DAY = 1000  # new analyses in 24 hours when ANALYSIS_LIMIT_PER_DAY is unset


@dataclass(frozen=True)
class Settings:
    dataset_path: Path
    cors_origin: str
    analysis_dir: Path
    thumbnail_dir: Path
    ytdlp_cookies: Path | None = None
    youtube_api_key: str | None = None  # None = no made-for-kids check
    analysis_limit_per_ip: int = DEFAULT_LIMIT_PER_IP  # 0 = no limit
    analysis_limit_per_day: int = DEFAULT_LIMIT_PER_DAY  # 0 = no limit
    api_docs: bool = True  # /docs, /redoc, /openapi.json
    collected_dir: Path | None = None  # the collector's files (plan 013); None: reference set only
    collected_reload_s: int = 300  # how often to look for new ones
    usage_dir: Path | None = None  # daily usage counts (plan 014); None: not counted


def _required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Environment variable {name} is not set (see .env.example).")
    return value


def _limit(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        value = -1
    if value < 0:
        raise RuntimeError(f"Environment variable {name} must be a whole number ≥ 0, got {raw!r}.")
    return value


def _flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    if raw not in ("0", "1"):
        raise RuntimeError(f"Environment variable {name} must be 0 or 1, got {raw!r}.")
    return raw == "1"


def load_settings() -> Settings:
    cookies = os.environ.get("YTDLP_COOKIES", "").strip()
    collected = os.environ.get("COLLECTED_DIR", "").strip()
    usage = os.environ.get("USAGE_DIR", "").strip()
    return Settings(
        dataset_path=Path(_required("DATASET_PATH")),
        cors_origin=_required("CORS_ORIGIN").rstrip("/"),
        analysis_dir=Path(_required("ANALYSIS_DIR")),
        thumbnail_dir=Path(_required("THUMBNAIL_DIR")),
        ytdlp_cookies=Path(cookies) if cookies else None,
        youtube_api_key=os.environ.get("YOUTUBE_API_KEY", "").strip() or None,
        analysis_limit_per_ip=_limit("ANALYSIS_LIMIT_PER_IP", DEFAULT_LIMIT_PER_IP),
        analysis_limit_per_day=_limit("ANALYSIS_LIMIT_PER_DAY", DEFAULT_LIMIT_PER_DAY),
        api_docs=_flag("API_DOCS", default=True),
        collected_dir=Path(collected) if collected else None,
        collected_reload_s=_limit("COLLECTED_RELOAD_S", 300) or 300,
        usage_dir=Path(usage) if usage else None,
    )
