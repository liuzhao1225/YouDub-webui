from __future__ import annotations

import json
import traceback
from dataclasses import dataclass
from pathlib import Path
from time import monotonic
from typing import Callable

from . import database, runtime_security
from .config import WORKFOLDER
from .devices import device_plan_summary
from .runtime_checks import validate_runtime_device
from .sources import detect_source
from .stages import STAGES
from .youtube import is_local_upload_url


@dataclass
class PipelineArtifacts:
    session: Path | None = None
    video_file: Path | None = None
    vocals_file: Path | None = None
    bgm_file: Path | None = None
    asr_file: Path | None = None
    asr_fixed_file: Path | None = None
    translation_file: Path | None = None
    vocals_dir: Path | None = None
    tts_dir: Path | None = None
    dubbing_file: Path | None = None
    timings_file: Path | None = None
    final_video: Path | None = None


def _write_log(task_id: str, message: str) -> None:
    path = database.log_path(task_id)
    timestamp = database.now_iso()
    with runtime_security.open_private_append_text(path) as handle:
        for line in message.rstrip().splitlines() or [""]:
            handle.write(f"[{timestamp}] {line}\n")


def _require(value, name: str):
    if value is None:
        raise RuntimeError(f"Missing pipeline artifact: {name}")
    return value


def _require_existing(path: Path, name: str) -> Path:
    if not path.exists():
        raise RuntimeError(f"Missing cached pipeline artifact: {name} ({path})")
    return path


