from __future__ import annotations

import json
import stat
from pathlib import Path
from unittest.mock import MagicMock, call, patch

import numpy as np
import pytest
import soundfile as sf

from backend.app import runtime_security
from backend.app.adapters import voxcpm as voxcpm_mod


def test_release_model_clears_cached_model(monkeypatch):
    model = object()
    monkeypatch.setattr(voxcpm_mod, "_MODEL", model)

    assert voxcpm_mod.release_model() is True
    assert voxcpm_mod._MODEL is None
    assert voxcpm_mod.release_model() is False


def _make_synthetic_wav(path: Path, duration_ms: int = 1500) -> Path:
    """Create a minimal WAV file for testing."""
    rate = 16000
    samples = int(rate * duration_ms / 1000)
    wav = np.sin(2 * np.pi * 440 * np.linspace(0, duration_ms / 1000, samples)).astype(np.float32)
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(path, wav, rate)
    return path


def _write_translation_json(path: Path, items: list[dict]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"translation": items}), encoding="utf-8")
    return path


_CACHE_GENERATION_DEFAULTS = {
    "min_len": 2,
    "max_len": 4096,
    "retry_badcase": True,
    "retry_badcase_max_times": 3,
    "retry_badcase_ratio_threshold": 6.0,
}


@patch.object(voxcpm_mod, "_load_model")
def test_fallback_cache_built_once_and_reused(mock_load, tmp_path):
    """Prompt cache is built exactly once for the fallback reference."""
    session = tmp_path / "session"
    vocals_dir = session / "segments" / "vocals"
    ref_0001 = _make_synthetic_wav(vocals_dir / "0001.wav", duration_ms=600)
    ref_0002 = _make_synthetic_wav(vocals_dir / "0002.wav", duration_ms=600)
    ref_0003 = _make_synthetic_wav(vocals_dir / "0003.wav", duration_ms=300)
    ref_0004 = _make_synthetic_wav(vocals_dir / "0004.wav", duration_ms=2000)

    translation = _write_translation_json(
        session / "metadata" / "translation.en.json",
        [
            {"dst": "Short segment requiring fallback."},
            {"dst": "Another fallback sentence."},
            {"dst": "Third fallback."},
            {"dst": "Own reference sentence."},
        ],
    )

    mock_tts_model = MagicMock()
    mock_tts_model.sample_rate = 16000
    mock_cache = {"ref_audio_feat": MagicMock(), "mode": "reference"}

    mock_tts_model.build_prompt_cache.return_value = mock_cache

    fake_wav_tensor = MagicMock()
    fake_wav_tensor.squeeze.return_value.cpu.return_value.numpy.return_value = np.zeros(1600, dtype=np.float32)
    mock_tts_model.generate_with_prompt_cache.return_value = (fake_wav_tensor, MagicMock(), MagicMock())

    mock_model = MagicMock()
    mock_model.tts_model = mock_tts_model
    mock_model.generate.return_value = np.zeros(1600, dtype=np.float32)
    mock_load.return_value = mock_model

    voxcpm_mod.generate_tts(translation, vocals_dir, session)

    # build_prompt_cache called exactly once with fallback path
    mock_tts_model.build_prompt_cache.assert_called_once_with(
        reference_wav_path=str(ref_0004)
    )

    # generate_with_prompt_cache called for the 3 short segments
    assert mock_tts_model.generate_with_prompt_cache.call_count == 3
    mock_tts_model.generate_with_prompt_cache.assert_has_calls(
        [
            call(
                target_text="Short segment requiring fallback.",
                prompt_cache=mock_cache,
                cfg_value=2.0,
                inference_timesteps=10,
                **_CACHE_GENERATION_DEFAULTS,
            ),
            call(
                target_text="Another fallback sentence.",
                prompt_cache=mock_cache,
                cfg_value=2.0,
                inference_timesteps=10,
                **_CACHE_GENERATION_DEFAULTS,
            ),
            call(
                target_text="Third fallback.",
                prompt_cache=mock_cache,
                cfg_value=2.0,
                inference_timesteps=10,
                **_CACHE_GENERATION_DEFAULTS,
            ),
        ]
    )

    # model.generate called for the sentence with its own reference
    assert mock_model.generate.call_count == 1
    mock_model.generate.assert_called_once_with(
        text="Own reference sentence.",
        reference_wav_path=str(ref_0004),
        cfg_value=2.0,
        inference_timesteps=10,
    )


