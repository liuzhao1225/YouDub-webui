from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import SplitResult, parse_qs, urlparse, urlsplit, urlunsplit


YOUTUBE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
BILIBILI_BV_RE = re.compile(r"BV[A-Za-z0-9]{10}")
REMOTE_URL_UNSAFE_RE = re.compile(r"[\\\x00-\x20\x7f]")
YOUTUBE_LONG_HOSTS = {"youtube.com", "www.youtube.com", "m.youtube.com"}
YOUTUBE_SHORT_HOSTS = {"youtu.be"}
BILIBILI_HOSTS = {"bilibili.com", "www.bilibili.com"}
DEFAULT_HTTP_PORTS = {"http": 80, "https": 443}
LOCAL_UPLOAD_SCHEME = "local"
LOCAL_UPLOAD_HOST = "upload"
LOCAL_UPLOAD_DIRECTIONS = {"en-zh", "zh-en"}
LOCAL_UPLOAD_TASK_ID_RE = re.compile(r"^[A-Za-z0-9_-]+$")


@dataclass(frozen=True)
class ValidatedVideoURL:
    source: str
    video_id: str
    url: str


def _parse_remote_video_url(url: str) -> tuple[SplitResult, str] | None:
    candidate = url.strip()
    if not candidate or REMOTE_URL_UNSAFE_RE.search(candidate):
        return None
    try:
        parsed = urlsplit(candidate)
        hostname = parsed.hostname
        port = parsed.port
        username = parsed.username
        password = parsed.password
    except (TypeError, ValueError):
        return None

    scheme = parsed.scheme.lower()
    if scheme not in DEFAULT_HTTP_PORTS or not hostname:
        return None
    if username is not None or password is not None:
        return None
    if parsed.netloc.endswith(":"):
        return None
    if port is not None and port != DEFAULT_HTTP_PORTS[scheme]:
        return None
    return parsed, hostname.lower()


def _extract_youtube_video(
    parsed: SplitResult, host: str
) -> tuple[str, str, str] | None:
    path = parsed.path.strip("/")
    parts = path.split("/") if path else []

    if host in YOUTUBE_SHORT_HOSTS:
        candidate = parts[0] if len(parts) == 1 else ""
        if YOUTUBE_ID_RE.match(candidate):
            return candidate, f"/{candidate}", ""
        return None

    if host not in YOUTUBE_LONG_HOSTS:
        return None

    if parts == ["watch"]:
        query_id = parse_qs(parsed.query).get("v", [""])[0]
        if YOUTUBE_ID_RE.match(query_id):
            return query_id, "/watch", f"v={query_id}"

    if (
        len(parts) == 2
        and parts[0] in {"shorts", "embed", "live"}
        and YOUTUBE_ID_RE.match(parts[1])
    ):
        return parts[1], f"/{parts[0]}/{parts[1]}", ""
    return None


def _extract_bilibili_video(
    parsed: SplitResult, host: str
) -> tuple[str, str, str] | None:
    if host not in BILIBILI_HOSTS:
        return None
    parts = parsed.path.strip("/").split("/")
    if len(parts) == 2 and parts[0] == "video" and BILIBILI_BV_RE.fullmatch(parts[1]):
        return parts[1], f"/video/{parts[1]}", ""
    return None


def validate_video_url(url: str) -> ValidatedVideoURL:
    parsed_host = _parse_remote_video_url(url)
    if parsed_host is not None:
        parsed, host = parsed_host
        video = _extract_youtube_video(parsed, host)
        source = "youtube"
        if video is None:
            video = _extract_bilibili_video(parsed, host)
            source = "bilibili"
        if video is not None:
            video_id, canonical_path, canonical_query = video
            canonical_url = urlunsplit(
                (
                    parsed.scheme.lower(),
                    host,
                    canonical_path,
                    canonical_query,
                    "",
                )
            )
            return ValidatedVideoURL(source=source, video_id=video_id, url=canonical_url)
    raise ValueError("Only YouTube or Bilibili single-video URLs are supported.")


def extract_video_id(url: str) -> str:
    return validate_video_url(url).video_id


def is_youtube_url(url: str) -> bool:
    try:
        return validate_video_url(url).source == "youtube"
    except ValueError:
        return False


def is_bilibili_url(url: str) -> bool:
    try:
        return validate_video_url(url).source == "bilibili"
    except ValueError:
        return False


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
