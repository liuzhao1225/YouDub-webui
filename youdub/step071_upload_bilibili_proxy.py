import subprocess
import json
import sys
from pathlib import Path

UPLOAD_BILIBILI_ENV_PYTHON = Path(r".venv\Scripts\python.exe")

def run_upload_bilibili_in_venv(root_folder: str):

    cmd = [
        str(UPLOAD_BILIBILI_ENV_PYTHON),
        "-m",
        "youdub.step070_upload_bilibili",  
        root_folder, 
    ]

    result = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )

    if result.returncode != 0:
        raise Exception(f"Upload process failed: {result.stderr}")
    # check audio_vocals.wav
    if Path.exists(Path(root_folder) / "bilibili.json") is False:
        raise Exception(f"Upload process failed: bilibili.json not found")

    
if __name__ == "__main__":
    folder = r"E:\webui\YouDub-webui\videos"
    run_upload_bilibili_in_venv(folder)