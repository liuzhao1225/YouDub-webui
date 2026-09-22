"""Handwritten API contracts for the single-video MVP.

The checked-in OpenAPI document describes the wire format. These models validate
that format without loading documentation into the application at runtime.
Runtime model availability and credentials are checked by the service layer.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Literal, Self
from urllib.parse import urlsplit

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    SecretStr,
    field_validator,
    model_serializer,
    model_validator,
)


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


NonEmptyString = Annotated[str, Field(min_length=1)]
PositiveInt = Annotated[int, Field(ge=1)]
TaskId = Annotated[
    str,
    Field(pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"),
]
Stage = Literal["prepare", "separate", "asr", "translate", "tts", "mix", "export"]
TaskStage = Literal["prepare", "separate", "asr", "translate", "tts", "mix", "export", "done"]
TaskStatus = Literal["queued", "running", "waiting", "cancelling", "cancelled", "succeeded", "failed"]
OutputMode = Literal["subtitles", "dubbing", "both"]
UiLanguage = Literal["en", "zh", "ja"]
VoiceMode = Literal["preset", "source_clone"]
TaskAction = Literal["cancel", "retry", "rerun", "delete"]
WaitReason = Literal["active_limit", "cpu", "gpu", "remote_limit", "remote_result"]
ErrorAction = Literal["adjust_settings", "retry", "rerun", "contact_support", "none"]
ErrorCode = Literal[
    "UNAUTHORIZED", "CSRF_INVALID", "ORIGIN_NOT_ALLOWED", "TASK_NOT_FOUND",
    "OUTPUT_NOT_FOUND", "TASK_EXISTS", "IMPORT_IN_PROGRESS", "IMPORT_RESIDUE",
    "TASK_BUSY", "ATTEMPT_CONFLICT", "RETRY_NOT_ALLOWED", "EXTERNAL_RESULT_UNKNOWN",
    "FILE_TOO_LARGE", "UNSUPPORTED_MEDIA", "RANGE_NOT_SATISFIABLE", "INVALID_CONFIG",
    "MODEL_NOT_READY", "UNSUPPORTED_LANGUAGE", "INVALID_PROVIDER_RESULT", "INTERNAL_ERROR",
    "FILE_DELETE_FAILED", "SETTINGS_PARTIALLY_APPLIED", "RUNTIME_UNAVAILABLE", "DISK_FULL",
    "APP_INTERRUPTED", "WORKER_EXITED", "REMOTE_QUERY_FAILED", "REMOTE_TIMEOUT",
    "PROVIDER_REJECTED", "CANCEL_TIMEOUT", "NO_AUDIO_TRACK", "INVALID_MEDIA",
    "INPUT_MISSING", "STAGE_OUTPUT_MISSING", "UNSUPPORTED_OVERLAPPING_SPEECH",
    "AUDIO_EXCEEDS_VIDEO",
]


def _valid_timestamp(value: str) -> str:
    datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%fZ")
    return value


Timestamp = Annotated[
    str,
    Field(pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$"),
    AfterValidator(_valid_timestamp),
]


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


class Error(Contract):
    code: ErrorCode
    message: NonEmptyString
    field: str | None
    stage: Stage | None
    action: ErrorAction


class ErrorEnvelope(Contract):
    error: Error


class Health(Contract):
    status: Literal["ready", "degraded"]
    instance_id: TaskId


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


class ResolvedConnection(Contract):
    adapter: NonEmptyString
    base_url: BaseUrl


class ConnectionRead(ResolvedConnection):
    has_api_key: bool


class Settings(Contract):
    defaults: TaskConfig | None
    connections: list[ConnectionRead]
    ui_language: UiLanguage


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


class Device(Contract):
    id: Annotated[str, Field(pattern=r"^(cpu|cuda:[0-9]+)$")]
    name: NonEmptyString
    available: bool
    unavailable_reason: str | None


class Voice(Contract):
    id: NonEmptyString
    name: NonEmptyString
    languages: list[NonEmptyString]


class ModelInputLimits(Contract):
    max_audio_duration_ms: PositiveInt | None
    max_text_chars: PositiveInt | None
    max_reference_duration_ms: PositiveInt | None


class ModelCapability(Contract):
    id: NonEmptyString
    devices: list[NonEmptyString]
    source_languages: list[NonEmptyString]
    target_languages: list[NonEmptyString]
    voice_modes: list[VoiceMode]
    voices: list[Voice]
    input_limits: ModelInputLimits

    @field_validator("voice_modes")
    @classmethod
    def unique_voice_modes(cls, value: list[VoiceMode]) -> list[VoiceMode]:
        if len(value) != len(set(value)):
            raise ValueError("voice_modes must contain unique items")
        return value


class RemoteOperations(Contract):
    submit_mode: Literal["sync", "async"]
    can_poll: bool
    can_cancel: bool
    can_lookup_request_key: bool


class Capability(Contract):
    adapter: NonEmptyString
    capability: Literal["separation", "asr", "translation", "tts", "subtitle_alignment"]
    execution: Literal["local", "remote"]
    available: bool
    unavailable_reason: str | None
    requires_api_key: bool
    models: list[ModelCapability]
    data_sent: list[Literal["audio", "text", "reference_audio"]]
    remote_operations: RemoteOperations | None

    @model_validator(mode="after")
    def validate_execution(self) -> Self:
        if self.execution == "local" and (self.remote_operations is not None or self.data_sent):
            raise ValueError("local capabilities cannot have remote operations or transmit data")
        if self.execution == "remote" and self.remote_operations is None:
            raise ValueError("remote capabilities require remote_operations")
        if not self.available and not self.unavailable_reason:
            raise ValueError("unavailable capabilities require a reason")
        if len(self.data_sent) != len(set(self.data_sent)):
            raise ValueError("data_sent must contain unique items")
        return self


class RuntimeLimits(Contract):
    max_file_bytes: PositiveInt
    max_video_duration_ms: PositiveInt
    max_video_width: PositiveInt
    max_video_height: PositiveInt
    max_frame_rate: Annotated[float, Field(gt=0)]
    video_suffixes: list[NonEmptyString]
    video_codecs: list[NonEmptyString]
    audio_codecs: list[NonEmptyString]
    max_active_tasks: PositiveInt
    cpu_heavy_slots: PositiveInt
    gpu_slots_per_device: PositiveInt
    remote_request_slots_per_connection: PositiveInt
    remote_pending_slots_per_connection: PositiveInt
    poll_interval_ms: Annotated[int, Field(ge=250)]


class Runtime(Contract):
    api_version: Literal["v1"]
    contract_version: NonEmptyString
    instance_id: TaskId
    status: Literal["ready", "degraded"]
    platform: Literal["windows", "macos", "linux"]
    arch: NonEmptyString
    devices: list[Device]
    capabilities: list[Capability]
    limits: RuntimeLimits


class OutputFile(Contract):
    url: Annotated[str, Field(pattern=r"^/api/v1/tasks/")]
    file_name: NonEmptyString
    mime_type: Literal["video/mp4", "audio/wav", "application/x-subrip"]
    size_bytes: PositiveInt
    duration_ms: PositiveInt | None
    timeline: Literal["source", "dubbed"] | None


class Outputs(Contract):
    video: OutputFile = Field(default=None)
    audio: OutputFile = Field(default=None)
    source_subtitles: OutputFile = Field(default=None)
    translated_subtitles: OutputFile = Field(default=None)

    @model_serializer(mode="wrap")
    def omit_absent_outputs(self, handler):
        return {name: value for name, value in handler(self).items() if value is not None}


class ExternalOperation(Contract):
    state: Literal["none", "pending", "succeeded", "failed", "cancelled", "unknown"]
    may_still_run: bool

    @model_validator(mode="after")
    def validate_remote_risk(self) -> Self:
        if self.may_still_run != (self.state in {"pending", "unknown"}):
            raise ValueError("may_still_run must be true exactly for pending or unknown operations")
        return self


class TaskSummary(Contract):
    id: TaskId
    attempt: PositiveInt
    source_name: NonEmptyString
    source_size_bytes: PositiveInt
    source_duration_ms: PositiveInt | None
    status: TaskStatus
    current_stage: TaskStage
    stage_progress: Annotated[float, Field(ge=0, le=1)] | None
    wait_reason: WaitReason | None
    message: str | None
    error: Error | None
    external_operation: ExternalOperation
    allowed_actions: list[TaskAction]
    created_at: Timestamp
    updated_at: Timestamp
    started_at: Timestamp | None
    finished_at: Timestamp | None

    @model_validator(mode="after")
    def validate_state(self) -> Self:
        if (self.status == "succeeded") != (self.current_stage == "done"):
            raise ValueError("current_stage must be done exactly for succeeded tasks")
        if self.status == "failed" and self.error is None:
            raise ValueError("failed tasks require an error")
        terminal = self.status in {"succeeded", "failed", "cancelled"}
        if terminal != (self.finished_at is not None):
            raise ValueError("finished_at is required exactly for terminal tasks")
        if len(self.allowed_actions) != len(set(self.allowed_actions)):
            raise ValueError("allowed_actions must contain unique items")
        return self


class Task(TaskSummary):
    config: TaskConfig
    pipeline_version: NonEmptyString
    resolved_connections: list[ResolvedConnection]
    outputs: Outputs

    @model_validator(mode="after")
    def require_success_outputs(self) -> Self:
        if self.status != "succeeded":
            return self
        required = {"video"}
        if self.config.output_mode in {"subtitles", "both"}:
            required.update({"source_subtitles", "translated_subtitles"})
        if self.config.output_mode in {"dubbing", "both"}:
            required.add("audio")
        missing = sorted(name for name in required if getattr(self.outputs, name) is None)
        if missing:
            raise ValueError("succeeded task is missing outputs: " + ", ".join(missing))
        return self


class TaskList(Contract):
    items: list[TaskSummary]
    limit: Annotated[int, Field(ge=1, le=100)]
    offset: Annotated[int, Field(ge=0)]
    has_more: bool


class RetryRequest(Contract):
    expected_attempt: PositiveInt


class RerunRequest(Contract):
    id: TaskId
    config: TaskConfig
    acknowledge_external_risk: bool = False
