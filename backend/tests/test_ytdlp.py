from pathlib import Path

import pytest

from backend.app.adapters import ytdlp
from backend.app.sources import SourceConfig


def _make_source(*, use_proxy: bool, cookie_dir: Path) -> SourceConfig:
    cookie_path = cookie_dir / "missing-cookie.txt"

    class _Source(SourceConfig):
        @property
        def cookie_path(self):
            return cookie_path

    return _Source(
        name="test",
        matches=lambda url: True,
        use_proxy=use_proxy,
        cookie_filename="missing-cookie.txt",
        asr_language="en",
        target_language="zh",
    )


def test_ytdlp_proxy_port_takes_priority(monkeypatch, tmp_path):
    monkeypatch.setenv("HTTP_PROXY", "http://env-proxy:8080")
    source = _make_source(use_proxy=True, cookie_dir=tmp_path)

    options = ytdlp._ydl_base(source, "7890")

    assert options["proxy"] == "http://127.0.0.1:7890"


def test_ytdlp_proxy_falls_back_to_environment(monkeypatch, tmp_path):
    monkeypatch.setenv("HTTP_PROXY", "http://env-proxy:8080")
    source = _make_source(use_proxy=True, cookie_dir=tmp_path)

    options = ytdlp._ydl_base(source, "")

    assert options["proxy"] == "http://env-proxy:8080"


def test_ytdlp_disables_proxy_when_source_opts_out(monkeypatch, tmp_path):
    monkeypatch.setenv("HTTP_PROXY", "http://env-proxy:8080")
    source = _make_source(use_proxy=False, cookie_dir=tmp_path)

    options = ytdlp._ydl_base(source, "7890")

    assert options["proxy"] == ""


def test_ytdlp_enables_node_js_runtime(tmp_path):
    source = _make_source(use_proxy=True, cookie_dir=tmp_path)

    options = ytdlp._ydl_base(source, "")

    assert options["js_runtimes"] == {"node": {}}


def test_ytdlp_format_candidates_start_with_backend_format():
    assert ytdlp.FORMAT_CANDIDATES[0] == "bestvideo[height<=1080]+bestaudio/best"
    assert "bestvideo[height<=1080]+bestaudio/best[height<=1080]/best" not in ytdlp.FORMAT_CANDIDATES


def _youtube_source() -> SourceConfig:
    return SourceConfig(
        name="youtube",
        matches=lambda url: True,
        use_proxy=False,
        cookie_filename=None,
        asr_language="en",
        target_language="zh",
    )


def test_download_video_passes_only_the_canonical_url_to_both_ytdlp_sinks(
    monkeypatch, tmp_path
):
    extracted_urls: list[str] = []
    downloaded_urls: list[str] = []

    class FakeYoutubeDL:
        def __init__(self, options):
            self.options = options

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def extract_info(self, url, *, download):
            extracted_urls.append(url)
            assert download is False
            return {
                "id": "abcdefghijk",
                "uploader": "tester",
                "title": "canonical",
                "webpage_url": url,
            }

        def sanitize_info(self, info):
            return info

        def download(self, urls):
            downloaded_urls.extend(urls)
            Path(self.options["outtmpl"]).write_bytes(b"video")

    monkeypatch.setattr(ytdlp.yt_dlp, "YoutubeDL", FakeYoutubeDL)

    session, _ = ytdlp.download_video(
        "HTTPS://WWW.YOUTUBE.COM:443/watch?v=abcdefghijk",
        tmp_path,
        _youtube_source(),
    )

    expected = "https://www.youtube.com/watch?v=abcdefghijk"
    assert extracted_urls == [expected]
    assert downloaded_urls == [expected]
    assert (session / "media" / "video_source.mp4").read_bytes() == b"video"


def test_download_video_rejects_deceptive_url_before_cookie_or_ytdlp(
    monkeypatch, tmp_path
):
    calls: list[str] = []
    monkeypatch.setattr(ytdlp, "_ensure_cookie", lambda source: calls.append("cookie"))
    monkeypatch.setattr(
        ytdlp.yt_dlp,
        "YoutubeDL",
        lambda options: calls.append("ytdlp"),
    )

    with pytest.raises(ValueError):
        ytdlp.download_video(
            "https://youtube.com.evil.example/watch?v=abcdefghijk",
            tmp_path,
            _youtube_source(),
        )

    assert calls == []
