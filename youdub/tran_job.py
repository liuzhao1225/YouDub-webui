import argparse
import asyncio
import json
import os
import sys
import threading
import time
import traceback
from datetime import datetime

from dotenv import load_dotenv

from youdub.util.ffmpeg_utils import deduplicate_video
from youdub.util.lock_util import with_timeout_lock
from youdub.util.sql_utils import getdb

# 获取当前文件所在目录的父目录（项目根目录）
root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# 将项目根目录添加到系统路径
sys.path.append(root_dir)
from apscheduler.schedulers.blocking import BlockingScheduler
from loguru import logger
from sqlalchemy.testing import db

from youdub.do_everything import do_everything, up_video
from youdub.step000_video_downloader import download_single_video
from youdub.step030_translation import translate_all_title_under_folder
from youdub.step060_genrate_info import generate_all_info_under_folder
load_dotenv()
db = getdb()

# 获取项目根目录的绝对路径
root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# 构建videos文件夹的绝对路径
root_folder = os.path.join(root_dir, "social_auto_upload", "videos")
resolution = '1080p'  # 视频分辨率


def transport_video():
    # 定义所有参数
    num_videos = 5  # 视频数量
    demucs_model = 'htdemucs_ft'  # Demucs 模型
    device = 'auto'  # 设备类型
    shifts = 5  # 数据处理的 shifts
    whisper_model = 'large'  # Whisper 模型
    whisper_download_root = 'models/ASR/whisper'  # Whisper 模型下载路径
    whisper_batch_size = 32  # Whisper 批处理大小
    whisper_diarization = True  # 是否启用说话人分离
    whisper_min_speakers = None  # 最小说话人数
    whisper_max_speakers = None  # 最大说话人数
    translation_target_language = '简体中文'  # 翻译目标语言
    force_bytedance = False  # 是否强制使用字节跳动
    subtitles = True  # 是否生成字幕
    speed_up = 1.05  # 加速倍数
    fps = 30  # 视频帧率
    target_resolution = '1080p'  # 目标分辨率
    max_workers = 3  # 最大工作线程数
    max_retries = 5  # 最大重试次数
    auto_upload_video = True  # 是否自动上传视频

    transport_jobs = db.fetchall('SELECT * FROM transport_job WHERE state = 0 order by  id desc ')
    for transport_job in transport_jobs:
        try:
            dwn_count = 0
            page_num = 1
            while dwn_count < num_videos:
                now_dwn_count, download_e = do_everything(transport_job, root_folder, transport_job['dwn_url'],
                                              num_videos, page_num,
                                              resolution, demucs_model,
                                              device, shifts, whisper_model, whisper_download_root,
                                              whisper_batch_size, whisper_diarization, whisper_min_speakers,
                                              whisper_max_speakers, translation_target_language,
                                              force_bytedance,
                                              subtitles, speed_up, fps, target_resolution, max_workers,
                                              max_retries, auto_upload_video)
                if download_e.url_type == 1:
                    break
                dwn_count += now_dwn_count
                page_num += 1
        except Exception as e:
            logger.exception(f"处理视频时出错: {transport_job['dwn_url']} - 错误信息: {e}")
            traceback.print_exc()


# 补充处理数据
def replenish_job():
    # 查询符合条件的 transport_job
    jobs_to_replenish = db.fetchall(
        "SELECT  tjd.*,tj.platform,tj.user_id tj_user_id FROM transport_job_des tjd left join transport_job tj on tjd.tj_id = tj.id WHERE tjd.state != 0 and tjd.state !=99 order by id desc ")

    for job in jobs_to_replenish:
        try:
            folder = job['file_path'].replace('\\', '/').replace('\\\\', '/')
            json_file_path = os.path.join(folder, 'download.info.json')
            with open(json_file_path, 'r', encoding='utf-8') as f:
                info = json.load(f)
            # if job['state'] != 4:
            #     db.execute(
            #         "UPDATE `transport_job` SET `state`=%s WHERE `id`=%s",
            #         (1, job['id'])
            #     )
            # 根据不同的状态调用不同的方法
            if job['state'] == 1:
                # 调用处理状态1的方法
                translate_all_title_under_folder(
                    folder, target_language='简体中文',info=info
                )
                # 生成信息文件
                generate_all_info_under_folder(folder)
                db.execute(
                    "UPDATE `transport_job_des` SET `state`=%s, file_path=%s WHERE `id`=%s",
                    (2, folder, job['id'])
                )
            elif job['state'] == 3:
                # 上传视频
                platforms = job['platform'].split(',')
                tj_user_ids = job['tj_user_id'].split(',') if job['tj_user_id'] else None
                tjd_id = job['id']
                all_success = True
                plat_up_count = 0
                for platform in platforms:
                    try:
                        up_sta, up_count = asyncio.run(up_video(folder, platform, tjd_id=tjd_id,tj_user_ids=tj_user_ids,info = info))
                        if not up_sta:
                            all_success = False
                        else:
                            if up_count == 1:
                                plat_up_count += 1
                    except Exception as e:
                        logger.exception(f"上传视频时出错: {tjd_id} - 平台: {platform} - 错误信息:  {traceback.format_exc()}")
                        all_success = False
                if all_success and plat_up_count > 0:
                    db.execute(
                        "UPDATE `transport_job_des` SET `state`=%s WHERE `id`=%s",
                        (0, tjd_id)
                    )
            elif job['state'] == 4:
                threading.Thread(target=dl_err_pass, args=(info, job)).start()
            elif job['state'] == 2:
                # 去重视频
                start_time = time.time()
                deduplicate_video(info, folder)
                end_time = time.time()
                logger.info(f"去重视频处理完成，耗时: {end_time - start_time:.2f} 秒")
                db.execute(
                    "UPDATE `transport_job_des` SET `state`=%s, file_path=%s WHERE `id`=%s",
                    (3, folder, job['id'])
                )
        except Exception as e:
            logger.exception(f"处理补充任务时出错: job_id={job['id']}, file_path={job.get('file_path', 'unknown')}\n"
                           f"错误详情: {str(e)}\n"
                           f"完整堆栈: {traceback.format_exc()}")

def dl_err_pass(info, job):
    try:
        re_dl(info, job)
    except:
        pass


@with_timeout_lock(timeout=1, max_workers=3)
def re_dl(info, job):
    try:
        folder, dw_state = download_single_video(info, root_folder, resolution)
        if dw_state == 1 or dw_state == 3:
            db.execute(
                "UPDATE `transport_job_des` SET `state`=%s, file_path=%s WHERE `id`=%s",
                (1, folder, job['id'])
            )
            db.execute(
                "UPDATE `transport_job` SET `state`=%s WHERE `id`=%s",
                (1, job['tj_id'])
            )
    except Exception as e:
        logger.info(f'有其他下载任务在执行{e}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Script Scheduler")
    parser.add_argument("--one", action="store_true", help="Run the script immediately")
    args = parser.parse_args()
    if args.one:
        transport_video()
    else:
        scheduler = BlockingScheduler()
        now = datetime.now()
        scheduler.add_job(replenish_job, 'interval', minutes=5, max_instances=1, next_run_time=now)
        scheduler.add_job(transport_video, 'interval', minutes=32, max_instances=1, next_run_time=now)
        scheduler.start()
