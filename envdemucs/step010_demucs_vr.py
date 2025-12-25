import shutil
from demucs.api import Separator
import librosa
import os
from loguru import logger
import time
from .utils import save_wav, normalize_wav
import torch
auto_device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
logger.info(f'Using device: {auto_device}')
separator = None

def init_demucs():
    global separator
    separator = load_model()
    
def load_model(model_name: str = "htdemucs_ft", device: str = 'auto', progress: bool = True, shifts: int=3) -> Separator:
    global separator
    if separator is not None:
        logger.info(f'Demucs model already loaded')
        return
    
    logger.info(f'Loading Demucs model: {model_name}')
    t_start = time.time()
    separator = Separator(model_name, device=auto_device if device=='auto' else device, progress=progress, shifts=shifts)
    t_end = time.time()
    logger.info(f'Demucs model loaded in {t_end - t_start:.2f} seconds')

def reload_model(model_name: str = "htdemucs_ft", device: str = 'auto', progress: bool = True, shifts: int=3) -> Separator:
    global separator
    logger.info(f'Reloading Demucs model: {model_name}')
    t_start = time.time()
    separator = Separator(model_name, device=auto_device if device=='auto' else device, progress=progress, shifts=shifts)
    t_end = time.time()
    logger.info(f'Demucs model reloaded in {t_end - t_start:.2f} seconds')

def unload_model():
    global separator
    if separator is not None:
        del separator
        separator = None
        torch.cuda.empty_cache()
        torch.cuda.ipc_collect()
        logger.info(f'Demucs model unloaded')
    
def separate_audio(folder: str, model_name: str = "htdemucs_ft", device: str = 'auto', progress: bool = True, shifts: int = 3) -> None:
    global separator
    audio_path = os.path.join(folder, 'audio.wav')
    if not os.path.exists(audio_path):
        return
    vocal_output_path = os.path.join(folder, 'audio_vocals.wav')
    instruments_output_path = os.path.join(folder, 'audio_instruments.wav')
    
    if os.path.exists(vocal_output_path) and os.path.exists(instruments_output_path):
        logger.info(f'Audio already separated in {folder}')
        return
    
    logger.info(f'Separating audio from {folder}')

    load_model(model_name, device, progress, shifts)
    t_start = time.time()
    try:
        # if the length of audio is more than 20 minutes, update parameters
        if librosa.get_duration(path=audio_path) > 1200:
            logger.info(f'Long audio detected: {librosa.get_duration(path=audio_path)}, updating Demucs parameters for long audio')
            # reload_model(model_name="mdx_q")
            separator.update_parameter(shifts=0, segment=4, split=True, overlap=0.5)
        origin, separated = separator.separate_audio_file(audio_path)
    except:
        # reload_model(model_name, device, progress, shifts)
                # origin, separated = separator.separate_audio_file(audio_path)
        time.sleep(5)
        logger.error(f'Error separating audio from {folder}')
        raise Exception(f'Error separating audio from {folder}')
    t_end = time.time()
    logger.info(f'Audio separated in {t_end - t_start:.2f} seconds')
    
    vocals = separated['vocals'].numpy().T
    instruments = None
    for k, v in separated.items():
        if k == 'vocals':
            continue
        if instruments is None:
            instruments = v
        else:
            instruments += v
    instruments = instruments.numpy().T
    
    vocal_output_path = os.path.join(folder, 'audio_vocals.wav')
    instruments_output_path = os.path.join(folder, 'audio_instruments.wav')
    
    save_wav(vocals, vocal_output_path, sample_rate=44100)
    logger.info(f'Vocals saved to {vocal_output_path}')
    
    save_wav(instruments, instruments_output_path, sample_rate=44100)
    logger.info(f'Instruments saved to {instruments_output_path}')

    
def extract_audio_from_video(folder: str) -> bool:
    video_path = os.path.join(folder, 'download.mp4')
    if not os.path.exists(video_path):
        return False
    audio_path = os.path.join(folder, 'audio.wav')
    if os.path.exists(audio_path):
        logger.info(f'Audio already extracted in {folder}')
        return True
    logger.info(f'Extracting audio from {folder}')

    os.system(
        f'ffmpeg -loglevel error -i "{video_path}" -vn -acodec pcm_s16le -ar 44100 -ac 2 "{audio_path}"')

    
    time.sleep(1)
    logger.info(f'Audio extracted from {folder}')
    return True
    
def separate_all_audio_under_folder(root_folder: str, model_name: str = "htdemucs_ft", device: str = 'auto', progress: bool = True, shifts: int = 5) -> None:
    global separator
    for subdir, dirs, files in os.walk(root_folder):
        if 'download.mp4' not in files:
            continue
        if 'audio.wav' not in files:
            extract_audio_from_video(subdir)
        if 'audio_vocals.wav' not in files:
            try:
                separate_audio(subdir, model_name, device, progress, shifts)
            except Exception as e:
                unload_model()
                raise e

    logger.info(f'All audio separated under {root_folder}')
    unload_model()
    return f'All audio separated under {root_folder}'
    
if __name__ == '__main__':
    import sys

    folder = sys.argv[1]
    model = sys.argv[2]
    device = sys.argv[3]
    progress_bar = sys.argv[4].lower() == "true"
    shifts = int(sys.argv[5])

    output = separate_all_audio_under_folder(
        folder, model, device, progress_bar, shifts
    )

    print(output)
    
    
