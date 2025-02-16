import os
import re
from datetime import datetime, timedelta

import asyncio

import aiofiles
import yt_dlp
from yt_dlp import DateRange
from yt_dlp import YoutubeDL

from loguru import logger
from yt_dlp.extractor.tiktok import TikTokBaseIE

from app.api.endpoints import download
from crawlers.hybrid.hybrid_crawler import HybridCrawler

HybridCrawler = HybridCrawler()


def sanitize_title(title, max_length=50):
    # 只保留数字、字母、中文字符和空格
    title = re.sub(r'[^\w\u4e00-\u9fff \d_-]', '', title)
    # 将多个空格替换为一个空格
    title = re.sub(r'\s+', ' ', title)
    # 将最后的空格替换为下划线
    title = title.rstrip().replace(' ', '_')
    if len(title) > max_length:
        title = title[:max_length]
    return title


def get_target_folder(info, folder_path):
    # 使用更短的长度限制来为路径的其他部分预留空间
    sanitized_title = sanitize_title(info['title'], max_length=50)
    sanitized_uploader = sanitize_title(info.get('uploader', 'Unknown'), max_length=20)
    upload_date = info.get('upload_date', 'Unknown')
    # if upload_date == 'Unknown':
    #     return None

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
    if info.get("platform", None) == 'douyin':
        return asyncio.run(download_video(info, output_folder))
    else:
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


async def download_video(info, output_folder):
    url = info.get('nwm_video_url_HQ')
    file_path = os.path.join(output_folder, 'download.mp4')
    # 判断文件是否存在，存在就直接返回
    if os.path.exists(file_path):
        return output_folder, 3
    # 获取视频文件
    __headers = await HybridCrawler.DouyinWebCrawler.get_douyin_headers()
    response = await download.fetch_data(url, headers=__headers)
    # 保存文件
    async with aiofiles.open(file_path, 'wb') as out_file:
        await out_file.write(response.content)
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


def get_info_list_from_url(url, num_videos, page_num, download_e,root_folder):
    if isinstance(url, str):
        url = [url]
    ydl_opts = get_ydl_opts()
    ydl_opts['dumpjson'] = True
    if num_videos:
        ydl_opts['playliststart'] = num_videos * (page_num - 1) + 1
        ydl_opts['playlistend'] = num_videos * page_num
    # video_info_list = []
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        for u in url:
            # 添加cookies支持
            if "douyin" in u:
                dy_res = asyncio.run(HybridCrawler.hybrid_parsing_single_video(url=u, minimal=False))
                if dy_res.get('filter_reason', None):
                    yield dy_res
                else:
                    # 在使用TikTokBaseIE之前，需要正确初始化下载器
                    ydl_opts = {
                        'format': 'best',
                        'writeinfojson': True,
                        # 可以根据需要添加其他选项
                    }
                    # 初始化TikTok提取器
                    tikTokBaseIE = TikTokBaseIE(ydl)
                    dy_info_dict =tikTokBaseIE._parse_aweme_video_app(aweme_detail=dy_res)

                    dy_info_dict['platform'] = 'douyin'

                    wm_video_url_HQ = dy_res['video']['play_addr']['url_list'][0]
                    nwm_video_url_HQ = wm_video_url_HQ.replace('playwm', 'play')
                    dy_info_dict['nwm_video_url_HQ'] = nwm_video_url_HQ
                    dy_info_dict['webpage_url'] = u
                    dy_info_dict['upload_date'] = dy_res['create_time']
                    # 添加分类和标签信息
                    categories = []
                    # 从video_tag中提取标签信息
                    if 'video_tag' in dy_res:
                        for tag in dy_res['video_tag']:
                            tag_name = tag.get('tag_name')
                            if tag_name:
                                categories.append(tag_name)

                    # 从text_extra中提取话题标签
                    if 'text_extra' in dy_res:
                        for text in dy_res['text_extra']:
                            if text.get('hashtag_name'):
                                categories.append(text['hashtag_name'])

                    dy_info_dict['categories'] = categories if categories else []
                    dy_info_dict['tags'] = dy_res.get('caption',{})
                    anchor_info = dy_res.get('anchor_info',{})
                    dy_info_dict['anchor_info'] = anchor_info
                    
                    # 从标题中提取信息
                    video_title = dy_info_dict.get('title', '')
                    playlet_title = anchor_info.get("title", None)
                    
                    # 尝试从《》中提取标题
                    title_match = re.search(r'《(.+?)》', video_title) or re.search(r'《(.+?)》', playlet_title)
                    if title_match:
                        extracted_title = title_match.group(1)
                    else:
                        # 如果没有《》，则处理 playlet_title
                        extracted_title = playlet_title
                        # 从环境变量获取替换模式，如果没有则使用默认值
                        replace_patterns = os.getenv('TITLE_REPLACE_PATTERNS').split(',')
                        
                        for pattern in replace_patterns:
                            if pattern:  # 确保不是空字符串
                                extracted_title = extracted_title.replace(pattern.strip(), '').strip()
                    
                    # 更新标题
                    dy_info_dict['title'] = extracted_title if extracted_title else video_title
                    
                    video_title = dy_info_dict.get('title',None)
                    output_folder = get_target_folder(dy_info_dict, root_folder)
                    ydl_opts['outtmpl'] = os.path.join(output_folder, 'download.%(ext)s')
                    ydl = YoutubeDL(ydl_opts)
                    dy_infofn = ydl.prepare_filename(dy_info_dict, 'infojson')
                    ydl._write_info_json('video', dy_info_dict, dy_infofn)
                    download_e.url_type = 1
                    yield dy_info_dict
            else:
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
            result = ydl.extract_info(u, download=True)
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
    url = 'https://www.douyin.com/video/7449317235476221195'
    # url = 'https://www.youtube.com/watch?v=D6NQ1DYZ6Xs'
    folder_path = 'videos'
    # download_from_url(url, folder_path)

    dy_res =asyncio.run(HybridCrawler.hybrid_parsing_single_video(url=url, minimal=False))
    ydl_opts = {
        'format': 'best',
        'writeinfojson': True,
        # 可以根据需要添加其他选项
    }
    ydl = YoutubeDL(ydl_opts)

    # 初始化TikTok提取器
    tikTokBaseIE = TikTokBaseIE(ydl)
    dy_info_dict =tikTokBaseIE._parse_aweme_video_app(aweme_detail=dy_res)
    output_folder = get_target_folder(dy_info_dict, folder_path)
    ydl_opts['outtmpl'] = os.path.join(output_folder, 'download.%(ext)s')
    ydl = YoutubeDL(ydl_opts)
    dy_infofn = ydl.prepare_filename(dy_info_dict, 'infojson')
    dy_info_dict['platform'] = 'douyin'

    uri = dy_info_dict['video']['play_addr']['uri']
    wm_video_url_HQ = dy_info_dict['video']['play_addr']['url_list'][0]
    nwm_video_url_HQ = wm_video_url_HQ.replace('playwm', 'play')
    dy_info_dict['nwm_video_url_HQ'] = nwm_video_url_HQ

    ydl._write_info_json('video', dy_info_dict, dy_infofn)
    # 然后再调用解析方法
    print(dy_info_dict)
    # infos = get_info_list_from_url('https://www.youtube.com/@pharkil/videos', 5, cookies='cookies/cookies.txt')
    # for info in infos:
    #     print(info)
