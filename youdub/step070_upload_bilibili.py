import subprocess
import time
import json
import os
from bilibili_toolman.bilisession.web import BiliSession
from bilibili_toolman.bilisession.common.submission import Submission
from dotenv import load_dotenv
from loguru import logger
# Load environment variables
load_dotenv()

def bili_login():

    SESSDATA = os.getenv('BILI_SESSDATA')
    BILI_JCT = os.getenv('BILI_BILI_JCT')
    try:
        session = BiliSession(f'SESSDATA={SESSDATA};bili_jct={BILI_JCT}')
        logger.info(f"bilibili登陆成功。")
        return session
    except Exception as e:
        logger.error(e)
        raise Exception('bilibili登陆失败，请更换SESSDATA和bili_jct。')

def upload_video(folder):
    submission_result_path = os.path.join(folder, 'bilibili.json')
    if os.path.exists(submission_result_path):
        with open(submission_result_path, 'r', encoding='utf-8') as f:
            submission_result = json.load(f)
        if submission_result['results'][0]['code'] == 0:
            logger.info('Video already uploaded.')
            return True
        
    video_path = os.path.join(folder, 'video.mp4')
    cover_path = os.path.join(folder, 'video.png')

    # Load summary data
    with open(os.path.join(folder, 'summary.json'), 'r', encoding='utf-8') as f:
        summary = json.load(f)
    summary['title'] = summary['title'].replace('视频标题：', '').strip()
    summary['summary'] = summary['summary'].replace(
        '视频摘要：', '').replace('视频简介：', '').strip()
    tags = summary.get('tags', [])
    if not isinstance(tags, list):
        tags = []
    title = f'【中配】{summary["title"]} - {summary["author"]}'
    with open(os.path.join(folder, 'download.info.json'), 'r', encoding='utf-8') as f:
        data = json.load(f)
    title_English = data['title']
    webpage_url = data['webpage_url']
    description = f'{title_English}\n' + \
        summary['summary'] + '\n\n项目地址：https://github.com/liuzhao1225/YouDub-webui\nYouDub 是一个开创性的开源工具，旨在将 YouTube 和其他平台上的高质量视频翻译和配音成中文版本。该工具结合了最新的 AI 技术，包括语音识别、大型语言模型翻译，以及 AI 声音克隆技术，提供与原视频相似的中文配音，为中文用户提供卓越的观看体验。'

    session = bili_login()
    # time.sleep(5)
    
    # Submit the submission
    for retry in range(5):
        try:
            # Upload video and get endpoint
            video_endpoint, _ = session.UploadVideo(video_path)

            # Create a submission object
            submission = Submission(
                title=title,
                desc=description
            )

            # Add video to submission
            submission.videos.append(
                Submission(
                    title=title,
                    video_endpoint=video_endpoint
                )
            )

            # Upload and set cover
            # cover = session.UploadCover(cover_path)
            submission.cover_url = session.UploadCover(cover_path)

            # Set additional properties as needed
            # For example, setting source, tags, and thread
            # submission.source = 'https://source_url.com'
            # submission.tags.append('Tag1')
            # submission.tags.append('Tag2')
            tags = ['YouDub', summary["author"], 'AI',
                    'ChatGPT'] + tags + ['中文配音', '科学', '科普', ]
            for tag in tags[:12]:
                if len(tag) > 20:
                    tag = tag[:20]
                submission.tags.append(tag)
            submission.thread = 201  # 科普 201, 科技
            # submission.copyright = submission.COPYRIGHT_ORIGINAL
            submission.copyright = submission.COPYRIGHT_REUPLOAD
            submission.source = webpage_url
            response = session.SubmitSubmission(submission, seperate_parts=False)
            if response['results'][0]['code'] != 0:
                logger.error(response)
                raise Exception(response)
            logger.info(f"Submission successful: {response}")
            with open(os.path.join(folder, 'bilibili.json'), 'w', encoding='utf-8') as f:
                json.dump(response, f, ensure_ascii=False, indent=4)
            return True
        except Exception as e:
            logger.error(f"Error submitting:\n{e}")
            time.sleep(10)
    raise Exception('上传失败')

def upload_all_videos_under_folder(folder):
    for dir, _, files in os.walk(folder):
        if 'video.mp4' in files:
            upload_video(dir)
    return f'All videos under {folder} uploaded.'

if __name__ == '__main__':
    
    # Example usage
    # folder = r'F:\YouDub-webui\videos\DigiDigger\20200824 How do non-euclidean games work Bitwise'
    folder = r'videos\The Game Theorists\20210522 Game Theory What Level is Ashs Pikachu Pokemon'
    upload_all_videos_under_folder(folder)