@patch.object(voxcpm_mod, "_load_model")
def test_skips_existing_tts_files(mock_load, tmp_path):
    """Pre-existing TTS output files are not regenerated."""
    session = tmp_path / "session"
    vocals_dir = session / "segments" / "vocals"
    tts_dir = session / "segments" / "tts"
    tts_dir.mkdir(parents=True)

    ref_0001 = _make_synthetic_wav(vocals_dir / "0001.wav", duration_ms=600)
    ref_0002 = _make_synthetic_wav(vocals_dir / "0002.wav", duration_ms=600)
    translation = _write_translation_json(
        session / "metadata" / "translation.en.json",
        [
            {"dst": "First sentence."},
            {"dst": "Second sentence."},
        ],
    )

    # Pre-create output file for sentence 0001
    sf.write(tts_dir / "0001.wav", np.zeros(1600, dtype=np.float32), 16000)

    mock_tts_model = MagicMock()
    mock_tts_model.sample_rate = 16000
    mock_cache = {"ref_audio_feat": MagicMock(), "mode": "reference"}
    mock_tts_model.build_prompt_cache.return_value = mock_cache

    fake_wav_tensor = MagicMock()
    fake_wav_tensor.squeeze.return_value.cpu.return_value.numpy.return_value = np.zeros(1600, dtype=np.float32)
    mock_tts_model.generate_with_prompt_cache.return_value = (fake_wav_tensor, MagicMock(), MagicMock())

    mock_model = MagicMock()
    mock_model.tts_model = mock_tts_model
    mock_load.return_value = mock_model

    voxcpm_mod.generate_tts(translation, vocals_dir, session)

    # Should only generate for sentence 0002 (0001 exists)
    assert mock_tts_model.generate_with_prompt_cache.call_count == 1
    call_kwargs = mock_tts_model.generate_with_prompt_cache.call_args.kwargs
    assert call_kwargs["target_text"] == "Second sentence."
    for key, value in _CACHE_GENERATION_DEFAULTS.items():
        assert call_kwargs[key] == value


@patch.object(voxcpm_mod, "_load_model")
def test_empty_translation_skips_tts(mock_load, tmp_path):
    """Empty translation items list returns early without calling the model."""
    session = tmp_path / "session"
    translation = _write_translation_json(
        session / "metadata" / "translation.en.json",
        [],
    )

    mock_model = MagicMock()
    mock_load.return_value = mock_model

    result = voxcpm_mod.generate_tts(translation, tmp_path, session)
    assert result == session / "segments" / "tts"
    mock_load.assert_not_called()


