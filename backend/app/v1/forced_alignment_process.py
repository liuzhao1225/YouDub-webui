"""Isolated local Qwen timestamp inference; generates no speech or new text."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-path", type=Path, required=True)
    parser.add_argument("--request-path", type=Path, required=True)
    parser.add_argument("--output-path", type=Path, required=True)
    parser.add_argument("--device", required=True)
    options = parser.parse_args()
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    import librosa
    import numpy as np
    import soundfile as sf
    import torch
    from transformers import AutoModelForTokenClassification, AutoProcessor

    request = json.loads(options.request_path.read_text(encoding="utf-8"))
    processor = AutoProcessor.from_pretrained(str(options.model_path), local_files_only=True)
    model = AutoModelForTokenClassification.from_pretrained(
        str(options.model_path), local_files_only=True, dtype=torch.float32,
    ).to(options.device).eval()
    results = []
    with torch.inference_mode():
        for clip in request["clips"]:
            samples, rate = sf.read(clip["audio_path"], dtype="float32", always_2d=True)
            if not samples.size or not np.isfinite(samples).all() or len(samples) / rate > 300:
                raise ValueError("Invalid or over-five-minute alignment audio")
            audio = librosa.resample(samples.mean(axis=1), orig_sr=rate, target_sr=16000)
            inputs, words = processor.prepare_forced_aligner_inputs(
                audio=audio, transcript=clip["text"], language=request["language"], return_tensors="pt",
            )
            inputs = inputs.to(options.device, dtype=model.dtype)
            output = model(**inputs)
            aligned = processor.decode_forced_alignment(
                output.logits, inputs["input_ids"], words, model.config.timestamp_token_id,
            )
            results.append({"segment_id": clip["segment_id"], "words": aligned[0]})
    options.output_path.write_text(json.dumps({"model": "Qwen3-ForcedAligner-0.6B-hf", "clips": results}, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
