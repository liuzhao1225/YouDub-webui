"""Media data and default-localization settings validation for Python workers."""

from __future__ import annotations

from typing import Annotated, Literal, Self
from urllib.parse import urlsplit

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    model_validator,
)


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False, hide_input_in_errors=True)


NonEmptyString = Annotated[str, Field(min_length=1)]
PositiveInt = Annotated[int, Field(ge=1)]
OutputMode = Literal["subtitles", "dubbing", "both"]
UiLanguage = Literal["en", "zh", "ja"]


def _valid_base_url(value: str) -> str:
    parsed = urlsplit(value)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or "?" in value
        or "#" in value
        or any(character.isspace() for character in value)
    ):
        raise ValueError("base_url must be an HTTP(S) URL without credentials, query or fragment")
    # Accessing port also rejects malformed and out-of-range port numbers.
    _ = parsed.port
    return value


BaseUrl = Annotated[str, Field(pattern=r"^https?://"), AfterValidator(_valid_base_url)]


class ModelSelection(Contract):
    adapter: NonEmptyString
    model: NonEmptyString
    device: Annotated[str, Field(pattern=r"^(cpu|cuda:[0-9]+|remote)$")]


class AsrSelection(ModelSelection):
    initial_prompt: Annotated[str, Field(max_length=500)] | None = None


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
        if self.source_language.casefold() == self.target_language.casefold():
            raise ValueError("source_language and target_language must differ")
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


class ConnectionPatch(Contract):
    adapter: NonEmptyString
    # An absent base_url is allowed; an explicitly null base_url is rejected.
    base_url: BaseUrl = Field(default=None)
    api_key: Annotated[SecretStr, Field(min_length=1)] | None = None

    @model_validator(mode="after")
    def require_change(self) -> Self:
        if not self.model_fields_set.intersection({"base_url", "api_key"}):
            raise ValueError("a connection update requires base_url or api_key")
        return self


class SettingsPatch(Contract):
    # Supplied groups must be non-null. model_fields_set identifies the group
    # while ConnectionPatch distinguishes an omitted key from an explicit clear.
    defaults: TaskConfig = Field(default=None)
    ui_language: UiLanguage = Field(default=None)
    connection: ConnectionPatch = Field(default=None)

    @model_validator(mode="after")
    def require_one_group(self) -> Self:
        if len(self.model_fields_set) != 1:
            raise ValueError("update exactly one of defaults, ui_language or connection")
        return self
