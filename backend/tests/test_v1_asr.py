from __future__ import annotations

import json
import subprocess
import sys
from copy import deepcopy
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import pytest

from backend.app.v1 import asr, asr_process, media
from backend.app.v1.contracts import TaskConfig
from backend.app.v1.errors import ApiError
from backend.app.v1.steps import StageCancelled, StageContext


@pytest.fixture
def raw_result():
    return {"text": " Hello.  World!", "language": "en", "segments": [
        {"id": 7, "start": 0.123, "end": 1.456, "text": " Hello. ", "speaker": "speaker-a",
         "words": [{"start": 0.123, "end": 1.456, "word": " Hello."}]},
        {"id": 8, "start": 2, "end": 2.99, "text": " World!", "temperature": 0,
         "words": [{"start": 2, "end": 2.99, "word": " World!"}]},
    ]}


@pytest.fixture
def context(tmp_path, monkeypatch):
    models = tmp_path / "models"
    models.mkdir()
    (models / "small.pt").write_bytes(b"test-checkpoint")
    monkeypatch.setenv("YOUDUB_WHISPER_MODELS_DIR", str(models))
    source = tmp_path / "source.wav"
    source.write_bytes(b"test-audio")
    info = tmp_path / "media.json"
    info.write_text(json.dumps({"duration_ms": 3000}), encoding="utf-8")
    config = TaskConfig.model_validate({
        "source_language": "auto", "target_language": "zh", "output_mode": "subtitles", "keep_background": False,
        "asr": {"adapter": "whisper", "model": "small", "device": "cpu"},
        "translation": {"adapter": "openai", "model": "test-model", "device": "remote"},
        "tts": None, "separation": None,
    })
    return StageContext(task_id="00000000-0000-0000-0000-000000000001", attempt=1,
                        stage="asr", config=config, input_files={"source_audio": source, "media_info": info},
                        work_dir=tmp_path / "asr")


def test_catalog_uses_only_known_nonempty_local_checkpoint_metadata(tmp_path, monkeypatch):
    monkeypatch.delenv("YOUDUB_WHISPER_MODELS_DIR", raising=False)
    assert asr.model_directory() == tmp_path / "desktop-runtime" / "models" / "whisper"
    assert asr.available_models() == []
    root = tmp_path / "installed-whisper"
    root.mkdir()
    (root / "small.pt").write_bytes(b"small")
    (root / "tiny.en.pt").write_bytes(b"english")
    (root / "large-v3-turbo.pt").write_bytes(b"turbo")
    (root / "base.pt").touch()
    (root / "medium.pt").mkdir()
    (root / "arbitrary.pt").write_bytes(b"other")
    monkeypatch.setenv("YOUDUB_WHISPER_MODELS_DIR", str(root))
    # A missing model package must not affect this filesystem-only inventory.
    monkeypatch.setitem(sys.modules, "whisper", None)
    assert asr.available_models() == ["tiny.en", "small", "large-v3-turbo"]


def test_normalization_preserves_words_order_and_detected_language(raw_result):
    before = deepcopy(raw_result)
    normalized = asr.normalize_result(raw_result, duration_ms=3000)
    assert normalized == {"detected_language": "en", "segments": [
        {"id": "segment-000001", "start_ms": 123, "end_ms": 1456, "text": " Hello.", "speaker_id": "speaker-a",
         "words": [{"text": " Hello.", "start_ms": 123, "end_ms": 1456}]},
        {"id": "segment-000002", "start_ms": 2000, "end_ms": 2990, "text": " World!",
         "words": [{"text": " World!", "start_ms": 2000, "end_ms": 2990}]},
    ]}
    assert raw_result == before
    assert asr.normalize_result(raw_result, duration_ms=3000) == normalized


def word_result(words, *, speaker="narrator"):
    return {"language": "en", "segments": [{
        "start": words[0][0], "end": words[-1][1],
        "text": "".join(text for _, _, text in words), "speaker_id": speaker,
        "words": [{"start": start, "end": end, "word": text} for start, end, text in words],
    }]}


