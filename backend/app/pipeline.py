from __future__ import annotations

import traceback
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from . import database
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
    path.parent.mkdir(parents=True, exist_ok=True)
    timestamp = database.now_iso()
    with path.open("a", encoding="utf-8") as handle:
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

        database.update_task(self.task_id, status="running", started_at=database.now_iso())
        self.log("Task started")

        try:
            validate_runtime_device()
            self.log(f"Device plan: {device_plan_summary()}")
            for stage in STAGES:
                self._run_stage(stage.name)
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

    def _stage_status(self, stage: str) -> str | None:
        task = database.get_task(self.task_id)
        for entry in task["stages"] if task else []:
            if entry["name"] == stage:
                return entry["status"]
        return None

    def _run_stage(self, stage: str) -> None:
        if self._stage_status(stage) == "succeeded":
            database.update_task(self.task_id, current_stage=stage)
            self._restore_cached_stage(stage, database.get_task(self.task_id))
            self.log(f"[{stage}] Reused cached output")
            return
        database.update_task(self.task_id, current_stage=stage)
        database.update_stage(
            self.task_id,
            stage,
            status="running",
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
        self.artifacts.vocals_file, self.artifacts.bgm_file = separate_audio(video_file, session)
        self.stage_message("separate", f"Vocals: {self.artifacts.vocals_file.name}, BGM: {self.artifacts.bgm_file.name}")

    def _asr(self, task: dict) -> None:
        import json as _json
        from .adapters.whisper_asr import recognize_speech

        session = _require(self.artifacts.session, "session")
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
        from .adapters.asr_sentence_fixer import fix_asr_sentences

        session = _require(self.artifacts.session, "session")
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
        from .adapters.openai_translate import translate_asr

        session = _require(self.artifacts.session, "session")
        asr_file = _require(self.artifacts.asr_fixed_file, "asr_fixed_file")
        settings = database.get_openai_settings()
        source = detect_source(task["url"])
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
        self.artifacts.tts_dir = generate_tts(translation_file, vocals_dir, session)
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
