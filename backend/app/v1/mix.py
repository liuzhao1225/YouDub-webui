"""Bounded speech timing on the unchanged video timeline.

The duration multiplier is base * local, where base is
clamp(0.99 * sum(source durations) / sum(TTS durations), 0.8, 1.2), and local
is clamp((source_end - scheduled_start) / (TTS_duration * base), 0.75, 1.25).
These are the production pipeline's bounds. FFmpeg atempo uses the reciprocal
multiplier. Scheduling always advances by actual output samples, never by the
estimated duration or the old source end. No speech samples are trimmed.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path

import numpy as np
import soundfile as sf

from ..config import ffmpeg_binary
from . import media
from .audio_segments import AlignedSegment, Alignment, SpeechClip, read_speech_clips
from .errors import ApiError
from .segments import read_transcript
from .steps import Completed, StageContext

SAMPLE_RATE = 48000
CHANNELS = 2
BACKGROUND_GAIN = 0.3


def _input_file(context: StageContext, name: str) -> Path:
    path = context.input_files.get(name)
    if path is None or not path.is_file():
        raise ApiError(500, "INPUT_MISSING", f"The {name} input is missing.", stage="mix", action="retry")
    return path


def _invalid(message: str) -> ApiError:
    return ApiError(500, "INVALID_PROVIDER_RESULT", message, stage="mix", action="retry")


def _clip_input(context: StageContext, clip: SpeechClip) -> tuple[Path, float]:
    path = (context.work_dir / clip.path).resolve()
    if Path(clip.path).is_absolute() or not path.is_relative_to(context.work_dir.resolve()) or not path.is_file():
        raise _invalid("A speech clip is missing or outside its work directory.")
    try:
        info = sf.info(path)
    except (OSError, RuntimeError) as exc:
        raise _invalid("A speech clip could not be read.") from exc
    if (info.frames <= 0 or info.samplerate != clip.sample_rate_hz or info.channels != clip.channels
            or round(info.frames * 1000 / info.samplerate) != clip.duration_ms):
        raise _invalid("Speech clip metadata differs from the actual audio.")
    return path, info.frames * 1000 / info.samplerate


def _decode(context: StageContext, source: Path, destination: Path, *, duration_ratio: float = 1.0) -> np.ndarray:
    command = [ffmpeg_binary(), "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-xerror",
               "-i", str(source.resolve()), "-map", "0:a:0", "-vn"]
    if duration_ratio != 1.0:
        command.extend(["-af", f"atempo={1 / duration_ratio:.12g}"])
    command.extend(["-ar", str(SAMPLE_RATE), "-ac", str(CHANNELS), "-c:a", "pcm_f32le", str(destination.resolve())])
    try:
        result = media._run_media(command, check_cancel=context.check_cancel)
    except FileNotFoundError as exc:
        raise ApiError(503, "RUNTIME_UNAVAILABLE", "ffmpeg is unavailable.", stage="mix") from exc
    if result.returncode != 0:
        raise ApiError(500, "INTERNAL_ERROR", f"FFmpeg audio processing failed (exit {result.returncode}).",
                       stage="mix", action="retry")
    try:
        samples, rate = sf.read(destination, dtype="float32", always_2d=True)
    except (OSError, RuntimeError) as exc:
        raise _invalid("Processed audio is missing or invalid.") from exc
    if rate != SAMPLE_RATE or samples.shape[1] != CHANNELS or not len(samples) or not np.isfinite(samples).all():
        raise _invalid("Processed audio has invalid samples or format.")
    return samples


def run(context: StageContext, progress: Callable[[float | None, str], None]) -> Completed:
    context.check_cancel()
    if context.config.output_mode == "subtitles":
        raise ApiError(422, "INVALID_CONFIG", "Subtitle-only tasks do not have a mixing step.", stage="mix")
    transcript = read_transcript(_input_file(context, "transcript"), stage="mix")
    clips = read_speech_clips(_input_file(context, "speech_clips"), transcript).match(transcript)
    try:
        info = json.loads(_input_file(context, "media_info").read_text(encoding="utf-8"))
    except (ValueError, UnicodeError) as exc:
        raise _invalid("The source media information is invalid.") from exc
    duration = info.get("duration_ms") if isinstance(info, dict) else None
    if type(duration) is not int or duration <= 0:
        raise _invalid("The source video duration is invalid.")
    previous_source_end = 0
    inputs = {}
    for segment in transcript.segments:
        if segment.start_ms < previous_source_end:
            raise ApiError(422, "UNSUPPORTED_OVERLAPPING_SPEECH", "Source speech segments overlap.",
                           stage="mix", action="none")
        if segment.end_ms > duration:
            raise _invalid("Source speech extends beyond the video.")
        previous_source_end = segment.end_ms
        inputs[segment.id] = _clip_input(context, clips[segment.id])
    background = _input_file(context, "background") if context.config.keep_background else None
    context.work_dir.mkdir(parents=True, exist_ok=True)
    adjusted = context.work_dir / "adjusted"
    adjusted.mkdir(exist_ok=True)
    total_samples = round(duration * SAMPLE_RATE / 1000)
    final_audio = np.zeros((total_samples, CHANNELS), dtype=np.float32)
    base = min(1.2, max(0.8, 0.99 * sum(segment.end_ms - segment.start_ms for segment in transcript.segments)
                        / sum(milliseconds for _, milliseconds in inputs.values())))
    previous_end = 0
    aligned = []
    for index, segment in enumerate(transcript.segments):
        context.check_cancel()
        path, raw_duration = inputs[segment.id]
        start_sample = max(round(segment.start_ms * SAMPLE_RATE / 1000), previous_end)
        start_ms = start_sample * 1000 / SAMPLE_RATE
        local = min(1.25, max(0.75, (segment.end_ms - start_ms) / (raw_duration * base)))
        samples = _decode(context, path, adjusted / f"{index + 1:04d}.wav", duration_ratio=base * local)
        end_sample = start_sample + len(samples)
        if end_sample > total_samples:
            raise ApiError(422, "AUDIO_EXCEEDS_VIDEO", "The complete dubbed speech does not fit the source video.",
                           stage="mix", action="adjust_settings")
        final_audio[start_sample:end_sample] = samples
        aligned.append(AlignedSegment(
            segment_id=segment.id, source_start_ms=segment.start_ms, source_end_ms=segment.end_ms,
            dubbed_start_ms=round(start_ms), dubbed_end_ms=round(end_sample * 1000 / SAMPLE_RATE),
        ))
        previous_end = end_sample
        progress((index + 1) / (len(transcript.segments) + 1), f"Aligned {index + 1}/{len(transcript.segments)} speech clips")
    if background is not None:
        samples = _decode(context, background, adjusted / "background.wav")
        count = min(len(samples), total_samples)
        final_audio[:count] += BACKGROUND_GAIN * samples[:count]
        # Preserve headroom for the additive mix, with a fixed documented gain.
        final_audio /= 1 + BACKGROUND_GAIN
    context.check_cancel()
    if not np.isfinite(final_audio).all() or np.max(np.abs(final_audio)) > 1:
        raise _invalid("Mixed audio exceeds the supported sample amplitude.")
    alignment = Alignment(segments=aligned)
    alignment.match(transcript, duration)
    audio_path, alignment_path = context.work_dir / "mixed.wav", context.work_dir / "alignment.json"
    sf.write(audio_path, final_audio, SAMPLE_RATE, subtype="PCM_16")
    alignment_path.write_text(alignment.model_dump_json(indent=2), encoding="utf-8")
    progress(1.0, "Mixed audio and dubbed timeline are ready")
    return Completed(output_files={"mixed_audio": audio_path, "alignment": alignment_path})
