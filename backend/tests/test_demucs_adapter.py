from __future__ import annotations

import gc
import shutil
import subprocess
import sys
import types
import weakref
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


def test_chunk_seconds_uses_default_when_unset(monkeypatch):
    monkeypatch.delenv("DEMUCS_CHUNK_SECONDS", raising=False)

    assert demucs_adapter._chunk_seconds() == demucs_adapter.DEFAULT_CHUNK_SECONDS


@pytest.mark.parametrize("value", ["abc", "1.5", "0", "-1"])
def test_chunk_seconds_rejects_invalid_values(monkeypatch, value):
    monkeypatch.setenv("DEMUCS_CHUNK_SECONDS", value)

    with pytest.raises(RuntimeError, match="DEMUCS_CHUNK_SECONDS must be a positive integer"):
        demucs_adapter._chunk_seconds()


def test_separate_audio_rejects_invalid_chunk_setting_before_loading_model(
    tmp_path, monkeypatch
):
    monkeypatch.setenv("DEMUCS_CHUNK_SECONDS", "invalid")

    with pytest.raises(RuntimeError, match="DEMUCS_CHUNK_SECONDS"):
        demucs_adapter.separate_audio(tmp_path / "video.mp4", tmp_path / "session")

    assert not (tmp_path / "session").exists()


def test_chunk_plan_covers_every_frame_exactly_once():
    plan = demucs_adapter._chunk_plan(1000, 200, 100)

    assert [(start, stop) for start, stop, _ in plan] == [
        (0, 200),
        (200, 400),
        (400, 600),
        (600, 800),
        (800, 1000),
    ]
    assert [window_stop for _, _, window_stop in plan] == [300, 500, 700, 900, 1000]


def test_chunk_plan_folds_short_remainder_into_previous_window():
    assert demucs_adapter._chunk_plan(1050, 1000, 100) == [(0, 1050, 1050)]


def test_chunk_plan_handles_empty_track():
    assert demucs_adapter._chunk_plan(0, 200, 100) == []


def test_chunk_plan_rejects_non_positive_window():
    with pytest.raises(ValueError, match="chunk_frames must be positive"):
        demucs_adapter._chunk_plan(100, 0, 10)


def test_crossfade_blends_previous_tail_into_current_head():
    tail = np.zeros((4, 1), dtype=np.float32)
    head = np.ones((6, 1), dtype=np.float32)

    blended = demucs_adapter._crossfade(tail, head)

    assert blended.shape == head.shape
    assert blended[:4, 0].tolist() == pytest.approx([0.0, 0.25, 0.5, 0.75])
    assert blended[4:, 0].tolist() == pytest.approx([1.0, 1.0])


def test_crossfade_returns_head_when_overlap_is_empty():
    head = np.ones((3, 2), dtype=np.float32)

    assert np.array_equal(
        demucs_adapter._crossfade(np.zeros((0, 2), dtype=np.float32), head),
        head,
    )


def test_extract_audio_pins_first_audio_stream_and_model_format(tmp_path, monkeypatch):
    destination = tmp_path / "tmp" / "demucs_input.wav"
    recorded: dict[str, list[str]] = {}

    def fake_run(command, **kwargs):
        recorded["command"] = command
        destination.write_bytes(b"audio")
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(demucs_adapter.subprocess, "run", fake_run)
    monkeypatch.setattr(demucs_adapter, "_probe_audio_channels", lambda video_file: 6)

    demucs_adapter._extract_audio(tmp_path / "video.mp4", destination, 44100, 2)

    command = recorded["command"]
    assert command[command.index("-map") + 1] == "0:a:0"
    assert command[command.index("-ar") + 1] == "44100"
    assert command[command.index("-af") + 1] == "pan=stereo|c0=c0|c1=c1"
    assert command[command.index("-c:a") + 1] == "pcm_f32le"
    assert command[command.index("-rf64") + 1] == "auto"
    assert command[-1] == str(destination)


