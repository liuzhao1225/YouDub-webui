from __future__ import annotations

import subprocess
import sys
from dataclasses import replace
from pathlib import Path

import pytest
import soundfile as sf

from backend.app.v1 import media, separate, separate_process
from backend.app.v1.contracts import TaskConfig
from backend.app.v1.errors import ApiError
from backend.app.v1.steps import StageCancelled, StageContext
from backend.tests.test_v1_task_api import video


@pytest.fixture
def context(tmp_path, monkeypatch, video):
    models = tmp_path / "models"
    models.mkdir()
    (models / separate.MODEL_FILES["htdemucs"]).write_bytes(b"explicit-mock-checkpoint")
    monkeypatch.setenv("YOUDUB_DEMUCS_MODELS_DIR", str(models))
    config = TaskConfig.model_validate({
        "source_language": "en", "target_language": "zh", "output_mode": "both", "keep_background": True,
        "asr": {"adapter": "whisper", "model": "tiny", "device": "cpu"},
        "translation": {"adapter": "openai", "model": "test", "device": "remote"},
        "tts": {"adapter": "voxcpm", "model": "VoxCPM2", "device": "cpu", "voice": {"mode": "source_clone"}},
        "separation": {"adapter": "demucs", "model": "htdemucs", "device": "cpu"},
    })
    return StageContext(task_id="00000000-0000-0000-0000-000000000001", attempt=1, stage="separate",
                        config=config, input_files={"video": video}, work_dir=tmp_path / "work")


def test_local_model_metadata_and_missing_asset_fail_before_extraction(context, monkeypatch):
    assert separate.available_models() == ["htdemucs"]
    (separate.model_directory() / separate.MODEL_FILES["htdemucs"]).unlink()
    monkeypatch.setattr(media, "_run_media", lambda *args, **kwargs: pytest.fail("must not start"))
    with pytest.raises(ApiError) as error:
        separate.run(context, lambda *args: None)
    assert error.value.content["error"]["code"] == "MODEL_NOT_READY"


@pytest.mark.parametrize("bad_length", [False, True])
def test_original_stereo_extraction_and_separation_timeline_validation(context, monkeypatch, bad_length):
    real_run = media._run_media
    commands = []
    original_bytes = context.input_files["video"].read_bytes()

    def invoke(command, **kwargs):
        commands.append(command)
        if command[0] != sys.executable:
            return real_run(command, **kwargs)
        assert command[command.index("--device") + 1] == "cpu"
        assert Path(command[command.index("--model-path") + 1]).name == separate.MODEL_FILES["htdemucs"]
        source = Path(command[command.index("--audio-path") + 1])
        samples, rate = sf.read(source, always_2d=True)
        assert rate == 44100 and samples.shape[1] == 2
        for flag in ("--vocals-path", "--background-path"):
            sf.write(command[command.index(flag) + 1], samples[:-1] if bad_length else samples, rate, subtype="FLOAT")
        return subprocess.CompletedProcess(command, 0, "", "")

    monkeypatch.setattr(media, "_run_media", invoke)
    if bad_length:
        with pytest.raises(ApiError) as error:
            separate.run(context, lambda *args: None)
        assert error.value.content["error"]["code"] == "INVALID_PROVIDER_RESULT"
    else:
        result = separate.run(context, lambda *args: None)
        assert set(result.output_files) == {"vocals", "background"}
        assert sf.info(result.output_files["vocals"]).frames == sf.info(context.work_dir / "separation/source.wav").frames
    assert context.input_files["video"].read_bytes() == original_bytes
    assert len(commands) == 2


def test_demucs_process_is_reaped_on_cancel(context, monkeypatch):
    real_run, real_popen = media._run_media, subprocess.Popen
    children = []

    def invoke(command, **kwargs):
        if command[0] != sys.executable:
            return real_run(command, **kwargs)

        def child(*args, **kw):
            process = real_popen([sys.executable, "-c", "import time; time.sleep(30)"], **kw)
            children.append(process)
            return process

        with monkeypatch.context() as scoped:
            scoped.setattr(media.subprocess, "Popen", child)
            return real_run(command, **kwargs)

    def cancelled():
        if children:
            raise StageCancelled()

    monkeypatch.setattr(media, "_run_media", invoke)
    with pytest.raises(StageCancelled):
        separate.run(replace(context, check_cancel=cancelled), lambda *args: None)
    assert children[0].poll() is not None


def test_child_rejects_invalid_weight_before_importing_demucs(context, monkeypatch, capsys):
    monkeypatch.setitem(sys.modules, "demucs", None)
    args = []
    for name, path in {"model": separate.model_directory() / separate.MODEL_FILES["htdemucs"],
                       "audio": context.work_dir / "input.wav", "vocals": context.work_dir / "vocals.wav",
                       "background": context.work_dir / "background.wav"}.items():
        args.extend([f"--{name}-path", str(path)])
    assert separate_process.main([*args, "--device", "cpu"]) == 1
    assert "checksum is invalid" in capsys.readouterr().err
