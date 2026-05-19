from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

from ..config import ffmpeg_binary, ffprobe_binary

SUBTITLE_PUNCTUATION = {"，", ",", "；", ";", "：", ":", "。", "?", "？", "!", "！", "、"}
SUBTITLE_PROTECTED_PAIRS = {"《": "》", "（": "）", "【": "】", "「": "」", "『": "』"}
SUBTITLE_CLOSING_QUOTES = {'"', "'", "」", "』", "》", "）", "】", "\u201d", "\u2019", "]"}
SUBTITLE_MIN_FRAGMENT_LEN = 5
SUBTITLE_MIN_DURATION_MS = 200
SUBTITLE_TAIL_BUFFER_MS = 100
SUBTITLE_DURATION_FLOOR_MS = 600


SUBTITLE_FONTS = {
    "zh": "Noto Sans CJK SC",
    "en": "Arial",
}

SUBTITLE_FONT_SIZES = {
    "zh": {"portrait": 12, "landscape": 24},
    "en": {"portrait": 9, "landscape": 18},
}


def _subtitle_style(font: str, size: int, margin_v: int) -> str:
    return (
        f"FontName={font},"
        f"FontSize={size},"
        "PrimaryColour=&H00FFFFFF,"
        "OutlineColour=&H00000000,"
        "BorderStyle=1,"
        "Outline=2,"
        "Alignment=2,"
        f"MarginV={margin_v}"
    )


def _srt_time(ms: int) -> str:
    hours = ms // 3_600_000
    ms -= hours * 3_600_000
    minutes = ms // 60_000
    ms -= minutes * 60_000
    seconds = ms // 1000
    millis = ms - seconds * 1000
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"


def _split_protected(text: str) -> list[str]:
    segments: list[str] = []
    buf: list[str] = []
    inside = None
    for ch in text:
        if inside is None and ch in SUBTITLE_PROTECTED_PAIRS:
            inside = SUBTITLE_PROTECTED_PAIRS[ch]
            buf.append(ch)
            continue
        if inside is not None and ch == inside:
            inside = None
            buf.append(ch)
            continue
        if inside is None and ch in SUBTITLE_PUNCTUATION:
            chunk = "".join(buf).strip()
            if chunk:
                segments.append(chunk)
            buf.clear()
            continue
        buf.append(ch)
    tail = "".join(buf).strip()
    if tail:
        segments.append(tail)
    return segments


def _attach_closing_quotes(segments: list[str]) -> list[str]:
    fixed: list[str] = []
    for seg in segments:
        if seg and seg[0] in SUBTITLE_CLOSING_QUOTES and fixed:
            fixed[-1] = f"{fixed[-1]}{seg}".strip()
            continue
        fixed.append(seg.strip())
    return fixed


def _merge_short_fragments(segments: list[str]) -> list[str]:
    merged: list[str] = []
    i = 0
    while i < len(segments):
        cur = segments[i]
        if len(cur.strip()) < SUBTITLE_MIN_FRAGMENT_LEN and i + 1 < len(segments):
            segments[i + 1] = f"{cur}{segments[i + 1]}".strip()
            i += 1
            continue
        merged.append(cur)
        i += 1
    return merged


def _strip_trailing_punct(segments: list[str]) -> list[str]:
    cleaned: list[str] = []
    for item in segments:
        text = item.strip()
        if not text:
            continue
        if text.endswith(("，", ",", "。")):
            text = text[:-1]
        cleaned.append(re.sub(r"\s+", " ", text).strip())
    return cleaned


def split_subtitle_text(text: str) -> list[str]:
    original = (text or "").strip()
    if not original:
        return []
    segments = _split_protected(original)
    if not segments:
        return [original]
    segments = _attach_closing_quotes(segments)
    segments = _merge_short_fragments(segments)
    cleaned = _strip_trailing_punct(segments)
    return cleaned or [original]


def _allocate_durations(fragments: list[str], total_duration: int) -> list[int]:
    if len(fragments) == 1:
        return [total_duration]
    weights = [max(1, len(f.replace(" ", ""))) for f in fragments]
    total_weight = sum(weights)
    durations: list[int] = []
    allocated = 0
    for i, weight in enumerate(weights[:-1]):
        share = round(total_duration * weight / total_weight)
        if total_duration >= SUBTITLE_DURATION_FLOOR_MS:
            ceiling = total_duration - allocated - SUBTITLE_TAIL_BUFFER_MS
            share = max(SUBTITLE_MIN_DURATION_MS, min(share, ceiling))
        else:
            share = max(int(SUBTITLE_MIN_DURATION_MS / 2), share)
        durations.append(share)
        allocated += share
    durations.append(max(SUBTITLE_TAIL_BUFFER_MS, total_duration - allocated))
    return durations


