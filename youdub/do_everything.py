import os
from loguru import logger
from .step000_video_downloader import get_info_list_from_url, download_single_video
from .step010_demucs_vr import separate_all_audio_under_folder, init_demucs
from .step020_whisperx import transcribe_all_audio_under_folder, init_whisperx
from .step030_translation import translate_all_transcript_under_folder
from .step040_tts import generate_all_wavs_under_folder
from .step042_tts_xtts import init_TTS
from .step050_synthesize_video import synthesize_all_video_under_folder
from .step060_genrate_info import generate_all_info_under_folder
from concurrent.futures import ThreadPoolExecutor, as_completed
import concurrent

def process_video(info, root_folder, resolution, demucs_model, device, shifts, whisper_model, whisper_download_root, whisper_batch_size, whisper_diarization, whisper_max_speakers, translation_target_language, force_bytedance, subtitles, speed_up, fps, target_resolution):
    try:
        folder = download_single_video(info, root_folder, resolution)
        if folder is None:
            logger.warning(f'Failed to download video {info["title"]}')
            return
        # if os.path.exists(folder, 'video.mp4') and os.path.exists(folder, 'video.txt') and os.path.exists(folder, 'video.png'):
        if os.path.exists(os.path.join(folder, 'video.mp4')) and os.path.exists(os.path.join(folder, 'video.txt')) and os.path.exists(os.path.join(folder, 'video.png')):
            logger.info(f'Video already processed in {folder}')
            return
        logger.info(f'Process video in {folder}')
        separate_all_audio_under_folder(
            folder, model_name=demucs_model, device=device, progress=True, shifts=shifts)
        transcribe_all_audio_under_folder(
            folder, model_name=whisper_model, download_root=whisper_download_root, device=device, batch_size=whisper_batch_size, diarization=whisper_diarization, max_speakers=whisper_max_speakers)
        
        translate_all_transcript_under_folder(
            folder, target_language=translation_target_language
        )
        generate_all_wavs_under_folder(folder, force_bytedance=force_bytedance)
        synthesize_all_video_under_folder(folder, subtitles=subtitles, speed_up=speed_up, fps=fps, resolution=target_resolution)
        generate_all_info_under_folder(folder)
        return True
    except Exception as e:
        logger.error(f'Error processing video {info["title"]}: {e}')
        return False


def do_everything(root_folder, url, num_videos=5, resolution='1080p', demucs_model='htdemucs_ft', device='auto', shifts=5, whisper_model='large', whisper_download_root='models/ASR/whisper', whisper_batch_size=32, whisper_diarization=True, translation_target_language='简体中文', force_bytedance=False, subtitles=True, speed_up=1.05, fps=30, target_resolution='1080p', max_workers=2, max_retries=5):
    video_info_list = get_info_list_from_url(url, num_videos)
    init_demucs()
    init_TTS()
    init_whisperx()

    retries = {}
    for info in video_info_list:
        retries[info['id']] = 0  # Initialize retry count for each video

    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures_to_info = {executor.submit(process_video, info, root_folder, resolution, demucs_model, device, shifts, whisper_model, whisper_download_root, whisper_batch_size,
                                           whisper_diarization, translation_target_language, force_bytedance, subtitles, speed_up, fps, target_resolution): info for info in video_info_list}

        while futures_to_info:
            for future in as_completed(futures_to_info):
                info = futures_to_info[future]
                success = future.result()

                if not success and retries[info['id']] < max_retries:
                    retries[info['id']] += 1
                    new_future = executor.submit(process_video, info, root_folder, resolution, demucs_model, device, shifts, whisper_model, whisper_download_root,
                                                 whisper_batch_size, whisper_diarization, translation_target_language, force_bytedance, subtitles, speed_up, fps, target_resolution)
                    futures_to_info[new_future] = info
                del futures_to_info[future]

    return f'Done everything for {url}'