def test_complete_utterance_keeps_all_clauses_in_one_speech_generation_unit():
    raw = word_result([
        (0, .36, " Welcome"), (.36, .6, " to"), (.6, 1.04, " Atlas,"),
        (1.2, 1.58, " today"), (1.58, 1.76, " we"), (1.76, 1.88, " are"),
        (1.88, 2.32, " testing"), (2.32, 2.72, " video"), (2.72, 3.42, " translation,"),
        (3.88, 3.96, " the"), (3.96, 4.36, " original"), (4.36, 4.76, " voice"),
        (4.76, 4.94, " and"), (4.94, 5.52, " subtitle"), (5.52, 5.82, " timing"),
        (5.82, 6.18, " should"), (6.18, 6.42, " stay"), (6.42, 6.7, " clear."),
    ])
    before = deepcopy(raw)
    segments = asr.normalize_result(raw, duration_ms=7000)["segments"]
    assert [{k: v for k, v in segment.items() if k != "words"} for segment in segments] == [
        {"id": "segment-000001", "start_ms": 0, "end_ms": 6700,
         "text": " Welcome to Atlas, today we are testing video translation,"
                 " the original voice and subtitle timing should stay clear.", "speaker_id": "narrator"},
    ]
    assert raw == before


@pytest.mark.parametrize("punctuation", [".", "!", "?", ",", ";", ":", "。", "！", "？", "，", "；", "：", "、", "…"])
def test_punctuation_and_closing_quotes_do_not_split_the_source_utterance(punctuation):
    raw = word_result([(0, .5, "第一句" + punctuation + "”"), (.7, 1.3, "第二句。")])
    raw["language"] = "zh"
    segments = asr.normalize_result(raw, duration_ms=2000)["segments"]
    assert [{k: v for k, v in segment.items() if k != "words"} for segment in segments] == [{"id": "segment-000001", "start_ms": 0, "end_ms": 1300,
                         "text": "第一句" + punctuation + "”第二句。", "speaker_id": "narrator"}]


def test_utterance_longer_than_eight_seconds_keeps_its_complete_text_and_interval():
    raw = word_result([
        (.25, 1.5, " one"), (2, 4.75, " two"), (4.75, 7.9, " three"),
        (8.1, 8.5, " four"), (9, 10, " five"),
    ])
    segments = asr.normalize_result(raw, duration_ms=10000)["segments"]
    assert [{k: v for k, v in segment.items() if k != "words"} for segment in segments] == [{"id": "segment-000001", "start_ms": 250, "end_ms": 10000,
                         "text": " one two three four five", "speaker_id": "narrator"}]


def test_sentence_bounds_follow_first_and_last_word():
    raw = word_result([(.2, .5, " First,"), (.8, 1.2, " second.")])
    raw["segments"][0].update(start=0.1, end=1.5)
    segments = asr.normalize_result(raw, duration_ms=2000)["segments"]
    assert [{k: v for k, v in segment.items() if k != "words"} for segment in segments] == [{"id": "segment-000001", "start_ms": 200, "end_ms": 1200,
                         "text": " First, second.", "speaker_id": "narrator"}]


def test_sentence_splitting_preserves_each_word_including_boundary_whitespace():
    raw = word_result([(0, .5, " First."), (.8, 1.2, " Second. ")])
    raw["segments"][0]["text"] = "\n  First. Second.\t "
    segments = asr.normalize_result(raw, duration_ms=2000)["segments"]
    assert [item["text"] for item in segments] == [" First.", " Second. "]
    assert [(s["start_ms"], s["end_ms"]) for s in segments] == [(0, 500), (800, 1200)]
    assert [w["text"] for s in segments for w in s["words"]] == [" First.", " Second. "]


def test_english_without_word_timestamps_fails_instead_of_estimating_sentence_times():
    raw = {"language": "en", "segments": [{"start": 0, "end": 15, "text": " One. Two, three!"}]}
    with pytest.raises(ApiError, match="word timestamps") as error:
        asr.normalize_result(raw, duration_ms=15000)
    assert error.value.content["error"]["code"] == "INVALID_PROVIDER_RESULT"