@patch.object(voxcpm_mod, "_load_model")
def test_original_mode_copies_original_audio_with_non_empty_caption(mock_load, tmp_path):
    session = tmp_path / "session"
    vocals_dir = session / "segments" / "vocals"
    _make_synthetic_wav(vocals_dir / "0001.wav", duration_ms=600)
    ref_0002 = _make_synthetic_wav(vocals_dir / "0002.wav", duration_ms=2000)
    original_vocals = _make_synthetic_wav(
        session / "media" / "audio_vocals.wav", duration_ms=2500
    )
    translation = _write_translation_json(
        session / "metadata" / "translation.en.json",
        [
            {
                "dst": "（呻吟）",
                "audio_mode": "original",
                "start_time": 0,
                "end_time": 500,
            },
            {
                "dst": "Meaningful sentence.",
                "audio_mode": "tts",
                "start_time": 600,
                "end_time": 1800,
            },
        ],
    )

    mock_tts_model = MagicMock()
    mock_tts_model.sample_rate = 16000
    mock_model = MagicMock()
    mock_model.tts_model = mock_tts_model
    mock_model.generate.return_value = np.zeros(1600, dtype=np.float32)
    mock_load.return_value = mock_model

    voxcpm_mod.generate_tts(
        translation,
        vocals_dir,
        session,
        original_vocals_file=original_vocals,
    )

    copied = session / "segments" / "tts" / "0001.wav"
    original_samples, _ = sf.read(original_vocals, dtype="float32")
    copied_samples, _ = sf.read(copied, dtype="float32")
    assert sf.info(copied).frames == 8000
    assert np.allclose(copied_samples, original_samples[:8000], atol=2 / 32768)
    mock_model.generate.assert_called_once_with(
        text="Meaningful sentence.",
        reference_wav_path=str(ref_0002),
        cfg_value=2.0,
        inference_timesteps=10,
    )


@patch.object(voxcpm_mod, "_load_model")
def test_legacy_empty_target_copies_original_audio_without_loading_model(mock_load, tmp_path):
    session = tmp_path / "session"
    vocals_dir = session / "segments" / "vocals"
    _make_synthetic_wav(vocals_dir / "0001.wav", duration_ms=600)
    original_vocals = _make_synthetic_wav(
        session / "media" / "audio_vocals.wav", duration_ms=2500
    )
    translation = _write_translation_json(
        session / "metadata" / "translation.en.json",
        [{"dst": "", "start_time": 100, "end_time": 600}],
    )

    voxcpm_mod.generate_tts(
        translation,
        vocals_dir,
        session,
        original_vocals_file=original_vocals,
    )

    copied = session / "segments" / "tts" / "0001.wav"
    assert sf.info(copied).frames == 8000
    mock_load.assert_not_called()


def test_original_target_audio_writes_exact_private_range(tmp_path):
    source = tmp_path / "media" / "audio_vocals.wav"
    source.parent.mkdir(parents=True)
    source_samples = np.linspace(-0.75, 0.75, 4000, dtype=np.float32)
    sf.write(source, source_samples, 8000)
    output = tmp_path / "segments" / "tts" / "0001.wav"

    voxcpm_mod._write_original_target_audio(
        output,
        {"start_time": 125, "end_time": 375},
        source,
    )

    copied, sample_rate = sf.read(output, dtype="float32")
    assert sample_rate == 8000
    assert len(copied) == 2000
    assert np.allclose(copied, source_samples[1000:3000], atol=2 / 32768)
    if runtime_security.POSIX_STRONG_PERMISSIONS:
        assert stat.S_IMODE(output.stat().st_mode) == 0o600
        assert stat.S_IMODE(output.parent.stat().st_mode) == 0o700


def test_original_target_audio_rejects_partially_out_of_range(tmp_path):
    source = _make_synthetic_wav(
        tmp_path / "media" / "audio_vocals.wav", duration_ms=500
    )
    output = tmp_path / "segments" / "tts" / "0001.wav"

    with pytest.raises(ValueError) as exc_info:
        voxcpm_mod._write_original_target_audio(
            output,
            {"start_time": 250, "end_time": 750},
            source,
        )

    message = str(exc_info.value)
    assert "250-750 ms" in message
    assert "requested frames 4000-12000" in message
    assert "8000 frames (500.000 ms)" in message
    assert not output.exists()


def test_original_target_audio_rejects_fully_out_of_range(tmp_path):
    source = _make_synthetic_wav(
        tmp_path / "media" / "audio_vocals.wav", duration_ms=500
    )
    output = tmp_path / "segments" / "tts" / "0001.wav"

    with pytest.raises(ValueError) as exc_info:
        voxcpm_mod._write_original_target_audio(
            output,
            {"start_time": 600, "end_time": 750},
            source,
        )

    message = str(exc_info.value)
    assert "600-750 ms" in message
    assert "requested frames 9600-12000" in message
    assert "8000 frames (500.000 ms)" in message
    assert not output.exists()


