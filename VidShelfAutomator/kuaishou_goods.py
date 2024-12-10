import argparse
import asyncio
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from playwright.async_api import async_playwright

from Crawler.service.douyin.views import add_account as dy_add_account
from Crawler.service.douyin.views.add_account import Param as dy_param
from Crawler.service.douyin.views.buyin_login import login_with_qrcode as dy_shop_login
from Crawler.service.kuaishou.kfx.logic.entity.goods_req import GoodsInfoHomeReq
from Crawler.service.kuaishou.kfx.views import add_account as ks_add_account
from Crawler.service.kuaishou.kfx.views.add_account import Param as ks_param
from VidShelfAutomator.goods_info import get_goods_info
from social_auto_upload.conf import BASE_DIR
from social_auto_upload.uploader.douyin_uploader.main import douyin_cookie_gen
from social_auto_upload.uploader.ks_uploader.ks_shop import get_ks_shop_cookie
from social_auto_upload.uploader.ks_uploader.main import ks_setup, get_ks_cookie
from social_auto_upload.utils.base_social_media import get_platforms, SOCIAL_MEDIA_DOUYIN, SOCIAL_MEDIA_KUAISHOU, \
    SOCIAL_MEDIA_TENCENT, SOCIAL_MEDIA_TIKTOK, SOCIAL_MEDIA_BILIBILI, SOCIAL_MEDIA_XHS, SOCIAL_MEDIA_JD


load_dotenv()

# 获取当前文件所在目录的父目录（项目根目录）
root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# 将项目根目录添加到系统路径
sys.path.append(root_dir)
from datetime import datetime
from apscheduler.schedulers.blocking import BlockingScheduler


# 补充处理数据
async def auto_pub():
    for platform in get_platforms():
        if platform == SOCIAL_MEDIA_DOUYIN:
            async with async_playwright() as playwright:
                await get_goods_info(1, GoodsInfoHomeReq(key_word=""), platform, playwright)
        else:
            await get_goods_info(1, GoodsInfoHomeReq(key_word=""), platform, playwright)
    # shop_user_id = await shop_login(SOCIAL_MEDIA_KUAISHOU, None)
    # await creator_login(SOCIAL_MEDIA_KUAISHOU,shop_user_id)
    # shop_user_id = await shop_login(SOCIAL_MEDIA_DOUYIN, None)
    # await creator_login(SOCIAL_MEDIA_DOUYIN,shop_user_id)
# 创作者登录
async def creator_login(platform, shop_user_id):
    if platform == SOCIAL_MEDIA_KUAISHOU:
        user_id, user_name = await get_ks_cookie(None)
        await ks_add_account(ks_param(shop_user_id=shop_user_id, cookie=None, creator_id=user_id))
    elif platform == SOCIAL_MEDIA_DOUYIN:
        user_id, user_name, cookie = await douyin_cookie_gen(None)
        await dy_add_account(dy_param(shop_user_id=shop_user_id, creator_id=user_id, cookie=cookie))
    # elif platform == SOCIAL_MEDIA_TENCENT:
    #     que_succ, res = await get_tx_goods(headers, query_type, req)
    # elif platform == SOCIAL_MEDIA_TIKTOK:
    #     que_succ, res = await get_tk_goods(headers, query_type, req)
    # elif platform == SOCIAL_MEDIA_BILIBILI:
    #     que_succ, res = await get_bl_goods(headers, query_type, req)
    # elif platform == SOCIAL_MEDIA_XHS:
    #     que_succ, res = await get_xhs_goods(headers, query_type, req)
    # elif platform == SOCIAL_MEDIA_JD:
    #     que_succ, res = await get_jd_goods(headers, query_type, req)

# 小店登录
async def shop_login(platform, user_id):
    shop_user_id = None
    if platform == SOCIAL_MEDIA_KUAISHOU:
        # shop_user_id, cookie = asyncio.run(get_ks_shop_cookie())
        shop_user_id = '4505472846'
        await ks_add_account(ks_param(shop_user_id='4505472846', cookie="_did=web_6575436369641EC3; did=web_kawifxkvyg6gjal1bxqdv3es70uuyyj8; bUserId=1000383682909; userId=4505472846; sid=kuaishou.shop.b; kuaishou.shop.b_st=ChJrdWFpc2hvdS5zaG9wLmIuc3QSoAEzcmictorphgI4ZnXSNid-BY7Cyr3_2TqilY_BIep5fa42Ddzkdoh57TRAW4Fbk4lwYco8yWNLIbxlNeBIyato9g35IeJCabOqzvqkE5iGbsgzH9OQkEvmA6AIYQfvpPX7ey77dawO7aqd4jsbyTJEuIMudYh_V_LUAvjpVQGCza1DMdR05SFE8SDr_AEJDF2T_Wvvopr8UQNfP_SEkwtQGhJEwYN8fze1y97CKEMszZ1sXx4iIKgUS31d650CTT8jaSbkK0VTm_fzjiL_C3qgDcX5TtWXKAUwAQ; kuaishou.shop.b_ph=49bca9c3cfed514065712d5db182ab627fc2",
                                            creator_id=user_id))
    elif platform == SOCIAL_MEDIA_DOUYIN:
        shop_user_id = await dy_shop_login()
        await dy_add_account(dy_param(shop_user_id=shop_user_id, creator_id=user_id, cookie=""))
    # elif platform == SOCIAL_MEDIA_TENCENT:
    #     que_succ, res = await get_tx_goods(headers, query_type, req)
    # elif platform == SOCIAL_MEDIA_TIKTOK:
    #     que_succ, res = await get_tk_goods(headers, query_type, req)
    # elif platform == SOCIAL_MEDIA_BILIBILI:
    #     que_succ, res = await get_bl_goods(headers, query_type, req)
    # elif platform == SOCIAL_MEDIA_XHS:
    #     que_succ, res = await get_xhs_goods(headers, query_type, req)
    # elif platform == SOCIAL_MEDIA_JD:
    #     que_succ, res = await get_jd_goods(headers, query_type, req)
    return shop_user_id

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description="Script Scheduler")
    parser.add_argument("--one", action="store_true", help="Run the script immediately")
    args = parser.parse_args()

    if args.one:
        asyncio.run(auto_pub())
    else:
        scheduler = BlockingScheduler()
        now = datetime.now()


        def run_auto_pub():
            asyncio.run(auto_pub())


        scheduler.add_job(run_auto_pub, 'interval', minutes=2, max_instances=1, next_run_time=now)
        scheduler.start()
