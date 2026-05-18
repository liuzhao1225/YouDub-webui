from __future__ import annotations

import importlib

import numpy as np
import pytest
import torch


def test_torchaudio_save_without_torchcodec(monkeypatch, tmp_path):
    monkeypatch.setenv("USE_TORCHCODEC", "0")
    import backend.app.config as config

    importlib.reload(config)

    import torchaudio

    wav = torch.zeros(2, 8000, dtype=torch.float32)
    output = tmp_path / "clip.wav"
    torchaudio.save(str(output), wav, 16000)

    assert output.exists()
    assert output.stat().st_size > 0


def test_save_audio_tensor_roundtrip(tmp_path):
    from backend.app.utils.video import load_audio_tensor, save_audio_tensor

    source = torch.linspace(-0.5, 0.5, steps=4000).unsqueeze(0)
    path = tmp_path / "roundtrip.wav"
    save_audio_tensor(path, source, 16000)
    loaded, sample_rate = load_audio_tensor(path)

    assert sample_rate == 16000
    assert loaded.shape[0] == 1
    assert loaded.shape[1] == pytest.approx(4000, rel=0, abs=2)
