import glob
import os
import logging
import asyncio

from Crawler.service.douyin.utils.trend_insight_util import juliang_setup
from VidShelfAutomator.kuaishou_goods import shop_login
from social_auto_upload.uploader.douyin_uploader.main import douyin_setup
from social_auto_upload.uploader.ks_uploader.main import ks_setup
from social_auto_upload.uploader.tencent_uploader.main import weixin_setup
from social_auto_upload.uploader.tk_uploader.main import tiktok_setup
from social_auto_upload.utils.base_social_media import get_platforms, SOCIAL_MEDIA_DOUYIN, SOCIAL_MEDIA_TIKTOK, \
    SOCIAL_MEDIA_TENCENT, SOCIAL_MEDIA_KUAISHOU
from youdub.do_everything import cookie_path

# 检查登录
def get_user_info_from_filename(file_path):
    # 从文件路径中获取文件名
    filename = os.path.basename(file_path)
    # 移除.json后缀
    filename = filename.replace('_account.json', '')
    # 分割获取用户ID和用户名
    try:
        user_id, username = filename.split('_', 1)
        return user_id, username
    except ValueError:
        return None, None


async def check_login():
    platforms = get_platforms()
    for platform in platforms:
        logging.info(f"正在检查平台: {platform} 的账号登录状态")
        cookie_files = glob.glob(f'{cookie_path}/{platform}_uploader/*.json')
        for account_file in cookie_files:
            user_id, username = get_user_info_from_filename(account_file)
            logging.info(f"正在检查账号 - 平台: {platform} - 用户ID: {user_id} - 用户名: {username}")
            try:
                if platform == SOCIAL_MEDIA_DOUYIN:
                    await douyin_setup(str(account_file), handle=True)
                elif platform == SOCIAL_MEDIA_TIKTOK:
                    await tiktok_setup(str(account_file), handle=True)
                elif platform == SOCIAL_MEDIA_TENCENT:
                    await weixin_setup(str(account_file), handle=True)
                elif platform == SOCIAL_MEDIA_KUAISHOU:
                    await ks_setup(str(account_file), handle=True)
                logging.info(f"账号检查成功 - 平台: {platform} - 用户ID: {user_id} - 用户名: {username}")
            except Exception as e:
                logging.error(f"平台: {platform} - 用户ID: {user_id} - 用户名: {username} 登录失效")
                logging.error(f"错误信息: {str(e)}")


if __name__ == '__main__':
    # 配置日志格式
    logging.basicConfig(
        level=logging.INFO,
        format='%(asctime)s - %(levelname)s - %(message)s'
    )
    # -----------------上传账号登录
    # asyncio.run(check_login())
    # 巨量算数登录
    # asyncio.run(juliang_setup('None',True))
    # 店铺登录
    # shop_user_id = await shop_login(SOCIAL_MEDIA_KUAISHOU, None)
    # await creator_login(SOCIAL_MEDIA_KUAISHOU,shop_user_id)
    shop_user_id = asyncio.run( shop_login(SOCIAL_MEDIA_DOUYIN, None))
    # await creator_login(SOCIAL_MEDIA_DOUYIN,shop_user_id)