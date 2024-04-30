import json
import os
import time
from loguru import logger
from .step000_video_downloader import get_info_list_from_url, download_single_video, get_target_folder
from .step010_demucs_vr import separate_all_audio_under_folder, init_demucs
from .step020_whisperx import transcribe_all_audio_under_folder, init_whisperx
from .step030_translation import translate_all_transcript_under_folder
from .step040_tts import generate_all_wavs_under_folder
from .step042_tts_xtts import init_TTS
from .step050_synthesize_video import synthesize_all_video_under_folder
from .step060_genrate_info import generate_all_info_under_folder
from .step070_upload_bilibili import upload_all_videos_under_folder
from concurrent.futures import ThreadPoolExecutor, as_completed
import re



def process_video(info, root_folder, resolution, demucs_model, device, shifts, whisper_model, whisper_download_root, whisper_batch_size, whisper_diarization, whisper_min_speakers, whisper_max_speakers, translation_target_language, force_bytedance, subtitles, speed_up, fps, target_resolution, max_retries, auto_upload_video):
    # only work during 21:00-8:00
    local_time = time.localtime()
    
    # while local_time.tm_hour >= 8 and local_time.tm_hour < 21:
    #     logger.info(f'Sleep because it is too early')
    #     time.sleep(600)
    #     local_time = time.localtime()
    
    for retry in range(max_retries):
        try:
            folder = get_target_folder(info, root_folder)
            if folder is None:
                logger.warning(f'Failed to get target folder for video {info["title"]}')
                return False
            
            if os.path.exists(os.path.join(folder, 'bilibili.json')):
                with open(os.path.join(folder, 'bilibili.json'), 'r', encoding='utf-8') as f:
                    bilibili_info = json.load(f)
                if bilibili_info['results'][0]['code'] == 0:
                    logger.info(f'Video already uploaded in {folder}')
                    return True
                
            folder = download_single_video(info, root_folder, resolution)
            if folder is None:
                logger.warning(f'Failed to download video {info["title"]}')
                return True
            # if os.path.exists(folder, 'video.mp4') and os.path.exists(folder, 'video.txt') and os.path.exists(folder, 'video.png'):
            # if os.path.exists(os.path.join(folder, 'video.mp4')) and os.path.exists(os.path.join(folder, 'video.txt')) and os.path.exists(os.path.join(folder, 'video.png')):
            # if auto_upload_video and os.path.exists(os.path.join(folder, 'bilibili.json')):
            #     with open(os.path.join(folder, 'bilibili.json'), 'r', encoding='utf-8') as f:
            #         bilibili_info = json.load(f)
            #     if bilibili_info['results'][0]['code'] == 0:
            #         logger.info(f'Video already uploaded in {folder}')
            #         return True
            logger.info(f'Process video in {folder}')
            separate_all_audio_under_folder(
                folder, model_name=demucs_model, device=device, progress=True, shifts=shifts)
            transcribe_all_audio_under_folder(
                folder, model_name=whisper_model, download_root=whisper_download_root, device=device, batch_size=whisper_batch_size, diarization=whisper_diarization, 
                min_speakers=whisper_min_speakers,
                max_speakers=whisper_max_speakers)
            
            translate_all_transcript_under_folder(
                folder, target_language=translation_target_language
            )
            generate_all_wavs_under_folder(folder, force_bytedance=force_bytedance)
            synthesize_all_video_under_folder(folder, subtitles=subtitles, speed_up=speed_up, fps=fps, resolution=target_resolution)
            generate_all_info_under_folder(folder)
            if auto_upload_video:
                time.sleep(1)
                upload_all_videos_under_folder(folder)
            return True
        except Exception as e:
            logger.error(f'Error processing video {info["title"]}: {e}')
    return False


def do_everything(root_folder, url, num_videos=5, resolution='1080p', demucs_model='htdemucs_ft', device='auto', shifts=5, whisper_model='large', whisper_download_root='models/ASR/whisper', whisper_batch_size=32, whisper_diarization=True, whisper_min_speakers=None, whisper_max_speakers=None, translation_target_language='简体中文', force_bytedance=False, subtitles=True, speed_up=1.05, fps=30, target_resolution='1080p', max_workers=3, max_retries=5, auto_upload_video=True):
    success_list = []
    fail_list = []

    url = url.replace(' ', '').replace('，', '\n').replace(',', '\n')
    urls = [_ for _ in url.split('\n') if _]
    
    # 使用线程池执行任务
    with ThreadPoolExecutor() as executor:
        # Submitting the tasks
        # video_info_future = executor.submit(get_info_list_from_url, urls, num_videos)
        executor.submit(init_demucs)
        executor.submit(init_TTS)
        executor.submit(init_whisperx)

        # Waiting for the get_info_list_from_url task to complete and storing its result
        # video_info_list = video_info_future.result()

    # def process_and_track(info):
    #     success = process_video(info, root_folder, resolution, demucs_model, device, shifts, whisper_model, whisper_download_root, whisper_batch_size,
    #                             whisper_diarization, whisper_min_speakers, whisper_max_speakers, translation_target_language, force_bytedance, subtitles, speed_up, fps, target_resolution, max_retries, auto_upload_video)
    #     return (info, success)

    # with ThreadPoolExecutor(max_workers=max_workers) as executor:
    #     future_to_info = {executor.submit(
    #         process_and_track, info): info for info in video_info_list}
    #     for future in as_completed(future_to_info):
    #         info, success = future.result()
    #         if success:
    #             success_list.append(info)
    #         else:
    #             fail_list.append(info)
    for info in get_info_list_from_url(urls, num_videos):
        success = process_video(info, root_folder, resolution, demucs_model, device, shifts, whisper_model, whisper_download_root, whisper_batch_size,
                                whisper_diarization, whisper_min_speakers, whisper_max_speakers, translation_target_language, force_bytedance, subtitles, speed_up, fps, target_resolution, max_retries, auto_upload_video)
        if success:
            success_list.append(info)
        else:
            fail_list.append(info)

    return f'Success: {len(success_list)}\nFail: {len(fail_list)}'
