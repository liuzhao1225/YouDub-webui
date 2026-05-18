from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import BinaryIO, Optional, Tuple, Union

import numpy as np
import soundfile as sf
import torch

Uri = Union[BinaryIO, str, os.PathLike]


def _env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name, "")
    if not value:
        return default
    return value.strip().lower() not in {"0", "false", "no", "off"}


def use_torchcodec() -> bool:
    return _env_flag("USE_TORCHCODEC", default=False)


def ffmpeg_bin() -> str:
    configured = os.getenv("FFMPEG_PATH", "").strip()
    if configured:
        return configured
    found = shutil.which("ffmpeg")
    if found:
        return found
    raise FileNotFoundError(
        "FFmpeg not found on PATH. Install it (e.g. winget install Gyan.FFmpeg) "
        "or set FFMPEG_PATH to the ffmpeg executable."
    )


def _to_channels_first(wav: torch.Tensor, channels_first: bool) -> torch.Tensor:
    if wav.ndim == 1:
        return wav.unsqueeze(0)
    if wav.ndim != 2:
        raise ValueError(f"Expected 1D or 2D tensor, got {wav.ndim}D tensor")
    return wav if channels_first else wav.transpose(0, 1)


def _tensor_to_soundfile_array(wav: torch.Tensor, channels_first: bool) -> np.ndarray:
    data = _to_channels_first(wav.detach().cpu().float(), channels_first)
    return data.numpy().T


def save_audio_tensor(
    uri: Uri,
    src: torch.Tensor,
    sample_rate: int,
    *,
    channels_first: bool = True,
    bits_per_sample: int = 16,
    **_kwargs,
) -> None:
    """Save float audio tensor to disk without TorchCodec."""
    path = Path(uri)
    path.parent.mkdir(parents=True, exist_ok=True)
    subtype = "PCM_16"
    if bits_per_sample == 24:
        subtype = "PCM_24"
    elif bits_per_sample == 32:
        subtype = "PCM_32"
    sf.write(str(path), _tensor_to_soundfile_array(src, channels_first), int(sample_rate), subtype=subtype)


def load_audio_tensor(
    uri: Uri,
    frame_offset: int = 0,
    num_frames: int = -1,
    *,
    channels_first: bool = True,
    **_kwargs,
) -> Tuple[torch.Tensor, int]:
    """Load audio from disk without TorchCodec."""
    if hasattr(uri, "read"):
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as handle:
            temp_path = Path(handle.name)
            handle.write(uri.read())
        try:
            return load_audio_tensor(
                temp_path,
                frame_offset=frame_offset,
                num_frames=num_frames,
                channels_first=channels_first,
            )
        finally:
            temp_path.unlink(missing_ok=True)

    data, sample_rate = sf.read(str(uri), always_2d=True, dtype="float32")
    tensor = torch.from_numpy(data.T)
    if frame_offset > 0:
        tensor = tensor[:, frame_offset:]
    if num_frames > 0:
        tensor = tensor[:, :num_frames]
    if not channels_first:
        tensor = tensor.transpose(0, 1)
    return tensor, int(sample_rate)


def extract_audio_from_video(
    video_path: Path,
    output_path: Path,
    *,
    sample_rate: int = 44100,
) -> Path:
    """Extract mono/stereo WAV audio from a video file via FFmpeg."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        ffmpeg_bin(),
        "-y",
        "-i",
        str(video_path),
        "-vn",
        "-acodec",
        "pcm_s16le",
        "-ar",
        str(sample_rate),
        str(output_path),
    ]
    subprocess.run(cmd, check=True, capture_output=True, text=True)
    return output_path


def patch_torchaudio_no_torchcodec() -> None:
    """Replace torchaudio TorchCodec entry points with soundfile/FFmpeg helpers."""
    import torchaudio

    torchaudio.save = save_audio_tensor  # type: ignore[assignment]
    torchaudio.load = load_audio_tensor  # type: ignore[assignment]
    torchaudio.save_with_torchcodec = save_audio_tensor  # type: ignore[attr-defined]
    torchaudio.load_with_torchcodec = load_audio_tensor  # type: ignore[attr-defined]

    try:
        import torchaudio._torchcodec as torchcodec_module

        torchcodec_module.save_with_torchcodec = save_audio_tensor
        torchcodec_module.load_with_torchcodec = load_audio_tensor
    except Exception:
        pass
