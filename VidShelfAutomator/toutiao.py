import argparse

from apscheduler.schedulers.blocking import BlockingScheduler

from Crawler.service.douyin.logic.search import main
from crawlers.hybrid.hybrid_crawler import HybridCrawler
from social_auto_upload.uploader.toutiao.main import toutiao_setup, TouTiaoVideo
import asyncio
import os
import json
import glob
import time
from datetime import datetime, timedelta
import aiohttp
from PIL import Image
from io import BytesIO
from youdub.do_everything import cookie_path
from youdub.step000_video_downloader import download_video, get_target_folder
from youdub.tran_job import root_folder

# 记录文件路径
cookie_pa = f'{cookie_path}/toutiao_uploader'
DOWNLOAD_RECORD_FILE = "data/douyin/dwn_txt/toutiao.txt"
UPLOAD_RECORD_FILE = f"{cookie_pa}/upload.txt"
MIN_UPLOAD_INTERVAL = 7200  # 2小时 = 7200秒
hybridCrawler = HybridCrawler()
# 从西瓜搬运到头条
def load_downloaded_ids():
    """加载已下载的视频ID"""
    os.makedirs(os.path.dirname(DOWNLOAD_RECORD_FILE), exist_ok=True)
    try:
        with open(DOWNLOAD_RECORD_FILE, 'r', encoding='utf-8') as f:
            return set(line.strip() for line in f)
    except FileNotFoundError:
        return set()

def save_downloaded_id(aweme_id):
    """保存已下载的视频ID"""
    with open(DOWNLOAD_RECORD_FILE, 'a', encoding='utf-8') as f:
        f.write(f"{aweme_id}\n")

def load_upload_records():
    """加载上传记录"""
    try:
        with open(UPLOAD_RECORD_FILE, 'r', encoding='utf-8') as f:
            records = {}
            for line in f:
                parts = line.strip().split(',')
                if len(parts) == 2:
                    records[parts[0]] = float(parts[1])
            return records
    except FileNotFoundError:
        return {}

def save_upload_record(cookie_file, timestamp):
    """保存上传记录"""
    os.makedirs(os.path.dirname(UPLOAD_RECORD_FILE), exist_ok=True)
    records = load_upload_records()
    records[cookie_file] = timestamp
    
    with open(UPLOAD_RECORD_FILE, 'w', encoding='utf-8') as f:
        for cookie, ts in records.items():
            f.write(f"{cookie},{ts}\n")

def get_available_cookie():
    """获取可用的cookie文件"""
    cookie_files = glob.glob(f'{cookie_pa}/*.json')
    if not cookie_files:
        return None
        
    records = load_upload_records()
    current_time = time.time()
    
    # 找到最早可用的cookie文件
    available_cookies = []
    for cookie_file in cookie_files:
        last_upload_time = records.get(cookie_file, 0)
        if current_time - last_upload_time >= MIN_UPLOAD_INTERVAL:
            available_cookies.append((cookie_file, last_upload_time))
    
    if not available_cookies:
        return None
        
    # 按最后上传时间排序，返回最早的
    available_cookies.sort(key=lambda x: x[1])
    return available_cookies[0][0]

def is_horizontal_video(video_info):
    """判断是否为横屏视频"""
    try:
        play_addr = video_info['video']['play_addr']
        width = int(play_addr.get('width', 0))
        height = int(play_addr.get('height', 0))
        return width > height if width and height else False
    except (ValueError, TypeError, KeyError):
        return False

async def get_videos():
    """获取视频列表"""
    result, success = await main()
    if success and result['code'] == 200:
        return result['data']['channelFeed']['Data']
    return []

async def save_video_info(video_file, title, tags):
    """保存视频信息到文本文件"""
    txt_file = os.path.join(video_file, 'download.txt')
    try:
        with open(txt_file, 'w', encoding='utf-8') as f:
            f.write(f"{title}\n")
            # 确保每个标签都以#开头，并用#连接
            formatted_tags = '#' + ' #'.join(tag.strip('#') for tag in tags) if tags else ''
            f.write(formatted_tags)
    except Exception as e:
        print(f"保存视频信息文件失败: {str(e)}")

