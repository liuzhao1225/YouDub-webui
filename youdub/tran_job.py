import argparse
from datetime import datetime

import loguru
from apscheduler.schedulers.blocking import BlockingScheduler
from sqlalchemy.testing import db
from util.sql_utils import getdb
from youdub.do_everything import do_everything

loguru.logger.add("error.log", format="{time} {level} {message}", level="ERROR")
db = getdb()


def transport_video():
    root_folder = "your_root_folder"  # 设置根文件夹路径

    # 定义所有参数
    num_videos = 5  # 视频数量
    resolution = '1080p'  # 视频分辨率
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

    transport_jobs = db.fetchall('SELECT id, dwn_url FROM transport_job WHERE state = 0')
    for transport_job in transport_jobs:
        try:
            do_everything(transport_job,root_folder, transport_job['dwn_url'], num_videos, resolution, demucs_model,
                          device, shifts, whisper_model, whisper_download_root,
                          whisper_batch_size, whisper_diarization, whisper_min_speakers,
                          whisper_max_speakers, translation_target_language, force_bytedance,
                          subtitles, speed_up, fps, target_resolution, max_workers,
                          max_retries, auto_upload_video)
        except Exception as e:
            loguru.logger.error(f"处理视频时出错: {transport_job['dwn_url']} - 错误信息: {str(e)}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Script Scheduler")
    parser.add_argument("--one", action="store_true", help="Run the script immediately")
    args = parser.parse_args()
    if args.one:
        transport_video()
    else:
        scheduler = BlockingScheduler()
        now = datetime.now()
        initial_execution_time = datetime.now().replace(hour=now.hour, minute=now.minute, second=now.second,
                                                        microsecond=0)
        scheduler.add_job(transport_video, 'interval', minutes=32, max_instances=1)  # 每30分钟执行一次
        scheduler.start()
