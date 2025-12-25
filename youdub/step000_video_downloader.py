import os
import re
from loguru import logger
import yt_dlp
import io
import browser_cookie3
import http.cookiejar as cookielib
import re

COOKIE_FILE = "cookies.txt"

def prepare_cookies(input_path="cookies.txt", output_path="cookies.txt"):

    if not os.path.exists(input_path):
        return None
    try:
        with io.open(input_path, "r", encoding="utf-8-sig") as f:
            content = f.read().replace("\r\n", "\n")  # ?? LF
        with io.open(output_path, "w", encoding="utf-8") as f:
            f.write(content)
        return output_path
    except Exception as e:
        return None

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

def download_single_video(info, folder_path, resolution='1080'):
    sanitized_title = sanitize_title(info['title'])
    sanitized_uploader = sanitize_title(info.get('uploader', 'Unknown'))
    upload_date = info.get('upload_date', 'Unknown')
    if upload_date == 'Unknown':
        return None
    
    output_folder = os.path.join(folder_path, sanitized_uploader, f'{upload_date} {sanitized_title}')
    if os.path.exists(os.path.join(output_folder, 'download.mp4')):
        logger.info(f'Video already downloaded in {output_folder}')
        return output_folder
    if os.path.exists(os.path.join(output_folder, 'video.txt')):
        raise Exception(f"Video already finished in {output_folder}")
    
    # resolution = resolution.replace('p', '')
    ydl_opts = {
        # 'res': resolution,
        # 'js_runtimes': {'deno': {'path': r'C:\Users\zzy\AppData\Local\Microsoft\WinGet\Packages\DenoLand.Deno_Microsoft.Winget.Source_8wekyb3d8bbwe'}},
        'format': f'bestvideo[ext=mp4][height<={resolution}]+bestaudio[ext=m4a]/best[ext=mp4]/best',
        'writeinfojson': True,
        'writethumbnail': True,
        'outtmpl': os.path.join(folder_path, sanitized_uploader, f'{upload_date} {sanitized_title}', 'download'),
        'ignoreerrors': True,
        # 'cookiefile': "G:/Projects/YouDub-webui-master/error_check/cookies.txt", 
        'cookiefile': "cookies.txt"
    }

    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            ydl.download([info['webpage_url']])
        logger.info(f'Video downloaded in {output_folder}')
    except Exception as e:
        logger.warning(f"Download failed for {info['webpage_url']}: {e}")

    return output_folder

def download_videos(info_list, folder_path, resolution='1080p'):
    for info in info_list:
        download_single_video(info, folder_path, resolution)

def get_info_list_from_url(url, num_videos):
    prepare_cookies()
    if isinstance(url, str):
        url = [url]

    # Download JSON information first
    ydl_opts = {
        'format': 'best',
        'dumpjson': True,
        'playlistend': num_videos,
        'ignoreerrors': True,
        # 'cookiefile': "G:/Projects/YouDub-webui-master/error_check/cookies.txt", 
        'cookiefile': "cookies.txt"
    }

    video_info_list = []
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        for u in url:
            result = ydl.extract_info(u, download=False)
            if 'entries' in result:
                # Playlist
                video_info_list.extend(result['entries'])
                # for video_info in result['entries']:
                #     yield video_info
            else:
                # Single video
                video_info_list.append(result)
                # yield result    
    return video_info_list

def download_from_url(url, folder_path, resolution='1080p', num_videos=5):
    prepare_cookies()
    resolution = resolution.replace('p', '')
    if isinstance(url, str):
        url = [url]

    # Download JSON information first
    ydl_opts = {
        'format': 'best',
        'dumpjson': True,
        'playlistend': num_videos,
        'ignoreerrors': True,
        # 'cookiefile': "G:/Projects/YouDub-webui-master/error_check/cookies.txt", 
        'cookiefile': "cookies.txt"
    }

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
    url = r'https://www.youtube.com/watch?v=9q_ReKFq-MI'
    folder_path = 'videos'
    download_from_url(url, folder_path, resolution='1080p', num_videos=1)