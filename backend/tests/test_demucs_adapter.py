from __future__ import annotations

import sys
import types
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
import soundfile as sf

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


def test_chunk_plan_covers_every_frame_exactly_once():
    plan = demucs_adapter._chunk_plan(1000, 200, 100)

    assert [(start, stop) for start, stop, _ in plan] == [
        (0, 200),
        (200, 400),
        (400, 600),
        (600, 800),
        (800, 1000),
    ]
    # Windows read past their own range so Demucs keeps context across the seam.
    assert [window for _, _, window in plan] == [300, 500, 700, 900, 1000]


def test_chunk_plan_folds_short_remainder_into_previous_window():
    plan = demucs_adapter._chunk_plan(1050, 1000, 100)

    assert plan == [(0, 1050, 1050)]


def test_chunk_plan_single_window_when_track_fits():
    assert demucs_adapter._chunk_plan(150, 200, 100) == [(0, 150, 150)]


def test_chunk_plan_handles_empty_track():
    assert demucs_adapter._chunk_plan(0, 200, 100) == []


def test_crossfade_blends_from_tail_to_head():
    tail = np.zeros((4, 1), dtype=np.float32)
    head = np.ones((6, 1), dtype=np.float32)

    blended = demucs_adapter._crossfade(tail, head)

    assert blended.shape == head.shape
    # Ramp is 0, .25, .5, .75 over the overlap, then the head continues untouched.
    assert blended[:4, 0].tolist() == pytest.approx([0.0, 0.25, 0.5, 0.75])
    assert blended[4:, 0].tolist() == pytest.approx([1.0, 1.0])


def test_crossfade_returns_head_when_no_tail():
    head = np.ones((3, 2), dtype=np.float32)

    assert np.array_equal(demucs_adapter._crossfade(np.zeros((0, 2), dtype=np.float32), head), head)


def test_extract_audio_decodes_to_model_rate_and_channels(tmp_path, monkeypatch):
    destination = tmp_path / "tmp" / "demucs_input.wav"
    recorded: dict[str, list[str]] = {}

    def fake_run(command, **kwargs):
        recorded["command"] = command
        destination.write_bytes(b"audio")
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(demucs_adapter.subprocess, "run", fake_run)

    demucs_adapter._extract_audio(tmp_path / "video.mp4", destination, 44100, 2)

    command = recorded["command"]
    assert "-vn" in command
    # Demucs' own loader reads streams=0; multi-track sources must not switch track.
    assert command[command.index("-map") + 1] == "0:a:0"
    assert command[command.index("-ar") + 1] == "44100"
    assert command[command.index("-ac") + 1] == "2"
    assert command[command.index("-c:a") + 1] == "pcm_s16le"
    assert command[-1] == str(destination)


def test_extract_audio_rejects_empty_output(tmp_path, monkeypatch):
    destination = tmp_path / "tmp" / "demucs_input.wav"

    def fake_run(command, **kwargs):
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(b"")
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(demucs_adapter.subprocess, "run", fake_run)

    with pytest.raises(RuntimeError, match="produced no audio"):
        demucs_adapter._extract_audio(tmp_path / "video.mp4", destination, 44100, 2)


class _FakeTensor:
    """Minimal stand-in for the torch tensors Demucs hands back."""

    def __init__(self, array: np.ndarray):
        self.array = array

    def __add__(self, other: "_FakeTensor") -> "_FakeTensor":
        return _FakeTensor(self.array + other.array)

    def detach(self) -> "_FakeTensor":
        return self

    def cpu(self) -> "_FakeTensor":
        return self

    def numpy(self) -> np.ndarray:
        return self.array


def _install_fake_demucs(monkeypatch, sample_rate: int, channels: int, calls: list[int]):
    """Fake torch + demucs.api so the streaming path runs without the real models."""

    class FakeSeparator:
        def __init__(self, **kwargs):
            self.samplerate = sample_rate
            self.audio_channels = channels
            self.callback = kwargs.get("callback")

        def separate_tensor(self, wav, sr):
            calls.append(wav.array.shape[1])
            if self.callback:
                self.callback(
                    {
                        "models": 1,
                        "model_idx_in_bag": 0,
                        "shift_idx": 0,
                        "segment_offset": wav.array.shape[1],
                        "audio_length": wav.array.shape[1],
                    }
                )
            return wav, {
                "vocals": _FakeTensor(wav.array * 0.5),
                "drums": _FakeTensor(wav.array * 0.1),
                "bass": _FakeTensor(wav.array * 0.1),
                "other": _FakeTensor(wav.array * 0.1),
            }

    fake_torch = types.ModuleType("torch")
    fake_torch.from_numpy = _FakeTensor
    monkeypatch.setitem(sys.modules, "torch", fake_torch)

    fake_demucs = types.ModuleType("demucs")
    fake_api = types.ModuleType("demucs.api")
    fake_api.Separator = FakeSeparator
    fake_demucs.api = fake_api
    monkeypatch.setitem(sys.modules, "demucs", fake_demucs)
    monkeypatch.setitem(sys.modules, "demucs.api", fake_api)


