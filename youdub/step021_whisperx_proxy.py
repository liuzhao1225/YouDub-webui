import subprocess
import json
import sys
from pathlib import Path

WHISPERX_ENV_PYTHON = Path(r".venv\Scripts\python.exe")

def run_whisperx_in_venv(root_folder: str, model_name: str = 'large', download_root='models/ASR/whisper', device='auto', batch_size=8, diarization=True, min_speakers=None, max_speakers=None):

    cmd = [
        str(WHISPERX_ENV_PYTHON),
        "-m",
        "youdub.step020_whisperx",  
        root_folder,
        model_name,
        download_root,
        device,
        str(batch_size),
        str(diarization),
        str(min_speakers) if min_speakers is not None else 'None',
        str(max_speakers) if max_speakers is not None else 'None'
    ]

    result = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )

    if result.returncode != 0:
        raise Exception(f"WhisperX process failed: {result.stderr}")
    if Path.exists(Path(root_folder) / "transcript.json") is False:
        raise Exception(f"WhisperX process failed: transcript.json not found")



    
if __name__ == "__main__":
    folder = r"E:\webui\YouDub-webui\videos"
    run_whisperx_in_venv(folder, model_name='large', download_root='models/ASR/whisper', device='auto', batch_size=8, diarization=True, min_speakers=None, max_speakers=None)