async def download_cover(url, save_path):
    """下载视频封面"""
    try:
        # 定义支持的图片格式
        SUPPORTED_IMAGE_FORMATS = {'.jpg', '.jpeg', '.png', '.webp', '.jfif', '.pjpeg', '.pjp'}
        
        async with aiohttp.ClientSession() as session:
            async with session.get(url) as response:
                if response.status == 200:
                    # 从Content-Type中获取实际的图片格式
                    content_type = response.headers.get('Content-Type', '')
                    ext = '.jpg'  # 默认使用.jpg
                    
                    if 'image/jpeg' in content_type:
                        ext = '.jpeg'
                    elif 'image/png' in content_type:
                        ext = '.png'
                    elif 'image/webp' in content_type:
                        ext = '.webp'
                    
                    # 更新保存路径以使用正确的扩展名
                    base_path = os.path.splitext(save_path)[0]
                    save_path = f"{base_path}{ext}"
                    
                    # 读取图片数据
                    image_data = await response.read()
                    img = Image.open(BytesIO(image_data))
                    
                    # 检查图片尺寸
                    width, height = img.size
                    if width < 853 or height < 480:
                        # 创建一个黑色背景的新图片
                        new_img = Image.new('RGB', (853, 480), (0, 0, 0))
                        
                        # 计算缩放比例，保持原始比例
                        ratio = min(853/width, 480/height)
                        new_width = int(width * ratio)
                        new_height = int(height * ratio)
                        
                        # 缩放原始图片
                        img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)
                        
                        # 计算居中位置
                        x = (853 - new_width) // 2
                        y = (480 - new_height) // 2
                        
                        # 将原图粘贴到新图片中心
                        new_img.paste(img, (x, y))
                        img = new_img
                    
                    # 保存图片
                    img.save(save_path, quality=95)
                    return True, save_path
    except Exception as e:
        print(f"下载或处理封面失败: {str(e)}")
    return False, None

async def find_existing_video(aweme_id, downloads_dir="downloads"):
    """查找是否存在包含指定aweme_id的视频文件"""
    try:
        for root, _, files in os.walk(downloads_dir):
            for file in files:
                if file.endswith('.mp4') and aweme_id in file:
                    video_path = os.path.join(root, file)
                    # 查找对应的txt文件
                    txt_path = os.path.splitext(video_path)[0] + '.txt'
                    if os.path.exists(txt_path):
                        with open(txt_path, 'r', encoding='utf-8') as f:
                            lines = f.readlines()
                            title = lines[0].strip()
                            tags = []
                            if len(lines) > 1:
                                tag_line = lines[1].strip()
                                tags = [tag.strip('# ') for tag in tag_line.split('#') if tag.strip()]
                        return video_path, title, tags
                    return video_path, None, None
        return None, None, None
    except Exception as e:
        print(f"查找现有视频时出错: {str(e)}")
        return None, None, None

