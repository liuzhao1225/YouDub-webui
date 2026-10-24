"""Clone each translated utterance from its corresponding source utterance."""

from __future__ import annotations

import json
import os
import sys
from collections.abc import Callable
from pathlib import Path

from .audio_segments import SpeechClip, SpeechClips
from .audio import audio_info
from .errors import ApiError
from .segments import LANGUAGES, Transcript, read_transcript, read_translation
from .steps import Completed, StageContext
from ..paths import data_directory

def model_directory() -> Path:
    configured = os.getenv("YOUDUB_VOXCPM_MODEL_DIR", "").strip()
    return Path(configured).expanduser().resolve() if configured else data_directory() / "models" / "voxcpm" / "VoxCPM2"


def available_models() -> list[str]:
    """Inspect only local asset metadata; never import or download a model."""
    root = model_directory()

    def present(name: str) -> bool:
        path = root / name
        return path.is_file() and path.stat().st_size > 0

    groups = (("config.json",), ("tokenizer_config.json",), ("tokenizer.json", "tokenizer.model"),
              ("model.safetensors", "pytorch_model.bin"), ("audiovae.safetensors", "audiovae.pth"))
    return ["VoxCPM2"] if all(any(present(name) for name in choices) for choices in groups) else []


def _reference_error(message: str) -> ApiError:
    return ApiError(422, "INVALID_MEDIA", message, field="tts.voice.mode", stage="tts")


def prepare_reference_audio(context: StageContext, transcript: Transcript, progress: Callable) -> dict:
    """Prepare cloning inputs independently of a speech model invocation."""
    from ..config import ffmpeg_binary
    from .media import _run_media

    vocals = context.input_files["vocals"]
    source_info = audio_info(vocals, stage=context.stage)
    source_duration_ms = round(source_info.frames * 1000 / source_info.samplerate)
    if any(segment.end_ms > source_duration_ms for segment in transcript.segments):
        raise ApiError(422, "INVALID_MEDIA", "A source utterance lies outside the separated vocals.", stage="tts")
    # Keep each utterance's complete audio and matching text, including imported
    # subtitles that have sentence timings without ASR word timings.
    references = transcript.segments
    output_dir = context.work_dir / "tts"
    reference_dir = output_dir / "references"
    reference_dir.mkdir(parents=True, exist_ok=True)
    prepared = {}
    progress(0.0, "Preparing source utterance references")
    for index, reference in enumerate(references, start=1):
        context.check_cancel()
        start_ms = reference.start_ms
        duration_ms = reference.end_ms - start_ms
        path = reference_dir / f"{index:06d}.wav"
        try:
            result = _run_media(
                [ffmpeg_binary(), "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-xerror",
                 "-ss", f"{start_ms / 1000:.3f}", "-i", str(vocals.resolve()),
                 "-t", f"{duration_ms / 1000:.3f}", "-map", "0:a:0", "-vn", "-ac", "1",
                 "-ar", "16000", "-c:a", "pcm_s16le", str(path.resolve())],
                check_cancel=context.check_cancel,
            )
        except FileNotFoundError as exc:
            raise ApiError(503, "RUNTIME_UNAVAILABLE", "ffmpeg is unavailable.", stage="tts") from exc
        if result.returncode != 0:
            raise ApiError(422, "INVALID_MEDIA", "The source utterance reference could not be extracted.", stage="tts")
        info = audio_info(path, stage=context.stage)
        if round(info.frames * 1000 / info.samplerate) != duration_ms:
            raise ApiError(422, "INVALID_MEDIA", "The source reference does not cover the selected utterance interval.", stage="tts")
        prepared[reference.id] = {"path": path, "text": reference.text}
        progress(index / len(references), f"Prepared source reference {index}/{len(references)}")
    return prepared