def test_original_target_audio_accepts_end_at_source_boundary(tmp_path):
    source = _make_synthetic_wav(
        tmp_path / "media" / "audio_vocals.wav", duration_ms=500
    )
    output = tmp_path / "segments" / "tts" / "0001.wav"

    voxcpm_mod._write_original_target_audio(
        output,
        {"start_time": 250, "end_time": 500},
        source,
    )

    copied, sample_rate = sf.read(output, dtype="float32")
    source_samples, _ = sf.read(source, dtype="float32")
    assert sample_rate == 16000
    assert len(copied) == 4000
    assert np.allclose(copied, source_samples[4000:8000], atol=2 / 32768)


def test_original_target_audio_accepts_sub_millisecond_rounded_tail(tmp_path):
    source = tmp_path / "media" / "audio_vocals.wav"
    source.parent.mkdir(parents=True)
    source_samples = np.linspace(-0.75, 0.75, 44127, dtype=np.float32)
    sf.write(source, source_samples, 44100)
    output = tmp_path / "segments" / "tts" / "0001.wav"

    voxcpm_mod._write_original_target_audio(
        output,
        {"start_time": 0, "end_time": 1001},
        source,
    )

    copied, sample_rate = sf.read(output, dtype="float32")
    assert sample_rate == 44100
    assert len(copied) == 44127
    assert np.allclose(copied, source_samples, atol=2 / 32768)


def test_original_target_audio_rejects_one_millisecond_tail_overflow(tmp_path):
    source = _make_synthetic_wav(
        tmp_path / "media" / "audio_vocals.wav", duration_ms=500
    )
    output = tmp_path / "segments" / "tts" / "0001.wav"

    with pytest.raises(ValueError) as exc_info:
        voxcpm_mod._write_original_target_audio(
            output,
            {"start_time": 0, "end_time": 501},
            source,
        )

    message = str(exc_info.value)
    assert "0-501 ms" in message
    assert "requested frames 0-8016" in message
    assert "8000 frames (500.000 ms)" in message
    assert not output.exists()


def test_original_target_audio_rejects_quantized_one_millisecond_tail_overflow(
    tmp_path,
):
    source = tmp_path / "media" / "audio_vocals.wav"
    source.parent.mkdir(parents=True)
    source_samples = np.linspace(-0.75, 0.75, 22050, dtype=np.float32)
    sf.write(source, source_samples, 44100)
    output = tmp_path / "segments" / "tts" / "0001.wav"

    with pytest.raises(ValueError) as exc_info:
        voxcpm_mod._write_original_target_audio(
            output,
            {"start_time": 0, "end_time": 501},
            source,
        )

    message = str(exc_info.value)
    assert "0-501 ms" in message
    assert "requested frames 0-22094" in message
    assert "22050 frames (500.000 ms)" in message
    assert not output.exists()


@pytest.mark.skipif(
    not runtime_security.POSIX_STRONG_PERMISSIONS,
    reason="symlink-safe private writes require POSIX semantics",
)
def test_original_target_audio_rejects_symlink_output(tmp_path):
    source = _make_synthetic_wav(
        tmp_path / "media" / "audio_vocals.wav", duration_ms=500
    )
    victim = tmp_path / "victim.wav"
    victim.write_bytes(b"keep-me")
    output = tmp_path / "segments" / "tts" / "0001.wav"
    output.parent.mkdir(parents=True)
    output.symlink_to(victim)

    with pytest.raises(runtime_security.RuntimeSecurityError):
        voxcpm_mod._write_original_target_audio(
            output,
            {"start_time": 0, "end_time": 250},
            source,
        )

    assert output.is_symlink()
    assert victim.read_bytes() == b"keep-me"


