import asyncio
import glob
import json
import os
import random
import threading
import time
from functools import wraps
# from .step040_tts import generate_all_wavs_under_folder
# from .step042_tts_xtts import init_TTS
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime

from loguru import logger

from social_auto_upload.uploader.douyin_uploader.main import DouYinVideo
from social_auto_upload.utils.files_times import get_title_and_hashtags
from util.sql_utils import getdb
from youdub.util.ffmpeg_utils import deduplicate_video
from .step000_video_downloader import get_info_list_from_url, download_single_video, get_target_folder
from .step010_demucs_vr import init_demucs
from .step020_whisperx import init_whisperx
from .step030_translation import translate_all_title_under_folder
from .step060_genrate_info import generate_all_info_under_folder

db = getdb()

# 创建一个全局锁
_upload_lock = threading.Lock()

def with_timeout_lock(timeout=60):
    """
    装饰器：确保同一时间只有一个方法在执行，其他调用需等待
    timeout: 超时时间（秒）
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            start_time = time.time()
            while True:
                # 尝试获取锁，等待1秒
                if _upload_lock.acquire(timeout=1):
                    try:
                        return func(*args, **kwargs)
                    finally:
                        _upload_lock.release()
                
                # 检查是否超时
                if time.time() - start_time > timeout:
                    raise TimeoutError(f"等待执行超时（{timeout}秒）")
                
                # 等待后继续尝试
                time.sleep(1)
        return wrapper
    return decorator

def process_video(info, root_folder, resolution, demucs_model, device, shifts, whisper_model, whisper_download_root,
                  whisper_batch_size, whisper_diarization, whisper_min_speakers, whisper_max_speakers,
                  translation_target_language, force_bytedance, subtitles, speed_up, fps, target_resolution,
                  max_retries, auto_upload_video, cookie_file):
    # only work during 21:00-8:00
    local_time = time.localtime()

    # while local_time.tm_hour >= 8 and local_time.tm_hour < 21:
    #     logger.info(f'Sleep because it is too early')
    #     time.sleep(600)
    #     local_time = time.localtime()
    transport_job = info['transport_job']
    for retry in range(max_retries):
        try:
            folder = get_target_folder(info, root_folder)
            if folder is None:
                logger.info(f'无法获取视频 {info["title"]} 的目标文件夹')
                return False

            # 下载视频
            folder, dw_state = download_single_video(info, root_folder, resolution, cookie_file)
            folder = folder.replace('\\', '/').replace('\\\\', '/')
            if folder is None:
                logger.info(f'下载视频 {info["title"]} 失败')
                return False
            elif dw_state == 2:
                tjd = db.fetchone(f"select * from transport_job_des where video_id='{info['id']}'")
                if tjd:
                    logger.info(f'视频已经处理过：{info["title"]}')
                    return False
                insert_tjd(folder, info, transport_job, 4)
                return True
            elif dw_state == 3 or dw_state == 1:
                tjd = db.fetchone(f"select * from transport_job_des where video_id='{info['id']}'")
                if tjd:
                    logger.info(f'视频已经处理过：{info["title"]}')
                    return False
                # 替换原来的 f-string SQL 语句
                tjd_id = insert_tjd(folder, info, transport_job, 1)
                # 翻译标题
                translate_all_title_under_folder(
                    folder, target_language=translation_target_language
                )
                # 生成信息文件
                generate_all_info_under_folder(folder)
                db.execute(
                    "UPDATE `transport_job_des` SET `state`=%s, file_path=%s WHERE `id`=%s",
                    (2, folder, tjd_id)
                )
                # 去重视频
                deduplicate_video(info, folder)
                db.execute(
                    "UPDATE `transport_job_des` SET `state`=%s, file_path=%s WHERE `id`=%s",
                    (3, folder, tjd_id)
                )
                # 上传视频
                threading.Thread(target=up_video, args=(folder, tjd_id)).start()
                return True
        except Exception as e:
            logger.error(f'处理视频 {info["title"]} 时发生错误：{e}')
    return False


# 新增数据
def insert_tjd(folder, info, transport_job, state):
    sql = """
                INSERT INTO `transport_job_des`
                (`tj_id`, `video_id`, `video_url`, `title`, `remark`, `file_path`, `state`,update_time) 
                VALUES (%s, %s, %s, %s, %s, %s, %s,now())
            """
    args = (
        transport_job['id'],
        info['id'],
        info['webpage_url'],
        info['title'],
        info['description'],
        folder,
        state
    )
    tjd_id = db.execute(sql, args)
    return tjd_id


def do_everything(transport_job, root_folder, url, num_videos=5, page_num=1, resolution='1080p',
                  demucs_model='htdemucs_ft',
                  device='auto', shifts=5, whisper_model='large', whisper_download_root='models/ASR/whisper',
                  whisper_batch_size=32, whisper_diarization=True, whisper_min_speakers=None, whisper_max_speakers=None,
                  translation_target_language='简体中文', force_bytedance=False, subtitles=True, speed_up=1.05, fps=30,
                  target_resolution='1080p', max_workers=3, max_retries=5, auto_upload_video=True):
    success_list = []
    fail_list = []

    url = url.replace(' ', '').replace('，', '\n').replace(',', '\n')
    urls = [_ for _ in url.split('\n') if _]

    dwn_count = 0
    inf_count = 0
    infos = get_info_list_from_url(urls, num_videos, page_num, cookies='cookies/cookies.txt')
    for info in infos:
        inf_count += 1
        try:
            info['transport_job'] = transport_job
            success = process_video(info, root_folder, resolution, demucs_model, device, shifts, whisper_model,
                                    whisper_download_root, whisper_batch_size,
                                    whisper_diarization, whisper_min_speakers, whisper_max_speakers,
                                    translation_target_language, force_bytedance, subtitles, speed_up, fps,
                                    target_resolution, max_retries, auto_upload_video,
                                    cookie_file='cookies/cookies.txt')
            if success:
                success_list.append(info)
                dwn_count += 1
            else:
                fail_list.append(info)
        except Exception as e:
            logger.error(f'处理视频 {info["title"]} 时发生错误：{e}')
            fail_list.append(info)
    return dwn_count, inf_count


# 上传视频
@with_timeout_lock(timeout=60)
def up_video(folder, tjd_id):
    video_text = os.path.join(folder, 'video.txt')
    title, tags = get_title_and_hashtags(video_text)
    video_file = os.path.join(folder, 'download_final.mp4')
    # thumbnail_webp = os.path.join(folder, 'download.webp')
    # thumbnail_path = os.path.join(folder, 'download.jpg')
    # if not os.path.exists(thumbnail_path):
    #     ffmpeg.input(thumbnail_webp).output(thumbnail_path).run()
    # 获取当前日期
    today = datetime.now().strftime('%Y-%m-%d')
    # 遍历 cookies 文件夹
    cookie_files = glob.glob('../social_auto_upload/cookies/douyin_uploader/*.json')
    for cookie_file in cookie_files:
        try:
            user_id = os.path.basename(cookie_file).split('_')[0]
            # 查询该用户当天发布的条数
            sql = """
                            SELECT COUNT(*) as count, max(update_time) as update_time FROM transport_job_des 
                            WHERE user_id = %s AND state = 0 AND DATE(update_time) = %s
                        """
            result = db.fetchone(sql, (user_id, today))
            count = result['count']
            last_update_time = result['update_time']

            # 检查最后更新时间是否在30分钟之前
            if last_update_time:
                time_diff = datetime.now() - last_update_time
                if time_diff.total_seconds() < 1800:  # 1800秒 = 30分钟
                    logger.info(f'{user_id}上次发布距离现在小于30分钟，等会再发布')
                    continue

            # 如果发布条数大于5条，则不再
            if count >= 5:
                logger.info(f'{user_id}已发布5条，明日再发布')
                continue
            # if 'pharkil' in folder and user_id == '57779263751':
            #     continue
            app = DouYinVideo(title, video_file, tags, 0, cookie_file)
            # 使用 asyncio 运行异步方法
            up_state, up_test_msg = asyncio.run(app.main())
            db.execute(
                "UPDATE `transport_job_des` SET `state`=%s, file_path=%s ,user_id = %s,up_test_msg= %s WHERE `id`=%s",
                (0 if up_state else 99, folder, user_id, up_test_msg, tjd_id)
            )
            return
        except Exception as e:
            logger.error(f"处理补充任务发布时出错: {tjd_id} - 错误信息: {str(e)}")