def run(context: StageContext, progress: Callable[[float | None, str], None], *,
        prepared_references: dict) -> Completed:
    from .media import _run_media

    context.check_cancel()
    selection = context.config.tts
    if selection is None or selection.adapter != "voxcpm" or selection.model != "VoxCPM2" or selection.device == "remote":
        raise ApiError(422, "INVALID_CONFIG", "TTS requires the local VoxCPM2 model and a CPU/CUDA/ROCm/MPS device.",
                       field="tts", stage="tts")
    if selection.voice.mode != "source_clone":
        raise ApiError(422, "INVALID_CONFIG", "VoxCPM2 preset voice assets are not configured; select source_clone.",
                       field="tts.voice.mode", stage="tts")
    if not available_models():
        raise ApiError(503, "MODEL_NOT_READY", "The local VoxCPM2 model assets are missing or incomplete.",
                       field="tts.model", stage="tts")
    for name in ("transcript", "translation"):
        path = context.input_files.get(name)
        if path is None or not path.is_file() or path.stat().st_size == 0:
            raise ApiError(500, "INPUT_MISSING", f"The {name} input is missing or empty.", stage="tts")
    transcript = read_transcript(context.input_files["transcript"], stage="tts")
    translation = read_translation(context.input_files["translation"], transcript, stage="tts")
    if transcript.detected_language not in LANGUAGES or context.config.target_language not in LANGUAGES:
        raise ApiError(422, "UNSUPPORTED_LANGUAGE", "VoxCPM2 supports English, Chinese and Japanese in this pipeline.",
                       stage="tts", action="adjust_settings")
    if translation.target_language != context.config.target_language:
        raise ApiError(502, "INVALID_PROVIDER_RESULT", "The translation target language differs from the Task.", stage="tts")
    texts = translation.match(transcript)
    prepared = prepared_references
    if set(prepared) != {segment.id for segment in transcript.segments}:
        raise _reference_error("Prepared source references must match transcript utterance IDs exactly.")
    output_dir = context.work_dir / "tts"
    output_dir.mkdir(parents=True, exist_ok=True)
    clips = [{"segment_id": segment.id, "text": texts[segment.id],
              "reference_path": str(Path(prepared[segment.id]["path"]).resolve()),
              "reference_text": prepared[segment.id]["text"],
              "output_path": str((output_dir / f"{index:06d}.wav").resolve())}
             for index, segment in enumerate(transcript.segments, start=1)]
    request_path = output_dir / "request.json"
    request_path.write_text(json.dumps({"clips": clips}, ensure_ascii=False, indent=2), encoding="utf-8")
    progress(None, "Generating translated speech with VoxCPM2")
    result = _run_media(
        [sys.executable, str(Path(__file__).with_name("tts_process.py")),
         "--model-path", str(model_directory().resolve()), "--request-path", str(request_path.resolve()),
         "--device", selection.device],
        check_cancel=context.check_cancel,
    )
    if result.returncode != 0:
        try:
            error = json.loads(result.stderr.strip().splitlines()[-1])
        except (ValueError, IndexError):
            error = {}
        if (not isinstance(error, dict) or error.get("code") not in {"MODEL_NOT_READY", "INPUT_MISSING", "INVALID_PROVIDER_RESULT"}
                or not isinstance(error.get("message"), str)):
            error = {"code": "WORKER_EXITED", "message": f"VoxCPM2 process exited with code {result.returncode}."}
        status = 503 if error["code"] == "MODEL_NOT_READY" else 502
        raise ApiError(status, error["code"], error["message"], stage="tts",
                       action="adjust_settings" if status == 503 else "retry") from RuntimeError(result.stderr)
    measured = []
    for clip in clips:
        context.check_cancel()
        path = Path(clip["output_path"])
        info = audio_info(path, stage=context.stage)
        duration_ms = round(info.frames * 1000 / info.samplerate)
        if duration_ms <= 0:
            raise ApiError(502, "INVALID_PROVIDER_RESULT", "A generated speech clip has no measurable duration.", stage="tts")
        measured.append(SpeechClip(segment_id=clip["segment_id"], path=path.relative_to(context.work_dir.resolve()).as_posix(),
                                   duration_ms=duration_ms, sample_rate_hz=info.samplerate, channels=info.channels))
    payload = SpeechClips(clips=measured)
    payload.match(transcript)
    output = context.work_dir / "speech_clips.json"
    output.write_text(payload.model_dump_json(indent=2), encoding="utf-8")
    progress(1.0, "All source segments have generated speech")
    return Completed(output_files={"speech_clips": output})
