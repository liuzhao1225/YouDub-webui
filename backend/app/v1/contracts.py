"""Media data and default-localization settings validation for Python workers."""

from __future__ import annotations

from typing import Annotated, Literal, Self

from pydantic import Field, model_validator

from .data_contracts import Contract, NonEmptyString


OutputMode = Literal["subtitles", "dubbing", "both"]


class ModelSelection(Contract):
    adapter: NonEmptyString
    model: NonEmptyString
    device: Annotated[str, Field(pattern=r"^(cpu|cuda:[0-9]+|mps|remote)$")]


class AsrSelection(ModelSelection):
    initial_prompt: str | None = None


class PresetVoice(Contract):
    mode: Literal["preset"]
    id: NonEmptyString


class SourceCloneVoice(Contract):
    mode: Literal["source_clone"]


VoiceSelection = Annotated[PresetVoice | SourceCloneVoice, Field(discriminator="mode")]


class TtsSelection(ModelSelection):
    voice: VoiceSelection


class TaskConfig(Contract):
    source_language: Annotated[str, Field(pattern=r"^(auto|[a-z]{2,3}(-[A-Za-z0-9]{2,8})*)$")]
    target_language: Annotated[str, Field(pattern=r"^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$")]
    output_mode: OutputMode
    keep_background: bool
    asr: AsrSelection
    translation: ModelSelection
    tts: TtsSelection | None
    separation: ModelSelection | None
    subtitle_alignment: ModelSelection | None = None

    @model_validator(mode="after")
    def validate_pipeline(self) -> Self:
        if self.target_language == "auto":
            raise ValueError("target_language cannot be auto")
        if self.subtitle_alignment is not None and self.output_mode != "both":
            raise ValueError("subtitle_alignment requires both mode")
        if self.output_mode == "subtitles":
            if self.tts is not None or self.separation is not None or self.keep_background:
                raise ValueError("subtitles mode requires tts=null, separation=null and keep_background=false")
        elif self.tts is None:
            raise ValueError("dubbing and both modes require tts")
        needs_separation = self.keep_background or (
            self.tts is not None and self.tts.voice.mode == "source_clone"
        )
        if needs_separation and self.separation is None:
            raise ValueError("background preservation and source cloning require separation")
        if not needs_separation and self.separation is not None:
            raise ValueError("separation must be null when it is not used")
        return self
