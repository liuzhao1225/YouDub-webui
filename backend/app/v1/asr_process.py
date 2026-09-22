"""One Whisper invocation in a cancellable process; never resolve model names.

Executed by file path so importing this entry point does not load the server or
legacy environment configuration. The caller supplies an existing checkpoint.
"""

from __future__ import annotations

import argparse
import json
import sys
import traceback
from pathlib import Path


def _fail(code: str, message: str, field: str | None = None) -> int:
    print(json.dumps({"code": code, "message": message, "field": field}), file=sys.stderr)
    return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-path", type=Path, required=True)
    parser.add_argument("--audio-path", type=Path, required=True)
    parser.add_argument("--output-path", type=Path, required=True)
    parser.add_argument("--device", required=True)
    parser.add_argument("--language", required=True)
    parser.add_argument("--initial-prompt")
    options = parser.parse_args(argv)

    # Passing an absolute file path is essential: Whisper downloads checkpoints
    # when load_model receives a recognized model name instead.
    model_path = options.model_path.resolve()
    if not model_path.is_file() or model_path.stat().st_size == 0:
        return _fail("MODEL_NOT_READY", "The selected local Whisper checkpoint is missing or empty.", "asr.model")
    if not options.audio_path.is_file() or options.audio_path.stat().st_size == 0:
        return _fail("INPUT_MISSING", "The ASR input audio is missing or empty.")
    try:
        import whisper
    except ImportError:
        return _fail("MODEL_NOT_READY", "Install openai-whisper in the backend Python environment.", "asr.model")
    if not callable(getattr(whisper, "load_model", None)):
        return _fail("MODEL_NOT_READY", "The installed whisper package is not OpenAI Whisper.", "asr.model")

    try:
        model = whisper.load_model(str(model_path), device=options.device)
    except Exception as exc:
        traceback.print_exc()
        return _fail("MODEL_NOT_READY", f"The local Whisper checkpoint could not be loaded ({type(exc).__name__}).", "asr.model")
    try:
        result = model.transcribe(
            str(options.audio_path.resolve()),
            language=None if options.language == "auto" else options.language,
            task="transcribe",
            fp16=options.device.startswith("cuda:"),
            word_timestamps=True,
            verbose=False,
            **({"initial_prompt": options.initial_prompt} if options.initial_prompt else {}),
        )
        options.output_path.write_text(
            json.dumps(result, ensure_ascii=False, allow_nan=False, indent=2), encoding="utf-8",
        )
    except Exception as exc:
        traceback.print_exc()
        return _fail("INVALID_PROVIDER_RESULT", f"Whisper transcription failed ({type(exc).__name__}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