def test_separate_audio_streams_windows_and_reconstructs_full_track(tmp_path, monkeypatch):
    sample_rate, channels, total_frames = 100, 2, 1000
    monkeypatch.setattr(demucs_adapter, "OVERLAP_SECONDS", 1)
    monkeypatch.setenv("DEMUCS_CHUNK_SECONDS", "2")

    calls: list[int] = []
    _install_fake_demucs(monkeypatch, sample_rate, channels, calls)

    time = np.linspace(0, 10, total_frames, endpoint=False, dtype=np.float32)
    source = np.stack([np.sin(2 * np.pi * time) * 0.8, np.cos(2 * np.pi * time) * 0.8], axis=1)

    session = tmp_path / "session"

    def fake_extract(video_file, destination, rate, chans):
        destination.parent.mkdir(parents=True, exist_ok=True)
        sf.write(destination, source, rate, subtype="PCM_16")
        return destination

    monkeypatch.setattr(demucs_adapter, "_extract_audio", fake_extract)

    progress: list[tuple[int, str]] = []
    vocals_file, bgm_file = demucs_adapter.separate_audio(
        tmp_path / "video.mp4", session, lambda value, message: progress.append((value, message))
    )

    # Five windows, each reading its own range plus the overlap tail.
    assert calls == [300, 300, 300, 300, 200]

    vocals, rate = sf.read(vocals_file, always_2d=True)
    bgm, _ = sf.read(bgm_file, always_2d=True)
    assert rate == sample_rate
    # The whole track comes back, no frames lost or duplicated at the seams.
    assert len(vocals) == total_frames
    assert len(bgm) == total_frames

    # Crossfading two windows of the same deterministic separation must reproduce the
    # signal itself, so any seam artefact would show up here.
    np.testing.assert_allclose(vocals, source * 0.5, atol=2e-4)
    np.testing.assert_allclose(bgm, source * 0.3, atol=2e-4)

    assert progress and all(0 <= value <= 99 for value, _ in progress)
    assert "part 5/5" in progress[-1][1]


def test_separate_audio_removes_temporary_files(tmp_path, monkeypatch):
    sample_rate, channels = 100, 2
    monkeypatch.setattr(demucs_adapter, "OVERLAP_SECONDS", 1)
    monkeypatch.setenv("DEMUCS_CHUNK_SECONDS", "2")
    _install_fake_demucs(monkeypatch, sample_rate, channels, [])

    source = np.zeros((500, channels), dtype=np.float32)
    session = tmp_path / "session"

    def fake_extract(video_file, destination, rate, chans):
        destination.parent.mkdir(parents=True, exist_ok=True)
        sf.write(destination, source, rate, subtype="PCM_16")
        return destination

    monkeypatch.setattr(demucs_adapter, "_extract_audio", fake_extract)

    demucs_adapter.separate_audio(tmp_path / "video.mp4", session)

    assert sorted(p.name for p in (session / "tmp").iterdir()) == []


def test_separate_audio_reuses_existing_output(tmp_path, monkeypatch):
    session = tmp_path / "session"
    media = session / "media"
    media.mkdir(parents=True)
    (media / "audio_vocals.wav").write_bytes(b"cached")
    (media / "audio_bgm.wav").write_bytes(b"cached")

    def explode(*args, **kwargs):
        raise AssertionError("separation must not run when outputs are cached")

    monkeypatch.setattr(demucs_adapter, "_extract_audio", explode)

    vocals, bgm = demucs_adapter.separate_audio(tmp_path / "video.mp4", session)

    assert vocals == media / "audio_vocals.wav"
    assert bgm == media / "audio_bgm.wav"
