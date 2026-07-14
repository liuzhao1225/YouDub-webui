from __future__ import annotations

import json
import sys
import types
from pathlib import Path

from backend.app import database
from backend.app import pipeline
from backend.app.pipeline import PipelineRunner
from backend.app.stages import STAGES


def configure_db(monkeypatch, tmp_path):
    monkeypatch.setattr(database, "DB_PATH", tmp_path / "test.sqlite")
    database.init_db()


def _noop_stage(self, task):
    return None


def _cached_session(tmp_path: Path) -> Path:
    session = tmp_path / "session"
    for directory in ("media", "metadata", "segments/vocals", "segments/tts", "tmp"):
        (session / directory).mkdir(parents=True, exist_ok=True)
    for file in (
        "media/video_source.mp4",
        "media/audio_vocals.wav",
        "media/audio_bgm.wav",
        "metadata/asr.json",
        "metadata/asr_fixed.json",
        "metadata/translation.zh.json",
        "tmp/audio_dubbing.wav",
        "metadata/timings.json",
        "media/video_final.mp4",
    ):
        (session / file).write_bytes(b"cached")
    return session


def test_pipeline_marks_all_stages_succeeded(monkeypatch, tmp_path):
    configure_db(monkeypatch, tmp_path)
    task_id = database.create_task("https://www.youtube.com/watch?v=abcdefghijk")
    final_path = tmp_path / "video_final.mp4"
    final_path.write_bytes(b"mp4")

    for name in ("_download", "_separate", "_asr", "_asr_fix", "_translate", "_split_audio", "_tts", "_merge_audio"):
        monkeypatch.setattr(PipelineRunner, name, _noop_stage)

    def merge_video(self, task):
        self.artifacts.final_video = final_path

    monkeypatch.setattr(PipelineRunner, "_merge_video", merge_video)

    PipelineRunner(task_id).run()
    task = database.get_task(task_id)

    assert task["status"] == "succeeded"
    assert task["final_video_path"] == str(final_path)
    assert [stage["status"] for stage in task["stages"]] == ["succeeded"] * 9
    assert [stage["progress"] for stage in task["stages"]] == [100] * 9


def test_pipeline_skips_already_succeeded_stages(monkeypatch, tmp_path):
    configure_db(monkeypatch, tmp_path)
    task_id = database.create_task("https://www.youtube.com/watch?v=resumevidxxx", task_id="resumevidxxx")
    session = _cached_session(tmp_path)
    final_path = session / "media" / "video_final.mp4"
    database.update_task(task_id, session_path=str(session))

    for name in ("download", "separate", "asr"):
        database.update_stage(task_id, name, status="succeeded", completed_at=database.now_iso())

    visited: list[str] = []
    for stage_name in ("_download", "_separate", "_asr"):
        def make_handler(name=stage_name):
            def handler(self, task):
                visited.append(name)
            return handler
        monkeypatch.setattr(PipelineRunner, stage_name, make_handler())

    def asr_fix(self, task):
        visited.append("_asr_fix")
        assert self.artifacts.session == session
        assert self.artifacts.video_file == session / "media" / "video_source.mp4"
        assert self.artifacts.vocals_file == session / "media" / "audio_vocals.wav"
        assert self.artifacts.bgm_file == session / "media" / "audio_bgm.wav"
        assert self.artifacts.asr_file == session / "metadata" / "asr.json"
        self.artifacts.asr_fixed_file = session / "metadata" / "asr_fixed.json"

    def translate(self, task):
        visited.append("_translate")
        self.artifacts.translation_file = session / "metadata" / "translation.zh.json"

    def split_audio(self, task):
        visited.append("_split_audio")
        self.artifacts.vocals_dir = session / "segments" / "vocals"

    def tts(self, task):
        visited.append("_tts")
        self.artifacts.tts_dir = session / "segments" / "tts"

    def merge_audio(self, task):
        visited.append("_merge_audio")
        self.artifacts.dubbing_file = session / "tmp" / "audio_dubbing.wav"
        self.artifacts.timings_file = session / "metadata" / "timings.json"

    def merge_video(self, task):
        visited.append("_merge_video")
        self.artifacts.final_video = final_path

    monkeypatch.setattr(PipelineRunner, "_asr_fix", asr_fix)
    monkeypatch.setattr(PipelineRunner, "_translate", translate)
    monkeypatch.setattr(PipelineRunner, "_split_audio", split_audio)
    monkeypatch.setattr(PipelineRunner, "_tts", tts)
    monkeypatch.setattr(PipelineRunner, "_merge_audio", merge_audio)
    monkeypatch.setattr(PipelineRunner, "_merge_video", merge_video)

    PipelineRunner(task_id).run()

    assert visited == [
        "_asr_fix", "_translate", "_split_audio", "_tts", "_merge_audio", "_merge_video",
    ]
    task = database.get_task(task_id)
    assert task["status"] == "succeeded"
    assert task["final_video_path"] == str(final_path)


