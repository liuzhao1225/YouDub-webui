from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.app.adapters import audio, local_subtitles
from backend.app.sources import detect_source


def test_parse_srt_accepts_bom_crlf_and_multiline_text():
    cues = local_subtitles.parse_srt(
        "\ufeff1\r\n"
        "00:00:01,000 --> 00:00:02,500\r\n"
        "第一行\r\n"
        "第二行\r\n\r\n"
        "2\r\n"
        "00:00:03.000 --> 00:00:04.250\r\n"
        "Next cue\r\n"
    )

    assert len(cues) == 2
    assert cues[0].start_time == 1000
    assert cues[0].end_time == 2500
    assert cues[0].text == "第一行\n第二行"
    assert cues[1].start_time == 3000
    assert cues[1].end_time == 4250


@pytest.mark.parametrize(
    "content",
    [
        "",
        "1\nmissing timing\nhello",
        "1\n00:00:02,000 --> 00:00:01,000\nbad",
    ],
)
def test_parse_srt_rejects_invalid_or_empty_content(content):
    with pytest.raises(ValueError):
        local_subtitles.parse_srt(content)


def test_write_uploaded_subtitle_artifacts_outputs_pipeline_schema(tmp_path):
    subtitle = tmp_path / "subtitles.srt"
    subtitle.write_text(
        "1\n00:00:00,000 --> 00:00:01,200\n你好世界\n\n"
        "2\n00:00:01,500 --> 00:00:02,500\n继续讲\n",
        encoding="utf-8",
    )
    source = detect_source("local://upload/task-id?direction=en-zh")

    asr_file, asr_fixed_file, translation_file = local_subtitles.write_uploaded_subtitle_artifacts(
        subtitle,
        tmp_path,
        source,
    )

    asr = json.loads(asr_file.read_text(encoding="utf-8"))
    fixed = json.loads(asr_fixed_file.read_text(encoding="utf-8"))
    translation = json.loads(translation_file.read_text(encoding="utf-8"))["translation"]
    assert asr == fixed
    assert asr["result"]["utterances"][0]["text"] == "你好世界"
    assert translation_file.name == "translation.zh.json"
    assert translation[0] == {
        "src": "",
        "dst": "你好世界",
        "src_lang": "en",
        "dst_lang": "zh",
        "start_time": 0,
        "end_time": 1200,
        "speaker": "1",
    }


@pytest.mark.parametrize(
    ("writer_name", "target_name"),
    [
        ("write_uploaded_asr_artifact", "asr.json"),
        ("write_uploaded_asr_fixed_artifact", "asr_fixed.json"),
        ("write_uploaded_translation_artifact", "translation.zh.json"),
    ],
)
def test_uploaded_subtitle_stage_writer_only_replaces_its_own_artifact(
    tmp_path, writer_name, target_name
):
    subtitle = tmp_path / "subtitles.srt"
    subtitle.write_text(
        "1\n00:00:00,000 --> 00:00:01,200\n你好世界\n",
        encoding="utf-8",
    )
    subtitle_before = subtitle.read_bytes()
    metadata = tmp_path / "metadata"
    metadata.mkdir()
    artifact_names = ("asr.json", "asr_fixed.json", "translation.zh.json")
    sentinels = {name: f"sentinel:{name}".encode() for name in artifact_names}
    for name, content in sentinels.items():
        (metadata / name).write_bytes(content)

    writer = getattr(local_subtitles, writer_name)
    output = writer(
        subtitle,
        tmp_path,
        detect_source("local://upload/task-id?direction=en-zh"),
    )

    assert output == metadata / target_name
    assert subtitle.read_bytes() == subtitle_before
    for name, content in sentinels.items():
        if name == target_name:
            assert (metadata / name).read_bytes() != content
        else:
            assert (metadata / name).read_bytes() == content


@pytest.mark.parametrize(
    "writer_name",
    [
        "write_uploaded_asr_artifact",
        "write_uploaded_asr_fixed_artifact",
        "write_uploaded_translation_artifact",
    ],
)
def test_uploaded_subtitle_stage_writer_failure_preserves_all_artifacts(
    tmp_path, writer_name
):
    subtitle = tmp_path / "invalid.srt"
    subtitle.write_text("invalid subtitle", encoding="utf-8")
    subtitle_before = subtitle.read_bytes()
    metadata = tmp_path / "metadata"
    metadata.mkdir()
    artifact_names = ("asr.json", "asr_fixed.json", "translation.zh.json")
    sentinels = {name: f"sentinel:{name}".encode() for name in artifact_names}
    for name, content in sentinels.items():
        (metadata / name).write_bytes(content)

    writer = getattr(local_subtitles, writer_name)
    with pytest.raises(ValueError):
        writer(
            subtitle,
            tmp_path,
            detect_source("local://upload/task-id?direction=en-zh"),
        )

    assert subtitle.read_bytes() == subtitle_before
    for name, content in sentinels.items():
        assert (metadata / name).read_bytes() == content


def test_split_audio_by_uploaded_subtitle_translation(monkeypatch, tmp_path):
    translation = tmp_path / "metadata" / "translation.zh.json"
    translation.parent.mkdir()
    translation.write_text(
        json.dumps(
            {
                "translation": [
                    {"start_time": 100, "end_time": 900, "dst": "一"},
                    {"start_time": 1200, "end_time": 2000, "dst": "二"},
                ]
            }
        ),
        encoding="utf-8",
    )
    exports: list[tuple[slice, Path]] = []

    class FakeSlice:
        def __init__(self, segment: slice):
            self.segment = segment

        def export(self, output_file: Path, format: str):
            exports.append((self.segment, output_file))
            output_file.write_bytes(b"wav")

    class FakeAudio:
        def __len__(self):
            return 2500

        def __getitem__(self, segment: slice):
            return FakeSlice(segment)

    monkeypatch.setattr(audio.AudioSegment, "from_file", lambda _path: FakeAudio())

    output_dir = audio.split_audio_by_translation(Path("vocals.wav"), translation, tmp_path)

    assert output_dir == tmp_path / "segments" / "vocals"
    assert [item[0] for item in exports] == [slice(20, 1060, None), slice(1120, 2160, None)]
    assert (output_dir / "0001.wav").exists()
    assert (output_dir / "0002.wav").exists()
