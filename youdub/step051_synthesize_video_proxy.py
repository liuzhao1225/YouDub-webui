import subprocess
import json
import sys
from pathlib import Path

SYNTHESIZE_ENV_PYTHON = Path(r".venv\Scripts\python.exe")

def run_synthesize_in_venv(root_folder: str, subtitles: bool = True, speed_up: float = 1.05, fps: int = 30, resolution: str = '1080p'):

    cmd = [
        str(SYNTHESIZE_ENV_PYTHON),
        "-m",
        "youdub.step050_synthesize_video",  
        root_folder,
        str(subtitles),
        str(speed_up),
        str(fps),
        resolution
    ]

    result = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True
    )

    if result.returncode != 0:
        raise Exception(f"Synthesize process failed: {result.stderr}")
    if Path.exists(Path(root_folder) / "video.mp4") is False:
        raise Exception(f"Synthesize process failed: video.mp4 not found")



    
if __name__ == "__main__":
    folder = r"E:\webui\YouDub-webui\videos"
    run_synthesize_in_venv(folder, subtitles=True, speed_up=1.05, fps=30, resolution='1080p')

