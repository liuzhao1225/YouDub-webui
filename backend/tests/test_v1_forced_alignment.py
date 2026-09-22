from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest

from backend.app.v1 import export, forced_alignment, media
from backend.app.v1.contracts import TaskConfig
from backend.app.v1.errors import ApiError
from backend.app.v1.segments import Segment
from backend.app.v1.steps import StageContext


def word(text, start, end):
    return {"text": text, "start_time": start, "end_time": end}


def test_measured_words_control_cues_with_global_offset_and_silent_gaps():
    parts = ["欢迎来到 YouDub，", "字幕按声音显示。"]
    words = [word("欢迎来到", 0.16, 0.64), word("YouDub", 0.72, 1.04),
             word("字幕按声音显示", 1.60, 2.24)]

    cues = forced_alignment.word_cues(parts, words, 5000, 8000)

    assert cues == [(5160, 6040, parts[0]), (6600, 7240, parts[1])]
    assert "".join(cue[2] for cue in cues) == "".join(parts)


def test_display_boundary_inside_one_aligned_word_is_merged_without_interpolation():
    # Qwen's punctuation removal can yield one word for Hello,world.
    parts = ["Hello,", "world!", " Next sentence."]
    words = [word("Helloworld", 0.08, 0.72), word("Next", 0.96, 1.20),
             word("sentence", 1.20, 1.68)]

    assert forced_alignment.word_cues(parts, words, 1000, 3000) == [
        (1080, 1720, "Hello,world!"), (1960, 2680, " Next sentence."),
    ]


@pytest.mark.parametrize("parts,words,expected", [
    (["甲，", "乙。"], [word("甲", 0.16, 0.16), word("乙", 0.32, 0.64)],
     [(1160, 1640, "甲，乙。")]),
    (["甲，", "乙。"], [word("甲", 0.16, 0.64), word("乙", 0.80, 0.80)],
     [(1160, 1800, "甲，乙。")]),
    (["甲，", "乙，", "丙。"],
     [word("甲", 0.16, 0.32), word("乙", 0.40, 0.40), word("丙", 0.56, 0.72)],
     [(1160, 1320, "甲，"), (1400, 1720, "乙，丙。")]),
])
def test_zero_duration_tokens_retain_text_in_a_positive_duration_cue(parts, words, expected):
    assert forced_alignment.word_cues(parts, words, 1000, 2000) == expected
    assert "".join(cue[2] for cue in expected) == "".join(parts)


@pytest.mark.parametrize("tail_seconds", [1.068, 1.080])
def test_final_timestamp_class_crossing_audio_end_maps_to_endpoint_without_changing_raw_words(tail_seconds):
    words = [word("完整", 0.08, 0.64), word("配音", 0.80, tail_seconds)]
    original = json.dumps(words, ensure_ascii=False)

    assert forced_alignment.word_cues(["完整配音。"], words, 5000, 6000) == [(5080, 6000, "完整配音。")]
    assert json.dumps(words, ensure_ascii=False) == original


def test_final_timestamp_class_mapped_to_zero_duration_keeps_its_text():
    words = [word("Hello", 0.16, 0.80), word("world", 1.04, 1.08)]
    original = json.dumps(words)

    assert forced_alignment.word_cues(["Hello,", "world!"], words, 1000, 2000) == [(1160, 2000, "Hello,world!")]
    assert json.dumps(words) == original


@pytest.mark.parametrize("words", [
    None,
    [],
    ["hello"],
    [word("different", 0, 0.5)],
    [word("hello", -0.1, 0.5)],
    [word("hello", 0.5, 0.1)],
    [word("hello", 0, 1.081)],
    [word("hello", 0, float("nan"))],
    [word("hello", 0, float("inf"))],
    [word("hello", False, 0.5)],
    [word("hello", "0", 0.5)],
    [word("hello", 0.5, 0.5)],
    [word("hel", 0.1, 0.6), word("lo", 0.4, 0.8)],
])
def test_unusable_alignment_fails_explicitly_instead_of_estimating_cues(words):
    with pytest.raises(ApiError) as error:
        forced_alignment.word_cues(["hello"], words, 1000, 2000)
    assert error.value.content["error"]["code"] == "INVALID_PROVIDER_RESULT"
    assert error.value.content["error"]["stage"] == "export"