@pytest.mark.parametrize("parts,expected", [
    ([" Although AI is the conversation today,", " computing is much broader than that."], 1),
    ([" We build faster", " chips."], 1),
    ([" I spoke to Dr.", " Smith yesterday."], 1),
    ([" She lives in the U.S.", " and works there."], 1),
    ([" It costs 3.5", " dollars."], 1),
    ([' He said, "Hello."', ' Then left.'], 2),
])
def test_pretrained_punkt_merges_fragments_and_handles_english_boundaries(parts, expected):
    raw = {"language": "en", "segments": [
        {"start": i, "end": i + .8, "text": text,
         "words": [{"start": i, "end": i + .8, "word": text}]}
        for i, text in enumerate(parts)
    ]}
    before = deepcopy(raw)
    segments = asr.normalize_result(raw, duration_ms=2000)["segments"]
    assert len(segments) == expected
    assert "".join(s["text"] for s in segments) == "".join(parts)
    assert [w for s in segments for w in s["words"]] == [
        {"text": text, "start_ms": i * 1000, "end_ms": i * 1000 + 800}
        for i, text in enumerate(parts)
    ]
    assert raw == before


def test_known_speaker_change_is_a_sentence_boundary():
    raw = {"language": "en", "segments": [
        word_result([(0, .8, " Wait,")], speaker="a")["segments"][0],
        word_result([(1, 1.8, " let me answer.")], speaker="b")["segments"][0],
    ]}
    segments = asr.normalize_result(raw, duration_ms=2000)["segments"]
    assert [(s["text"], s["speaker_id"]) for s in segments] == [(" Wait,", "a"), (" let me answer.", "b")]


@pytest.mark.parametrize("parts,expected", [
    ([" We build faster", "chips."], [" We build faster chips."]),
    ([" Hello.", "How are you?"], [" Hello.", " How are you?"]),
])
def test_missing_segment_separator_is_normalized_without_changing_raw_or_timing(parts, expected):
    raw = {"language": "en", "segments": [
        word_result([(i, i + .8, text)])["segments"][0] for i, text in enumerate(parts)
    ]}
    before = deepcopy(raw)
    segments = asr.normalize_result(raw, duration_ms=2000)["segments"]
    assert [s["text"] for s in segments] == expected
    assert [(w["text"].strip(), w["start_ms"], w["end_ms"]) for s in segments for w in s["words"]] == [
        (text.strip(), i * 1000, i * 1000 + 800) for i, text in enumerate(parts)
    ]
    assert raw == before


def test_zero_duration_word_is_preserved_inside_sentence():
    raw = word_result([(0, .4, " Hello"), (.4, .4, ","), (.4, 1, " world.")])
    segment = asr.normalize_result(raw, duration_ms=1000)["segments"][0]
    assert segment["words"][1] == {"text": ",", "start_ms": 400, "end_ms": 400}


def test_boundary_inside_one_timed_word_fails_instead_of_reusing_its_full_time():
    raw = word_result([(0, 1, " Hello. How are you?")])
    with pytest.raises(ApiError, match="inside one Whisper word"):
        asr.normalize_result(raw, duration_ms=1000)


def test_overlapping_words_in_merged_segments_are_rejected():
    raw = {"language": "en", "segments": [
        word_result([(0, 1, " Hello,")])["segments"][0],
        word_result([(.8, 2, " world.")])["segments"][0],
    ]}
    with pytest.raises(ApiError) as error:
        asr.normalize_result(raw, duration_ms=2000)
    assert error.value.content["error"]["code"] == "INVALID_PROVIDER_RESULT"


@pytest.mark.parametrize("language", ["zh", "ja"])
def test_non_english_keeps_provider_segments_without_english_tokenizer(language, monkeypatch):
    monkeypatch.setattr(asr, "_english_sentences", lambda _: pytest.fail("English model used for another language"))
    raw = {"language": language, "segments": [{"start": 0, "end": 2, "text": "第一句。第二句。"}]}
    assert asr.normalize_result(raw, duration_ms=2000)["segments"] == [
        {"id": "segment-000001", "start_ms": 0, "end_ms": 2000, "text": "第一句。第二句。"},
    ]


def test_missing_punkt_data_is_an_explicit_error(raw_result, monkeypatch):
    import nltk.data
    monkeypatch.setattr(nltk.data, "path", [])
    with pytest.raises(ApiError) as error:
        asr.normalize_result(raw_result, duration_ms=3000)
    assert error.value.content["error"]["code"] == "MODEL_NOT_READY"


@pytest.mark.parametrize("words", [[], [{"start": .3, "end": .7, "word": " Different"}],
                                   [{"start": -1, "end": 3, "word": " One. Two."}]])
