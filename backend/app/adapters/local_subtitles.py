from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .. import runtime_security
from ..sources import SourceConfig
from .local_video import upload_dir


SRT_TIME_RE = re.compile(
    r"^\s*(?P<start>\d{2}:\d{2}:\d{2}[,.]\d{3})\s*-->\s*"
    r"(?P<end>\d{2}:\d{2}:\d{2}[,.]\d{3})"
)


@dataclass(frozen=True)
class SubtitleCue:
    start_time: int
    end_time: int
    text: str


def uploaded_subtitle_dir(workfolder: Path, task_id: str) -> Path:
    return upload_dir(workfolder, task_id) / "subtitle"


def uploaded_subtitle_file(workfolder: Path, task_id: str) -> Path | None:
    root = uploaded_subtitle_dir(workfolder, task_id)
    if not root.exists():
        return None
    files = sorted(path for path in root.iterdir() if path.is_file())
    if not files:
        return None
    if len(files) > 1:
        raise RuntimeError(f"Local upload has multiple subtitle files for task {task_id}.")
    return files[0]


def _parse_srt_time(value: str) -> int:
    hours, minutes, rest = value.replace(".", ",").split(":", maxsplit=2)
    seconds, millis = rest.split(",", maxsplit=1)
    return (
        int(hours) * 3_600_000
        + int(minutes) * 60_000
        + int(seconds) * 1000
        + int(millis)
    )


def parse_srt(content: str) -> list[SubtitleCue]:
    normalized = content.lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n")
    blocks = re.split(r"\n{2,}", normalized.strip())
    cues: list[SubtitleCue] = []
    for block in blocks:
        lines = [line.strip() for line in block.split("\n")]
        lines = [line for line in lines if line]
        if not lines:
            continue

        timing_index = next((i for i, line in enumerate(lines) if "-->" in line), -1)
        if timing_index < 0:
            raise ValueError("SRT cue is missing a timing line.")

        match = SRT_TIME_RE.match(lines[timing_index])
        if not match:
            raise ValueError(f"Invalid SRT timing line: {lines[timing_index]}")

        text = "\n".join(lines[timing_index + 1 :]).strip()
        if not text:
            continue
        start = _parse_srt_time(match.group("start"))
        end = _parse_srt_time(match.group("end"))
        if end <= start:
            raise ValueError(f"SRT cue end time must be after start time: {lines[timing_index]}")
        cues.append(SubtitleCue(start_time=start, end_time=end, text=text))

    if not cues:
        raise ValueError("SRT file does not contain any subtitle cues.")
    return cues


def _translation_items(cues: list[SubtitleCue], source: SourceConfig) -> list[dict[str, Any]]:
    return [
        {
            "src": "",
            "dst": cue.text,
            "src_lang": source.asr_language,
            "dst_lang": source.target_language,
            "start_time": cue.start_time,
            "end_time": cue.end_time,
            "speaker": "1",
        }
        for cue in cues
    ]


def _uploaded_subtitle_payloads(
    subtitle_file: Path,
    source: SourceConfig,
) -> tuple[dict[str, Any], dict[str, Any]]:
    content = subtitle_file.read_text(encoding="utf-8-sig")
    cues = parse_srt(content)
    translation = _translation_items(cues, source)

    asr_payload = {
        "result": {
            "text": " ".join(item["dst"] for item in translation),
            "utterances": [
                {
                    "text": item["dst"],
                    "start_time": item["start_time"],
                    "end_time": item["end_time"],
                    "additions": {"speaker": item["speaker"]},
                    "words": [],
                }
                for item in translation
            ],
        }
    }
    translation_payload = {"translation": translation}
    return asr_payload, translation_payload


def _write_json_artifact(path: Path, payload: dict[str, Any]) -> Path:
    content = json.dumps(payload, ensure_ascii=False, indent=2)
    runtime_security.atomic_write_private_text(path, content)
    return path


def write_uploaded_asr_artifact(
    subtitle_file: Path,
    session: Path,
    source: SourceConfig,
) -> Path:
    asr_payload, _ = _uploaded_subtitle_payloads(subtitle_file, source)
    return _write_json_artifact(session / "metadata" / "asr.json", asr_payload)


def write_uploaded_asr_fixed_artifact(
    subtitle_file: Path,
    session: Path,
    source: SourceConfig,
) -> Path:
    asr_payload, _ = _uploaded_subtitle_payloads(subtitle_file, source)
    return _write_json_artifact(session / "metadata" / "asr_fixed.json", asr_payload)


def write_uploaded_translation_artifact(
    subtitle_file: Path,
    session: Path,
    source: SourceConfig,
) -> Path:
    _, translation_payload = _uploaded_subtitle_payloads(subtitle_file, source)
    return _write_json_artifact(
        session / "metadata" / f"translation.{source.target_language}.json",
        translation_payload,
    )


def write_uploaded_subtitle_artifacts(
    subtitle_file: Path,
    session: Path,
    source: SourceConfig,
) -> tuple[Path, Path, Path]:
    asr_payload, translation_payload = _uploaded_subtitle_payloads(
        subtitle_file, source
    )

    metadata_dir = session / "metadata"
    asr_file = metadata_dir / "asr.json"
    asr_fixed_file = metadata_dir / "asr_fixed.json"
    translation_file = metadata_dir / f"translation.{source.target_language}.json"
    _write_json_artifact(asr_file, asr_payload)
    _write_json_artifact(asr_fixed_file, asr_payload)
    _write_json_artifact(translation_file, translation_payload)
    return asr_file, asr_fixed_file, translation_file
