import subprocess
import json
import sys
from pathlib import Path

TTS_ENV_PYTHON = Path(r".venv\Scripts\python.exe")

def run_tts_in_venv(root_folder: str):

    cmd = [
        str(TTS_ENV_PYTHON),
        "-m",
        "youdub.step040_tts",  
        root_folder, 
    ]

    result = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )

    if result.returncode != 0:
        raise Exception(f"TTS process failed: {result.stderr}")
    # check audio_vocals.wav
    if Path.exists(Path(root_folder) / "audio_tts.wav") is False:
        raise Exception(f"TTS process failed: audio_tts.wav not found")

    
if __name__ == "__main__":
    folder = r"E:\webui\YouDub-webui\videos"
    run_tts_in_venv(folder)