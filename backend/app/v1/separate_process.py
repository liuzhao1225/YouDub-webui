"""One cancellable Demucs process with a verified local official checkpoint."""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import traceback
from pathlib import Path


def _fail(code: str, message: str) -> int:
    print(json.dumps({"code": code, "message": message}), file=sys.stderr)
    return 1


def main(argv=None) -> int:
    parser = argparse.ArgumentParser()
    for name in ("model", "audio", "vocals", "background"):
        parser.add_argument(f"--{name}-path", type=Path, required=True)
    parser.add_argument("--device", required=True)
    options = parser.parse_args(argv)
    checkpoint = options.model_path
    if not checkpoint.is_file():
        return _fail("MODEL_NOT_READY", "The local Demucs checkpoint is missing.")
    # The supported model and checksum are fixed by the vendored official
    # demucs/remote/htdemucs.yaml and files.txt. Check before loading its pickle.
    with checkpoint.open("rb") as handle:
        digest = hashlib.file_digest(handle, "sha256").hexdigest()
    if checkpoint.name != "955717e8-8726e21a.th" or not digest.startswith("8726e21a"):
        return _fail("MODEL_NOT_READY", "The local Demucs checkpoint checksum is invalid.")
    sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "submodule" / "demucs"))
    try:
        import numpy as np
        import soundfile as sf
        import torch
        from demucs.apply import apply_model
        from demucs.states import load_model
    except ImportError as exc:
        return _fail("MODEL_NOT_READY", f"A Demucs runtime dependency is missing ({exc.name}).")
    try:
        # Official Demucs packages contain a model class and state dictionary.
        # Pass the already loaded package; do not modify Torch's global loader.
        package = torch.load(checkpoint, map_location="cpu", weights_only=False)
        model = load_model(package).eval()
    except Exception as exc:
        traceback.print_exc()
        return _fail("MODEL_NOT_READY", f"The local Demucs model could not be loaded ({type(exc).__name__}).")
    try:
        samples, rate = sf.read(options.audio_path, dtype="float32", always_2d=True)
        if rate != model.samplerate or samples.shape[1] != model.audio_channels or not np.isfinite(samples).all():
            return _fail("INVALID_MEDIA", "The prepared separation audio has an invalid format.")
        waveform = torch.from_numpy(samples.T.copy())
        reference = waveform.mean(0)
        mean, std = reference.mean(), reference.std()
        if not torch.isfinite(std) or std <= 0:
            return _fail("INVALID_MEDIA", "The source audio has no signal for separation.")
        normalized = (waveform - mean) / std
        with torch.inference_mode():
            sources = apply_model(model, normalized[None], device=options.device, shifts=1,
                                  split=True, overlap=0.25, progress=False, num_workers=0)[0]
        sources = sources.cpu() * std + mean
        vocals_index = model.sources.index("vocals")
        vocals = sources[vocals_index].numpy().T
        background = sum(source for index, source in enumerate(sources) if index != vocals_index).numpy().T
        if vocals.shape != samples.shape or background.shape != samples.shape or not np.isfinite(sources.numpy()).all():
            return _fail("INVALID_PROVIDER_RESULT", "Demucs changed the audio length or returned non-finite samples.")
        sf.write(options.vocals_path, vocals, rate, subtype="FLOAT")
        sf.write(options.background_path, background, rate, subtype="FLOAT")
    except Exception as exc:
        traceback.print_exc()
        return _fail("INVALID_PROVIDER_RESULT", f"Demucs separation failed ({type(exc).__name__}).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