@patch.object(voxcpm_mod, "_load_model")
def test_original_segments_are_excluded_from_tts_fallback_references(mock_load, tmp_path):
    session = tmp_path / "session"
    vocals_dir = session / "segments" / "vocals"
    nonverbal_ref = _make_synthetic_wav(vocals_dir / "0001.wav", duration_ms=2000)
    speech_ref = _make_synthetic_wav(vocals_dir / "0002.wav", duration_ms=600)
    original_vocals = _make_synthetic_wav(
        session / "media" / "audio_vocals.wav", duration_ms=2500
    )
    translation = _write_translation_json(
        session / "metadata" / "translation.en.json",
        [
            {
                "dst": "（笑声）",
                "audio_mode": "original",
                "start_time": 0,
                "end_time": 500,
                "speaker": "1",
            },
            {
                "dst": "Keep speaking.",
                "audio_mode": "tts",
                "start_time": 600,
                "end_time": 1200,
                "speaker": "1",
            },
        ],
    )

    mock_tts_model = MagicMock()
    mock_tts_model.sample_rate = 16000
    mock_cache = {"ref_audio_feat": MagicMock(), "mode": "reference"}
    mock_tts_model.build_prompt_cache.return_value = mock_cache
    fake_wav_tensor = MagicMock()
    fake_wav_tensor.squeeze.return_value.cpu.return_value.numpy.return_value = np.zeros(
        1600, dtype=np.float32
    )
    mock_tts_model.generate_with_prompt_cache.return_value = (
        fake_wav_tensor,
        MagicMock(),
        MagicMock(),
    )
    mock_model = MagicMock()
    mock_model.tts_model = mock_tts_model
    mock_load.return_value = mock_model

    voxcpm_mod.generate_tts(
        translation,
        vocals_dir,
        session,
        original_vocals_file=original_vocals,
    )

    mock_tts_model.build_prompt_cache.assert_called_once_with(
        reference_wav_path=str(speech_ref)
    )
    assert str(nonverbal_ref) not in str(mock_tts_model.mock_calls)


@patch.object(voxcpm_mod, "_load_model")
def test_calls_progress_callback(mock_load, tmp_path):
    """Progress callback is invoked for each item and reports 100 at the end."""
    session = tmp_path / "session"
    vocals_dir = session / "segments" / "vocals"
    ref_0001 = _make_synthetic_wav(vocals_dir / "0001.wav", duration_ms=600)
    ref_0002 = _make_synthetic_wav(vocals_dir / "0002.wav", duration_ms=600)

    translation = _write_translation_json(
        session / "metadata" / "translation.en.json",
        [{"dst": "A"}, {"dst": "B"}, {"dst": "C"}],
    )

    mock_tts_model = MagicMock()
    mock_tts_model.sample_rate = 16000
    mock_cache = {"ref_audio_feat": MagicMock(), "mode": "reference"}
    mock_tts_model.build_prompt_cache.return_value = mock_cache

    fake_wav_tensor = MagicMock()
    fake_wav_tensor.squeeze.return_value.cpu.return_value.numpy.return_value = np.zeros(1600, dtype=np.float32)
    mock_tts_model.generate_with_prompt_cache.return_value = (fake_wav_tensor, MagicMock(), MagicMock())

    mock_model = MagicMock()
    mock_model.tts_model = mock_tts_model
    mock_load.return_value = mock_model

    cb = MagicMock()
    voxcpm_mod.generate_tts(translation, vocals_dir, session, progress_callback=cb)

    # progress called for each item
    progress_calls = [c for c in cb.call_args_list if c.args[1].startswith("Prepared")]
    assert len(progress_calls) == 3
    assert progress_calls[0].args[0] == 33
    assert progress_calls[1].args[0] == 67
    assert progress_calls[2].args[0] == 100


