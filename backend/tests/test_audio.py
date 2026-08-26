from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import soundfile as sf

from backend.app.adapters import audio


def _write_wav(path: Path, samples: np.ndarray, sample_rate: int = 8000) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(path, samples.astype(np.float32), sample_rate)
    return path


def _patch_audio_loading(monkeypatch) -> None:
    def fake_load(path: Path):
        samples, sample_rate = sf.read(path, dtype="float32")
        return samples, sample_rate

    monkeypatch.setattr(audio, "_load_audio", fake_load)
    monkeypatch.setattr(
        audio,
        "_stretch_segment",
        lambda path, _ratio, _target, _cache: (
            sf.read(path, dtype="float32")[0],
            sf.info(path).samplerate,
        ),
    )


def test_merge_tts_audio_keeps_original_audio_for_original_mode(monkeypatch, tmp_path):
    session = tmp_path / "session"
    tts_dir = session / "segments" / "tts"
    translation_file = session / "metadata" / "translation.en.json"
    original = np.linspace(-0.75, 0.75, 4000, dtype=np.float32)
    original_file = _write_wav(tts_dir / "0001.wav", original)
    _write_wav(tts_dir / "0002.wav", np.zeros(4000, dtype=np.float32))
    translation_file.parent.mkdir(parents=True, exist_ok=True)
    translation_file.write_text(
        json.dumps(
            {
                "translation": [
                    {
                        "dst": "（笑声）",
                        "audio_mode": "original",
                        "start_time": 0,
                        "end_time": 500,
                    },
                    {
                        "dst": "Meaningful.",
                        "audio_mode": "tts",
                        "start_time": 700,
                        "end_time": 1200,
                    },
                ]
            }
        ),
        encoding="utf-8",
    )

    _patch_audio_loading(monkeypatch)
    monkeypatch.setattr(audio, "_audio_duration", lambda _path: (0.5, 8000))
    monkeypatch.setattr(audio, "_base_speed_factor", lambda *_args: 1.0)

    dubbing_file, timings_file = audio.merge_tts_audio(
        translation_file,
        tts_dir,
        session,
    )

    mixed, sample_rate = sf.read(dubbing_file, dtype="float32")
    source_samples, _ = sf.read(original_file, dtype="float32")
    assert sample_rate == 8000
    assert np.allclose(mixed[:4000], source_samples, atol=1e-6)
    timings = json.loads(timings_file.read_text(encoding="utf-8"))["translation"]
    assert timings[0]["actual_start_time"] == 0
    assert timings[0]["actual_end_time"] == 500


def test_base_speed_factor_ignores_original_audio(monkeypatch, tmp_path):
    original_file = tmp_path / "original.wav"
    translated_file = tmp_path / "translated.wav"
    durations = {original_file: (10.0, 8000), translated_file: (2.0, 8000)}
    monkeypatch.setattr(audio, "_audio_duration", lambda path: durations[path])

    factor = audio._base_speed_factor(
        [
            {"dst": "（笑声）", "audio_mode": "original", "start_time": 0, "end_time": 1000},
            {"dst": "Translated.", "audio_mode": "tts", "start_time": 1000, "end_time": 2000},
        ],
        [original_file, translated_file],
    )

    assert factor == audio.BASE_FACTOR_MIN


def test_merge_tts_audio_keeps_full_delayed_original_clip(monkeypatch, tmp_path):
    session = tmp_path / "session"
    tts_dir = session / "segments" / "tts"
    translation_file = session / "metadata" / "translation.en.json"
    _write_wav(tts_dir / "0001.wav", np.zeros(8000, dtype=np.float32))
    original = np.linspace(-0.75, 0.75, 4000, dtype=np.float32)
    original_file = _write_wav(tts_dir / "0002.wav", original)
    translation_file.parent.mkdir(parents=True, exist_ok=True)
    translation_file.write_text(
        json.dumps(
            {
                "translation": [
                    {
                        "dst": "Meaningful.",
                        "audio_mode": "tts",
                        "start_time": 0,
                        "end_time": 500,
                    },
                    {
                        "dst": "（喘息声）",
                        "audio_mode": "original",
                        "start_time": 500,
                        "end_time": 1000,
                    },
                ]
            }
        ),
        encoding="utf-8",
    )

    _patch_audio_loading(monkeypatch)
    monkeypatch.setattr(
        audio,
        "_audio_duration",
        lambda path: (1.0 if path.name == "0001.wav" else 0.5, 8000),
    )
    monkeypatch.setattr(audio, "_base_speed_factor", lambda *_args: 1.0)

    dubbing_file, timings_file = audio.merge_tts_audio(translation_file, tts_dir, session)

    mixed, _ = sf.read(dubbing_file, dtype="float32")
    source_samples, _ = sf.read(original_file, dtype="float32")
    assert np.allclose(mixed[8000:12000], source_samples, atol=1e-6)
    timings = json.loads(timings_file.read_text(encoding="utf-8"))["translation"]
    assert timings[1]["actual_start_time"] == 1000
    assert timings[1]["actual_end_time"] == 1500