def test_pipeline_fails_when_succeeded_stage_cache_is_missing(monkeypatch, tmp_path):
    configure_db(monkeypatch, tmp_path)
    task_id = database.create_task("https://www.youtube.com/watch?v=missingvidx", task_id="missingvidx")
    session = tmp_path / "session"
    session.mkdir()
    database.update_task(task_id, session_path=str(session))
    database.update_stage(task_id, "download", status="succeeded", completed_at=database.now_iso())

    visited: list[str] = []

    def download(self, task):
        visited.append("_download")

    monkeypatch.setattr(PipelineRunner, "_download", download)

    PipelineRunner(task_id).run()
    task = database.get_task(task_id)
    stages = {stage["name"]: stage for stage in task["stages"]}

    assert visited == []
    assert task["status"] == "failed"
    assert task["error_message"].startswith("Missing cached pipeline artifact: video_file")
    assert stages["download"]["status"] == "failed"
    assert stages["separate"]["status"] == "pending"


def test_pipeline_failure_stops_following_stages(monkeypatch, tmp_path):
    configure_db(monkeypatch, tmp_path)
    task_id = database.create_task("https://www.youtube.com/watch?v=abcdefghijk")

    monkeypatch.setattr(PipelineRunner, "_download", _noop_stage)
    monkeypatch.setattr(PipelineRunner, "_separate", _noop_stage)

    def fail_asr(self, task):
        raise RuntimeError("asr exploded")

    monkeypatch.setattr(PipelineRunner, "_asr", fail_asr)

    PipelineRunner(task_id).run()
    task = database.get_task(task_id)
    stages = {stage["name"]: stage for stage in task["stages"]}

    assert task["status"] == "failed"
    assert stages["asr"]["status"] == "failed"
    assert stages["asr"]["progress"] == 0
    assert stages["translate"]["status"] == "pending"
    assert task["error_message"] == "asr exploded"


def test_stage_progress_is_throttled(monkeypatch, tmp_path):
    configure_db(monkeypatch, tmp_path)
    task_id = database.create_task("https://www.youtube.com/watch?v=progressidx")
    runner = PipelineRunner(task_id)
    ticks = iter([0.0, 0.5, 2.1])
    monkeypatch.setattr(pipeline, "monotonic", lambda: next(ticks))

    runner.stage_progress("tts", 10, "Prepared 1/10 TTS clips")
    runner.stage_progress("tts", 20, "Prepared 2/10 TTS clips")
    runner.stage_progress("tts", 30, "Prepared 3/10 TTS clips")

    stage = {entry["name"]: entry for entry in database.get_task(task_id)["stages"]}["tts"]
    assert stage["progress"] == 30
    assert stage["last_message"] == "Prepared 3/10 TTS clips"


def test_pipeline_manual_pauses_after_each_stage(monkeypatch, tmp_path):
    configure_db(monkeypatch, tmp_path)
    task_id = database.create_task(
        "https://www.youtube.com/watch?v=manualstepx",
        task_id="manualstepx",
        execution_mode="manual",
    )

    def download(self, task):
        session = tmp_path / "session"
        media = session / "media"
        media.mkdir(parents=True)
        video = media / "video_source.mp4"
        video.write_bytes(b"video")
        self.artifacts.session = session
        self.artifacts.video_file = video
        database.update_task(self.task_id, session_path=str(session), title="manual")

    monkeypatch.setattr(PipelineRunner, "_download", download)

    def fail_later(name):
        def handler(self, task):
            raise AssertionError(f"unexpected stage {name}")

        return handler

    for name in ("_separate", "_asr", "_asr_fix", "_translate", "_split_audio", "_tts", "_merge_audio", "_merge_video"):
        monkeypatch.setattr(PipelineRunner, name, fail_later(name))

    PipelineRunner(task_id).run()
    task = database.get_task(task_id)
    assert task["status"] == "paused"
    assert task["stages"][0]["status"] == "succeeded"
    assert task["stages"][1]["status"] == "pending"

    def separate(self, task):
        vocals = self.artifacts.session / "media" / "audio_vocals.wav"
        bgm = self.artifacts.session / "media" / "audio_bgm.wav"
        vocals.write_bytes(b"v")
        bgm.write_bytes(b"b")
        self.artifacts.vocals_file = vocals
        self.artifacts.bgm_file = bgm

    monkeypatch.setattr(PipelineRunner, "_separate", separate)
    database.queue_task_for_continue(task_id)
    PipelineRunner(task_id).run()
    task = database.get_task(task_id)
    assert task["status"] == "paused"
    assert task["stages"][1]["status"] == "succeeded"
    assert task["stages"][2]["status"] == "pending"


