import json
import os
import time
from loguru import logger
from .step000_video_downloader import get_info_list_from_url, download_single_video, get_target_folder
from .step010_demucs_vr import run_demucs_in_venv
from .step020_whisperx import transcribe_all_audio_under_folder
from .step030_translation import translate_all_transcript_under_folder
from .step040_tts import generate_all_wavs_under_folder
from .step050_synthesize_video import synthesize_all_video_under_folder
from .step060_genrate_info import generate_all_info_under_folder
from .step070_upload_bilibili import upload_all_videos_under_folder
from .config_manager import Config
import re





def process_video(info, root_folder, resolution, demucs_model, device, shifts, whisper_model, whisper_download_root, whisper_batch_size, whisper_diarization, whisper_min_speakers, whisper_max_speakers, translation_target_language, subtitles, speed_up, fps, target_resolution, max_retries, auto_upload_video):
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

            logger.info(f'Process video in {folder}')
            run_demucs_in_venv(
                folder, model_name=demucs_model, device=device, progress=True, shifts=shifts)
            logger.info(f'Finished demucs for video in {folder}')
            transcribe_all_audio_under_folder(
                folder, model_name=whisper_model, download_root=whisper_download_root, device=device, batch_size=whisper_batch_size, diarization=whisper_diarization, 
                min_speakers=whisper_min_speakers,
                max_speakers=whisper_max_speakers)
            logger.info(f'Finished whisper for video in {folder}')
            translate_all_transcript_under_folder(
                folder, target_language=translation_target_language
            )
            logger.info(f'Finished translation for video in {folder}')
            generate_all_wavs_under_folder(folder)
            logger.info(f'Finished TTS for video in {folder}')
            synthesize_all_video_under_folder(folder, subtitles=subtitles, speed_up=speed_up, fps=fps, resolution=target_resolution)
            logger.info(f'Finished video synthesis for video in {folder}')
            generate_all_info_under_folder(folder)
            logger.info(f'Finished info generation for video in {folder}')
            if auto_upload_video:
                time.sleep(3)
                upload_all_videos_under_folder(folder)
                logger.info(f'Finished uploading video in {folder}')
            return True
        except Exception as e:
            logger.error(f'Error processing video {info["title"]}: {e}')
    return False


def _do_everything(root_folder, url, num_videos=5, resolution='1080p', demucs_model='htdemucs_ft', device='auto', shifts=5, whisper_model='large', whisper_download_root='models/ASR/whisper', whisper_batch_size=32, whisper_diarization=True, whisper_min_speakers=None, whisper_max_speakers=None, translation_target_language='简体中文', subtitles=True, speed_up=1.05, fps=30, target_resolution='1080p', max_workers=3, max_retries=5, auto_upload_video=True):
    success_list = []
    fail_list = []

    url = url.replace(' ', '').replace('，', '\n').replace(',', '\n')
    urls = [_ for _ in url.split('\n') if _]
    
    for info in get_info_list_from_url(urls, num_videos):
        success = process_video(info, root_folder, resolution, 
                                demucs_model, device, shifts, 
                                whisper_model, whisper_download_root, whisper_batch_size, whisper_diarization, whisper_min_speakers, whisper_max_speakers, 
                                translation_target_language, 
                                subtitles, speed_up, fps, target_resolution, 
                                max_retries, auto_upload_video)
        if success:
            success_list.append(info)
        else:
            fail_list.append(info)

    return f'Success: {len(success_list)}\nFail: {len(fail_list)}'

def do_everything(
    root_folder,
    url='',
    num_videos=1,
    resolution='1080p',
    demucs_model='htdemucs_ft',
    device='auto',
    shifts=5,
    whisper_model='large',
    whisper_download_root='models/ASR/whisper',
    whisper_batch_size=8,
    whisper_diarization=True,
    whisper_min_speakers=None,
    whisper_max_speakers=None,
    translation_target_language='简体中文',
    subtitles=True,
    speed_up=1.05,
    fps=30,
    target_resolution='1080p',
    max_retries=5,
    auto_upload_video=True,
):
    # if not task_queue:
    #     logger.info("Starting single run of do_everything...")
    #     return _do_everything(root_folder, url, num_videos, resolution,demucs_model, device, shifts, 
    #                           whisper_model, whisper_download_root, whisper_batch_size, whisper_diarization, whisper_min_speakers, whisper_max_speakers,
    #                           translation_target_language, force_bytedance, subtitles, speed_up, fps, 
    #                           target_resolution, max_retries, auto_upload_video)
    # while True:
    #     task = get_next_pending_task()
    #     if not task:
    #         logger.info("No task pending. All done! ")
    #         break

    #     url = task["url"]
    #     logger.info(f"Processing task: {url}")

    #     try:
    #         success_list = []
    #         fail_list = []

    #         for info in get_info_list_from_url([url], num_videos):
    #             success = process_video(
    #                 info, root_folder, resolution, demucs_model, device, shifts,
    #                 whisper_model, whisper_download_root, whisper_batch_size,
    #                 whisper_diarization, whisper_min_speakers, whisper_max_speakers,
    #                 translation_target_language, force_bytedance,
    #                 subtitles, speed_up, fps, target_resolution,
    #                 max_retries, auto_upload_video
    #             )
    #             if success:
    #                 success_list.append(info)
    #             else:
    #                 fail_list.append(info)

    #         if fail_list:
    #             update_task(task, "failed")
    #         else:
    #             update_task(task, "success")

    #     except Exception as e:
    #         logger.error(f"Task error: {e}")
    #         update_task(task, "failed")

    # return "All tasks processed."

    cfg = Config(
        root_folder=root_folder,
        url=url,
        num_videos=num_videos,
        resolution=resolution,
        demucs_model=demucs_model,
        device=device,
        shifts=shifts,
        whisper_model=whisper_model,
        whisper_download_root=whisper_download_root,
        whisper_batch_size=whisper_batch_size,
        whisper_diarization=whisper_diarization,
        whisper_min_speakers=whisper_min_speakers,
        whisper_max_speakers=whisper_max_speakers,
        translation_target_language=translation_target_language,
        subtitles=subtitles,
        speed_up=speed_up,
        fps=fps,
        target_resolution=target_resolution,
        max_retries=max_retries,
        auto_upload_video=auto_upload_video
    )

    return _do_everything(root_folder, url, num_videos, resolution, demucs_model, device, shifts,
                        whisper_model, whisper_download_root, whisper_batch_size, whisper_diarization, whisper_min_speakers, whisper_max_speakers,
                        translation_target_language, subtitles, speed_up, fps,
                        target_resolution, max_retries, auto_upload_video)


