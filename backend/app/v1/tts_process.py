"""Generate a Task's speech clips with one local VoxCPM2 model instance."""

from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
from pathlib import Path


def _fail(code: str, message: str) -> int:
    print(json.dumps({"code": code, "message": message}), file=sys.stderr)
    return 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-path", type=Path, required=True)
    parser.add_argument("--request-path", type=Path, required=True)
    parser.add_argument("--device", required=True)
    options = parser.parse_args(argv)
    model_path = options.model_path.resolve()
    if not model_path.is_dir():
        return _fail("MODEL_NOT_READY", "The local VoxCPM2 model directory is missing.")
    try:
        config = json.loads((model_path / "config.json").read_text(encoding="utf-8"))
        if str(config.get("architecture", "")).lower() != "voxcpm2":
            raise ValueError("VoxCPM2 architecture is required")
    except (OSError, ValueError, AttributeError):
        return _fail("MODEL_NOT_READY", "The selected model is not a valid local VoxCPM2 model.")
    try:
        clips = json.loads(options.request_path.read_text(encoding="utf-8"))["clips"]
        if not isinstance(clips, list) or not clips:
            raise ValueError("Speech clips are required")
        ids = set()
        for clip in clips:
            if not isinstance(clip["text"], str) or not clip["text"].strip() or clip["segment_id"] in ids:
                raise ValueError("Invalid speech clip")
            ids.add(clip["segment_id"])
            if not Path(clip["reference_path"]).is_file():
                raise ValueError("Reference audio is missing")
    except (OSError, ValueError, KeyError, TypeError):
        return _fail("INPUT_MISSING", "The speech generation request or reference audio is invalid.")

    # VoxCPM's tokenizer loader also stays offline when resolving optional files.
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    try:
        import numpy as np
        import soundfile as sf
        from voxcpm import VoxCPM
    except ImportError:
        return _fail("MODEL_NOT_READY", "Install VoxCPM2 and its audio dependencies in the backend environment.")
    try:
        model = VoxCPM.from_pretrained(
            str(model_path), local_files_only=True, load_denoiser=False, optimize=False, device=options.device,
        )
        sample_rate = model.tts_model.sample_rate
        if type(sample_rate) is not int or sample_rate <= 0:
            raise ValueError("Invalid model output sample rate")
    except Exception as exc:
        traceback.print_exc()
        return _fail("MODEL_NOT_READY", f"The local VoxCPM2 model could not be loaded ({type(exc).__name__}).")
    try:
        for clip in clips:
            waveform = np.asarray(model.generate(
                text=clip["text"], reference_wav_path=clip["reference_path"],
                normalize=False, denoise=False, retry_badcase=False,
            ))
            if (waveform.ndim != 1 or waveform.size == 0 or not np.isfinite(waveform).all()
                    or np.max(np.abs(waveform)) > 1):
                raise ValueError("VoxCPM2 returned an empty or invalid mono waveform")
            sf.write(clip["output_path"], waveform, sample_rate, format="WAV", subtype="PCM_16")
    except Exception as exc:
        traceback.print_exc()
        return _fail("INVALID_PROVIDER_RESULT", f"VoxCPM2 speech generation failed ({type(exc).__name__}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
