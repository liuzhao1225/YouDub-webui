import subprocess
import json
import sys
from pathlib import Path

DEMUCS_ENV_PYTHON = Path(r"envdemucs\.venv\Scripts\python.exe")

def run_demucs_in_venv(root_folder: str, model_name: str = "htdemucs_ft", device: str = 'auto', progress: bool = True, shifts: int = 5):

    cmd = [
        str(DEMUCS_ENV_PYTHON),
        "-m",
        "envdemucs.step010_demucs_vr",  
        root_folder,
        model_name,
        device,
        str(progress),
        str(shifts)
    ]

    result = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )

    if result.returncode != 0:
        raise Exception(f"Demucs process failed: {result.stderr}")



    
if __name__ == "__main__":
    folder = r"E:\webui\YouDub-webui\videos"
    run_demucs_in_venv(folder, shifts = 0)

