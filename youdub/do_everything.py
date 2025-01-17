import glob
import json
import os
import time
import traceback

# from .step040_tts import generate_all_wavs_under_folder
# from .step042_tts_xtts import init_TTS
from datetime import datetime

from loguru import logger

from social_auto_upload.uploader.douyin_uploader.main import DouYinVideo, douyin_setup
from social_auto_upload.uploader.ks_uploader.main import ks_setup, KSVideo
from social_auto_upload.uploader.tencent_uploader.main import weixin_setup, TencentVideo
from social_auto_upload.uploader.tk_uploader.main_chrome import tiktok_setup, TiktokVideo
from social_auto_upload.uploader.xhs_uploader.main import XHSVideo
from social_auto_upload.utils.base_social_media import SOCIAL_MEDIA_DOUYIN, SOCIAL_MEDIA_TENCENT, SOCIAL_MEDIA_KUAISHOU, \
    SOCIAL_MEDIA_TIKTOK, SOCIAL_MEDIA_XHS
from social_auto_upload.utils.constant import TencentZoneTypes
from social_auto_upload.utils.file_util import get_account_file
from social_auto_upload.utils.files_times import get_title_and_hashtags
from youdub.entity.download_entity import DownloadEntity
from .step000_video_downloader import get_info_list_from_url, download_single_video, get_target_folder
from .step030_translation import translate_all_title_under_folder
from .step060_genrate_info import generate_all_info_under_folder
from .util.ffmpeg_utils import deduplicate_video
from .util.lock_util import with_timeout_lock
from .util.sql_utils import getdb

db = getdb()

# 获取项目根目录的绝对路径
root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# 构建videos文件夹的绝对路径
cookie_path = os.path.join(root_dir, "social_auto_upload", "cookies")


def get_pub_user_config():
    # 从环境变量中获取pub_user配置
    pub_user_config = os.getenv('PUB_USER_CONF', '{}')
    return json.loads(pub_user_config)


# 校验用户是否发布超过配置
def check_user_publish(user_id, platform,tj_user_ids):
    today = datetime.now().strftime('%Y-%m-%d')
    # 查询该用户当天发布的条数
    sql = """
                            SELECT COUNT(*) as count, max(update_time) as update_time FROM transport_job_pub 
                            WHERE user_id = %s AND state = 1 AND DATE(update_time) = %s and platform = %s
                        """
    result = db.fetchone(sql, (user_id, today, platform))
    count = result['count']
    last_update_time = result['update_time']
    pub_count_limit = get_config(user_id, f'{platform}_pub_count')
    pub_interval = int(get_config(user_id, 'pub_interval'))

    # 新增：检查当前时间是否在6点之后
    current_time = datetime.now().time()
    start_time_con = get_config(user_id, 'start_time')
    if current_time < datetime.strptime(start_time_con, "%H:%M").time():
        logger.info(f'{user_id}当前时间早于{start_time_con}点，暂时不允许发布')
        return True

    # 检查最后更新时间是否在30分钟之前
    if last_update_time:
        time_diff = datetime.now() - last_update_time
        if time_diff.total_seconds() < pub_interval:
            logger.info(
                f'{user_id}在{platform}上次发布距离现在{time_diff.total_seconds()}秒，小于{pub_interval}秒，等会再发布')
            return True

    if count >= pub_count_limit:
        logger.info(f'{user_id}在{platform}已发布{pub_count_limit}条，可发布{count}条，明日再发布')
        return True
    if tj_user_ids and user_id not in tj_user_ids:
        logger.info(f"={user_id}不再可发布用户{tj_user_ids}内")
        return False
    return False


def get_config(user_id, key):
    pub_user_config = get_pub_user_config()
    user_config = pub_user_config.get(str(user_id), {})
    base_config = json.loads(os.getenv('PUB_USER_CONF_BASE', '{}'))
    value = user_config.get(key, base_config.get(key))  # 默认值为5
    return value


