"""Internal audio files exchanged by TTS, mixing and export."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated, Self

from pydantic import Field, model_validator

from .contracts import Contract, NonEmptyString, PositiveInt
from .errors import ApiError
from .segments import Transcript


class SpeechClip(Contract):
    segment_id: NonEmptyString
    path: NonEmptyString  # Relative to the Task work directory.
    duration_ms: PositiveInt
    sample_rate_hz: PositiveInt
    channels: Annotated[int, Field(ge=1, le=2)]


class SpeechClips(Contract):
    clips: Annotated[list[SpeechClip], Field(min_length=1)]

    def match(self, transcript: Transcript) -> dict[str, SpeechClip]:
        ids = [item.segment_id for item in self.clips]
        if len(set(ids)) != len(ids) or set(ids) != {item.id for item in transcript.segments}:
            raise ValueError("Each original segment must have exactly one speech clip")
        return {item.segment_id: item for item in self.clips}


class AlignedSegment(Contract):
    segment_id: NonEmptyString
    source_start_ms: Annotated[int, Field(ge=0)]
    source_end_ms: PositiveInt
    dubbed_start_ms: Annotated[int, Field(ge=0)]
    dubbed_end_ms: PositiveInt

    @model_validator(mode="after")
    def valid_intervals(self) -> Self:
        if self.source_end_ms <= self.source_start_ms or self.dubbed_end_ms <= self.dubbed_start_ms:
            raise ValueError("Source and dubbed intervals must have positive duration")
        return self


class Alignment(Contract):
    segments: Annotated[list[AlignedSegment], Field(min_length=1)]

    def match(self, transcript: Transcript, duration_ms: int) -> dict[str, AlignedSegment]:
        if [item.segment_id for item in self.segments] != [item.id for item in transcript.segments]:
            raise ValueError("Aligned segments must match the original segment order exactly")
        previous_end = 0
        for aligned, source in zip(self.segments, transcript.segments, strict=True):
            if (aligned.source_start_ms, aligned.source_end_ms) != (source.start_ms, source.end_ms):
                raise ValueError("Alignment must preserve original source timestamps")
            if (source.end_ms > duration_ms or aligned.dubbed_start_ms < max(previous_end, source.start_ms)
                    or aligned.dubbed_end_ms > duration_ms):
                raise ValueError("Dubbed segments must fit the video without overlap")
            previous_end = aligned.dubbed_end_ms
        return {item.segment_id: item for item in self.segments}


def read_speech_clips(path: Path, transcript: Transcript) -> SpeechClips:
    try:
        result = SpeechClips.model_validate_json(path.read_bytes())
        result.match(transcript)
        return result
    except (OSError, ValueError) as exc:
        raise ApiError(500, "INVALID_PROVIDER_RESULT", "Speech clips do not match the original segments.",
                       stage="mix", action="retry") from exc


def read_alignment(path: Path, transcript: Transcript, duration_ms: int) -> Alignment:
    try:
        result = Alignment.model_validate_json(path.read_bytes())
        result.match(transcript, duration_ms)
        return result
    except (OSError, ValueError) as exc:
        raise ApiError(500, "INVALID_PROVIDER_RESULT", "The dubbed timeline does not match the original segments.",
                       stage="export", action="retry") from exc
