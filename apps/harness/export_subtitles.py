"""Reuse YouDub's transcript contract and SRT writer; no translation call."""
import sys
from pathlib import Path
from backend.app.v1.segments import Transcript
from backend.app.v1.export import _write_srt

transcript = Transcript.model_validate_json(Path(sys.argv[1]).read_bytes())
duration_ms = int(sys.argv[3])
if any(segment.end_ms > duration_ms for segment in transcript.segments):
    raise ValueError("Subtitle timestamp exceeds the video duration")
_write_srt(Path(sys.argv[2]), [(segment, segment.text) for segment in transcript.segments], translated=False)
