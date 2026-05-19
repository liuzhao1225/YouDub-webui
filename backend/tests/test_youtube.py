import pytest

from backend.app.youtube import (
    extract_video_id,
    is_bilibili_url,
    is_local_en_to_zh_url,
    is_local_upload_url,
    is_local_zh_to_en_url,
    is_youtube_url,
    local_upload_direction,
    local_upload_task_id,
)


def test_extract_video_id_from_watch_url():
    assert extract_video_id("https://www.youtube.com/watch?v=abcdefghijk&t=12s") == "abcdefghijk"


def test_extract_video_id_from_shorts_url():
    assert extract_video_id("https://youtube.com/shorts/abcdefghijk?feature=share") == "abcdefghijk"


def test_rejects_playlist_only_url():
    assert not is_youtube_url("https://www.youtube.com/playlist?list=123")


def test_extract_video_id_from_bilibili_url():
    assert extract_video_id("https://www.bilibili.com/video/BV1xx411c7mD/?spm_id_from=test") == "BV1xx411c7mD"


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
