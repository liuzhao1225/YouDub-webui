# step_functions.py
import os
import json
from loguru import logger

from .step000_video_downloader import download_from_url, get_target_folder, get_info_list_from_url
from .step010_demucs_vr import run_demucs_in_venv
from .step021_whisperx_proxy import run_whisperx_in_venv
from .step031_translation_proxy import run_translation_in_venv
from .step041_tts_proxy import run_tts_in_venv
from .step051_synthesize_video_proxy import run_synthesize_in_venv
from .step060_genrate_info import generate_all_info_under_folder
from .step071_upload_bilibili_proxy import run_upload_bilibili_in_venv


def step_download(task):
    url = task["url"]
    url = url.replace(' ', '').replace('，', '\n').replace(',', '\n')
    download_from_url(url, task["root_folder"], task["resolution"], task["num_videos"])
    folder = get_target_folder(get_info_list_from_url(url, task["num_videos"])[0], task["root_folder"])
    # check if download successful
    if not os.path.exists(folder) or not os.path.exists(os.path.join(folder, 'download.mp4')):
        raise Exception(f"Download failed for URL: {url}")
    return folder


def step_demucs(task):
    # check if download.mp4 exists
    if not os.path.exists(os.path.join(task["folder"], 'download.mp4')):
        raise Exception(f"download.mp4 not found in folder: {task['folder']}")
    
    folder = task["folder"]
    run_demucs_in_venv(folder, model_name=task["demucs_model"],
                        device=task["device"], progress=True, shifts=task["shifts"])
    
    # check if demucs successful
    if not os.path.exists(os.path.join(folder, 'audio_vocals.wav')):
        raise Exception(f"Demucs failed to produce audio_vocals.wav in folder: {folder}")
    return folder

def step_whisper(task):
    folder = task["folder"]
    run_whisperx_in_venv(
        folder, model_name=task["whisper_model"],
        download_root=task["whisper_download_root"], device=task["device"],
        batch_size=task["whisper_batch_size"],
        diarization=task["whisper_diarization"],
        min_speakers=task["whisper_min_speakers"],
        max_speakers=task["whisper_max_speakers"]
    )
    return folder


def step_translate(task):
    folder = task["folder"]
    run_translation_in_venv(folder, target_language=task["translation_target_language"])
    return folder


def step_tts(task):
    folder = task["folder"]
    run_tts_in_venv(folder)
    return folder


def step_synthesis(task):
    folder = task["folder"]
    run_synthesize_in_venv(
        folder, subtitles=task["subtitles"], speed_up=task["speed_up"],
        fps=task["fps"], resolution=task["target_resolution"]
    )
    return folder


def step_info(task):
    folder = task["folder"]
    generate_all_info_under_folder(folder)
    return folder


def step_upload(task):
    folder = task["folder"]
    if task["auto_upload_video"]:
        run_upload_bilibili_in_venv(folder)
    return folder