def test_invalid_standard_word_metadata_is_rejected(words):
    raw = {"language": "en", "segments": [{"start": 0, "end": 2, "text": " One. Two.", "words": words}]}
    before = deepcopy(raw)
    with pytest.raises(ApiError) as error:
        asr.normalize_result(raw, duration_ms=2000)
    assert error.value.content["error"]["code"] == "INVALID_PROVIDER_RESULT"
    assert error.value.status_code == 502
    assert raw == before


@pytest.mark.parametrize("change", [
    lambda result: result.update(segments=[]),
    lambda result: result.pop("language"),
    lambda result: result["segments"][0].update(start="0.1"),
    lambda result: result["segments"][0].update(start=True),
    lambda result: result["segments"][0].update(start=-0.1),
    lambda result: result["segments"][0].update(end=float("nan")),
    lambda result: result["segments"][0].update(end=float("inf")),
    lambda result: result["segments"][0].update(end=10 ** 500),
    lambda result: result["segments"][0].update(end=0.123),
    lambda result: result["segments"][0].update(end=3.1),
    lambda result: result["segments"][0].update(text=" \n"),
    lambda result: result["segments"][0].update(speaker_id=2),
])
def test_invalid_results_are_explicit_errors_without_retiming(raw_result, change):
    change(raw_result)
    with pytest.raises(ApiError) as error:
        asr.normalize_result(raw_result, duration_ms=3000)
    assert error.value.content["error"]["code"] == "INVALID_PROVIDER_RESULT"


def test_run_passes_config_checkpoint_and_vocals_and_keeps_full_raw_result(context, raw_result, monkeypatch):
    vocals = context.work_dir.parent / "vocals.wav"
    vocals.write_bytes(b"separated-audio")
    context = replace(context, input_files={**context.input_files, "vocals": vocals})
    commands = []

    def invoke(command, **kwargs):
        commands.append(command)
        assert kwargs["check_cancel"] is context.check_cancel
        output = Path(command[command.index("--output-path") + 1])
        output.write_text(json.dumps(raw_result), encoding="utf-8")
        return subprocess.CompletedProcess(command, 0, "", "")

    monkeypatch.setenv("WHISPER_MODEL", "legacy-unselected-model")
    monkeypatch.setattr(media, "_run_media", invoke)
    progress = []
    result = asr.run(context, lambda value, message: progress.append((value, message)))
    command = commands[0]
    assert command[0] == sys.executable
    assert command[command.index("--model-path") + 1] == str((asr.model_directory() / "small.pt").resolve())
    assert command[command.index("--audio-path") + 1] == str(vocals.resolve())
    assert command[command.index("--device") + 1] == "cpu"
    assert command[command.index("--language") + 1] == "auto"
    assert json.loads(result.output_files["asr_raw"].read_text()) == raw_result
    assert json.loads(result.output_files["transcript"].read_text()) == asr.normalize_result(raw_result, duration_ms=3000)
    assert progress[-1][0] == 1


@pytest.mark.parametrize("missing", ["checkpoint", "source_audio", "media_info"])
def test_run_rejects_missing_inputs_before_starting_model(context, monkeypatch, missing):
    path = asr.model_directory() / "small.pt" if missing == "checkpoint" else context.input_files[missing]
    path.unlink()
    monkeypatch.setattr(media, "_run_media", lambda *args, **kwargs: pytest.fail("model must not start"))
    with pytest.raises(ApiError) as error:
        asr.run(context, lambda *args: None)
    assert error.value.content["error"]["code"] == ("MODEL_NOT_READY" if missing == "checkpoint" else "INPUT_MISSING")


@pytest.mark.parametrize("stderr,code", [
    ('{"code":"MODEL_NOT_READY","message":"Install openai-whisper.","field":"asr.model"}', "MODEL_NOT_READY"),
    ("unexpected process crash", "WORKER_EXITED"),
])
def test_run_propagates_child_failure_without_claiming_output(context, monkeypatch, stderr, code):
    monkeypatch.setattr(media, "_run_media", lambda command, **kwargs:
                        subprocess.CompletedProcess(command, 1, "", stderr))
    with pytest.raises(ApiError) as error:
        asr.run(context, lambda *args: None)
    assert error.value.content["error"]["code"] == code
    assert not (context.work_dir / "transcript.json").exists()