def process_video(info, root_folder, resolution, demucs_model, device, shifts, whisper_model, whisper_download_root,
                  whisper_batch_size, whisper_diarization, whisper_min_speakers, whisper_max_speakers,
                  translation_target_language, force_bytedance, subtitles, speed_up, fps, target_resolution,
                  max_retries, auto_upload_video):
    # only work during 21:00-8:00
    local_time = time.localtime()

    # while local_time.tm_hour >= 8 and local_time.tm_hour < 21:
    #     logger.info(f'Sleep because it is too early')
    #     time.sleep(600)
    #     local_time = time.localtime()
    transport_job = info['transport_job']
    for retry in range(max_retries):
        try:
            folder = get_target_folder(info, root_folder)
            if folder is None:
                logger.info(f'无法获取视频 {info["title"]} 的目标文件夹')
                return False, 0

            # 下载视频
            folder, dw_state = download_single_video(info, root_folder, resolution)
            folder = folder.replace('\\', '/').replace('\\\\', '/')
            if folder is None:
                logger.info(f'{info["id"]}下载视频 {info["title"]} 失败')
                return False, dw_state
            elif dw_state == 2:
                json_file_path = os.path.join(folder, 'download.info.json')
                if not os.path.exists(json_file_path):
                    logger.info(f'{info["id"]}下载失败，并且没有info.json,直接返回：{info["title"]}')
                    return False, dw_state
                tjd = db.fetchone(f"select * from transport_job_des where video_id='{info['id']}'")
                if tjd:
                    logger.info(f'{info["id"]}视频已经处理过：{info["title"]}')
                    return False, dw_state
                insert_tjd(folder, info, transport_job, 4)
                return True, dw_state
            elif dw_state == 3 or dw_state == 1:
                tjd = db.fetchone(f"select * from transport_job_des where video_id='{info['id']}'")
                if tjd:
                    logger.info(f'{info["id"]}视频已经处理过：{info["title"]}')
                    return False, dw_state
                # 替换原来的 f-string SQL 语句
                tjd_id = insert_tjd(folder, info, transport_job, 1)
                # 翻译标题
                translate_all_title_under_folder(
                    folder, target_language=translation_target_language, info=info
                )
                # 生成信息文件
                generate_all_info_under_folder(folder)
                db.execute(
                    "UPDATE `transport_job_des` SET `state`=%s, file_path=%s WHERE `id`=%s",
                    (2, folder, tjd_id)
                )
                # 去重视频
                start_time = time.time()
                deduplicate_video(info, folder)
                end_time = time.time()
                logger.info(f"去重视频处理完成，耗时: {end_time - start_time:.2f} 秒")
                db.execute(
                    "UPDATE `transport_job_des` SET `state`=%s, file_path=%s WHERE `id`=%s",
                    (3, folder, tjd_id)
                )
                # 上传视频
                # threading.Thread(target=up_video, args=(folder, tjd_id)).start()
                return True, dw_state
        except Exception as e:
            logger.exception(f'处理视频 {info["title"]} 时发生错误：{e}')
            traceback.print_exc()
    return False, 0


# 新增数据
def insert_tjd(folder, info, transport_job, state):
    sql = """
                INSERT INTO `transport_job_des`
                (`tj_id`, `video_id`, `video_url`, `title`, `remark`, `file_path`, `state`) 
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """
    args = (
        transport_job['id'],
        info['id'],
        info['webpage_url'],
        info['title'],
        info['description'],
        folder,
        state
    )
    tjd_id = db.execute(sql, args)
    return tjd_id


def do_everything(transport_job, root_folder, url, num_videos=5, page_num=1, resolution='1080p',
                  demucs_model='htdemucs_ft',
                  device='auto', shifts=5, whisper_model='large', whisper_download_root='models/ASR/whisper',
                  whisper_batch_size=32, whisper_diarization=True, whisper_min_speakers=None, whisper_max_speakers=None,
                  translation_target_language='简体中文', force_bytedance=False, subtitles=True, speed_up=1.05, fps=30,
                  target_resolution='1080p', max_workers=3, max_retries=5, auto_upload_video=True):
    success_list = []
    fail_list = []

    url = url.replace(' ', '').replace('，', '\n').replace(',', '\n')
    urls = [_ for _ in url.split('\n') if _]

    dwn_count = 0
    download_e = DownloadEntity(2)  # 使用类实例来包装 url_type
    infos = get_info_list_from_url(urls, num_videos, page_num, download_e,root_folder)
    for info in infos:
        if info is None:
            logger.info(f'{urls}未解析出有用的数据')
            break
        try:
            info['transport_job'] = transport_job
            success, dw_state = process_video(info, root_folder, resolution, demucs_model, device, shifts,
                                              whisper_model,
                                              whisper_download_root, whisper_batch_size,
                                              whisper_diarization, whisper_min_speakers, whisper_max_speakers,
                                              translation_target_language, force_bytedance, subtitles, speed_up, fps,
                                              target_resolution, max_retries, auto_upload_video)
            if success:
                success_list.append(info)
                dwn_count += 1
            else:
                fail_list.append(info)
            if download_e.url_type == 1 and (dw_state == 1 or dw_state == 3):
                db.execute(
                    "UPDATE `transport_job` SET `state`=%s WHERE `id`=%s",
                    (1, transport_job['id'])
                )
        except Exception as e:
            logger.exception(f'处理视频 {info["title"]} 时发生错误：{e}')
            fail_list.append(info)
            traceback.print_exc()
    return dwn_count, download_e


