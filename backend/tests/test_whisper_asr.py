from __future__ import annotations

import sys
from types import SimpleNamespace

from backend.app.adapters import whisper_asr


def test_release_model_clears_cached_model(monkeypatch):
    model = object()
    monkeypatch.setattr(whisper_asr, "_MODEL", model)

    assert whisper_asr.release_model() is True
    assert whisper_asr._MODEL is None
    assert whisper_asr.release_model() is False


def test_load_model_removes_corrupt_cache_and_retries(monkeypatch, tmp_path):
    calls = {"count": 0}
    model = object()
    cache_file = tmp_path / "tiny.pt"
    cache_file.write_bytes(b"bad")

    def load_model(name, device, download_root=None):
        calls["count"] += 1
        assert name == "tiny"
        assert device == "cpu"
        assert download_root == str(tmp_path)
        if calls["count"] == 1:
            raise RuntimeError("SHA256 checksum does not match")
        return model

    fake_whisper = SimpleNamespace(_MODELS={"tiny": "https://example.com/tiny.pt"}, load_model=load_model)
    monkeypatch.setitem(sys.modules, "whisper", fake_whisper)
    monkeypatch.setenv("WHISPER_MODEL", "tiny")
    monkeypatch.setenv("WHISPER_DOWNLOAD_ROOT", str(tmp_path))
    monkeypatch.setattr(whisper_asr, "_MODEL", None)
    monkeypatch.setattr(whisper_asr, "resolve_device", lambda component: SimpleNamespace(selected="cpu"))

    assert whisper_asr._load_model() is model
    assert calls["count"] == 2
    assert not cache_file.exists()


def test_recognize_speech_passes_japanese_language_to_whisper(monkeypatch, tmp_path):
    calls: list[dict] = []

    class FakeModel:
        def transcribe(self, path, **kwargs):
            calls.append({"path": path, **kwargs})
            return {
                "text": "今日はいい天気です。",
                "segments": [
                    {
                        "text": "今日はいい天気です。",
                        "start": 0.0,
                        "end": 1.25,
                        "words": [],
                    }
                ],
            }

    class FakeAudio:
        def __len__(self):
            return 1250

    vocals = tmp_path / "vocals.wav"
    vocals.write_bytes(b"audio")
    monkeypatch.setattr(whisper_asr, "_load_model", lambda: FakeModel())
    monkeypatch.setattr(whisper_asr.AudioSegment, "from_file", lambda _path: FakeAudio())

    output = whisper_asr.recognize_speech(vocals, tmp_path, language="ja")

    assert calls == [
        {
            "path": str(vocals),
            "language": "ja",
            "word_timestamps": True,
            "verbose": False,
        }
    ]
    assert output == tmp_path / "metadata" / "asr.json"
