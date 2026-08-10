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


def test_merge_tts_audio_keeps_original_audio_for_empty_translation(
    monkeypatch, tmp_path
):
    session = tmp_path / "session"
    tts_dir = session / "segments" / "tts"
    translation_file = session / "metadata" / "translation.en.json"
    original = np.linspace(-0.75, 0.75, 4000, dtype=np.float32)
    original_file = _write_wav(tts_dir / "0001.wav", original)
    meaningful_file = _write_wav(tts_dir / "0002.wav", np.zeros(4000, dtype=np.float32))
    translation_file.parent.mkdir(parents=True, exist_ok=True)
    translation_file.write_text(
        json.dumps(
            {
                "translation": [
                    {"dst": "", "start_time": 0, "end_time": 500},
                    {"dst": "Meaningful.", "start_time": 700, "end_time": 1200},
                ]
            }
        ),
        encoding="utf-8",
    )

    def fake_load(path: Path):
        samples, sample_rate = sf.read(path, dtype="float32")
        return samples, sample_rate

    monkeypatch.setattr(audio, "_load_audio", fake_load)
    monkeypatch.setattr(audio, "_audio_duration", lambda _path: (0.5, 8000))
    monkeypatch.setattr(audio, "_base_speed_factor", lambda *_args: 1.0)
    monkeypatch.setattr(
        audio,
        "_stretch_segment",
        lambda path, _ratio, _target, _cache: (sf.read(path, dtype="float32")[0], 8000),
    )

    dubbing_file, timings_file = audio.merge_tts_audio(
        translation_file,
        tts_dir,
        session,
    )

    mixed, sample_rate = sf.read(dubbing_file, dtype="float32")
    source_samples, _ = sf.read(original_file, dtype="float32")
    assert sample_rate == 8000
    assert np.allclose(mixed[:4000], source_samples, atol=1e-6)
    assert not np.allclose(mixed[:4000], np.zeros(4000, dtype=np.float32))
    timings = json.loads(timings_file.read_text(encoding="utf-8"))["translation"]
    assert timings[0]["actual_start_time"] == 0
    assert timings[0]["actual_end_time"] == 500
    assert meaningful_file.exists()
