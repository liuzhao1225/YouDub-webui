"""Official operation adapters; each call owns only its supplied workspace."""
from __future__ import annotations

import json
import shutil
from pathlib import Path
from types import SimpleNamespace

from .protocol import WorkerError


class Operation:
    def __init__(self, request: dict, wire):
        self.request, self.wire = request, wire
        self.work = Path(request["workDir"]).resolve()
        self.root = Path(request["taskDir"]).resolve()
        if not self.work.is_relative_to(self.root) or self.work == self.root:
            raise WorkerError("INVALID_WORKSPACE", "Invocation workspace must be inside the task directory.")
        self.work.mkdir(parents=True, exist_ok=True)
        self.inputs = request.get("inputs", {})
        self.artifacts = {}
        self.binding = request.get("binding", {})
        self.options = {**request.get("config", {}), **self.binding.get("options", {}), **request.get("options", {})}

    def option(self, camel, snake=None, default=None):
        return self.options.get(camel, self.options.get(snake or camel, default))

    def path(self, value) -> Path:
        if not isinstance(value, dict) or not isinstance(value.get("path"), str):
            raise WorkerError("INVALID_INPUT", "A file input must have a host-resolved path.")
        path = Path(value["path"]).resolve()
        if not path.is_relative_to(self.root) or not path.is_file() or path.stat().st_size == 0:
            raise WorkerError("INPUT_MISSING", "Input file is missing, empty, or outside the task workspace.")
        return path

    def json_value(self, name):
        value = self.inputs[name]
        return json.loads(self.path(value).read_text()) if isinstance(value, dict) and "path" in value else value

    def json_file(self, name, value=None) -> Path:
        path = self.work / f"{name}.input.json"
        path.write_text(json.dumps(self.json_value(name) if value is None else value, ensure_ascii=False, allow_nan=False))
        return path

    def artifact(self, key, path: Path, schema: str, mime: str, metadata=None):
        path = path.resolve()
        if not path.is_relative_to(self.work) or not path.is_file() or path.stat().st_size == 0:
            raise WorkerError("INVALID_OUTPUT", "Output file must exist inside this invocation workspace.")
        self.artifacts[key] = {"path": path.relative_to(self.work).as_posix(), "mimeType": mime,
                               "schemaId": schema, "metadata": metadata or {}}
        return {"$artifact": key}

    def audio(self, key: str, path: Path):
        from backend.app.v1.tts import _audio_info
        info = _audio_info(path)
        metadata = {"sampleRate": info.samplerate, "channels": info.channels, "sampleCount": info.frames}
        return self.artifact(key, path, "audio/wav/v1", "audio/wav", metadata), metadata

    def context(self, stage: str, files: dict):
        from backend.app.v1.steps import StageContext
        def selection(name, adapter):
            original = self.options.get(name) or {}
            active = {"asr": "asr", "translate": "translation", "tts": "tts",
                      "separate": "separation", "align": "subtitle_alignment"}.get(stage)
            values = {**original}
            if name == active:
                values.update({key: self.binding[key] for key in ("model", "device") if key in self.binding})
            values.setdefault("adapter", adapter)
            values.setdefault("model", None)
            values.setdefault("device", "remote" if name == "translation" else "cpu")
            if name == "asr":
                values["initial_prompt"] = self.option("initialPrompt", "initial_prompt", values.get("initial_prompt"))
            if name == "tts":
                values["voice"] = SimpleNamespace(**self.option("voice", default=values.get("voice") or {"mode": "source_clone"}))
            return SimpleNamespace(**values)
        config = SimpleNamespace(
            source_language=self.option("sourceLanguage", "source_language", "auto"),
            target_language=self.option("targetLanguage", "target_language", "zh"),
            output_mode=self.option("outputMode", "output_mode", "both"),
            keep_background=self.option("keepBackground", "keep_background", False),
            max_completion_tokens=self.option("maxCompletionTokens", "max_completion_tokens", 65535),
            record_raw=True,
            asr=selection("asr", "whisper"), translation=selection("translation", "openai"),
            tts=selection("tts", "voxcpm"), separation=selection("separation", "demucs"),
            subtitle_alignment=selection("subtitle_alignment", "qwen_forced_aligner") if stage == "align" else None,
        )
        return StageContext(task_id=self.request["taskId"], attempt=self.request["attempt"], stage=stage,
                            config=config, input_files=files, work_dir=self.work,
                            connections=self.request.get("credentials", {}), check_cancel=self.wire.check_cancel,
                            set_external_state=self.wire.external_state)

    def execute(self):
        method = {
            "media.prepare/v1": self.prepare, "audio.separate/v1": self.separate,
            "speech.transcribe/v1": self.asr, "text.translate/v1": self.translate,
            "voice.reference/v1": self.reference, "speech.synthesize/v1": self.tts,
            "audio.mix/v1": self.mix, "text.align/v1": self.align,
            "media.export/v1": self.export, "subtitles.import/v1": self.import_subtitles,
        }.get(self.request["operation"])
        if method is None:
            raise WorkerError("UNSUPPORTED_OPERATION", f"Unknown operation: {self.request['operation']}")
        self.wire.check_cancel()
        outputs = method()
        self.wire.check_cancel()
        return {"state": "completed", "artifacts": self.artifacts, "outputs": outputs}

    def prepare(self):
        from backend.app.config import ffmpeg_binary
        from backend.app.v1 import media
        from backend.app.v1.runtime import RUNTIME_LIMITS
        source = self.path(self.inputs["video"])
        info = media.inspect_video(source, RUNTIME_LIMITS, self.wire.check_cancel)
        audio = self.work / "source.wav"
        self.wire.progress(None, "Extracting source audio")
        result = media._run_media([ffmpeg_binary(), "-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-xerror",
                                   "-i", str(source), "-map", "0:a:0", "-vn", "-ar", "44100", "-ac", "2",
                                   "-c:a", "pcm_s16le", str(audio)], check_cancel=self.wire.check_cancel)
        if result.returncode:
            raise WorkerError("INVALID_MEDIA", f"Source audio extraction failed: {result.stderr}")
        audio_ref, _ = self.audio("sourceAudio", audio)
        return {"sourceAudio": audio_ref, "mediaInfo": info}

    def separate(self):
        from backend.app.v1 import separate
        result = separate.run(self.context("separate", {"video": self.path(self.inputs["sourceAudio"])}), self.wire.progress)
        return {key: self.audio(key, path)[0] for key, path in result.output_files.items()}

    def asr(self):
        from backend.app.v1 import asr
        context = self.context("asr", {"source_audio": self.path(self.inputs["audio"]),
                                       "media_info": self.json_file("mediaInfo")})
        result = asr.run(context, self.wire.progress)
        return {"transcript": json.loads(result.output_files["transcript"].read_text()),
                "raw": self.artifact("raw", result.output_files["asr_raw"], "diagnostic/json/v1", "application/json")}

    def translate(self):
        from backend.app.v1 import translate
        result = translate.run(self.context("translate", {"transcript": self.json_file("transcript")}), self.wire.progress)
        output = {"translation": json.loads(result.output_files["translation"].read_text())}
        raw = self.work / "translation_raw"
        for path in sorted(raw.glob("*.json")) if raw.exists() else []:
            self.artifact("raw." + path.stem, path, "diagnostic/json/v1", "application/json")
        return output

    def reference(self):
        from backend.app.v1.segments import Transcript
        from backend.app.v1.tts import prepare_reference_audio
        transcript = Transcript.model_validate(self.json_value("transcript"))
        context = self.context("reference", {"vocals": self.path(self.inputs["audio"])})
        prepared = prepare_reference_audio(context, transcript, self.wire.progress)
        result = []
        for index, (segment_id, value) in enumerate(prepared.items()):
            ref, _ = self.audio(f"reference.{index}", value["path"])
            result.append({"segmentId": segment_id, "audio": ref, "transcript": value["text"]})
        return {"references": result}

    def tts(self):
        from backend.app.v1 import tts
        context = self.context("tts", {"transcript": self.json_file("transcript"), "translation": self.json_file("translation")})
        references = self.inputs.get("references")
        if not isinstance(references, list) or not references:
            raise WorkerError("INVALID_INPUT", "VoxCPM requires explicit prepared references.")
        prepared = {}
        for ref in references:
            segment_id = ref.get("segmentId") if isinstance(ref, dict) else None
            if not isinstance(segment_id, str) or not segment_id.strip():
                raise WorkerError("INVALID_INPUT", "Each voice reference requires a non-empty segmentId.")
            if segment_id in prepared:
                raise WorkerError("INVALID_INPUT", f"Duplicate reference for segment {segment_id}.")
            text = ref.get("transcript")
            if not isinstance(text, str) or not text.strip():
                raise WorkerError("INVALID_INPUT", f"Reference transcript is missing for segment {segment_id}.")
            prepared[segment_id] = {"path": self.path(ref.get("audio")), "text": text}
        result = tts.run(context, self.wire.progress, prepared_references=prepared)
        clips = json.loads(result.output_files["speech_clips"].read_text())["clips"]
        segments = []
        for clip in clips:
            audio, info = self.audio("audio." + clip["segment_id"], self.work / clip["path"])
            segments.append({"id": clip["segment_id"], "audio": audio, **info})
        return {"speechAudio": {"segments": segments}}

    def mix(self):
        from backend.app.v1 import mix
        segments = self.inputs["speechAudio"]["segments"]
        clips = []
        folder = self.work / "input_audio"
        folder.mkdir()
        for index, segment in enumerate(segments):
            path = folder / f"{index:06d}.wav"
            shutil.copyfile(self.path(segment["audio"]), path)
            clips.append({"segment_id": segment["id"], "path": path.relative_to(self.work).as_posix(),
                          "duration_ms": round(segment["sampleCount"] * 1000 / segment["sampleRate"]),
                          "sample_rate_hz": segment["sampleRate"], "channels": segment["channels"]})
        files = {"transcript": self.json_file("transcript"), "media_info": self.json_file("mediaInfo"),
                 "speech_clips": self.json_file("speech_clips", {"clips": clips})}
        if "background" in self.inputs:
            files["background"] = self.path(self.inputs["background"])
        result = mix.run(self.context("mix", files), self.wire.progress)
        adjusted = []
        for index, segment in enumerate(self.json_value("transcript")["segments"]):
            audio, info = self.audio("adjusted." + segment["id"], self.work / "adjusted" / f"{index + 1:04d}.wav")
            adjusted.append({"id": segment["id"], "audio": audio, **info})
        return {"finalAudio": self.audio("finalAudio", result.output_files["mixed_audio"])[0],
                "dubbedTimeline": json.loads(result.output_files["alignment"].read_text()),
                "adjustedSpeech": {"segments": adjusted}}

    def align(self):
        from backend.app.v1 import forced_alignment, export
        from backend.app.v1.segments import Transcript, Translation
        from backend.app.v1.audio_segments import Alignment
        transcript = Transcript.model_validate(self.json_value("transcript"))
        translation = Translation.model_validate(self.json_value("translation"))
        texts = translation.match(transcript)
        timeline = Alignment.model_validate(self.json_value("dubbedTimeline"))
        if [item.segment_id for item in timeline.segments] != [item.id for item in transcript.segments]:
            raise WorkerError("INVALID_INPUT", "Dubbed timeline IDs differ from transcript.")
        adjusted = self.inputs["adjustedSpeech"]["segments"]
        if [item["id"] for item in adjusted] != [item.id for item in transcript.segments]:
            raise WorkerError("INVALID_INPUT", "Adjusted audio IDs differ from transcript.")
        rows = [(segment.model_copy(update={"start_ms": timing.dubbed_start_ms, "end_ms": timing.dubbed_end_ms,
                                           "words": None}), texts[segment.id])
                for segment, timing in zip(transcript.segments, timeline.segments, strict=True)]
        cues = forced_alignment.align(self.context("align", {}), rows, export._display_parts, self.wire.progress,
                                       audio_paths=[self.path(item["audio"]) for item in adjusted])
        raw = self.work / "subtitle_alignment" / "words.json"
        self.artifact("raw", raw, "diagnostic/json/v1", "application/json")
        return {"wordAlignment": [{"start_ms": start, "end_ms": end, "text": text} for start, end, text in cues]}

    def export(self):
        from backend.app.v1 import export
        files = {"video": self.path(self.inputs["video"]), "media_info": self.json_file("mediaInfo"),
                 "transcript": self.json_file("transcript"), "translation": self.json_file("translation")}
        if "finalAudio" in self.inputs:
            files["mixed_audio"] = self.path(self.inputs["finalAudio"])
        if "dubbedTimeline" in self.inputs:
            files["alignment"] = self.json_file("dubbedTimeline")
        cues = self.inputs.get("wordAlignment")
        if cues is not None:
            cues = [(row["start_ms"], row["end_ms"], row["text"]) for row in cues]
        result = export.run(self.context("export", files), self.wire.progress,
                            output_dir=self.work / "output", prepared_cues=cues)
        names = {"source_subtitles": "sourceSubtitles", "translated_subtitles": "translatedSubtitles"}
        outputs = {}
        for name, path in result.output_files.items():
            port = names.get(name, name)
            mime = {"video": "video/mp4", "audio": "audio/wav"}.get(name, "application/x-subrip")
            outputs[port] = self.artifact(port, path, mime + "/v1", mime)
        return outputs

    def import_subtitles(self):
        import re
        from backend.app.v1.segments import Transcript, Translation
        timestamp = re.compile(r"^(\d{2,}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2,}):(\d{2}):(\d{2}),(\d{3})$")
        def parse(name):
            source = self.path(self.inputs[name]).read_text(encoding="utf-8-sig").strip()
            rows = []
            for block in re.split(r"\r?\n\s*\r?\n", source):
                lines = block.splitlines()
                match = timestamp.fullmatch(lines[1]) if len(lines) >= 3 and lines[0].isdigit() else None
                if match is None:
                    raise WorkerError("INVALID_SUBTITLES", f"Invalid SRT cue in {name}.")
                n = [int(value) for value in match.groups()]
                start, end = [(n[i] * 3600 + n[i + 1] * 60 + n[i + 2]) * 1000 + n[i + 3] for i in (0, 4)]
                rows.append({"id": f"segment-{len(rows) + 1:06d}", "start_ms": start, "end_ms": end, "text": "\n".join(lines[2:])})
            return rows
        source, target = parse("sourceSubtitles"), parse("translatedSubtitles")
        if [(s["start_ms"], s["end_ms"]) for s in source] != [(s["start_ms"], s["end_ms"]) for s in target]:
            raise WorkerError("INVALID_SUBTITLES", "Source and translated subtitles must have matching ordered intervals.")
        if any(current["start_ms"] < previous["end_ms"] for previous, current in zip(source, source[1:])):
            raise WorkerError("INVALID_SUBTITLES", "Subtitle intervals overlap or are out of order.")
        transcript = Transcript.model_validate({"detected_language": self.option("sourceLanguage", "source_language", "en"), "segments": source})
        translation = Translation.model_validate({"source_language": transcript.detected_language,
                                                  "target_language": self.option("targetLanguage", "target_language", "zh"),
                                                  "segments": [{"segment_id": row["id"], "text": row["text"]} for row in target]})
        translation.match(transcript)
        return {"transcript": transcript.model_dump(mode="json", exclude_none=True),
                "translation": translation.model_dump(mode="json")}
