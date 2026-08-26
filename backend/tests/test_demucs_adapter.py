from __future__ import annotations

import gc
import sys
import types
import weakref
from types import SimpleNamespace

import pytest

from backend.app.adapters import demucs as demucs_adapter


def test_separate_audio_reports_missing_demucs_submodule(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(demucs_adapter, "REPO_ROOT", tmp_path)

    with pytest.raises(RuntimeError, match="missing or incomplete"):
        demucs_adapter.separate_audio(tmp_path / "video.mp4", tmp_path / "session")


def test_separate_audio_reports_incomplete_demucs_submodule(tmp_path, monkeypatch) -> None:
    (tmp_path / "submodule" / "demucs").mkdir(parents=True)
    monkeypatch.setattr(demucs_adapter, "REPO_ROOT", tmp_path)

    with pytest.raises(RuntimeError, match="Download ZIP"):
        demucs_adapter.separate_audio(tmp_path / "video.mp4", tmp_path / "session")


def test_demucs_device_uses_central_resolver(monkeypatch):
    monkeypatch.setattr(demucs_adapter, "resolve_device", lambda component: SimpleNamespace(selected="mps"))
    assert demucs_adapter._device() == "mps"


def test_demucs_progress_uses_model_shift_and_segment_offset():
    progress = demucs_adapter._demucs_progress(
        {
            "models": 2,
            "model_idx_in_bag": 1,
            "shift_idx": 1,
            "segment_offset": 50,
            "audio_length": 100,
        },
        shifts=3,
    )

    assert progress == 75


def test_separate_audio_drops_large_local_objects_after_failure(tmp_path, monkeypatch):
    references: dict[str, weakref.ReferenceType] = {}

    class FakeTensor:
        def __add__(self, other):
            return self

    class FakeSeparator:
        samplerate = 44100

        def __init__(self, **kwargs):
            references["separator"] = weakref.ref(self)

        def separate_audio_file(self, path):
            vocals = FakeTensor()
            accompaniment = FakeTensor()
            references["vocals"] = weakref.ref(vocals)
            references["accompaniment"] = weakref.ref(accompaniment)
            return None, {"vocals": vocals, "other": accompaniment}

    def fail_save_audio(*args, **kwargs):
        raise RuntimeError("save exploded")

    fake_demucs = types.ModuleType("demucs")
    fake_api = types.ModuleType("demucs.api")
    fake_api.Separator = FakeSeparator
    fake_api.save_audio = fail_save_audio
    monkeypatch.setitem(sys.modules, "demucs", fake_demucs)
    monkeypatch.setitem(sys.modules, "demucs.api", fake_api)
    monkeypatch.setattr(demucs_adapter, "_demucs_source_path", lambda: tmp_path)
    monkeypatch.setattr(demucs_adapter, "_device", lambda: "cpu")
    (tmp_path / "session" / "media").mkdir(parents=True)

    with pytest.raises(RuntimeError, match="save exploded"):
        demucs_adapter.separate_audio(tmp_path / "video.mp4", tmp_path / "session")

    gc.collect()
    assert all(reference() is None for reference in references.values())
