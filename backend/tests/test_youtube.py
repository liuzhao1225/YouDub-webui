import pytest
from yt_dlp.extractor.bilibili import BiliBiliIE
from yt_dlp.extractor.youtube import YoutubeIE

from backend.app.youtube import (
    extract_video_id,
    is_bilibili_url,
    is_local_en_to_zh_url,
    is_local_upload_url,
    is_local_zh_to_en_url,
    is_youtube_url,
    local_upload_direction,
    local_upload_task_id,
    validate_video_url,
)


def test_extract_video_id_from_watch_url():
    assert extract_video_id("https://www.youtube.com/watch?v=abcdefghijk&t=12s") == "abcdefghijk"


def test_extract_video_id_from_shorts_url():
    assert extract_video_id("https://youtube.com/shorts/abcdefghijk?feature=share") == "abcdefghijk"


@pytest.mark.parametrize(
    ("url", "expected_id", "expected_url"),
    [
        (
            "HTTPS://YOUTUBE.COM:443/watch?v=abcdefghijk",
            "abcdefghijk",
            "https://youtube.com/watch?v=abcdefghijk",
        ),
        (
            "https://WWW.YOUTUBE.COM/embed/abcdefghijk",
            "abcdefghijk",
            "https://www.youtube.com/embed/abcdefghijk",
        ),
        (
            "http://M.YOUTUBE.COM:80/live/abcdefghijk",
            "abcdefghijk",
            "http://m.youtube.com/live/abcdefghijk",
        ),
        (
            "https://youtu.be/abcdefghijk",
            "abcdefghijk",
            "https://youtu.be/abcdefghijk",
        ),
        (
            "https://youtube.com//watch//?%76=%61bcdefghijk&t=12s#ignored",
            "abcdefghijk",
            "https://youtube.com/watch?v=abcdefghijk",
        ),
        (
            "https://youtu.be//abcdefghijk//?feature=share#ignored",
            "abcdefghijk",
            "https://youtu.be/abcdefghijk",
        ),
    ],
)
def test_youtube_url_accepts_only_explicit_supported_hosts(
    url, expected_id, expected_url
):
    validated = validate_video_url(url)

    assert validated.source == "youtube"
    assert validated.video_id == expected_id
    assert validated.url == expected_url
    assert YoutubeIE.suitable(validated.url)
    assert is_youtube_url(url)
    assert extract_video_id(url) == expected_id


@pytest.mark.parametrize(
    "url",
    [
        "ftp://youtube.com/watch?v=abcdefghijk",
        "//youtube.com/watch?v=abcdefghijk",
        "https://notyoutube.com/watch?v=abcdefghijk",
        "https://youtube.com.evil.example/watch?v=abcdefghijk",
        "https://youtube.com@evil.example/watch?v=abcdefghijk",
        "https://evil.example@youtube.com/watch?v=abcdefghijk",
        "https://user:password@youtube.com/watch?v=abcdefghijk",
        "https://youtube.com:444/watch?v=abcdefghijk",
        "http://youtube.com:443/watch?v=abcdefghijk",
        "https://youtube.com:99999/watch?v=abcdefghijk",
        "https://youtube.com:not-a-port/watch?v=abcdefghijk",
        "https://youtube.com:/watch?v=abcdefghijk",
        "https://youtube.com./watch?v=abcdefghijk",
        "https://music.youtube.com/watch?v=abcdefghijk",
        "https://evil.example/youtube.com/watch?v=abcdefghijk",
        "https://youtube.com\\@evil.example/watch?v=abcdefghijk",
        "https://youtube.com/redirect?q=http://127.0.0.1/&v=abcdefghijk",
        "https://youtube.com/anything?v=abcdefghijk",
        "https://youtu.be/abcdefghijk/extra",
        "https://youtubе.com/watch?v=abcdefghijk",
        "https://youtube.com/watch?v=abcdefghijk\nHost: evil.example",
    ],
)
def test_youtube_url_rejects_deceptive_hosts_schemes_userinfo_and_ports(url):
    assert not is_youtube_url(url)
    with pytest.raises(ValueError):
        extract_video_id(url)


def test_rejects_playlist_only_url():
    assert not is_youtube_url("https://www.youtube.com/playlist?list=123")


def test_extract_video_id_from_bilibili_url():
    assert extract_video_id("https://www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=test") == "BV1xx411c7mD"


def test_bilibili_url_is_canonicalized_to_the_expected_extractor():
    validated = validate_video_url(
        "HTTPS://WWW.BILIBILI.COM:443//video/BV1xx411c7mD//?spm_id_from=test"
    )

    assert validated.source == "bilibili"
    assert validated.video_id == "BV1xx411c7mD"
    assert validated.url == "https://www.bilibili.com/video/BV1xx411c7mD"
    assert BiliBiliIE.suitable(validated.url)


@pytest.mark.parametrize(
    "url",
    [
        "ftp://www.bilibili.com/video/BV1xx411c7mD",
        "https://www.bilibili.com/redirect/BV1xx411c7mD",
        "https://www.bilibili.com/anything?v=BV1xx411c7mD",
        "https://m.bilibili.com/video/BV1xx411c7mD",
    ],
)
def test_bilibili_url_rejects_non_video_generic_extractor_fallbacks(url):
    assert not is_bilibili_url(url)
    with pytest.raises(ValueError):
        extract_video_id(url)


def test_is_bilibili_url():
    assert is_bilibili_url("https://www.bilibili.com/video/BV1xx411c7mD")
    assert not is_bilibili_url("https://www.youtube.com/watch?v=abcdefghijk")


def test_extract_video_id_rejects_unknown():
    with pytest.raises(ValueError):
        extract_video_id("https://example.com/video/123")

def test_local_upload_helpers_parse_direction_and_task_id():
    url = "local://upload/abc123?direction=zh-en&filename=demo.mp4"

    assert local_upload_task_id(url) == "abc123"
    assert local_upload_direction(url) == "zh-en"
    assert is_local_upload_url(url)
    assert is_local_zh_to_en_url(url)
    assert not is_local_en_to_zh_url(url)


def test_local_upload_helpers_reject_missing_or_unknown_direction():
    assert not is_local_upload_url("local://upload/abc123")
    assert not is_local_upload_url("local://upload/../workfolder?direction=en-zh")
    assert local_upload_task_id("local://upload/../workfolder?direction=en-zh") == ""
    assert not is_local_upload_url("local://upload/abc123?direction=fr-zh")
    assert local_upload_task_id("https://example.com/video.mp4") == ""