def _segment_times(item: dict) -> tuple[int, int]:
    start = int(item.get("actual_start_time", item["start_time"]))
    end = int(item.get("actual_end_time", item["end_time"]))
    return start, end


def _dst_lang(translation: list[dict]) -> str:
    for item in translation:
        lang = item.get("dst_lang")
        if lang:
            return lang
    return "zh"


def _dst_text(item: dict) -> str:
    return item.get("dst") or item.get("zh") or ""


def write_srt(translation_file: Path, session: Path) -> Path:
    data = json.loads(translation_file.read_text(encoding="utf-8"))
    translation = data["translation"]
    dst_lang = _dst_lang(translation)
    output_file = session / "metadata" / f"subtitles.{dst_lang}.srt"
    lines: list[str] = []
    idx = 1
    for item in translation:
        start, end = _segment_times(item)
        if end <= start:
            continue
        fragments = split_subtitle_text(_dst_text(item))
        if not fragments:
            continue
        cursor = start
        for fragment, duration in zip(fragments, _allocate_durations(fragments, end - start)):
            lines.extend([str(idx), f"{_srt_time(cursor)} --> {_srt_time(cursor + duration)}", fragment, ""])
            cursor += duration
            idx += 1
    output_file.write_text("\n".join(lines), encoding="utf-8")
    return output_file


def probe_video_size(video_file: Path) -> tuple[int, int] | None:
    result = subprocess.run(
        [
            ffprobe_binary(),
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-show_entries",
            "stream=width,height",
            "-of",
            "csv=p=0",
            str(video_file),
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        return None

    lines = result.stdout.strip().splitlines()
    if not lines:
        return None
    parts = lines[0].split(",", maxsplit=1)
    if len(parts) != 2:
        return None
    try:
        return int(parts[0]), int(parts[1])
    except ValueError:
        return None


def get_video_orientation(video_file: Path) -> str:
    size = probe_video_size(video_file)
    if size is None:
        return "landscape"
    width, height = size
    return "portrait" if height > width else "landscape"


def subtitle_style_for_orientation(orientation: str, font: str, lang: str = "zh") -> str:
    sizes = SUBTITLE_FONT_SIZES.get(lang, SUBTITLE_FONT_SIZES["zh"])
    margin_v = 70 if orientation == "portrait" else 5
    return _subtitle_style(font, size=sizes[orientation], margin_v=margin_v)


def _subtitle_filter_path(subtitle_file: Path, session: Path) -> str:
    try:
        return subtitle_file.resolve().relative_to(session.resolve()).as_posix()
    except ValueError as exc:
        raise ValueError("Subtitle file must be inside the session directory.") from exc


def subtitle_filter(video_file: Path, subtitle_file: Path, session: Path) -> str:
    lang = subtitle_file.stem.rsplit(".", 1)[-1]
    font = SUBTITLE_FONTS.get(lang, "Arial")
    style = subtitle_style_for_orientation(get_video_orientation(video_file), font, lang)
    sub_path = _subtitle_filter_path(subtitle_file, session)
    return f"subtitles=filename='{sub_path}':force_style='{style}'"


def merge_video(video_file: Path, dubbing_file: Path, bgm_file: Path, timings_file: Path, session: Path) -> Path:
    tmp_dir = session / "tmp"
    media_dir = session / "media"
    tmp_dir.mkdir(parents=True, exist_ok=True)
    media_dir.mkdir(parents=True, exist_ok=True)
    final_video = media_dir / "video_final.mp4"
    if final_video.exists():
        return final_video

    session_dir = session.resolve()
    video_input = video_file.resolve()
    dubbing_input = dubbing_file.resolve()
    bgm_input = bgm_file.resolve()
    subtitles = write_srt(timings_file, session)
    mixed_audio = tmp_dir / "audio_mixed.m4a"
    mixed_audio_output = mixed_audio.resolve()
    final_video_output = final_video.resolve()
    subprocess.run(
        [
            ffmpeg_binary(),
            "-y",
            "-i",
            str(dubbing_input),
            "-i",
            str(bgm_input),
            "-filter_complex",
            "[0:a]volume=1.0[a0];[1:a]volume=0.30[a1];[a0][a1]amix=inputs=2:duration=longest:normalize=0[aout]",
            "-map",
            "[aout]",
            "-c:a",
            "aac",
            str(mixed_audio_output),
        ],
        check=True,
    )
    subprocess.run(
        [
            ffmpeg_binary(),
            "-y",
            "-i",
            str(video_input),
            "-i",
            str(mixed_audio_output),
            "-vf",
            subtitle_filter(video_input, subtitles, session_dir),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "23",
            "-c:a",
            "aac",
            "-movflags",
            "+faststart",
            "-shortest",
            str(final_video_output),
        ],
        check=True,
        cwd=session_dir,
    )
    return final_video
