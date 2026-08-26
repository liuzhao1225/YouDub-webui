from __future__ import annotations

import pytest

from backend.app.audio_mode import audio_mode, is_original_audio, target_text


def test_explicit_audio_mode_takes_priority_over_target_text():
    assert audio_mode({"dst": "（笑声）", "audio_mode": "original"}) == "original"
    assert audio_mode({"dst": "", "audio_mode": "tts"}) == "tts"
    assert is_original_audio({"dst": "（呻吟）", "audio_mode": "original"})


def test_legacy_items_infer_audio_mode_from_target_text():
    assert audio_mode({"dst": ""}) == "original"
    assert audio_mode({"dst": "Meaningful."}) == "tts"
    assert audio_mode({"zh": "旧版字幕"}) == "tts"
    assert target_text({"dst": "", "zh": "旧版字幕"}) == "旧版字幕"


def test_invalid_audio_mode_is_rejected():
    with pytest.raises(ValueError, match="audio_mode"):
        audio_mode({"dst": "Hello", "audio_mode": "invalid"})
