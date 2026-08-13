from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import MagicMock, call, patch

import numpy as np
import soundfile as sf

from backend.app.adapters import voxcpm as voxcpm_mod


def test_release_model_clears_cached_model(monkeypatch):
    monkeypatch.setattr(voxcpm_mod, "_MODEL", object())

    voxcpm_mod.release_model()

    assert voxcpm_mod._MODEL is None


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
def test_empty_target_copies_original_audio_without_tts_generation(mock_load, tmp_path):
    session = tmp_path / "session"
    vocals_dir = session / "segments" / "vocals"
    _make_synthetic_wav(vocals_dir / "0001.wav", duration_ms=600)
    ref_0002 = _make_synthetic_wav(vocals_dir / "0002.wav", duration_ms=2000)
    original_vocals = _make_synthetic_wav(session / "media" / "audio_vocals.wav", duration_ms=2500)
    translation = _write_translation_json(
        session / "metadata" / "translation.en.json",
        [
            {"dst": "", "start_time": 0, "end_time": 500},
            {"dst": "Meaningful sentence.", "start_time": 600, "end_time": 1800},
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

    original_segment = session / "segments" / "tts" / "0001.wav"
    assert original_segment.exists()
    assert sf.info(original_segment).samplerate == 16000
    assert sf.info(original_segment).frames == 8000
    original_samples, _ = sf.read(original_vocals, dtype="float32")
    copied_samples, _ = sf.read(original_segment, dtype="float32")
    assert np.allclose(copied_samples, original_samples[:8000], atol=2 / 32768)
    mock_model.generate.assert_called_once_with(
        text="Meaningful sentence.",
        reference_wav_path=str(ref_0002),
        cfg_value=2.0,
        inference_timesteps=10,
    )


@patch.object(voxcpm_mod, "_load_model")
def test_all_empty_targets_copy_original_audio_without_loading_model(mock_load, tmp_path):
    session = tmp_path / "session"
    vocals_dir = session / "segments" / "vocals"
    _make_synthetic_wav(vocals_dir / "0001.wav", duration_ms=600)
    original_vocals = _make_synthetic_wav(session / "media" / "audio_vocals.wav", duration_ms=2500)
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


def test_original_target_audio_decodes_only_requested_range(monkeypatch, tmp_path):
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