def test_extract_audio_rejects_empty_output(tmp_path, monkeypatch):
    destination = tmp_path / "tmp" / "demucs_input.wav"

    def fake_run(command, **kwargs):
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(b"")
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(demucs_adapter.subprocess, "run", fake_run)
    monkeypatch.setattr(demucs_adapter, "_probe_audio_channels", lambda video_file: 2)

    with pytest.raises(RuntimeError, match="produced no audio"):
        demucs_adapter._extract_audio(tmp_path / "video.mp4", destination, 44100, 2)


def test_probe_audio_channels_selects_first_audio_stream(tmp_path, monkeypatch):
    recorded: dict[str, object] = {}

    def fake_run(command, **kwargs):
        recorded["command"] = command
        recorded["kwargs"] = kwargs
        return SimpleNamespace(stdout="6\n")

    monkeypatch.setattr(demucs_adapter.subprocess, "run", fake_run)

    assert demucs_adapter._probe_audio_channels(tmp_path / "video.mkv") == 6
    command = recorded["command"]
    assert isinstance(command, list)
    assert command[command.index("-select_streams") + 1] == "a:0"
    assert recorded["kwargs"] == {"check": True, "capture_output": True, "text": True}


MEDIA_TOOLS_AVAILABLE = bool(shutil.which("ffmpeg") and shutil.which("ffprobe"))


@pytest.mark.skipif(not MEDIA_TOOLS_AVAILABLE, reason="ffmpeg and ffprobe are required")
def test_extract_audio_keeps_only_first_two_channels_from_surround(tmp_path):
    sample_rate = 44100
    source = tmp_path / "surround.wav"
    subprocess.run(
        [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-f",
            "lavfi",
            "-i",
            "aevalsrc="
            "0.1*sin(2*PI*220*t)|0.1*sin(2*PI*330*t)|"
            "0.1*sin(2*PI*440*t)|0.1*sin(2*PI*550*t)|"
            "0.1*sin(2*PI*880*t)|0.1*sin(2*PI*990*t):"
            "s=44100:d=1:c=5.1",
            "-c:a",
            "pcm_f32le",
            str(source),
        ],
        check=True,
    )

    output = demucs_adapter._extract_audio(source, tmp_path / "selected.wav", sample_rate, 2)
    audio, rate = sf.read(output, dtype="float32", always_2d=True)
    spectrum = np.abs(np.fft.rfft(audio, axis=0))
    frequencies = np.fft.rfftfreq(len(audio), 1 / rate)
    peak_frequencies = frequencies[np.argmax(spectrum, axis=0)]

    assert rate == sample_rate
    assert sf.info(output).subtype == "FLOAT"
    assert peak_frequencies.tolist() == pytest.approx([220.0, 330.0], abs=1.0)
    front_peak = float(spectrum.max())
    for rear_frequency in (440, 550, 880, 990):
        rear_bin = int(np.argmin(np.abs(frequencies - rear_frequency)))
        assert float(spectrum[rear_bin].max()) < front_peak * 1e-4


@pytest.mark.skipif(not MEDIA_TOOLS_AVAILABLE, reason="ffmpeg and ffprobe are required")
def test_extract_audio_duplicates_mono_as_float32_stereo(tmp_path):
    sample_rate = 44100
    time = np.arange(sample_rate, dtype=np.float32) / sample_rate
    mono = np.sin(2 * np.pi * 440 * time).astype(np.float32) * 0.1
    source = tmp_path / "mono.wav"
    sf.write(source, mono, sample_rate, subtype="FLOAT")

    output = demucs_adapter._extract_audio(source, tmp_path / "selected.wav", sample_rate, 2)
    audio, rate = sf.read(output, dtype="float32", always_2d=True)

    assert rate == sample_rate
    assert sf.info(output).subtype == "FLOAT"
    assert audio.shape == (sample_rate, 2)
    np.testing.assert_allclose(audio[:, 0], audio[:, 1], atol=0.0)


class _FakeTensor:
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


