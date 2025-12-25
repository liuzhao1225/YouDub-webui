import subprocess
import json
import sys
from pathlib import Path

TRANSLATION_ENV_PYTHON = Path(r".venv\Scripts\python.exe")

def run_translation_in_venv(root_folder: str, target_language: str = '简体中文'):

    cmd = [
        str(TRANSLATION_ENV_PYTHON),
        "-m",
        "youdub.step030_translation",  
        root_folder,
        target_language
    ]

    result = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )

    if result.returncode != 0:
        raise Exception(f"Translation process failed: {result.stderr}")
    if Path.exists(Path(root_folder) / "transcript.json") is False:
        raise Exception(f"Translation process failed: transcript.json not found")



    
if __name__ == "__main__":
    folder = r"E:\webui\YouDub-webui\videos"
    run_translation_in_venv(folder, target_language='简体中文')

