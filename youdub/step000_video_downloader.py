import os
import re
from datetime import datetime, timedelta

from loguru import logger
import yt_dlp

import re

from yt_dlp import DateRange


def sanitize_title(title):
    # Only keep numbers, letters, Chinese characters, and spaces
    title = re.sub(r'[^\w\u4e00-\u9fff \d_-]', '', title)
    # Replace multiple spaces with a single space
    title = re.sub(r'\s+', ' ', title)
    return title


def get_target_folder(info, folder_path):
    sanitized_title = sanitize_title(info['title'])
    sanitized_uploader = sanitize_title(info.get('uploader', 'Unknown'))
    upload_date = info.get('upload_date', 'Unknown')
    if upload_date == 'Unknown':
        return None

    output_folder = os.path.join(
        folder_path, sanitized_uploader, f'{upload_date} {sanitized_title}')

    return output_folder


def download_single_video(info, folder_path, resolution='480p', cookies=None):
    sanitized_title = sanitize_title(info['title'])
    sanitized_uploader = sanitize_title(info.get('uploader', 'Unknown'))
    upload_date = info.get('upload_date', 'Unknown')
    if upload_date == 'Unknown':
        return None, False

    output_folder = os.path.join(folder_path, sanitized_uploader, f'{upload_date} {sanitized_title}')
    if os.path.exists(os.path.join(output_folder, 'download.mp4')):
        logger.info(f'Video already downloaded in {output_folder}')
        return output_folder, False

    resolution = resolution.replace('p', '')
    # 计算前一天和当天的日期
    today = datetime.now()
    yesterday = today - timedelta(days=2)

    today_str = today.strftime('%Y%m%d')
    yesterday_str = yesterday.strftime('%Y%m%d')

    # 创建日期范围对象
    date_range = DateRange(yesterday_str, yesterday_str)

    ydl_opts = {
        # 'res': '1080',
        # 'format': f'worst',
        'format': f'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        'writeinfojson': True,
        'writethumbnail': True,
        'outtmpl': os.path.join(folder_path, sanitized_uploader, f'{upload_date} {sanitized_title}',
                                'download.%(ext)s'),
        # 'daterange': date_range,
        'ignoreerrors': True
    }

    # 添加cookies支持
    if cookies:
        ydl_opts['cookiefile'] = cookies

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([info['webpage_url']])
    logger.info(f'Video downloaded in {output_folder}')
    return output_folder, True


def download_videos(info_list, folder_path, resolution='1080p', cookies=None):
    for info in info_list:
        download_single_video(info, folder_path, resolution, cookies)


def get_info_list_from_url(url, num_videos, cookies=None):
    if isinstance(url, str):
        url = [url]

    # Download JSON information first
    ydl_opts = {
        'format': 'best',
        'dumpjson': True,

        'ignoreerrors': True
    }
    if num_videos:
        ydl_opts['playlistend'] = num_videos
    # 添加cookies支持
    if cookies:
        ydl_opts['cookiefile'] = cookies

    # video_info_list = []
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        for u in url:
            result = ydl.extract_info(u, download=False)
            if 'entries' in result:
                # Playlist
                # video_info_list.extend(result['entries'])
                for video_info in result['entries']:
                    yield video_info
            else:
                # Single video
                # video_info_list.append(result)
                yield result

    # return video_info_list


def download_from_url(url, folder_path, resolution='1080p', num_videos=5, cookies=None):
    resolution = resolution.replace('p', '')
    if isinstance(url, str):
        url = [url]

    # Download JSON information first
    ydl_opts = {
        'format': 'best',
        'dumpjson': True,
        'dump_single_json': True,
        'ignoreerrors': True
    }
    if num_videos:
        ydl_opts['playlistend']: num_videos
    # 添加cookies支持
    if cookies:
        ydl_opts['cookiefile'] = cookies

    video_info_list = []
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        for u in url:
            result = ydl.extract_info(u, download=False)
            if 'entries' in result:
                # Playlist
                video_info_list.extend(result['entries'])
            else:
                # Single video
                video_info_list.append(result)

    # Now download videos with sanitized titles
    download_videos(video_info_list, folder_path, resolution, cookies)


if __name__ == '__main__':
    # Example usage
    url = 'https://www.youtube.com/watch?v=MU0nObp-Yy0'
    folder_path = 'videos'
    download_from_url(url, folder_path, cookies='cookies/cookies.txt')
