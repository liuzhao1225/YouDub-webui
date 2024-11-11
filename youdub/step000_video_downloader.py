import os
import re
from datetime import datetime, timedelta

import yt_dlp
from yt_dlp import DateRange

from loguru import logger

from youdub.util.lock_util import with_timeout_lock

from PIL import Image


def sanitize_title(title):
    # 只保留数字、字母、中文字符和空格
    title = re.sub(r'[^\w\u4e00-\u9fff \d_-]', '', title)
    # 将多个空格替换为一个空格
    title = re.sub(r'\s+', ' ', title)
    # 将最后的空格替换为下划线
    title = title.rstrip().replace(' ', '_')
    return title


def get_target_folder(info, folder_path):
    sanitized_title = sanitize_title(info['title'])
    sanitized_uploader = sanitize_title(info.get('uploader', 'Unknown'))
    upload_date = info.get('upload_date', 'Unknown')
    if upload_date == 'Unknown':
        return None

    output_folder = os.path.join(folder_path, sanitized_uploader, f"{info['id']}_{upload_date}_{sanitized_title}")

    return output_folder


# 这个函数用于下载单个视频
# 参数:
# - info: 包含视频信息的字典
# - folder_path: 下载文件夹的路径
# - resolution: 视频分辨率，默认为 '480p'
# - cookies: cookies 文件路径，默认为 None
# - use_archive: 是否使用已下载列表，默认为 True
# 返回值:
# - 下载文件夹的路径
# - 下载状态码，0 表示未下载，1 表示已下载，2 表示下载失败，3下载成功
def download_single_video(info, folder_path, resolution='480p'):
    output_folder = get_target_folder(info, folder_path)
    if output_folder is None:
        return None, 0
    if os.path.exists(os.path.join(output_folder, 'download.mp4')):
        logger.info(f'{info["id"]}视频已下载在 {output_folder}')
        return output_folder, 1

    resolution = resolution.replace('p', '')
    # 计算前一天和当天的日期
    today = datetime.now()
    yesterday = today - timedelta(days=2)

    today_str = today.strftime('%Y%m%d')
    yesterday_str = yesterday.strftime('%Y%m%d')

    # 创建日期范围对象
    date_range = DateRange(yesterday_str, yesterday_str)

    ydl_opts = get_ydl_opts()
    ydl_opts['writeinfojson'] = True
    ydl_opts['writethumbnail'] = True
    ydl_opts['postprocessors'] = [
        #     {
        #     'key': 'EmbedThumbnail',
        #     'already_have_thumbnail': False,
        # },
        # {
        #     'key': 'FFmpegThumbnailsConvertor',
        #     'format': 'jpg',  # 将缩略图转换为 JPG 格式
        # },
        {
            'key': 'FFmpegVideoRemuxer',
            'preferedformat': 'mp4',
        }]
    ydl_opts['outtmpl'] = os.path.join(output_folder, 'download.%(ext)s')
    ydl_opts['concurrent_fragment_downloads'] = 5

    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        error_code = ydl.download([info['webpage_url']])
    if error_code:
        logger.info('下载视频失败，等待下次下载')
        return output_folder, 2
    else:
        logger.info('视频下载成功')
    return output_folder, 3


# 获取下载配置信息
def get_ydl_opts():
    ydl_opts = {
        # 修改格式选择，确保不下载以 'av01' 开头的编码格式的视频
        'format': 'bestvideo[vcodec!^=av01]+bestaudio/best[vcodec!^=av01]',
        # 'format_sort': ['+codec:avc:m4a'],
        'match_filter': duration_filter,  # 添加过滤器
        'ignoreerrors': True,
    }

    # 是否使用已下载列表
    if bool(os.getenv('USE_ARCHIVE')):
        ydl_opts['download_archive'] = f"download/download_archive.txt"
    # 添加cookies支持
    cookies = os.getenv('VIDEO_COOKIES', None)
    if cookies:
        ydl_opts['cookiefile'] = cookies
        # ydl_opts['cookiesfrombrowser'] = ('chrome',)
    # 添加代理
    proxy_url = os.getenv('PROXY_URL', None)
    if proxy_url:
        ydl_opts['proxy'] = proxy_url
    return ydl_opts


def duration_filter(info_dict):
    duration = info_dict.get('duration', 0)
    if duration > 600:  # 600秒等于10分钟
        return f"视频时长超过10分钟: {duration}秒"
    return None


def download_videos(info_list, folder_path, resolution='1080p'):
    for info in info_list:
        download_single_video(info, folder_path, resolution)


def get_info_list_from_url(url, num_videos, page_num, download_e):
    if isinstance(url, str):
        url = [url]
    ydl_opts = get_ydl_opts()
    ydl_opts['dumpjson'] = True
    if num_videos:
        ydl_opts['playliststart'] = num_videos * (page_num - 1) + 1
        ydl_opts['playlistend'] = num_videos * page_num
    # 添加cookies支持

    # video_info_list = []
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        for u in url:
            result = ydl.extract_info(u, download=False)
            if 'entries' in result:
                # Playlist
                # video_info_list.extend(result['entries'])
                for video_info in result['entries']:
                    download_e.url_type = 2
                    yield video_info
            else:
                # Single video
                # video_info_list.append(result)
                download_e.url_type = 1
                yield result

    # return video_info_list


def download_from_url(url, folder_path, resolution='1080p', num_videos=5):
    resolution = resolution.replace('p', '')
    if isinstance(url, str):
        url = [url]

    # Download JSON information first
    ydl_opts = get_ydl_opts()
    ydl_opts['dumpjson'] = True
    if num_videos:
        ydl_opts['playlistend'] = num_videos

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
    download_videos(video_info_list, folder_path, resolution)

if __name__ == '__main__':
    # Example usage
    url = 'https://www.youtube.com/watch?v=_5XPJr5aUgw'
    # url = 'https://www.youtube.com/watch?v=D6NQ1DYZ6Xs'
    folder_path = 'videos'
    download_from_url(url, folder_path)
    # infos = get_info_list_from_url('https://www.youtube.com/@pharkil/videos', 5, cookies='cookies/cookies.txt')
    # for info in infos:
    #     print(info)