@pytest.fixture
def alignment_context(tmp_path, monkeypatch):
    work = tmp_path / "work"
    adjusted = work / "adjusted"
    adjusted.mkdir(parents=True)
    for index in (1, 2):
        (adjusted / f"{index:04d}.wav").write_bytes(f"complete-adjusted-utterance-{index}".encode())
    config = TaskConfig.model_validate({
        "source_language": "en", "target_language": "zh", "output_mode": "both", "keep_background": False,
        "asr": {"adapter": "whisper", "model": "small", "device": "cpu"},
        "translation": {"adapter": "openai", "model": "test-model", "device": "remote"},
        "tts": {"adapter": "test-tts", "model": "test-voice", "device": "cpu",
                "voice": {"mode": "preset", "id": "voice"}},
        "separation": None,
        "subtitle_alignment": {"adapter": "qwen_forced_aligner", "model": forced_alignment.MODEL_NAME, "device": "cpu"},
    })
    monkeypatch.setattr(forced_alignment, "available_models", lambda: [forced_alignment.MODEL_NAME])
    return StageContext(task_id="00000000-0000-0000-0000-000000000001", attempt=1,
                        stage="export", config=config, input_files={}, work_dir=work)


@pytest.mark.parametrize("first_clip_end_ms", [8000, 7172])
def test_align_passes_complete_adjusted_clips_and_retains_raw_word_evidence(monkeypatch, alignment_context, first_clip_end_ms):
    context = alignment_context
    rows = [(Segment(id="first", start_ms=5000, end_ms=first_clip_end_ms, text="Original one"), "欢迎来到YouDub，字幕按声音显示。"),
            (Segment(id="second", start_ms=9000, end_ms=11000, text="Original two"), "完整的一句话。")]
    original_clips = {path: path.read_bytes() for path in (context.work_dir / "adjusted").glob("*.wav")}
    raw = json.dumps({"model": forced_alignment.MODEL_NAME, "clips": [
        {"segment_id": "first", "words": [word("欢迎来到YouDub", 0.16, 1.04), word("字幕按声音显示", 1.60, 2.24)]},
        {"segment_id": "second", "words": [word("完整的一句话", 0.08, 1.36)]},
    ]}, ensure_ascii=False, indent=2) + "\n"
    calls = []

    def infer(command, **kwargs):
        calls.append(command)
        assert kwargs["check_cancel"] is context.check_cancel
        request = json.loads(Path(command[command.index("--request-path") + 1]).read_text())
        assert request == {"language": "zh", "clips": [
            {"segment_id": segment.id, "audio_path": str((context.work_dir / "adjusted" / f"{index:04d}.wav").resolve()),
             "text": text} for index, (segment, text) in enumerate(rows, 1)
        ]}
        Path(command[command.index("--output-path") + 1]).write_text(raw, encoding="utf-8")
        return subprocess.CompletedProcess(command, 0, "", "")

    monkeypatch.setattr(media, "_run_media", infer)
    progress = []
    cues = forced_alignment.align(context, rows, export._display_parts, lambda value, message: progress.append(message))

    assert len(calls) == 1
    assert cues == [(5160, 6040, "欢迎来到YouDub，"), (6600, min(7240, first_clip_end_ms), "字幕按声音显示。"), (9080, 10360, "完整的一句话。")]
    if first_clip_end_ms == 7172:
        assert any("Mapped 1 final word intervals" in message and "80 ms" in message for message in progress)
    evidence = context.work_dir / "subtitle_alignment"
    assert (evidence / "words.json").read_text() == raw
    assert json.loads((evidence / "cues.json").read_text()) == [
        {"start_ms": start, "end_ms": end, "text": text} for start, end, text in cues
    ]
    assert {path: path.read_bytes() for path in original_clips} == original_clips


@pytest.mark.parametrize("failure,code", [("exit", "WORKER_EXITED"), ("wrong_id", "INVALID_PROVIDER_RESULT")])
def test_align_worker_failure_and_wrong_segment_result_are_visible(monkeypatch, alignment_context, failure, code):
    def infer(command, **kwargs):
        if failure == "exit":
            return subprocess.CompletedProcess(command, 7, "", "alignment model failed")
        Path(command[command.index("--output-path") + 1]).write_text(json.dumps({"clips": [
            {"segment_id": "other", "words": [word("字幕", 0.16, 0.64)]},
        ]}))
        return subprocess.CompletedProcess(command, 0, "", "")

    monkeypatch.setattr(media, "_run_media", infer)
    rows = [(Segment(id="first", start_ms=1000, end_ms=2000, text="Original"), "字幕")]
    with pytest.raises(ApiError) as error:
        forced_alignment.align(alignment_context, rows, export._display_parts, lambda *args: None)
    assert error.value.content["error"]["code"] == code
    assert not (alignment_context.work_dir / "subtitle_alignment" / "cues.json").exists()