def test_pipeline_manual_completes_immediately_after_final_stage(monkeypatch, tmp_path):
    configure_db(monkeypatch, tmp_path)
    task_id = database.create_task(
        "https://www.youtube.com/watch?v=manualfinal",
        task_id="manualfinal",
        execution_mode="manual",
    )
    session = _cached_session(tmp_path)
    final_path = session / "media" / "video_final.mp4"
    visited: list[str] = []

    def make_stage_handler(stage_name: str):
        def handler(self, _task):
            visited.append(stage_name)
            if stage_name == "download":
                self.artifacts.session = session
                self.artifacts.video_file = session / "media" / "video_source.mp4"
                database.update_task(self.task_id, session_path=str(session), title="manual-final")
            elif stage_name == "separate":
                self.artifacts.vocals_file = session / "media" / "audio_vocals.wav"
                self.artifacts.bgm_file = session / "media" / "audio_bgm.wav"
            elif stage_name == "asr":
                self.artifacts.asr_file = session / "metadata" / "asr.json"
            elif stage_name == "asr_fix":
                self.artifacts.asr_fixed_file = session / "metadata" / "asr_fixed.json"
            elif stage_name == "translate":
                self.artifacts.translation_file = session / "metadata" / "translation.zh.json"
            elif stage_name == "split_audio":
                self.artifacts.vocals_dir = session / "segments" / "vocals"
            elif stage_name == "tts":
                self.artifacts.tts_dir = session / "segments" / "tts"
            elif stage_name == "merge_audio":
                self.artifacts.dubbing_file = session / "tmp" / "audio_dubbing.wav"
                self.artifacts.timings_file = session / "metadata" / "timings.json"
            elif stage_name == "merge_video":
                self.artifacts.final_video = final_path

        return handler

    for stage in STAGES:
        monkeypatch.setattr(PipelineRunner, f"_{stage.name}", make_stage_handler(stage.name))

    for index, stage in enumerate(STAGES):
        if index > 0:
            database.queue_task_for_continue(task_id)

        PipelineRunner(task_id).run()
        task = database.get_task(task_id)
        stage_statuses = [entry["status"] for entry in task["stages"]]

        assert stage_statuses[: index + 1] == ["succeeded"] * (index + 1)
        assert stage_statuses[index + 1 :] == ["pending"] * (len(STAGES) - index - 1)
        if index < len(STAGES) - 1:
            assert task["status"] == "paused"
            assert task["current_stage"] == stage.name
            assert task["final_video_path"] is None
            assert task["completed_at"] is None
        else:
            assert task["status"] == "succeeded"
            assert task["current_stage"] == "done"
            assert task["final_video_path"] == str(final_path)
            assert task["completed_at"] is not None

    assert visited == [stage.name for stage in STAGES]
    assert [stage["progress"] for stage in task["stages"]] == [100] * len(STAGES)
    log_content = database.log_path(task_id).read_text(encoding="utf-8")
    assert "Task succeeded" in log_content
    assert "Paused after [merge_video]" not in log_content


def test_pipeline_manual_switch_to_auto_runs_remaining_stages(monkeypatch, tmp_path):
    configure_db(monkeypatch, tmp_path)
    task_id = database.create_task(
        "https://www.youtube.com/watch?v=manual2auto",
        task_id="manual2auto",
        execution_mode="manual",
    )
    final_path = tmp_path / "video_final.mp4"

    def download(self, task):
        session = tmp_path / "session"
        media = session / "media"
        media.mkdir(parents=True)
        video = media / "video_source.mp4"
        video.write_bytes(b"video")
        self.artifacts.session = session
        self.artifacts.video_file = video
        database.update_task(self.task_id, session_path=str(session), title="manual2auto")

    monkeypatch.setattr(PipelineRunner, "_download", download)

    for name in ("_separate", "_asr", "_asr_fix", "_translate", "_split_audio", "_tts", "_merge_audio"):
        monkeypatch.setattr(PipelineRunner, name, _noop_stage)

    def merge_video(self, task):
        self.artifacts.final_video = final_path

    monkeypatch.setattr(PipelineRunner, "_merge_video", merge_video)

    PipelineRunner(task_id).run()
    task = database.get_task(task_id)
    assert task["status"] == "paused"
    assert task["stages"][0]["status"] == "succeeded"

    database.update_task(task_id, execution_mode="auto")
    database.queue_task_for_continue(task_id)
    PipelineRunner(task_id).run()
    task = database.get_task(task_id)
    assert task["status"] == "succeeded"
    assert task["execution_mode"] == "auto"
    assert all(stage["status"] == "succeeded" for stage in task["stages"])


