import subprocess
import time
import json
import os
# from bilibili_toolman.bilisession.web import BiliSession
# from bilibili_toolman.bilisession.common.submission import Submission
from dotenv import load_dotenv
from loguru import logger
# Load environment variables

import asyncio
import logging
from bilibili_api import Credential
from bilibili_api import video_uploader
logger = logging.getLogger(__name__)
if not logger.handlers:
    logging.basicConfig(level=logging.INFO, format='%(asctime)s | %(levelname)s | %(message)s')


load_dotenv()


# bilibili_toolman已停止维护, api不再可用, 改用 bilibili-api-python
# def bili_login():

#     SESSDATA = os.getenv('BILI_SESSDATA')
#     BILI_JCT = os.getenv('BILI_BILI_JCT')
#     try:
#         session = BiliSession(f'SESSDATA={SESSDATA};bili_jct={BILI_JCT}')
#         logger.info(f"bilibili登陆成功。")
#         return session
#     except Exception as e:
#         logger.error(e)
#         raise Exception('bilibili登陆失败，请更换SESSDATA和bili_jct。')
# def upload_video(folder):
#     submission_result_path = os.path.join(folder, 'bilibili.json')
#     if os.path.exists(submission_result_path):
#         with open(submission_result_path, 'r', encoding='utf-8') as f:
#             submission_result = json.load(f)
#         if submission_result['results'][0]['code'] == 0:
#             logger.info('Video already uploaded.')
#             return True
        
#     video_path = os.path.join(folder, 'video.mp4')
#     cover_path = os.path.join(folder, 'video.png')

#     # Load summary data
#     with open(os.path.join(folder, 'summary.json'), 'r', encoding='utf-8') as f:
#         summary = json.load(f)
#     summary['title'] = summary['title'].replace('视频标题：', '').strip()
#     summary['summary'] = summary['summary'].replace(
#         '视频摘要：', '').replace('视频简介：', '').strip()
#     tags = summary.get('tags', [])
#     if not isinstance(tags, list):
#         tags = []
#     title = f'【中配】{summary["title"]} - {summary["author"]}'
#     with open(os.path.join(folder, 'download.info.json'), 'r', encoding='utf-8') as f:
#         data = json.load(f)
#     title_English = data['title']
#     webpage_url = data['webpage_url']
#     description = f'{title_English}\n' + \
#         summary['summary'] + '\n\n项目地址：https://github.com/liuzhao1225/YouDub-webui\nYouDub 是一个开创性的开源工具，旨在将 YouTube 和其他平台上的高质量视频翻译和配音成中文版本。该工具结合了最新的 AI 技术，包括语音识别、大型语言模型翻译，以及 AI 声音克隆技术，提供与原视频相似的中文配音，为中文用户提供卓越的观看体验。'

#     session = bili_login()
#     # time.sleep(5)
    
#     # Submit the submission
#     for retry in range(5):
#         try:
#             # Upload video and get endpoint
#             video_endpoint, _ = session.UploadVideo(video_path)

#             # Create a submission object
#             submission = Submission(
#                 title=title,
#                 desc=description
#             )

#             # Add video to submission
#             submission.videos.append(
#                 Submission(
#                     title=title,
#                     video_endpoint=video_endpoint
#                 )
#             )

#             # Upload and set cover
#             # cover = session.UploadCover(cover_path)
#             submission.cover_url = session.UploadCover(cover_path)

#             # Set additional properties as needed
#             # For example, setting source, tags, and thread
#             # submission.source = 'https://source_url.com'
#             # submission.tags.append('Tag1')
#             # submission.tags.append('Tag2')
#             tags = ['YouDub', summary["author"], 'AI',
#                     'ChatGPT'] + tags + ['中文配音', '科学', '科普', ]
#             for tag in tags[:12]:
#                 if len(tag) > 20:
#                     tag = tag[:20]
#                 submission.tags.append(tag)
#             submission.thread = 201  # 科普 201, 科技
#             # submission.copyright = submission.COPYRIGHT_ORIGINAL
#             submission.copyright = submission.COPYRIGHT_REUPLOAD
#             submission.source = webpage_url
#             response = session.SubmitSubmission(submission, seperate_parts=False)
#             if response['results'][0]['code'] != 0:
#                 logger.error(response)
#                 raise Exception(response)
#             logger.info(f"Submission successful: {response}")
#             with open(os.path.join(folder, 'bilibili.json'), 'w', encoding='utf-8') as f:
#                 json.dump(response, f, ensure_ascii=False, indent=4)
#             return True
#         except Exception as e:
#             logger.error(f"Error submitting:\n{e}")
#             time.sleep(10)
#     raise Exception('上传失败')
# def upload_all_videos_under_folder(folder):
#     for dir, _, files in os.walk(folder):
#         if 'video.mp4' in files:
#             upload_video(dir)
#     return f'All videos under {folder} uploaded.'

