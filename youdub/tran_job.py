import argparse
import json
import os
import sys
from datetime import datetime

from apscheduler.schedulers.blocking import BlockingScheduler
from loguru import logger
from sqlalchemy.testing import db

from util.sql_utils import getdb
from youdub.do_everything import do_everything, up_video
from youdub.step000_video_downloader import download_single_video
from youdub.step030_translation import translate_all_title_under_folder
from youdub.step060_genrate_info import generate_all_info_under_folder
from youdub.util.ffmpeg_utils import deduplicate_video

print(sys.path)
db = getdb()

root_folder = "../social_auto_upload/videos"  # 设置根文件夹路径
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

    transport_jobs = db.fetchall('SELECT * FROM transport_job WHERE state = 0')
    for transport_job in transport_jobs:
        try:
            dwn_count = 0
            page_num = 1
            while dwn_count < num_videos:
                now_dwn_count, conf_count = do_everything(transport_job, root_folder, transport_job['dwn_url'],
                                                          num_videos, page_num,
                                                          resolution, demucs_model,
                                                          device, shifts, whisper_model, whisper_download_root,
                                                          whisper_batch_size, whisper_diarization, whisper_min_speakers,
                                                          whisper_max_speakers, translation_target_language,
                                                          force_bytedance,
                                                          subtitles, speed_up, fps, target_resolution, max_workers,
                                                          max_retries, auto_upload_video)
                dwn_count += now_dwn_count
                page_num += 1
                if conf_count == 1:
                    db.execute(
                        "UPDATE `transport_job` SET `state`=%s WHERE `id`=%s",
                        (1, transport_job['id'])
                    )
                    break
        except Exception as e:
            logger.error(f"处理视频时出错: {transport_job['dwn_url']} - 错误信息: {str(e)}")


# 补充处理数据
def replenish_job():
    # 查询符合条件的 transport_job
    jobs_to_replenish = db.fetchall(
        "SELECT * FROM transport_job_des WHERE state != 0 and state !=99 order by id desc ")

    for job in jobs_to_replenish:
        try:
            folder = job['file_path'].replace('\\', '/').replace('\\\\', '/')
            json_file_path = os.path.join(folder, 'download.info.json')
            with open(json_file_path, 'r', encoding='utf-8') as f:
                info = json.load(f)
            # 根据不同的状态调用不同的方法
            if job['state'] == 1:
                # 调用处理状态1的方法
                translate_all_title_under_folder(
                    folder, target_language='简体中文'
                )
                # 生成信息文件
                generate_all_info_under_folder(folder)
                db.execute(
                    "UPDATE `transport_job_des` SET `state`=%s, file_path=%s WHERE `id`=%s",
                    (2, folder, job['id'])
                )
            elif job['state'] == 2:
                # 去重视频
                deduplicate_video(info, folder)
                db.execute(
                    "UPDATE `transport_job_des` SET `state`=%s, file_path=%s WHERE `id`=%s",
                    (3, folder, job['id'])
                )
            elif job['state'] == 3:
                # 上传视频
                up_video(folder, job['id'])
            elif job['state'] == 4:
                folder, dw_state = download_single_video(info, root_folder, resolution, 'cookies/cookies.txt', False)
                if dw_state == 1 or dw_state == 3:
                    db.execute(
                        "UPDATE `transport_job_des` SET `state`=%s, file_path=%s WHERE `id`=%s",
                        (1, folder, job['id'])
                    )
            # 可以继续添加其他状态的处理逻辑
        except Exception as e:
            logger.error(f"处理补充任务时出错: {job['id']} - 错误信息: {str(e)}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Script Scheduler")
    parser.add_argument("--one", action="store_true", help="Run the script immediately")
    args = parser.parse_args()
    if args.one:
        transport_video()
    else:
        scheduler = BlockingScheduler()
        now = datetime.now()
        scheduler.add_job(transport_video, 'interval', minutes=32, max_instances=1, next_run_time=now)
        scheduler.add_job(replenish_job, 'interval', minutes=5, max_instances=1, next_run_time=now)
        scheduler.start()