def test_pipeline_uses_uploaded_srt_and_skips_model_stages(monkeypatch, tmp_path):
    configure_db(monkeypatch, tmp_path)
    monkeypatch.setattr(pipeline, "WORKFOLDER", tmp_path)
    task_id = "local-subtitle-task"
    task_url = f"local://upload/{task_id}?direction=en-zh&filename=clip.mp4"
    task_id = database.create_task(task_url, task_id=task_id)
    session = tmp_path / "session"
    for directory in ("media", "metadata", "segments/vocals", "segments/tts", "tmp"):
        (session / directory).mkdir(parents=True, exist_ok=True)
    subtitle_file = tmp_path / "uploaded" / "clip.zh.srt"
    subtitle_file.parent.mkdir(parents=True)
    subtitle_file.write_text(
        "1\n00:00:00,000 --> 00:00:01,000\n你好\n\n"
        "2\n00:00:01,200 --> 00:00:02,000\n世界\n",
        encoding="utf-8",
    )
    (session / "metadata" / "local_info.json").write_text(
        json.dumps({"subtitle_path": str(subtitle_file)}),
        encoding="utf-8",
    )

    def fail_model_call(*args, **kwargs):
        raise AssertionError("model stage should be skipped")

    whisper_module = types.ModuleType("backend.app.adapters.whisper_asr")
    whisper_module.recognize_speech = fail_model_call
    fixer_module = types.ModuleType("backend.app.adapters.asr_sentence_fixer")
    fixer_module.fix_asr_sentences = fail_model_call
    translate_module = types.ModuleType("backend.app.adapters.openai_translate")
    translate_module.translate_asr = fail_model_call
    monkeypatch.setitem(sys.modules, "backend.app.adapters.whisper_asr", whisper_module)
    monkeypatch.setitem(sys.modules, "backend.app.adapters.asr_sentence_fixer", fixer_module)
    monkeypatch.setitem(sys.modules, "backend.app.adapters.openai_translate", translate_module)

    def download(self, task):
        self.artifacts.session = session
        self.artifacts.video_file = session / "media" / "video_source.mp4"
        self.artifacts.video_file.write_bytes(b"mp4")
        database.update_task(self.task_id, session_path=str(session), title="clip")

    def separate(self, task):
        self.artifacts.vocals_file = session / "media" / "audio_vocals.wav"
        self.artifacts.bgm_file = session / "media" / "audio_bgm.wav"
        self.artifacts.vocals_file.write_bytes(b"vocals")
        self.artifacts.bgm_file.write_bytes(b"bgm")

    def split_audio(self, task):
        self.artifacts.vocals_dir = session / "segments" / "vocals"

    def tts(self, task):
        self.artifacts.tts_dir = session / "segments" / "tts"

    def merge_audio(self, task):
        self.artifacts.dubbing_file = session / "tmp" / "audio_dubbing.wav"
        self.artifacts.timings_file = session / "metadata" / "timings.json"
        self.artifacts.dubbing_file.write_bytes(b"dubbing")
        self.artifacts.timings_file.write_text(
            (session / "metadata" / "translation.zh.json").read_text(encoding="utf-8"),
            encoding="utf-8",
        )

    def merge_video(self, task):
        self.artifacts.final_video = session / "media" / "video_final.mp4"
        self.artifacts.final_video.write_bytes(b"mp4")

    monkeypatch.setattr(PipelineRunner, "_download", download)
    monkeypatch.setattr(PipelineRunner, "_separate", separate)
    monkeypatch.setattr(PipelineRunner, "_split_audio", split_audio)
    monkeypatch.setattr(PipelineRunner, "_tts", tts)
    monkeypatch.setattr(PipelineRunner, "_merge_audio", merge_audio)
    monkeypatch.setattr(PipelineRunner, "_merge_video", merge_video)

    PipelineRunner(task_id).run()

    task = database.get_task(task_id)
    translation_file = session / "metadata" / "translation.zh.json"
    translation = json.loads(translation_file.read_text(encoding="utf-8"))["translation"]
    log_content = database.log_path(task_id).read_text(encoding="utf-8")
    assert task["status"] == "succeeded"
    assert [item["dst"] for item in translation] == ["你好", "世界"]
    assert "skipped Whisper" in log_content
    assert "skipped sentence splitting" in log_content
    assert "skipped OpenAI translation" in log_content