@patch.object(voxcpm_mod, "_load_model")
def test_model_generate_used_for_own_reference(mock_load, tmp_path):
    """Sentences with their own long-enough reference still use model.generate."""
    session = tmp_path / "session"
    vocals_dir = session / "segments" / "vocals"
    ref_0001 = _make_synthetic_wav(vocals_dir / "0001.wav", duration_ms=2000)
    ref_0002 = _make_synthetic_wav(vocals_dir / "0002.wav", duration_ms=2000)

    translation = _write_translation_json(
        session / "metadata" / "translation.en.json",
        [{"dst": "Own ref."}, {"dst": "Also own ref."}],
    )

    mock_tts_model = MagicMock()
    mock_tts_model.sample_rate = 16000
    mock_cache = {"ref_audio_feat": MagicMock(), "mode": "reference"}
    mock_tts_model.build_prompt_cache.return_value = mock_cache

    mock_model = MagicMock()
    mock_model.tts_model = mock_tts_model
    mock_model.generate.return_value = np.zeros(1600, dtype=np.float32)
    mock_load.return_value = mock_model

    voxcpm_mod.generate_tts(translation, vocals_dir, session)

    # fallback_cache is not built because no sentence falls back
    mock_tts_model.build_prompt_cache.assert_not_called()
    # generate_with_prompt_cache is not used (both have their own ref)
    mock_tts_model.generate_with_prompt_cache.assert_not_called()
    assert mock_model.generate.call_count == 2


@patch.object(voxcpm_mod, "_load_model")
def test_fallback_cache_preserves_wrapper_generation_behavior(mock_load, tmp_path):
    """Cached fallback generation keeps VoxCPM.generate defaults and text cleanup."""
    session = tmp_path / "session"
    vocals_dir = session / "segments" / "vocals"
    ref_0001 = _make_synthetic_wav(vocals_dir / "0001.wav", duration_ms=600)
    translation = _write_translation_json(
        session / "metadata" / "translation.en.json",
        [{"dst": "Hello\n   cached    world."}],
    )

    mock_tts_model = MagicMock()
    mock_tts_model.sample_rate = 16000
    mock_cache = {"ref_audio_feat": MagicMock(), "mode": "reference"}
    mock_tts_model.build_prompt_cache.return_value = mock_cache

    fake_wav_tensor = MagicMock()
    fake_wav_tensor.squeeze.return_value.cpu.return_value.numpy.return_value = np.zeros(1600, dtype=np.float32)
    mock_tts_model.generate_with_prompt_cache.return_value = (fake_wav_tensor, MagicMock(), MagicMock())

    mock_model = MagicMock()
    mock_model.tts_model = mock_tts_model
    mock_load.return_value = mock_model

    voxcpm_mod.generate_tts(translation, vocals_dir, session)

    mock_tts_model.generate_with_prompt_cache.assert_called_once_with(
        target_text="Hello cached world.",
        prompt_cache=mock_cache,
        cfg_value=2.0,
        inference_timesteps=10,
        **_CACHE_GENERATION_DEFAULTS,
    )
    mock_model.generate.assert_not_called()