async def upload_video_async(folder):
    """
    【已修正】使用 bilibili-api-python 的 video_uploader 模块异步上传视频。
    """
    # 检查是否已上传
    submission_result_path = os.path.join(folder, 'bilibili.json')
    if os.path.exists(submission_result_path):
        with open(submission_result_path, 'r', encoding='utf-8') as f:
            submission_result = json.load(f)
        # 根据文档，成功后返回的字典包含 bvid 和 aid
        if submission_result.get('bvid'):
            logger.info(f'视频 {folder} 已上传过 (bvid: {submission_result["bvid"]})，跳过。')
            return True

    # --- 1. 准备登录凭证 ---
    SESSDATA = os.getenv('BILI_SESSDATA')
    BILI_JCT = os.getenv('BILI_BILI_JCT')
    if not SESSDATA or not BILI_JCT:
        raise Exception('环境变量 BILI_SESSDATA 和 BILI_BILI_JCT 未设置。')
    credential = Credential(sessdata=SESSDATA, bili_jct=BILI_JCT)

    # --- 2. 准备文件路径和稿件信息 ---
    video_path = os.path.join(folder, 'video.mp4')
    cover_path = os.path.join(folder, 'video.png')
    if not os.path.exists(video_path):
        logger.error(f"视频文件不存在: {video_path}")
        return False

    with open(os.path.join(folder, 'summary.json'), 'r', encoding='utf-8') as f:
        summary = json.load(f)
    summary['title'] = summary['title'].replace('视频标题：', '').strip()
    summary['summary'] = summary['summary'].replace('视频摘要：', '').replace('视频简介：', '').strip()
    
    with open(os.path.join(folder, 'download.info.json'), 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    title = f'【中配】{summary["title"]}'
    description = (
        f"原标题：{data['title']}\n"
        f"作者：{summary['author']}\n\n"
        f"链接：{data['webpage_url']}\n\n"
        f"视频发布日期：{data.get('upload_date', '未知')}\n\n"
        f"{summary['summary']}\n\n"
        f"上传日期：{time.strftime('%Y-%m-%d')}\n"
    )
    
    raw_tags = summary.get('tags', [])
    if not isinstance(raw_tags, list): raw_tags = []
    
    tags = [summary["author"], 'AI', ] + raw_tags + ['中文配音']
    final_tags = list(dict.fromkeys([tag[:20] for tag in tags])) # 去重并截断

    # --- 3. 【修正】根据文档创建上传任务 ---
    for retry in range(5):
        try:
            # 3.1 创建分P对象 (VideoUploaderPage)
            # 你的场景是单P视频
            video_page = video_uploader.VideoUploaderPage(
                path=video_path,
                title=title,
                description="" # 分P简介，可留空
            )

            # 1/3概率上传原创
            import random
            if random.randint(1, 3) == 1:
                is_original = True
            else:
                is_original = False
            # 3.2 创建稿件元数据对象 (VideoMeta)
            # 根据文档，copyright=2 (转载) 对应 original=False
            video_meta = video_uploader.VideoMeta(
                tid=201,             # 分区ID, 201 为科技 -> 科普
                title=title,
                original=True,      # 设为 False 表示转载
                source=None,  # 非原创时提供转载来源
                desc=description,
                tags=final_tags[:10],   # 标签，最多10个
                cover=cover_path,    # 封面路径直接在这里传入
                dynamic=f"【视频更新】{title}" # 粉丝动态
            )

            # 3.3 创建上传器对象 (VideoUploader)
            uploader = video_uploader.VideoUploader(
                pages=[video_page],
                meta=video_meta,
                credential=credential
            )

            # (可选) 监听上传事件，打印进度
            @uploader.on("start")
            async def on_start():
                logger.info("上传任务开始")
            
            @uploader.on("progress")
            async def on_progress(page_idx, total_size, finished_size):
                percent = finished_size / total_size * 100
                logger.info(f"分P {page_idx+1} 上传进度: {percent:.2f}%")
                
            @uploader.on("completed")
            async def on_completed(result):
                logger.info(f"上传任务完成: {result}")

            # 3.4 启动上传
            submit_result = await uploader.start()
            
            # 保存成功结果
            with open(submission_result_path, 'w', encoding='utf-8') as f:
                json.dump(submit_result, f, ensure_ascii=False, indent=4)
            return True

        except Exception as e:
            logger.error(f"第 {retry+1}/5 次尝试失败")
            import traceback
            logger.error(traceback.format_exc()) # 打印完整错误堆栈
            await asyncio.sleep(10)

    raise Exception(f'上传视频 {folder} 失败，已重试5次。')

def upload_all_videos_under_folder(folder):
    """
    同步函数，用于启动异步上传任务。
    """
    for dir_path, _, files in os.walk(folder):
        if 'video.mp4' in files:
            logger.info(f"===== 开始处理文件夹: {dir_path} =====")
            try:
                # 使用 asyncio.run 来执行异步函数 (nest_asyncio 会处理冲突)
                asyncio.run(upload_video_async(dir_path))
            except Exception as e:
                logger.error(f"处理文件夹 {dir_path} 时发生致命错误: {e}")
    return f'所有视频处理完毕。'


if __name__ == '__main__':
    import sys
    folder = sys.argv[1]
    output = upload_all_videos_under_folder(
        folder
    )