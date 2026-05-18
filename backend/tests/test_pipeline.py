from __future__ import annotations

from pathlib import Path

from backend.app import database
from backend.app.pipeline import PipelineRunner


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
    assert stages["translate"]["status"] == "pending"
    assert task["error_message"] == "asr exploded"

