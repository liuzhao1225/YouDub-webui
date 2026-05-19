from __future__ import annotations

import re
from urllib.parse import parse_qs, urlparse


YOUTUBE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
BILIBILI_BV_RE = re.compile(r"BV[A-Za-z0-9]{10}")
BILIBILI_HOSTS = {"bilibili.com", "www.bilibili.com", "m.bilibili.com"}
LOCAL_UPLOAD_SCHEME = "local"
LOCAL_UPLOAD_HOST = "upload"
LOCAL_UPLOAD_DIRECTIONS = {"en-zh", "zh-en"}
LOCAL_UPLOAD_TASK_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")


def _extract_youtube_id(parsed) -> str | None:
    host = parsed.netloc.lower()
    path = parsed.path.strip("/")

    if host in {"youtu.be", "www.youtu.be"}:
        candidate = path.split("/")[0]
        if YOUTUBE_ID_RE.match(candidate):
            return candidate

    if "youtube.com" not in host:
        return None

    query_id = parse_qs(parsed.query).get("v", [""])[0]
    if YOUTUBE_ID_RE.match(query_id):
        return query_id

    parts = path.split("/")
    for prefix in ("shorts", "embed", "live"):
        if len(parts) >= 2 and parts[0] == prefix and YOUTUBE_ID_RE.match(parts[1]):
            return parts[1]
    return None


def _extract_bilibili_id(parsed) -> str | None:
    host = parsed.netloc.lower()
    if host not in BILIBILI_HOSTS:
        return None
    match = BILIBILI_BV_RE.search(parsed.path)
    if match:
        return match.group(0)
    return None


def extract_video_id(url: str) -> str:
    parsed = urlparse(url.strip())
    video_id = _extract_youtube_id(parsed) or _extract_bilibili_id(parsed)
    if video_id:
        return video_id
    raise ValueError("Only YouTube or Bilibili single-video URLs are supported.")


def is_youtube_url(url: str) -> bool:
    try:
        return _extract_youtube_id(urlparse(url.strip())) is not None
    except ValueError:
        return False


def is_bilibili_url(url: str) -> bool:
    return urlparse(url.strip()).netloc.lower() in BILIBILI_HOSTS


def local_upload_task_id(url: str) -> str:
    parsed = urlparse(url.strip())
    if parsed.scheme != LOCAL_UPLOAD_SCHEME or parsed.netloc != LOCAL_UPLOAD_HOST:
        return ""
    candidate = parsed.path.strip("/").split("/", maxsplit=1)[0]
    if not LOCAL_UPLOAD_TASK_ID_RE.match(candidate):
        return ""
    return candidate


def local_upload_direction(url: str) -> str:
    parsed = urlparse(url.strip())
    if not local_upload_task_id(url):
        return ""
    return parse_qs(parsed.query).get("direction", [""])[0]


def is_local_upload_url(url: str) -> bool:
    return bool(local_upload_task_id(url)) and local_upload_direction(url) in LOCAL_UPLOAD_DIRECTIONS


def is_local_en_to_zh_url(url: str) -> bool:
    return is_local_upload_url(url) and local_upload_direction(url) == "en-zh"


def is_local_zh_to_en_url(url: str) -> bool:
    return is_local_upload_url(url) and local_upload_direction(url) == "zh-en"