async def process_with_account(cookie_file, videos):
    """使用指定账号处理一个视频"""
    if not videos:
        return False
    
    for video in videos:
        try:
            # 从视频数据中提取必要信息
            aweme_id = video.get('data', {}).get('aweme_id')
            title = video.get('data', {}).get('title')
            
            if not aweme_id or not title:
                print("视频数据不完整，跳过")
                continue
            
            # 检查是否已下载记录
            downloaded_ids = load_downloaded_ids()
            if aweme_id in downloaded_ids:
                print(f"视频 {aweme_id} 已上传过，跳过")
                continue
            
            # 检查是否存在本地视频
            video_file, existing_title, existing_tags = await find_existing_video(aweme_id)
            if video_file:
                print(f"找到已下载的视频: {video_file}")
                if existing_title and existing_tags:
                    title = existing_title
                    tags = existing_tags
                else:
                    tags = []
            else:
                # 构建抖音视频URL
                video_url = f"https://www.douyin.com/video/{aweme_id}"
                
                # 解析视频
                dy_res = await hybridCrawler.hybrid_parsing_single_video(url=video_url, minimal=False)
                if not dy_res:
                    print(f"无法解析视频 {aweme_id}，跳过")
                    continue
                
                # 检查是否为横屏视频
                if not is_horizontal_video(dy_res):
                    print(f"视频 {aweme_id} 不是横屏视频，跳过")
                    continue
                
                # 获取无水印视频URL并构建下载信息
                video_info = dy_res.get('video', {})
                play_addr = video_info.get('play_addr', {})
                url_list = play_addr.get('url_list', [])
                
                if not url_list:
                    print(f"无法获取视频 {aweme_id} 的URL，跳过")
                    continue
                
                wm_video_url_HQ = url_list[0]
                nwm_video_url_HQ = wm_video_url_HQ.replace('playwm', 'play')
                
                # 从aweme_detail中提取所需信息
                download_info = {
                    'nwm_video_url_HQ': nwm_video_url_HQ,
                    'title': dy_res.get('desc', '无标题'),
                    'upload_date': str(dy_res.get('create_time', '')),
                    'id': dy_res.get('aweme_id', ''),
                    'uploader': dy_res.get('author', {}).get('nickname', '未知作者')
                }
                
                # 获取视频文件路径
                video_path = get_target_folder(download_info, root_folder)
                video_file = os.path.join(video_path, 'download.mp4')
                # 确保目标目录存在
                os.makedirs(video_path, exist_ok=True)
                
                # 下载封面
                cover_path = None
                cover_url = video.get('data', {}).get('image_url', None)
                if cover_url:
                    cover_base_path = os.path.join(video_path, 'video_cover')
                    success, downloaded_cover_path = await download_cover(cover_url, cover_base_path)
                    if success:
                        cover_path = downloaded_cover_path
                
                # 下载视频
                try:
                    await download_video(download_info, video_path)
                    if not os.path.exists(video_file):
                        print(f"视频下载失败，文件不存在: {video_file}")
                        continue
                except Exception as e:
                    print(f"下载视频时出错: {str(e)}")
                    continue
                
                # 准备标签
                tags = []
                video_tags = dy_res.get('video_tag', [])
                for tag in video_tags:
                    tag_name = tag.get('tag_name')
                    if tag_name:
                        tags.append(tag_name)

                # 保存视频信息到文本文件
                await save_video_info(video_path, title, tags)
            
            # 在上传前检查文件是否存在
            if not os.path.exists(video_file):
                print(f"视频文件不存在: {video_file}")
                continue
                
            # 头条上传
            await toutiao_setup(cookie_file, handle=True)
            app = TouTiaoVideo(title, video_file, tags, 0, cookie_file,thumbnail_path=None, goods=None)
            up_state, up_msg = await app.main()
            
            if up_state:
                save_upload_record(cookie_file, time.time())
                save_downloaded_id(aweme_id)
                try:
                    os.remove(video_file)
                    # 同时删除信息文件
                    txt_file = f"{os.path.splitext(video_file)[0]}.txt"
                    if os.path.exists(txt_file):
                        os.remove(txt_file)
                except Exception as e:
                    print(f"清理文件失败: {str(e)}")
                print(f"账号 {cookie_file} 成功上传视频 {aweme_id}")
                return True  # 成功处理一个视频
            
        except Exception as e:
            print(f"处理视频时出错: {str(e)}")
            import traceback
            print(f"详细错误信息: {traceback.format_exc()}")
            continue
    
    return False  # 没有成功处理任何视频

async def main_process():
    while True:  # 持续运行，直到没有可用账号或用户中断
        # 获取所有可用账号
        available_accounts = []
        cookie_files = glob.glob(f'{cookie_pa}/*.json')
        records = load_upload_records()
        current_time = time.time()
        
        for cookie_file in cookie_files:
            last_upload_time = records.get(cookie_file, 0)
            if current_time - last_upload_time >= MIN_UPLOAD_INTERVAL:
                available_accounts.append(cookie_file)
        
        if not available_accounts:
            print("没有可用的账号，等待冷却完成...")
            return
            
        # 获取视频列表
        videos = await get_videos()
        if not videos:
            print("没有获取到视频")
            return
        
        # 为每个可用账号处理一个视频
        processed_any = False
        for cookie_file in available_accounts:
            print(f"使用账号 {cookie_file} 处理视频")
            success = await process_with_account(cookie_file, videos)
            
            # 如果处理失败且是因为没有可用视频，则重新获取视频
            if not success:
                videos = await get_videos()
                if videos:  # 如果获取到新视频，重试当前账号
                    print("获取新视频列表，重试当前账号")
                    success = await process_with_account(cookie_file, videos)
            
            if success:
                processed_any = True

        if not processed_any:
            print("所有视频都已处理完毕或无法处理")
            return

def run_auto():
    """定时任务执行函数"""
    try:
        print(f"开始执行定时任务 - {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        asyncio.run(main_process())
    except Exception as e:
        print(f"定时任务执行出错: {str(e)}")
        import traceback
        print(f"详细错误信息: {traceback.format_exc()}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Script Scheduler")
    parser.add_argument("--one", action="store_true", help="Run the script immediately")
    args = parser.parse_args()

    if args.one:
        asyncio.run(main_process())
    else:
        print("启动定时任务调度器...")
        scheduler = BlockingScheduler()
        scheduler.add_job(
            run_auto, 
            'interval', 
            minutes=5, 
            max_instances=1, 
            next_run_time=datetime.now(),
            coalesce=True,  # 如果错过了执行时间，只执行一次
            misfire_grace_time=300  # 允许任务延迟执行的最大秒数
        )
        
        try:
            scheduler.start()
        except (KeyboardInterrupt, SystemExit):
            print("\n定时任务已停止")
