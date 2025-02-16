# 涨粉视频
import glob
import os
import random
import time
import traceback
from pathlib import Path

import asyncio

import loguru
from moviepy.editor import VideoFileClip

from Crawler.service.douyin.logic.common import COMMON_HEADERS
from Crawler.service.douyin.views import search
from Crawler.utils.error_code import ErrorCode
from VidShelfAutomator.check_login import get_user_info_from_filename
from VidShelfAutomator.goods_info import url_type_code_dict
from youdub.util.modify_video_duration import modify_video_duration
from social_auto_upload.uploader.douyin_uploader.main import DouYinVideo
from social_auto_upload.utils.base_social_media import SOCIAL_MEDIA_DOUYIN
from social_auto_upload.utils.files_times import get_title_and_hashtags
from youdub.do_everything import cookie_path
from youdub.util.download_util import fetch_data
from youdub.util.ffmpeg_utils import concat_videos_horizontally, get_random_video
from youdub.util.video_metadata_processor import add_metadata_to_video, VideoType


async def down(videos_dir):
    search_id = None
    offset = 0
    limit = 15

    for _ in range(10):
        search_res = await search('解压视频素材小说推文', offset, limit, search_id)
        if search_res['code'] != ErrorCode.OK.value:
            loguru.logger.error(f'搜索失败：{search_res}')
            return
        search_reply = search_res.get('data', {})
        video_list = search_reply.get('list', [])
        search_id = search_reply['search_id']
        offset += 1
        limit = 10
        print(search_id)
        if not video_list:
            loguru.logger.info('没有更多视频了')
            return
        # 处理视频列表
        for video in video_list:
            try:
                aweme_info = video.get('aweme_info', {})
                video_id = aweme_info.get('aweme_id')
                # 获取视频信息
                video_data = aweme_info.get('video', {})

                # play_addr中的信息
                play_addr = video_data.get('play_addr', {})
                width = play_addr.get('width')
                height = play_addr.get('height')
                if width > height:
                    continue
                # 判断链接类型
                url_type = url_type_code_dict.get(str(aweme_info.get("aweme_type")), 'video')

                if url_type != 'video':
                    continue
                duration_ms = video_data.get('duration', 0)
                duration_sec = round(duration_ms / 1000, 2)
                play_addr = video_data.get('play_addr', {})
                url_list = play_addr.get('url_list', [])

                if url_list and video_id:
                    download_url = url_list[0]
                    os.makedirs(videos_dir, exist_ok=True)
                    video_path = os.path.join(videos_dir, f'{video_id}.mp4')
                    headers_dy = {"cookie": ''}
                    headers_dy.update(COMMON_HEADERS)
                    await fetch_data(url=download_url, headers=headers_dy, file_path=video_path)
                    loguru.logger.info(f'视频下载成功: ID={video_id}, 时长={duration_sec}秒')
            except Exception as e:
                loguru.logger.error(f"下载视频时出错: {str(e)}")
                traceback.print_exc()


def split_video(video_path, split_duration=15):
    """
    将视频分割成指定秒数的片段
    
    Args:
        video_path (str): 视频文件路径
        split_duration (int): 每个片段的时长(秒)
    
    Returns:
        list: 分割后的视频文件路径列表
    """
    try:
        video = VideoFileClip(video_path)
        duration = video.duration
        split_files = []

        # 计算需要分割的片段数
        num_splits = int(duration // split_duration)
        if duration % split_duration > 0:
            num_splits += 1

        # 分割视频
        for i in range(num_splits):
            start_time = i * split_duration
            end_time = min((i + 1) * split_duration, duration)

            # 生成输出文件名
            output_path = video_path.rsplit('.', 1)[0] + f'_part{i + 1}.mp4'

            # 提取片段并保存
            video_segment = video.subclip(start_time, end_time)
            video_segment.write_videofile(output_path,
                                          codec='libx264',
                                          audio_codec='aac')
            split_files.append(output_path)

        video.close()
        return split_files

    except Exception as e:
        loguru.logger.error(f"分割视频时出错: {str(e)}")
        traceback.print_exc()
        return []


def zhangfen(videos_dir, fixed_video_dir, output_dir):
    try:
        cookie_files = glob.glob(f'{cookie_path}/{SOCIAL_MEDIA_DOUYIN}_uploader/*.json')
        for cookie_file in cookie_files:
            try:
                fixed_video_position = random.choice(['left', 'right'])
                user_id, username = get_user_info_from_filename(cookie_file)
                if user_id is None or ( user_id != '70436727108') :
                    continue

                # 从fixed_video_dir目录随机选择一个视频文件
                fixed_video_files = list(Path(fixed_video_dir).glob('*.mp4'))
                if not fixed_video_files:
                    loguru.logger.error(f"在 {fixed_video_dir} 目录下没有找到视频文件")
                    continue
                fixed_video = str(random.choice(fixed_video_files))

                # 确保输出目录存在
                os.makedirs(output_dir, exist_ok=True)

                # 根据配置选择随机视频的位置
                random_video = get_random_video(videos_dir, fixed_video)

                # 生成输出文件名
                output_filename = f"{user_id}_{int(time.time())}.mp4"
                output_path = os.path.join(output_dir, output_filename)
                output_tem = os.path.join(output_dir, f"{user_id}_tem_{int(time.time())}.mp4")
                # 测试水平拼接视频
                concat_videos_horizontally(
                    random_video,
                    fixed_video,
                    fixed_video_position,
                    output_tem
                )

                # add_metadata_to_video(output_tem, output_path, VideoType.XINGTU)
                output_path = output_tem
                modify_video_duration(output_path, 6)
                end_time = time.time()
                processing_time = end_time - start_time
                loguru.logger.info(f"视频处理完成，总耗时: {processing_time:.2f} 秒")
                loguru.logger.info(f"输出路径: {output_path}")
                video_text = os.path.join(videos_dir, 'video.txt')
                title, tags = get_title_and_hashtags(video_text)
                app = DouYinVideo(title, output_path, tags, 0, cookie_file, None)
                asyncio.run(app.main())
                os.remove(random_video)
                os.remove(output_path)
                os.remove(output_tem)
            except:
                pass
    except Exception as e:
        loguru.logger.error(f"处理视频时出错: {str(e)}")
        traceback.print_exc()


if __name__ == '__main__':
    videos_dir = r"E:\IDEA\workspace\YouDub-webui\data\douyin\videos\zf"
    # asyncio.run(down(videos_dir))
    start_time = time.time()
    split_videos = r"E:\IDEA\workspace\YouDub-webui\data\douyin\videos\zf\oEQsBdDE7GhfBHFU1AletI5QQACNqxDgxCeBFC.mp4"
    # split_video(split_videos, 20)

    # 修改为指定固定视频所在的目录
    fixed_video_dir = r"E:\IDEA\workspace\YouDub-webui\data\douyin\videos\zf\zfy"
    output_dir = r"E:\IDEA\workspace\YouDub-webui\data\douyin\videos\zf\final"

    zhangfen(videos_dir, fixed_video_dir, output_dir)
    # modify_video_duration(r'E:\IDEA\workspace\YouDub-webui\youdub\videos\20160519 160519 레이샤 LAYSHA 고은 - Chocolate Cream 신한대축제 직캠 fancam by zam\3.mp4', 1)