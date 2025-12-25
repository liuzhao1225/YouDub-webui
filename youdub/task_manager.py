# coding=utf-8
import os
import time
import json
from pathlib import Path
from loguru import logger

TASK_JSON_PATH = "tasks.json"

def ask(prompt, default=None):
    if default is not None:
        prompt = f"{prompt} [{default}]: "
    else:
        prompt = f"{prompt}: "
    value = input(prompt).strip()
    return value if value else default

def _load_tasks():
    if not Path(TASK_JSON_PATH).exists():
        return None
    try:
        with open(TASK_JSON_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        logger.warning(f"open tasks.json error: {e}")
        return None
    
def load_tasks():
    while True:
        tasks = _load_tasks()
        if tasks is not None:
            return tasks
        time.sleep(1)

def _save_tasks(tasks):
    if not Path(TASK_JSON_PATH).exists():
        Path(TASK_JSON_PATH).touch()
    try:
        with open(TASK_JSON_PATH, "w", encoding="utf-8") as f:
            json.dump(tasks, f, ensure_ascii=False, indent=2)
    except Exception as e:
        logger.warning(f"save tasks.json error: {e}")
        return False
    return True

def save_tasks(tasks):
    while not _save_tasks(tasks):
        time.sleep(1)

def save_single_task(task):
    tasks = load_tasks()
    for idx, t in enumerate(tasks):
        if t["url"] == task["url"]:
            tasks[idx] = task
            break
    save_tasks(tasks)

# Remove completed tasks
def remove_completed_tasks():
    # 遍历vedios目录，删除子目录所有已完成任务的视频、音频文件
    for root, dirs, files in os.walk("videos"):
        # logger.info(f"Checking folder: {root}")
        if "video.txt" in files:
            if Path.exists(Path(root) / "video.mp4"):
                os.remove(Path(root) / "video.mp4")
            if Path.exists(Path(root) / "video.png"):
                os.remove(Path(root) / "video.png")
            if Path.exists(Path(root) / "download.mp4"):
                os.remove(Path(root) / "download.mp4")
            if Path.exists(Path(root) / "audio.wav"):
                os.remove(Path(root) / "audio.wav")
            if Path.exists(Path(root) / "audio_vocals.wav"):
                os.remove(Path(root) / "audio_vocals.wav")
            if Path.exists(Path(root) / "audio_combined.wav"):
                os.remove(Path(root) / "audio_combined.wav")
            if Path.exists(Path(root) / "audio_instruments.wav"):
                os.remove(Path(root) / "audio_instruments.wav")
            if Path.exists(Path(root) / "audio_tts.wav"):
                os.remove(Path(root) / "audio_tts.wav")
            if Path.exists(Path(root) / "transcript.json"):
                os.remove(Path(root) / "transcript.json")
            if Path.exists(Path(root) / "translation.json"):
                os.remove(Path(root) / "translation.json")
            if Path.exists(Path(root) / "subtitles.srt"):
                os.remove(Path(root) / "subtitles.srt")
            speaker_folder = Path(root) / "SPEAKER"
            if speaker_folder.exists():
                for speaker_file in speaker_folder.glob("*.wav"):
                    os.remove(speaker_file)
                os.rmdir(speaker_folder)
            wavs_folder = Path(root) / "wavs"
            if wavs_folder.exists():
                for wav_file in wavs_folder.glob("*.wav"):
                    os.remove(wav_file)
                os.rmdir(wavs_folder)
        
    

# Reset failed tasks
def reset_failed_tasks():
    task_nubmer = ask("Enter task number to reset (or 'all' to reset all failed tasks)", "all")
    tasks = load_tasks()
    if task_nubmer.lower() == "all":
        for task in tasks:
            if task["status"] == "failed":
                task["status"] = "pending"
                task["step"] = 0
    else:
        try:
            task_index = int(task_nubmer) - 1
            if 0 <= task_index < len(tasks):
                task = tasks[task_index]
                if task["status"] == "failed":
                    task["status"] = "pending"
                    task["step"] = 0
                else:
                    print(f"Task {task_nubmer} is not in failed status.")
            else:
                print(f"Invalid task number: {task_nubmer}")
        except ValueError:
            print(f"Invalid input: {task_nubmer}")
    save_tasks(tasks)

def menu_add_task():
    url = input("Video URL: ")
    # Use default settings
    use_defaults = ask("Use default settings (True/False)", "True").lower() == "true"
    auto_upload_video = ask("Auto upload video (True/False)", "False").lower() == "true"

    if use_defaults:
        task = {
            "url": url,
            "step": 0,
            "status": "pending",
            "folder": "",
            "root_folder": "videos",
            "num_videos": 1,
            "resolution": "1080p",
            "demucs_model": "htdemucs_ft",
            "device": "auto",
            "shifts": 5,
            "whisper_model": "large-v2",
            "whisper_download_root": "models/ASR/whisper",
            "whisper_batch_size": 8,
            "whisper_diarization": True,
            "whisper_min_speakers": None,
            "whisper_max_speakers": None,
            "translation_target_language": "简体中文",
            "subtitles": True,
            "speed_up": 1.05,
            "fps": 30,
            "target_resolution": "1080p",
            "max_retries": 5,
            "auto_upload_video": auto_upload_video
        }
        tasks = load_tasks()
        if any(t["url"] == url for t in tasks):
            print(f"Task already exists: {url}")
            return
        tasks.append(task)
        save_tasks(tasks)
        print(f"Successfully added task: {task['url']}")
        print(json.dumps(task, indent=2, ensure_ascii=False))
        return
    root_folder = ask("Root folder for videos", "videos")
    num_videos = ask("Number of videos to download", "1")
    resolution = ask("Video resolution", "1080p")
    demucs_model = ask("Demucs model", "htdemucs_ft")
    device = ask("Device (auto/cpu/gpu)", "auto")
    shifts = ask("Number of audio shifts", "5")
    whisper_model = ask("Whisper model", "large-v2")
    whisper_download_root = ask("Whisper model download path", "models/ASR/whisper")
    whisper_batch_size = ask("Whisper batch size", "8")
    whisper_diarization = ask("Enable speaker diarization (True/False)", "True").lower() == "true"
    whisper_min_speakers = ask("Minimum number of speakers (leave blank for auto)", "")
    whisper_max_speakers = ask("Maximum number of speakers (leave blank for auto)", "")
    translation_target_language = ask("Translation target language", "Simplified Chinese")
    subtitles = ask("Enable subtitles (True/False)", "True").lower() == "true"
    speed_up = ask("Playback speed", "1.05")
    fps = ask("Target frames per second", "30")
    target_resolution = ask("Target resolution", "1080p")
    max_retries = ask("Maximum number of retries", "5")
    task = {
        "url": url,
        "step": 0,
        "status": "pending",
        "folder": "",
        "root_folder": root_folder,
        "num_videos": int(num_videos),
        "resolution": resolution,
        "demucs_model": demucs_model,
        "device": device,
        "shifts": int(shifts),
        "whisper_model": whisper_model,
        "whisper_download_root": whisper_download_root,
        "whisper_batch_size": int(whisper_batch_size),
        "whisper_diarization": whisper_diarization,
        "whisper_min_speakers": int(whisper_min_speakers) if whisper_min_speakers else None,
        "whisper_max_speakers": int(whisper_max_speakers) if whisper_max_speakers else None,
        "translation_target_language": translation_target_language,
        "subtitles": subtitles,
        "speed_up": float(speed_up),
        "fps": int(fps),
        "target_resolution": target_resolution,
        "max_retries": int(max_retries),
        "auto_upload_video": auto_upload_video
    }
    tasks = load_tasks()
    if any(t["url"] == url for t in tasks):
        print(f"Task already exists: {url}")
        return
    tasks.append(task)
    save_tasks(tasks)

    print(f"Successfully added task: {task['url']}")
    print(json.dumps(task, indent=2, ensure_ascii=False))

if __name__ == "__main__":

    while True:
        print("\n====== YouDub Task Manager ======")
        print("1. Add a new task")
        print("2. View all tasks")
        print("3. Remove completed tasks")
        print("4. Reset failed tasks")
        print("5. Exit")
        print("=================================")
        choice = input("Please choose an option (1-5): ")
        if choice == "1":
            menu_add_task()
        elif choice == "2":
            tasks = load_tasks()
            if not tasks:
                print("No tasks found.")
            else:
                for idx, task in enumerate(tasks, start=1):
                    print(f"\nTask {idx}:")
                    print(json.dumps(task, indent=2, ensure_ascii=False))
        elif choice == "3":
            remove_completed_tasks()
            print("Completed tasks removed.")
        elif choice == "4":
            reset_failed_tasks()
            print("Failed tasks reset.")
        elif choice == "5":
            print("Exiting the task manager...")
            break
        else:
            print("Invalid choice. Please try again.")
    # tasks = load_tasks()
    # save_single_task(tasks[0])