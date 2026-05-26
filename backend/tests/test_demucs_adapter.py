from __future__ import annotations

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