def test_run_requires_child_output(context, monkeypatch):
    monkeypatch.setattr(media, "_run_media", lambda command, **kwargs:
                        subprocess.CompletedProcess(command, 0, "", ""))
    with pytest.raises(ApiError) as error:
        asr.run(context, lambda *args: None)
    assert error.value.content["error"]["code"] == "STAGE_OUTPUT_MISSING"


def test_cancellation_reaps_asr_child_before_returning(context, monkeypatch):
    real_popen = subprocess.Popen
    children = []
    checks = 0

    def slow_child(command, **kwargs):
        child = real_popen([sys.executable, "-c", "import time; time.sleep(30)"], **kwargs)
        children.append(child)
        return child

    def check_cancel():
        nonlocal checks
        if children:
            checks += 1
            if checks == 2:
                raise StageCancelled()

    monkeypatch.setattr(media.subprocess, "Popen", slow_child)
    with pytest.raises(StageCancelled):
        asr.run(replace(context, check_cancel=check_cancel), lambda *args: None)
    assert len(children) == 1
    assert children[0].poll() is not None
    assert not (context.work_dir / "transcript.json").exists()


def child_arguments(context, *, device="cpu", language="auto"):
    return ["--model-path", str(asr.model_directory() / "small.pt"),
            "--audio-path", str(context.input_files["source_audio"]),
            "--output-path", str(context.work_dir.parent / "child.json"),
            "--device", device, "--language", language]


@pytest.mark.parametrize("device,language", [("cpu", "auto"), ("cuda:1", "ja")])
def test_child_uses_local_path_and_selected_device_language_without_downloading(context, raw_result, monkeypatch, device, language):
    calls = []

    def transcribe(path, **kwargs):
        calls.append(("transcribe", path, kwargs))
        return raw_result

    def load_model(name, **kwargs):
        calls.append(("load", name, kwargs))
        assert Path(name).is_absolute() and Path(name).is_file()
        return SimpleNamespace(transcribe=transcribe)

    monkeypatch.setitem(sys.modules, "whisper", SimpleNamespace(load_model=load_model))
    assert asr_process.main(child_arguments(context, device=device, language=language)) == 0
    assert calls[0] == ("load", str((asr.model_directory() / "small.pt").resolve()), {"device": device})
    assert calls[1][2] == {"language": None if language == "auto" else language, "task": "transcribe",
                           "fp16": device.startswith("cuda:"), "word_timestamps": True, "verbose": False}
    assert json.loads((context.work_dir.parent / "child.json").read_text()) == raw_result


def test_child_missing_package_reports_model_not_ready(context, monkeypatch, capsys):
    monkeypatch.setitem(sys.modules, "whisper", None)
    assert asr_process.main(child_arguments(context)) == 1
    error = json.loads(capsys.readouterr().err.strip().splitlines()[-1])
    assert error["code"] == "MODEL_NOT_READY"
    assert not (context.work_dir.parent / "child.json").exists()


def test_child_corrupt_checkpoint_is_not_deleted_retried_or_downloaded(context, monkeypatch, capsys):
    calls = []

    def load_model(name, **kwargs):
        calls.append(name)
        raise RuntimeError("invalid checkpoint")

    monkeypatch.setitem(sys.modules, "whisper", SimpleNamespace(load_model=load_model))
    checkpoint = asr.model_directory() / "small.pt"
    before = checkpoint.read_bytes()
    assert asr_process.main(child_arguments(context)) == 1
    assert checkpoint.read_bytes() == before
    assert len(calls) == 1
    captured = capsys.readouterr()
    assert "invalid checkpoint" in captured.err
    assert json.loads(captured.err.strip().splitlines()[-1])["code"] == "MODEL_NOT_READY"


@pytest.mark.parametrize("words", [[None], [{}], [{"word": " Hello."}], "invalid-words"])
def test_malformed_word_objects_report_provider_error(raw_result, words):
    raw_result["segments"][0]["words"] = words
    with pytest.raises(ApiError) as error:
        asr.normalize_result(raw_result, duration_ms=3000)
    assert error.value.content["error"]["code"] == "INVALID_PROVIDER_RESULT"
    assert error.value.status_code == 502