# 上传视频
@with_timeout_lock(timeout=60, max_workers=2)
async def up_video(folder, platform, tjd_id=None, check_job=True,account =None,tj_user_ids=None,goods =None,check_video=True):
    user_id = None
    if check_job:
        sql_check = """
                            SELECT * FROM transport_job_pub 
                            WHERE tjd_id = %s and platform =%s
                            """
        transport_job_pub = db.fetchone(sql_check, (tjd_id, platform))
        if transport_job_pub:
            user_id = transport_job_pub['user_id']
            if transport_job_pub['state'] == 1:
                logger.info(f"{transport_job_pub['user_id']}在{platform}平台上，tjd_id为{tjd_id}的任务之前发布成功过")
                return True, 1
    elif account:
        user_id = account.get('creator_id', '')
    if tj_user_ids and user_id not in tj_user_ids:
        logger.info(f"{tjd_id}：{user_id}不再可发布用户{tj_user_ids}内")
        return False, 0
    video_text = os.path.join(folder, 'video.txt')
    title, tags = get_title_and_hashtags(video_text)
    video_file = os.path.join(folder, 'download_final.mp4')
    thumbnail_path = os.path.join(folder, 'download.jpg')
    thumbnail_path = thumbnail_path if os.path.exists(thumbnail_path) else None
    # 遍历 cookies 文件夹
    cookie_files = glob.glob(f'{cookie_path}/{platform}_uploader/*.json')
    if user_id:
        cookie_files = [get_account_file(user_id, platform)]
    success_up = True
    for cookie_file in cookie_files:
        try:
            user_id = os.path.basename(cookie_file).split('_')[0]
            # 使用配置校验发布条数
            if not account and check_user_publish(user_id, platform,tj_user_ids):
                continue
            if platform == SOCIAL_MEDIA_DOUYIN:
                await douyin_setup(cookie_file, handle=False)
                app = DouYinVideo(title, video_file, tags, 0, cookie_file, thumbnail_path,goods=goods,check_video=check_video)
            elif platform == SOCIAL_MEDIA_TIKTOK:
                await tiktok_setup(cookie_file, handle=True)
                app = TiktokVideo(title, video_file, tags, 0, cookie_file, thumbnail_path)
            elif platform == SOCIAL_MEDIA_TENCENT:
                await weixin_setup(cookie_file, handle=True)
                category = TencentZoneTypes.DANCE.value  # 标记原创需要否则不需要传
                app = TencentVideo(title, video_file, tags, 0, cookie_file, category)
            elif platform == SOCIAL_MEDIA_KUAISHOU:
                await ks_setup(cookie_file, handle=True)
                app = KSVideo(title, video_file, tags, 0, cookie_file,goods=goods)
            elif platform == SOCIAL_MEDIA_XHS:
                app = XHSVideo(title, video_file, tags, 0, cookie_file, thumbnail_path)
            else:
                print("不支持的平台")
                continue
            # 使用 asyncio 运行异步方法
            up_state, up_test_msg = await app.main()
            logger.info(f'发布完毕{up_state}消息{up_test_msg}')
            if check_job:
                db.execute(
                    "INSERT INTO `transport_job_pub`(`tjd_id`, `user_id`, `platform`, `up_test_msg`, `state`, `create_time`, `update_time`) VALUES ( %s, %s, %s, %s, %s, NOW(), NOW())",
                    (tjd_id, user_id, platform, up_test_msg, 1 if up_state else 0)
                )
                if not up_state:
                    db.execute(
                        "UPDATE `transport_job_des` SET `state`=%s, file_path=%s ,up_test_msg= %s WHERE `id`=%s",
                        (99, folder, up_test_msg, tjd_id)
                    )
                    return False, 0
                else:
                    db.execute(
                        "UPDATE `transport_job_des` SET file_path=%s  WHERE `id`=%s",
                        (folder, tjd_id)
                    )
            return True, 1
        except Exception as e:
            logger.exception(f"处理补充任务发布时出错: {tjd_id} - 错误信息: {str(e)}")
            traceback.print_exc()
            success_up = False
    return success_up, 0