class PipelineRunner:
    def __init__(self, task_id: str):
        self.task_id = task_id
        self.artifacts = PipelineArtifacts()
        self._progress_state: dict[str, tuple[int, float]] = {}
        self._stage_handlers: dict[str, Callable[[dict], None]] = {
            "download": self._download,
            "separate": self._separate,
            "asr": self._asr,
            "asr_fix": self._asr_fix,
            "translate": self._translate,
            "split_audio": self._split_audio,
            "tts": self._tts,
            "merge_audio": self._merge_audio,
            "merge_video": self._merge_video,
        }

    def run(self) -> None:
        task = database.get_task(self.task_id)
        if not task:
            return

        execution_mode = task.get("execution_mode") or database.DEFAULT_EXECUTION_MODE
        status = task["status"]
        if status not in ("queued", "paused"):
            return

        if status == "queued":
            updates: dict[str, str] = {"status": "running"}
            if not task.get("started_at"):
                updates["started_at"] = database.now_iso()
            database.update_task(self.task_id, **updates)
            self.log("Task started")
        else:
            database.update_task(self.task_id, status="running")
            self.log("Task continued")

        try:
            validate_runtime_device()
            self.log(f"Device plan: {device_plan_summary()}")
            for stage in STAGES:
                if self._stage_status(stage.name) == "succeeded":
                    database.update_task(self.task_id, current_stage=stage.name)
                    database.update_stage(self.task_id, stage.name, progress=100)
                    self._restore_cached_stage(stage.name, database.get_task(self.task_id))
                    self.log(f"[{stage.name}] Reused cached output")
                    continue
                self._run_stage(stage.name)
                if execution_mode == "manual" and stage != STAGES[-1]:
                    database.update_task(self.task_id, status="paused")
                    self.log(f"Paused after [{stage.name}], waiting for manual continue")
                    return
            database.update_task(
                self.task_id,
                status="succeeded",
                current_stage="done",
                final_video_path=str(_require(self.artifacts.final_video, "final_video")),
                completed_at=database.now_iso(),
            )
            self.log("Task succeeded")
        except Exception as exc:
            current = database.get_task(self.task_id)
            failed_stage = current["current_stage"] if current else None
            if failed_stage and failed_stage != "done":
                database.update_stage(
                    self.task_id,
                    failed_stage,
                    status="failed",
                    completed_at=database.now_iso(),
                    error_message=str(exc),
                    last_message="Failed",
                )
            database.update_task(
                self.task_id,
                status="failed",
                error_message=str(exc),
                completed_at=database.now_iso(),
            )
            self.log("Task failed")
            self.log(traceback.format_exc())

    def log(self, message: str) -> None:
        _write_log(self.task_id, message)

    def stage_message(self, stage: str, message: str) -> None:
        database.update_stage(self.task_id, stage, last_message=message)
        self.log(f"[{stage}] {message}")

    def stage_progress(self, stage: str, progress: int, message: str, *, force: bool = False) -> None:
        bounded = max(0, min(100, int(progress)))
        now = monotonic()
        previous = self._progress_state.get(stage)
        if previous and not force and bounded < 100:
            last_progress, last_at = previous
            if bounded <= last_progress:
                return
            if now - last_at < 2:
                return
        database.update_stage(self.task_id, stage, progress=bounded, last_message=message)
        self._progress_state[stage] = (bounded, now)

    def _stage_status(self, stage: str) -> str | None:
        task = database.get_task(self.task_id)
        for entry in task["stages"] if task else []:
            if entry["name"] == stage:
                return entry["status"]
        return None

    def _local_info(self) -> dict | None:
        session = self.artifacts.session
        if not session:
            return None
        metadata_file = session / "metadata" / "local_info.json"
        if not metadata_file.exists():
            return None
        return json.loads(metadata_file.read_text(encoding="utf-8"))

    def _uploaded_subtitle_path(self, task: dict) -> Path | None:
        if not is_local_upload_url(task["url"]):
            return None
        info = self._local_info()
        if not info:
            return None
        subtitle_path = str(info.get("subtitle_path") or "").strip()
        if not subtitle_path:
            return None
        return _require_existing(Path(subtitle_path), "uploaded_subtitle_file")

    def _write_uploaded_asr_artifact(self, task: dict) -> Path:
        from .adapters.local_subtitles import write_uploaded_asr_artifact

        session = _require(self.artifacts.session, "session")
        subtitle_file = self._uploaded_subtitle_path(task)
        if not subtitle_file:
            raise RuntimeError("Missing uploaded subtitle file.")
        source = detect_source(task["url"])
        return write_uploaded_asr_artifact(subtitle_file, session, source)

    def _run_stage(self, stage: str) -> None:
        self._progress_state.pop(stage, None)
        database.update_task(self.task_id, current_stage=stage)
        database.update_stage(
            self.task_id,
            stage,
            status="running",
            progress=0,
            started_at=database.now_iso(),
            completed_at=None,
            error_message=None,
        )
        self.stage_message(stage, "Started")
        self._stage_handlers[stage](database.get_task(self.task_id))
        database.update_stage(
            self.task_id,
            stage,
            status="succeeded",
            progress=100,
            completed_at=database.now_iso(),
            last_message="Completed",
        )
        self.log(f"[{stage}] Completed")

    def _restore_cached_stage(self, stage: str, task: dict | None) -> None:
        if not task:
            raise RuntimeError("Missing task while restoring cached pipeline artifacts.")
        session_path = task.get("session_path")
        if not session_path:
            raise RuntimeError("Missing cached pipeline artifact: session_path")

        session = _require_existing(Path(session_path), "session")
        self.artifacts.session = session

        if stage == "download":
            self.artifacts.video_file = _require_existing(session / "media" / "video_source.mp4", "video_file")
            return
        if stage == "separate":
            self.artifacts.vocals_file = _require_existing(session / "media" / "audio_vocals.wav", "vocals_file")
            self.artifacts.bgm_file = _require_existing(session / "media" / "audio_bgm.wav", "bgm_file")
            return
        if stage == "asr":
            self.artifacts.asr_file = _require_existing(session / "metadata" / "asr.json", "asr_file")
            return
        if stage == "asr_fix":
            self.artifacts.asr_fixed_file = _require_existing(session / "metadata" / "asr_fixed.json", "asr_fixed_file")
            return
        if stage == "translate":
            source = detect_source(task["url"])
            self.artifacts.translation_file = _require_existing(
                session / "metadata" / f"translation.{source.target_language}.json",
                "translation_file",
            )
            return
        if stage == "split_audio":
            self.artifacts.vocals_dir = _require_existing(session / "segments" / "vocals", "vocals_dir")
            return
        if stage == "tts":
            self.artifacts.tts_dir = _require_existing(session / "segments" / "tts", "tts_dir")
            return
        if stage == "merge_audio":
            self.artifacts.dubbing_file = _require_existing(session / "tmp" / "audio_dubbing.wav", "dubbing_file")
            self.artifacts.timings_file = _require_existing(session / "metadata" / "timings.json", "timings_file")
            return
        if stage == "merge_video":
            self.artifacts.final_video = _require_existing(session / "media" / "video_final.mp4", "final_video")
            return
        raise RuntimeError(f"Unknown pipeline stage: {stage}")

    def _download(self, task: dict) -> None:
        source = detect_source(task["url"])
        if is_local_upload_url(task["url"]):
            from .adapters.local_video import import_local_video

            session, info = import_local_video(task["url"], WORKFOLDER, source)
        else:
            from .adapters.ytdlp import download_video

            proxy_port = database.get_ytdlp_settings()["proxy_port"]
            session, info = download_video(task["url"], WORKFOLDER, source, proxy_port)
        self.artifacts.session = session
        self.artifacts.video_file = session / "media" / "video_source.mp4"
        title = (info.get("title") or "").strip() or None
        database.update_task(self.task_id, session_path=str(session), title=title)
        self.stage_message("download", f"[{source.name}] {title or 'Downloaded'} -> {session}")

    def _separate(self, _: dict) -> None:
        from .adapters.demucs import separate_audio

        session = _require(self.artifacts.session, "session")
        video_file = _require(self.artifacts.video_file, "video_file")
        self.artifacts.vocals_file, self.artifacts.bgm_file = separate_audio(
            video_file,
            session,
            progress_callback=lambda progress, message: self.stage_progress("separate", progress, message),
        )
        self.stage_message("separate", f"Vocals: {self.artifacts.vocals_file.name}, BGM: {self.artifacts.bgm_file.name}")

    def _asr(self, task: dict) -> None:
        import json as _json

        session = _require(self.artifacts.session, "session")
        subtitle_file = self._uploaded_subtitle_path(task)
        if subtitle_file:
            self.artifacts.asr_file = self._write_uploaded_asr_artifact(task)
            items = _json.loads(
                self.artifacts.asr_file.read_text(encoding="utf-8")
            )["result"]["utterances"]
            self.stage_message(
                "asr",
                f"Used uploaded SRT subtitles ({len(items)} cues) -> {self.artifacts.asr_file.name}; skipped Whisper",
            )
            return

        from .adapters.whisper_asr import recognize_speech

        vocals_file = _require(self.artifacts.vocals_file, "vocals_file")
        source = detect_source(task["url"])
        self.artifacts.asr_file = recognize_speech(vocals_file, session, language=source.asr_language)
        data = _json.loads(self.artifacts.asr_file.read_text(encoding="utf-8"))
        utterances = data["result"]["utterances"]
        word_count = sum(len(u.get("words") or []) for u in utterances)
        self.stage_message(
            "asr",
            f"Recognized {len(utterances)} segments / {word_count} words -> {self.artifacts.asr_file.name}",
        )

    def _asr_fix(self, task: dict) -> None:
        import json as _json

        session = _require(self.artifacts.session, "session")
        subtitle_file = self._uploaded_subtitle_path(task)
        if subtitle_file:
            from .adapters.local_subtitles import write_uploaded_asr_fixed_artifact

            source = detect_source(task["url"])
            self.artifacts.asr_fixed_file = write_uploaded_asr_fixed_artifact(
                subtitle_file,
                session,
                source,
            )
            sentences = _json.loads(
                self.artifacts.asr_fixed_file.read_text(encoding="utf-8")
            )["result"]["utterances"]
            self.stage_message(
                "asr_fix",
                f"Reused uploaded SRT subtitles ({len(sentences)} cues); skipped sentence splitting",
            )
            return

        from .adapters.asr_sentence_fixer import fix_asr_sentences

        asr_file = _require(self.artifacts.asr_file, "asr_file")
        before = len(_json.loads(asr_file.read_text(encoding="utf-8"))["result"]["utterances"])
        source = detect_source(task["url"])
        self.artifacts.asr_fixed_file = fix_asr_sentences(asr_file, session, language=source.asr_language)
        sentences = _json.loads(self.artifacts.asr_fixed_file.read_text(encoding="utf-8"))["result"]["utterances"]
        self.stage_message(
            "asr_fix",
            f"Re-segmented {before} -> {len(sentences)} sentences -> {self.artifacts.asr_fixed_file.name}",
        )

    def _translate(self, task: dict) -> None:
        import json as _json

        session = _require(self.artifacts.session, "session")
        source = detect_source(task["url"])
        subtitle_file = self._uploaded_subtitle_path(task)
        if subtitle_file:
            from .adapters.local_subtitles import write_uploaded_translation_artifact

            self.artifacts.translation_file = write_uploaded_translation_artifact(
                subtitle_file,
                session,
                source,
            )
            items = _json.loads(
                self.artifacts.translation_file.read_text(encoding="utf-8")
            )["translation"]
            self.stage_message(
                "translate",
                f"Reused uploaded translated SRT ({len(items)} cues); skipped OpenAI translation",
            )
            return

        from .adapters.openai_translate import translate_asr

        asr_file = _require(self.artifacts.asr_fixed_file, "asr_fixed_file")
        settings = database.get_openai_settings()
        self.stage_message(
            "translate",
            f"Using model {settings['model']} at {settings['base_url']} ({source.asr_language}->{source.target_language})",
        )
        self.artifacts.translation_file = translate_asr(asr_file, session, settings, source)
        items = _json.loads(self.artifacts.translation_file.read_text(encoding="utf-8"))["translation"]
        self.stage_message(
            "translate",
            f"Translated {len(items)} sentences -> {self.artifacts.translation_file.name}",
        )
        from .adapters.openai_translate import preprocess_artifact_path

        preprocess_file = preprocess_artifact_path(session)
        if preprocess_file.exists():
            self.log(f"[translate] Preprocess artifact -> {preprocess_file}")

    def _split_audio(self, _: dict) -> None:
        from .adapters.audio import split_audio_by_translation

        session = _require(self.artifacts.session, "session")
        vocals_file = _require(self.artifacts.vocals_file, "vocals_file")
        translation_file = _require(self.artifacts.translation_file, "translation_file")
        self.artifacts.vocals_dir = split_audio_by_translation(vocals_file, translation_file, session)
        self.stage_message("split_audio", "Created vocal reference segments")

    def _tts(self, _: dict) -> None:
        from .adapters.voxcpm import generate_tts

        session = _require(self.artifacts.session, "session")
        translation_file = _require(self.artifacts.translation_file, "translation_file")
        vocals_dir = _require(self.artifacts.vocals_dir, "vocals_dir")
        self.artifacts.tts_dir = generate_tts(
            translation_file,
            vocals_dir,
            session,
            progress_callback=lambda progress, message: self.stage_progress("tts", progress, message),
        )
        wav_count = len(list(self.artifacts.tts_dir.glob("*.wav")))
        self.stage_message("tts", f"Generated {wav_count} TTS clips -> {self.artifacts.tts_dir}")

    def _merge_audio(self, _: dict) -> None:
        from .adapters.audio import merge_tts_audio

        session = _require(self.artifacts.session, "session")
        translation_file = _require(self.artifacts.translation_file, "translation_file")
        tts_dir = _require(self.artifacts.tts_dir, "tts_dir")
        dubbing, timings = merge_tts_audio(translation_file, tts_dir, session)
        self.artifacts.dubbing_file = dubbing
        self.artifacts.timings_file = timings
        self.stage_message("merge_audio", f"Dubbing -> {dubbing.name}, timings -> {timings.name}")

    def _merge_video(self, _: dict) -> None:
        from .adapters.ffmpeg import merge_video

        session = _require(self.artifacts.session, "session")
        video_file = _require(self.artifacts.video_file, "video_file")
        dubbing_file = _require(self.artifacts.dubbing_file, "dubbing_file")
        bgm_file = _require(self.artifacts.bgm_file, "bgm_file")
        timings_file = _require(self.artifacts.timings_file, "timings_file")
        self.artifacts.final_video = merge_video(video_file, dubbing_file, bgm_file, timings_file, session)
        size_mb = self.artifacts.final_video.stat().st_size / (1024 * 1024)
        self.stage_message("merge_video", f"Final video: {self.artifacts.final_video} ({size_mb:.1f} MB)")


def run_task(task_id: str) -> None:
    PipelineRunner(task_id).run()