@patch.object(voxcpm_mod, "_load_model")
def test_fallback_cache_is_scoped_by_speaker(mock_load, tmp_path):
    session = tmp_path / "session"
    vocals_dir = session / "segments" / "vocals"
    _make_synthetic_wav(vocals_dir / "0001.wav", duration_ms=500)
    ref_a_long = _make_synthetic_wav(vocals_dir / "0002.wav", duration_ms=2000)
    _make_synthetic_wav(vocals_dir / "0003.wav", duration_ms=600)
    ref_b_long = _make_synthetic_wav(vocals_dir / "0004.wav", duration_ms=2200)

    translation = _write_translation_json(
        session / "metadata" / "translation.en.json",
        [
            {"dst": "A needs fallback.", "speaker": "A"},
            {"dst": "A own reference.", "speaker": "A"},
            {"dst": "B needs fallback.", "speaker": "B"},
            {"dst": "B own reference.", "speaker": "B"},
        ],
    )

    mock_tts_model = MagicMock()
    mock_tts_model.sample_rate = 16000
    cache_a = {"ref_audio_feat": MagicMock(), "mode": "reference", "speaker": "A"}
    cache_b = {"ref_audio_feat": MagicMock(), "mode": "reference", "speaker": "B"}
    mock_tts_model.build_prompt_cache.side_effect = [cache_a, cache_b]

    fake_wav_tensor = MagicMock()
    fake_wav_tensor.squeeze.return_value.cpu.return_value.numpy.return_value = np.zeros(1600, dtype=np.float32)
    mock_tts_model.generate_with_prompt_cache.return_value = (fake_wav_tensor, MagicMock(), MagicMock())

    mock_model = MagicMock()
    mock_model.tts_model = mock_tts_model
    mock_model.generate.return_value = np.zeros(1600, dtype=np.float32)
    mock_load.return_value = mock_model

    voxcpm_mod.generate_tts(translation, vocals_dir, session)

    mock_tts_model.build_prompt_cache.assert_has_calls(
        [
            call(reference_wav_path=str(ref_a_long)),
            call(reference_wav_path=str(ref_b_long)),
        ]
    )
    assert mock_tts_model.build_prompt_cache.call_count == 2
    mock_tts_model.generate_with_prompt_cache.assert_has_calls(
        [
            call(
                target_text="A needs fallback.",
                prompt_cache=cache_a,
                cfg_value=2.0,
                inference_timesteps=10,
                **_CACHE_GENERATION_DEFAULTS,
            ),
            call(
                target_text="B needs fallback.",
                prompt_cache=cache_b,
                cfg_value=2.0,
                inference_timesteps=10,
                **_CACHE_GENERATION_DEFAULTS,
            ),
        ]
    )
    assert mock_model.generate.call_count == 2


@patch.object(voxcpm_mod, "_load_model")
def test_fallback_keeps_same_speaker_when_only_other_speaker_has_long_reference(mock_load, tmp_path):
    session = tmp_path / "session"
    vocals_dir = session / "segments" / "vocals"
    ref_a_short = _make_synthetic_wav(vocals_dir / "0001.wav", duration_ms=500)
    ref_b_long = _make_synthetic_wav(vocals_dir / "0002.wav", duration_ms=2200)
    _make_synthetic_wav(vocals_dir / "0003.wav", duration_ms=700)

    translation = _write_translation_json(
        session / "metadata" / "translation.en.json",
        [
            {"dst": "A first fallback.", "speaker": "A"},
            {"dst": "B own reference.", "speaker": "B"},
            {"dst": "A second fallback.", "speaker": "A"},
        ],
    )

    mock_tts_model = MagicMock()
    mock_tts_model.sample_rate = 16000
    cache_a = {"ref_audio_feat": MagicMock(), "mode": "reference", "speaker": "A"}
    mock_tts_model.build_prompt_cache.return_value = cache_a

    fake_wav_tensor = MagicMock()
    fake_wav_tensor.squeeze.return_value.cpu.return_value.numpy.return_value = np.zeros(1600, dtype=np.float32)
    mock_tts_model.generate_with_prompt_cache.return_value = (fake_wav_tensor, MagicMock(), MagicMock())

    mock_model = MagicMock()
    mock_model.tts_model = mock_tts_model
    mock_model.generate.return_value = np.zeros(1600, dtype=np.float32)
    mock_load.return_value = mock_model

    voxcpm_mod.generate_tts(translation, vocals_dir, session)

    mock_tts_model.build_prompt_cache.assert_called_once_with(
        reference_wav_path=str(ref_a_short)
    )
    mock_model.generate.assert_called_once_with(
        text="B own reference.",
        reference_wav_path=str(ref_b_long),
        cfg_value=2.0,
        inference_timesteps=10,
    )
    assert mock_tts_model.generate_with_prompt_cache.call_count == 2
