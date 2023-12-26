from loguru import logger
from .step000_video_downloader import get_info_list_from_url, download_single_video
from .step010_demucs_vr import separate_all_audio_under_folder
from .step020_whisperx import transcribe_all_audio_under_folder
from .step030_translation import translate_all_transcript_under_folder
from .step040_tts import generate_all_wavs_under_folder
from .step050_synthesize_video import synthesize_all_video_under_folder
from .step060_genrate_info import generate_all_info_under_folder
from concurrent.futures import ThreadPoolExecutor
import concurrent

def process_video(info, root_folder, resolution, demucs_model, device, shifts, whisper_model, whisper_download_root, whisper_batch_size, whisper_diarization, translation_target_language, force_bytedance, subtitles, speed_up, fps, target_resolution):
    folder = download_single_video(info, root_folder, resolution)
    if folder is None:
        return
    logger.info(f'Downloaded video to {folder}')
    separate_all_audio_under_folder(
        folder, model_name=demucs_model, device=device, progress=True, shifts=shifts)
    transcribe_all_audio_under_folder(
        folder, model_name=whisper_model, download_root=whisper_download_root, device=device, batch_size=whisper_batch_size, diarization=whisper_diarization)
    
    translate_all_transcript_under_folder(
        folder, target_language=translation_target_language
    )
    generate_all_wavs_under_folder(folder, force_bytedance=force_bytedance)
    synthesize_all_video_under_folder(folder, subtitles=subtitles, speed_up=speed_up, fps=fps, resolution=target_resolution)
    generate_all_info_under_folder(folder)


def do_everything(root_folder, url, num_videos=5, resolution='1080p', demucs_model='htdemucs_ft', device='auto', shifts=5, whisper_model='large', whisper_download_root='models/ASR/whisper', whisper_batch_size=32, whisper_diarization=True, translation_target_language='简体中文', force_bytedance=False, subtitles=True, speed_up=1.05, fps=30, target_resolution='1080p', max_workers=2):
    video_info_list = get_info_list_from_url(url, num_videos)
    # Adjust max_workers as needed
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = [executor.submit(process_video, info, root_folder, resolution, demucs_model, device, shifts, whisper_model, whisper_download_root, whisper_batch_size, whisper_diarization, translation_target_language, force_bytedance, subtitles, speed_up, fps, target_resolution) for info in video_info_list]

        for future in concurrent.futures.as_completed(futures):
            # Handle results or exceptions if needed
            pass
    return f'Done everything for {url}'