def _install_fake_demucs(
    monkeypatch,
    sample_rate: int,
    channels: int,
    calls: list[int],
    *,
    fail_on_call: int | None = None,
) -> None:
    class FakeSeparator:
        def __init__(self, **kwargs):
            self.samplerate = sample_rate
            self.audio_channels = channels
            self.callback = kwargs.get("callback")

        def separate_tensor(self, wav, sr):
            calls.append(wav.array.shape[1])
            if fail_on_call is not None and len(calls) == fail_on_call:
                raise RuntimeError("injected Demucs failure")
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
    monkeypatch.setattr(demucs_adapter, "_demucs_source_path", lambda: Path("/fake/demucs"))


def _install_fake_source(monkeypatch, source: np.ndarray, sample_rate: int) -> None:
    def fake_extract(video_file, destination, rate, channels):
        destination.parent.mkdir(parents=True, exist_ok=True)
        sf.write(destination, source, sample_rate, subtype="PCM_16")
        return destination

    monkeypatch.setattr(demucs_adapter, "_extract_audio", fake_extract)


def test_separate_audio_streams_windows_crossfades_and_reports_progress(
    tmp_path, monkeypatch
):
    sample_rate, channels, total_frames = 100, 2, 1000
    monkeypatch.setattr(demucs_adapter, "OVERLAP_SECONDS", 1)
    monkeypatch.setenv("DEMUCS_CHUNK_SECONDS", "2")

    calls: list[int] = []
    _install_fake_demucs(monkeypatch, sample_rate, channels, calls)

    time = np.linspace(0, 10, total_frames, endpoint=False, dtype=np.float32)
    source = np.stack(
        [np.sin(2 * np.pi * time) * 0.8, np.cos(2 * np.pi * time) * 0.8],
        axis=1,
    )
    _install_fake_source(monkeypatch, source, sample_rate)

    progress: list[tuple[int, str]] = []
    session = tmp_path / "session"
    vocals_file, bgm_file = demucs_adapter.separate_audio(
        tmp_path / "video.mp4",
        session,
        lambda value, message: progress.append((value, message)),
    )

    assert calls == [300, 300, 300, 300, 200]
    vocals, rate = sf.read(vocals_file, always_2d=True)
    bgm, _ = sf.read(bgm_file, always_2d=True)
    assert rate == sample_rate
    assert sf.info(vocals_file).format == "RF64"
    assert sf.info(bgm_file).format == "RF64"
    assert len(vocals) == total_frames
    assert len(bgm) == total_frames
    np.testing.assert_allclose(vocals, source * 0.5, atol=2e-4)
    np.testing.assert_allclose(bgm, source * 0.3, atol=2e-4)

    values = [value for value, _ in progress]
    assert values == sorted(values)
    assert values[-1] == 99
    assert "part 5/5" in progress[-1][1]
    assert list((session / "tmp").iterdir()) == []


def test_separate_audio_uses_rf64_for_large_temporary_stems(tmp_path, monkeypatch):
    sample_rate, channels = 100, 2
    monkeypatch.setenv("DEMUCS_CHUNK_SECONDS", "2")
    _install_fake_demucs(monkeypatch, sample_rate, channels, [])
    _install_fake_source(monkeypatch, np.zeros((100, channels), dtype=np.float32), sample_rate)
    temporary_formats: list[tuple[str, str]] = []

    def inspect_finalize(source, destination, peak, rate, output_channels):
        info = sf.info(source)
        temporary_formats.append((info.format, info.subtype))
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(b"finalized")

    monkeypatch.setattr(demucs_adapter, "_finalize", inspect_finalize)

    demucs_adapter.separate_audio(tmp_path / "video.mp4", tmp_path / "session")

    assert temporary_formats == [("RF64", "FLOAT"), ("RF64", "FLOAT")]


