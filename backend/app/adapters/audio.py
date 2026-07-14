from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import soundfile as sf
from pydub import AudioSegment

BASE_FACTOR_MIN = 0.8
BASE_FACTOR_MAX = 1.2
BASE_FACTOR_SAFETY = 0.99
LOCAL_FACTOR_MIN = 0.9
LOCAL_FACTOR_MAX = 1.1
SPEED_NOOP_EPSILON = 1e-2


def split_audio_by_translation(vocals_file: Path, translation_file: Path, session: Path) -> Path:
    output_dir = session / "segments" / "vocals"
    output_dir.mkdir(parents=True, exist_ok=True)
    data = json.loads(translation_file.read_text(encoding="utf-8"))
    audio = AudioSegment.from_file(vocals_file)

    for index, item in enumerate(data["translation"], start=1):
        output_file = output_dir / f"{index:04d}.wav"
        if output_file.exists():
            continue
        start = max(0, int(item["start_time"]) - 80)
        end = min(len(audio), int(item["end_time"]) + 160)
        audio[start:end].export(output_file, format="wav")

    return output_dir


def _audio_duration(file: Path) -> tuple[float, int]:
    import librosa

    y, sr = librosa.load(str(file), sr=None)
    return len(y) / sr, sr


def _base_speed_factor(translation: list[dict], tts_files: list[Path]) -> float:
    cur_total = 0.0
    des_total = 0.0
    for segment, tts_file in zip(translation, tts_files):
        dur, _ = _audio_duration(tts_file)
        cur_total += dur
        des_total += max(0.0, (segment["end_time"] - segment["start_time"]) / 1000.0)
    if cur_total <= 0:
        return 1.0
    factor = des_total / cur_total * BASE_FACTOR_SAFETY
    return max(min(factor, BASE_FACTOR_MAX), BASE_FACTOR_MIN)


def _stretch_segment(audio_file: Path, ratio: float, target_sec: float, cache_dir: Path) -> tuple[np.ndarray, int]:
    import librosa

    if abs(ratio - 1.0) < SPEED_NOOP_EPSILON:
        y, sr = librosa.load(str(audio_file), sr=None)
        return y, sr
    from audiostretchy.stretch import stretch_audio

    out_path = cache_dir / audio_file.name
    stretch_audio(str(audio_file), str(out_path), ratio=ratio)
    y, sr = librosa.load(str(out_path), sr=None)
    return y[: int(target_sec * sr)], sr


def _local_factor(current_sec: float, base: float, desired_sec: float) -> float:
    first = current_sec * base
    if first <= 1e-3:
        return 1.0
    return max(min(desired_sec / first, LOCAL_FACTOR_MAX), LOCAL_FACTOR_MIN)


def _silence(seconds: float, sample_rate: int) -> np.ndarray:
    return np.zeros(int(seconds * sample_rate), dtype=np.float32)


def merge_tts_audio(translation_file: Path, tts_dir: Path, session: Path) -> tuple[Path, Path]:
    dubbing_file = session / "tmp" / "audio_dubbing.wav"
    timings_file = session / "metadata" / "timings.json"
    cache_dir = session / "segments" / "stretched"
    dubbing_file.parent.mkdir(parents=True, exist_ok=True)
    timings_file.parent.mkdir(parents=True, exist_ok=True)
    cache_dir.mkdir(parents=True, exist_ok=True)
    if dubbing_file.exists() and timings_file.exists():
        return dubbing_file, timings_file

    data = json.loads(translation_file.read_text(encoding="utf-8"))
    translation = data["translation"]
    tts_files = [tts_dir / f"{i:04d}.wav" for i in range(1, len(translation) + 1)]
    for path in tts_files:
        if not path.exists():
            raise FileNotFoundError(f"Missing TTS segment: {path}")

    _, sample_rate = _audio_duration(tts_files[0])
    base = _base_speed_factor(translation, tts_files)

    final_audio = np.zeros(0, dtype=np.float32)
    last_end_ms = 0.0
    for segment, tts_file in zip(translation, tts_files):
        last_end_ms = final_audio.shape[0] / sample_rate * 1000.0
        real_start_ms = max(float(segment["start_time"]), last_end_ms)
        if real_start_ms > last_end_ms:
            final_audio = np.concatenate(
                [final_audio, _silence((real_start_ms - last_end_ms) / 1000.0, sample_rate)]
            )

        current_sec, _ = _audio_duration(tts_file)
        desired_sec = (segment["end_time"] - real_start_ms) / 1000.0
        speed = base * _local_factor(current_sec, base, desired_sec)
        target_sec = current_sec * speed
        y, _ = _stretch_segment(tts_file, speed, target_sec, cache_dir)

        adjusted_sec = len(y) / sample_rate
        real_end_ms = max(real_start_ms + adjusted_sec * 1000.0, float(segment["end_time"]))
        final_audio = np.concatenate([final_audio, y])
        segment["actual_start_time"] = int(real_start_ms)
        segment["actual_end_time"] = int(real_end_ms)

    sf.write(str(dubbing_file), final_audio, sample_rate)
    timings_file.write_text(
        json.dumps({"translation": translation}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return dubbing_file, timings_file
