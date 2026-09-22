"""Files passed between the transcription, translation and media steps."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated, Self

from pydantic import Field, ValidationError, field_validator, model_validator

from .contracts import Contract, NonEmptyString
from .errors import ApiError

LANGUAGES = ("en", "zh", "ja")


class Segment(Contract):
    id: NonEmptyString
    start_ms: Annotated[int, Field(ge=0)]
    end_ms: Annotated[int, Field(gt=0)]
    text: NonEmptyString
    speaker_id: NonEmptyString | None = None

    @model_validator(mode="after")
    def validate_interval(self) -> Self:
        if self.end_ms <= self.start_ms:
            raise ValueError("Segment end must follow its start")
        if not self.text.strip():
            raise ValueError("Segment text must not be blank")
        return self


class Transcript(Contract):
    detected_language: NonEmptyString
    segments: Annotated[list[Segment], Field(min_length=1)]

    @field_validator("segments")
    @classmethod
    def unique_ids(cls, segments: list[Segment]) -> list[Segment]:
        if len({item.id for item in segments}) != len(segments):
            raise ValueError("Transcript segment IDs must be unique")
        return segments


class TranslatedSegment(Contract):
    segment_id: NonEmptyString
    text: NonEmptyString

    @field_validator("text")
    @classmethod
    def nonblank_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Translated text must not be blank")
        return value


class Translation(Contract):
    source_language: NonEmptyString
    target_language: NonEmptyString
    segments: Annotated[list[TranslatedSegment], Field(min_length=1)]

    def match(self, transcript: Transcript) -> dict[str, str]:
        ids = [item.segment_id for item in self.segments]
        if len(set(ids)) != len(ids) or set(ids) != {item.id for item in transcript.segments}:
            raise ValueError("Each original segment must have exactly one translation")
        if self.source_language != transcript.detected_language:
            raise ValueError("Translation source language differs from the transcript")
        return {item.segment_id: item.text for item in self.segments}


def read_transcript(path: Path, *, stage: str) -> Transcript:
    try:
        return Transcript.model_validate_json(path.read_bytes())
    except (OSError, ValidationError) as exc:
        raise ApiError(500, "INVALID_PROVIDER_RESULT", "The transcription file is missing or invalid.", stage=stage) from exc


def read_translation(path: Path, transcript: Transcript, *, stage: str) -> Translation:
    try:
        result = Translation.model_validate_json(path.read_bytes())
        result.match(transcript)
        return result
    except (OSError, ValueError) as exc:
        raise ApiError(500, "INVALID_PROVIDER_RESULT", "The translation file does not match the original segments.", stage=stage) from exc