def test_previous_window_tensors_are_released_before_next_inference(tmp_path, monkeypatch):
    sample_rate, channels = 100, 2
    monkeypatch.setattr(demucs_adapter, "OVERLAP_SECONDS", 1)
    monkeypatch.setenv("DEMUCS_CHUNK_SECONDS", "2")
    calls: list[int] = []
    tracked: dict[int, list[weakref.ReferenceType]] = {0: [], 1: []}
    release_checked: list[bool] = []

    class TrackedTensor:
        def __init__(self, array: np.ndarray, generation: int):
            self.array = array
            self.generation = generation
            tracked.setdefault(generation, []).append(weakref.ref(self))

        def __add__(self, other: "TrackedTensor") -> "TrackedTensor":
            return TrackedTensor(self.array + other.array, self.generation)

        def detach(self) -> "TrackedTensor":
            return self

        def cpu(self) -> "TrackedTensor":
            return self

        def numpy(self) -> np.ndarray:
            return self.array

    class TrackingSeparator:
        def __init__(self, **kwargs):
            self.samplerate = sample_rate
            self.audio_channels = channels

        def separate_tensor(self, wav, sr):
            generation = len(calls)
            if generation == 1:
                gc.collect()
                assert tracked[0]
                assert all(reference() is None for reference in tracked[0])
                release_checked.append(True)
            calls.append(wav.array.shape[1])
            return wav, {
                "vocals": TrackedTensor(wav.array * 0.5, generation),
                "drums": TrackedTensor(wav.array * 0.1, generation),
                "bass": TrackedTensor(wav.array * 0.1, generation),
                "other": TrackedTensor(wav.array * 0.1, generation),
            }

    fake_torch = types.ModuleType("torch")
    fake_torch.from_numpy = lambda array: TrackedTensor(array, len(calls))
    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    fake_demucs = types.ModuleType("demucs")
    fake_api = types.ModuleType("demucs.api")
    fake_api.Separator = TrackingSeparator
    fake_demucs.api = fake_api
    monkeypatch.setitem(sys.modules, "demucs", fake_demucs)
    monkeypatch.setitem(sys.modules, "demucs.api", fake_api)
    monkeypatch.setattr(demucs_adapter, "_demucs_source_path", lambda: Path("/fake/demucs"))
    _install_fake_source(monkeypatch, np.zeros((500, channels), dtype=np.float32), sample_rate)

    demucs_adapter.separate_audio(tmp_path / "video.mp4", tmp_path / "session")

    assert calls == [300, 300]
    assert release_checked == [True]


def test_separate_audio_cleans_temporary_files_after_demucs_failure(tmp_path, monkeypatch):
    sample_rate, channels = 100, 2
    monkeypatch.setattr(demucs_adapter, "OVERLAP_SECONDS", 1)
    monkeypatch.setenv("DEMUCS_CHUNK_SECONDS", "2")
    _install_fake_demucs(
        monkeypatch,
        sample_rate,
        channels,
        [],
        fail_on_call=2,
    )
    _install_fake_source(monkeypatch, np.zeros((500, channels), dtype=np.float32), sample_rate)
    session = tmp_path / "session"

    with pytest.raises(RuntimeError, match="injected Demucs failure"):
        demucs_adapter.separate_audio(tmp_path / "video.mp4", session)

    assert list((session / "tmp").iterdir()) == []
    assert not (session / "media" / "audio_vocals.wav").exists()
    assert not (session / "media" / "audio_bgm.wav").exists()


def test_separate_audio_removes_partial_outputs_when_finalization_fails(
    tmp_path, monkeypatch
):
    sample_rate, channels = 100, 2
    monkeypatch.setenv("DEMUCS_CHUNK_SECONDS", "2")
    _install_fake_demucs(monkeypatch, sample_rate, channels, [])
    _install_fake_source(monkeypatch, np.zeros((100, channels), dtype=np.float32), sample_rate)
    finalized: list[Path] = []

    def fake_finalize(source, destination, peak, rate, output_channels):
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(b"partial")
        finalized.append(destination)
        if len(finalized) == 2:
            raise RuntimeError("injected finalization failure")

    monkeypatch.setattr(demucs_adapter, "_finalize", fake_finalize)
    session = tmp_path / "session"

    with pytest.raises(RuntimeError, match="injected finalization failure"):
        demucs_adapter.separate_audio(tmp_path / "video.mp4", session)

    assert len(finalized) == 2
    assert list((session / "tmp").iterdir()) == []
    assert not (session / "media" / "audio_vocals.wav").exists()
    assert not (session / "media" / "audio_bgm.wav").exists()


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
