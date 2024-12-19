import asyncio
import datetime
import os
import shutil
from collections import Counter
from http.cookies import SimpleCookie
from typing import Union, List
import aiohttp
import json

from playwright.async_api import async_playwright

from Crawler.lib.logger import logger
from Crawler.service.douyin.logic.common import COMMON_HEADERS
from Crawler.service.douyin.logic.entity import goods_info_req
from Crawler.service.douyin.logic.entity.goods_info_req import GoodsInfoRequest
from Crawler.service.douyin.logic.search import request_search_goods
from Crawler.service.douyin.models import accounts as douyin_accounts
from Crawler.service.bilibili.models import accounts as bilibili_accounts
from Crawler.service.douyin.utils.buyin_util import get_goods, add_chat
from Crawler.service.jd.models import accounts as jd_accounts
from Crawler.service.taobao.models import accounts as taobao_accounts
from Crawler.service.weibo.models import accounts as weibo_accounts
from Crawler.service.xhs.models import accounts as xhs_accounts
from Crawler.service.douyin.views import search
from Crawler.utils.error_code import ErrorCode
from social_auto_upload.utils.base_social_media import SOCIAL_MEDIA_BILIBILI, SOCIAL_MEDIA_DOUYIN, SOCIAL_MEDIA_JD, \
    SOCIAL_MEDIA_KUAISHOU, SOCIAL_MEDIA_TENCENT, SOCIAL_MEDIA_TIKTOK, SOCIAL_MEDIA_XHS
from youdub.do_everything import up_video
from youdub.util.download_util import fetch_data
from youdub.util.ffmpeg_utils import concat_videos
from Crawler.service.kuaishou.kfx.logic.Enum.goods_emnu import QueryType
from Crawler.service.kuaishou.kfx.logic.common import common_request, common_get
from Crawler.service.kuaishou.kfx.logic.entity import goods_add_shelves_req
from Crawler.service.kuaishou.kfx.logic.entity.goods_req import ThemeGoodsReq, HotRankingReq, GoodsInfoHomeReq
from Crawler.service.kuaishou.kfx.logic.entity.goods_res import GoodsResponse, GoodsData
from Crawler.service.kuaishou.kfx.models import accounts as kuaishou_accounts, goods_db
import random
import time
import re

# 从环境变量获取URL类型代码映射
url_type_code_dict = json.loads(os.getenv('URL_TYPE_CODE_DICT', '{"0":"video"}'))


# 查询抖音商品信息
async def get_dy_goods(account_id, req: GoodsInfoHomeReq, playwright, page, browser):
    que_succ, res, page, browser = await get_goods(account_id, playwright, req, page, browser)

    # 创建GoodsResponse实例
    good_res = GoodsResponse(
        pcursor=str(req.pcursor),
        result=0,
        data=[]  # 初始化空列表
    )

    if que_succ:
        # 检查res是否为字典类型且包含必要的数据
        if isinstance(res, dict) and 'data' in res and isinstance(res['data'], dict):
            promotions = res['data'].get('promotions', [])
            if promotions:
                good_res.result = 1
                goods_datas = []
                for goods in promotions:
                    # 从base_info中获取标题
                    title = goods.get('base_info', {}).get('title', '')

                    # 从price_info中获取价格
                    price = str(float(goods.get('price_info', {}).get('price', 0)) / 100)  # 转换为元并转为字符串

                    # 从cos_info中获取佣金比例和佣金
                    commission_rate = str(float(goods.get('cos_info', {}).get('cos_ratio', 0)))  # 转为字符串
                    commission = str(float(goods.get('cos_info', {}).get('cos_fee', 0)) / 100)  # 转换为元并转为字符串
                    seller_name = str(goods.get('shop_info', {}).get('shop_name', ''))
                    # 从商品ID
                    product_id = str(goods.get('product_id', ''))
                    detail_url = goods.get('base_info', {}).get('detail_url', '')
                    is_in_cart = bool(goods.get('event_info', {}).get('is_in_cart', False))

                    goods_data = GoodsData(
                        itemTitle=title,
                        zkFinalPrice=price,
                        commissionRate=commission_rate,
                        profitAmount=commission,
                        relItemId=product_id,
                        isAdd=1 if is_in_cart else 0,
                        # 添加必需的字段
                        sellerName=seller_name,
                        itemLinkUrl=detail_url,
                        ext=goods  # 直接使用完整的goods对象作为ext
                    )
                    goods_datas.append(goods_data)
                good_res.data = goods_datas

    return que_succ, good_res, page, browser


# 查询视频号商品信息
async def get_tx_goods(headers, query_type, req):
    pass


# 查询tiktok商品信息
async def get_tk_goods(headers, query_type, req):
    pass


# 查询bilibil商品信息
async def get_bl_goods(headers, query_type, req):
    pass


# 查询小红书商品信息
async def get_xhs_goods(headers, query_type, req):
    pass


# 查询京东商品信息
async def get_jd_goods(headers, query_type, req):
    pass


async def add_dy_shelver(page, title):
    return await add_chat(page=page, title=title)


async def add_tx_shelver(goods, headers, query_type):
    pass


async def add_tt_shelver(goods, headers, query_type):
    pass


async def add_bb_shelver(goods, headers, query_type):
    pass


async def add_xhs_shelver(goods, headers, query_type):
    pass


async def add_jd_shelver(goods, headers, query_type):
    pass


async def get_goods_info(
        query_type: int,
        request_entity: Union[ThemeGoodsReq, HotRankingReq, GoodsInfoHomeReq],
        platform,
        playwright=None
):
    """
    获取商品信息
    Args:
        query_type: 查询类型
        request_entity: 请求实体，可能是以下类型之一：
            - ThemeGoodsReq: 主题商品请求
            - HotRankingReq: 热门排行请求
            - GoodsInfoHomeReq: 商品主页信息请求
            :param playwright:
            :param query_type:
            :param request_entity:
            :param platform:
    """
    if platform == SOCIAL_MEDIA_DOUYIN:
        _accounts = await douyin_accounts.load()
    elif platform == SOCIAL_MEDIA_KUAISHOU:
        _accounts = await kuaishou_accounts.load()
    # elif platform == SOCIAL_MEDIA_TENCENT:
    #     _accounts = await tencent_accounts.load()
    # elif platform == SOCIAL_MEDIA_TIKTOK:
    #     _accounts = await tiktok_accounts.load()
    elif platform == SOCIAL_MEDIA_BILIBILI:
        _accounts = await bilibili_accounts.load()
    elif platform == SOCIAL_MEDIA_XHS:
        _accounts = await xhs_accounts.load()
    elif platform == SOCIAL_MEDIA_JD:
        _accounts = await jd_accounts.load()
    else:
        raise ValueError(f'不支持的平台: {platform}')
    random.shuffle(_accounts)
    query_type = QueryType.get_by_type(query_type)
    for account in _accounts:
        if datetime.datetime.now().hour < 8:
            logger.info("当前时间在八点之前，不执行后续代码")
            continue
        account_id = account.get('shop_user_id', '')
        try:
            headers = {
                "Cookie": account.get('cookie', ''),
                "Referer": query_type.referer,
            }
            pub_count = account.get('pub_count', 0)
            if account.get('expired', 0) == 1:
                continue
            keywords = account.get('keywords', '').split(',')
            # 组装请求实体
            req = create_request_entity(query_type, request_entity, 0)
            req.key_word = keywords.pop(0) if keywords else req.key_word
            # 获取今日关键词统计
            today_keywords_stats = await goods_db.get_keywords_statistics(date=time.strftime('%Y-%m-%d'),
                                                                          lUserId=account_id, platform=platform)
            empty_count = 0
            word_pub_succ = today_keywords_stats.get(req.key_word, 0)
            # 获取今日已添加的商品ID列表
            repeat_days = int(os.getenv('GOODS_REPEAT_DAYS', 7))
            past_date = (datetime.datetime.now() - datetime.timedelta(days=repeat_days)).strftime('%Y-%m-%d')
            repeat_day_items = await goods_db.query_by_lUserId(account_id, date=past_date, platform=platform)
            today_items = await goods_db.query_by_lUserId(account_id, date=datetime.datetime.now(), platform=platform)
            repeat_day__ids = {item['relItemId'] for item in repeat_day_items}
            total_pub_succ = len(today_items)
            if today_items:
                latest_publish_time = today_items[0].get('ut', None)
            else:
                latest_publish_time = None
            page = None
            browser = None
            while total_pub_succ < pub_count:
                # 查询status为99的商品ID列表
                failed_goods = await goods_db.query_by_lUserId(account_id, platform=platform,status =99)
                failed_item_ids = {item['relItemId'] for item in failed_goods}
                    
                # 首先从数据库查询status=1的商品数据
                db_goods = await goods_db.query_by_status(
                    lUserId=account_id, 
                    platform=platform,
                    status=0,
                    limit=int(os.getenv('DB_QUERY_LIMIT', 10))
                )
                
                if db_goods:
                    # 如果数据库中有数据,构造GoodsResponse对象
                    res = GoodsResponse(
                        pcursor="0",
                        result=1,
                        data=db_goods  # 直接使用返回的GoodsData列表
                    )
                    que_succ = True
                    
                if not db_goods:
                    # 数据库中没有数据,调用相应平台的API
                    if platform == SOCIAL_MEDIA_KUAISHOU:
                        que_succ, res = await get_ks_goods(headers, query_type, req)
                    elif platform == SOCIAL_MEDIA_DOUYIN:
                        que_succ, res, page, browser = await get_dy_goods(account_id, req, playwright, page, browser)
                    elif platform == SOCIAL_MEDIA_TENCENT:
                        que_succ, res = await get_tx_goods(headers, query_type, req)
                    elif platform == SOCIAL_MEDIA_TIKTOK:
                        que_succ, res = await get_tk_goods(headers, query_type, req)
                    elif platform == SOCIAL_MEDIA_BILIBILI:
                        que_succ, res = await get_bl_goods(headers, query_type, req)
                    elif platform == SOCIAL_MEDIA_XHS:
                        que_succ, res = await get_xhs_goods(headers, query_type, req)
                    elif platform == SOCIAL_MEDIA_JD:
                        que_succ, res = await get_jd_goods(headers, query_type, req)

                sleep_time = int(os.getenv('QUERY_SLEEP_TIME', 10))
                logger.info(
                    f'获取商品信息成功，账号: {account_id},休眠{sleep_time}秒, 实体: {request_entity.to_dict()}, 返回: {res}')
                
                if not que_succ or res == {} or res.result != 1:
                    empty_count += 1
                    await asyncio.sleep(sleep_time)
                else:
                    if not db_goods:  # 只有在非数据库查询的情况下更新pcursor
                        req.pcursor = res.pcursor
                    empty_count = 0
                    for goods in res.data:
                        try:
                            # 校验数据是否符合
                            if check_goods(query_type, request_entity, goods, repeat_day__ids,failed_item_ids):
                                if word_pub_succ >= int(os.getenv('KEYWORD_PUB_LIMIT')):
                                    logger.info(
                                        f'账号: {account_id}在关键字{req.key_word}已经发布了{word_pub_succ}条,超出配置: {os.getenv("KEYWORD_PUB_LIMIT")}')
                                    word_pub_succ = 0  # 如果达到关键词发布限制，则重置关键词发布成功次数
                                    req.key_word = keywords.pop(0) if keywords else req.key_word
                                    req.pcursor = 0
                                    if browser:
                                        await browser.close()
                                        page = None
                                        browser = None
                                    break
                                elif total_pub_succ > pub_count:
                                    logger.info(f'账号: {account_id}已经发布了{total_pub_succ}条,超出配置: {pub_count}')
                                    break
                                record_id = goods.id
                                # 只有在非数据库查询的情况下才添加货架
                                if not db_goods and goods.isAdd == 0:
                                    shelver_succ = True
                                    # 添加货架
                                    if platform == SOCIAL_MEDIA_KUAISHOU:
                                        shelver_res, shelver_succ = await add_ks_shelver(goods, headers, query_type)
                                    elif platform == SOCIAL_MEDIA_DOUYIN:
                                        shelver_succ = await add_dy_shelver(page, title=goods.itemTitle)
                                    elif platform == SOCIAL_MEDIA_TENCENT:
                                        await add_tx_shelver(goods, headers, query_type)
                                    elif platform == SOCIAL_MEDIA_TIKTOK:
                                        await add_tt_shelver(goods, headers, query_type)
                                    elif platform == SOCIAL_MEDIA_BILIBILI:
                                        await add_bb_shelver(goods, headers, query_type)
                                    elif platform == SOCIAL_MEDIA_XHS:
                                        await add_xhs_shelver(goods, headers, query_type)
                                    elif platform == SOCIAL_MEDIA_JD:
                                        await add_jd_shelver(goods, headers, query_type)
                                    # 保存数据
                                    goods_dict = goods.model_dump()
                                    goods_dict = convert_nested_to_str(goods_dict)
                                    goods_dict['lUserId'] = account_id
                                    goods_dict['keywords'] = req.key_word
                                    goods_dict['platform'] = platform
                                    if shelver_succ:
                                        goods_dict['status'] = 0
                                        # 保存并获取记录ID
                                        record_id = await goods_db.save(goods_dict)
                                    else:
                                        goods_dict['status'] = 99
                                        # 保存并获取记录ID
                                        record_id = await goods_db.save(goods_dict)
                                        continue
                                total_pub_succ += 1
                                word_pub_succ += 1
                                video_dir = f'../data/douyin/videos/{account_id}/{sanitize_filename(goods.itemTitle)}'

                                logger.info(f'商品信息已保存，记录ID: {record_id}')
                                output_path = os.path.join(video_dir, 'download_final.mp4')
                                await dwn_video(video_dir, goods, account, output_path)
                                if os.path.exists(output_path):
                                    if latest_publish_time:
                                        current_time = datetime.datetime.now()
                                        # 将字符串格式的时间转换为datetime对象进行比较
                                        if isinstance(latest_publish_time, str):
                                            latest_publish_time = datetime.datetime.strptime(latest_publish_time,
                                                                                             '%Y-%m-%d %H:%M:%S')
                                        time_diff = (current_time - latest_publish_time).total_seconds()
                                        publish_interval = int(os.getenv('PUBLISH_INTERVAL', 1200))

                                        if time_diff < publish_interval:
                                            logger.info(
                                                f'距离上次发布时间间隔{time_diff}秒，小于设定的{publish_interval}秒，跳过本次发布')
                                            continue

                                    logger.info('开始发布商品信息...')
                                    up_sta, up_count = await up_video(folder=video_dir, platform=platform,
                                                                      account=account, check_job=False, goods=goods)
                                    logger.info(f"上传视频完毕: - 状态: {up_sta}-视频路径：{output_path}")
                                    # 上传完成后删除文件
                                    if up_sta and up_count > 0:
                                        shutil.rmtree(video_dir)
                                        latest_publish_time = datetime.datetime.now()
                                        await goods_db.update_status(record_id, 1)
                        except Exception as e:
                            logger.exception(f'{account_id}处理商品信息失败，继续下一个商品', e)

                if empty_count > 3:
                    logger.info(f'连续三次没查到数据，继续下一个{request_entity.to_dict()}')
                    break
            if browser:
                await browser.close()
        except Exception as e:
            logger.exception(f'{account_id}发布视频时处理失败，继续下一个用户', e)
    return False, '请先添加账号'


async def add_ks_shelver(goods, headers, query_type):
    shelves_req = goods_add_shelves_req.GoodsAddShelvesReq.from_other(goods, query_type)
    shelver_res, shelver_succ = await common_request(shelves_req.to_dict(), headers,
                                                     f'{query_type.host}/gateway/distribute/match/shelf/item/save')
    shelver_res_data = shelver_res.get('data', None)
    if shelver_res_data and '该店铺正处于电商新手期，每日支付订单量上限约为' in shelver_res_data.get('remindContent', ''):
        ignore_res, ignore_state = await common_get( headers, f'{query_type.host}/gateway/distribute/match/shelf/remind/type/ignore?itemId={goods.relItemId}&remindType=10')
        if ignore_state and 'SUCCESS' == ignore_res.get('error_msg', ''):
            shelver_res, shelver_succ = await common_request(shelves_req.to_dict(), headers, f'{query_type.host}/gateway/distribute/match/shelf/item/save')

    return shelver_res,  shelver_res.get('pickSuccess', False)


# 查询快手商品信息
async def get_ks_goods(headers, query_type, req):
    res, que_succ = await common_request(req.to_dict(), headers, query_type.host + query_type.uri)
    # res = await ks_client.post(query_type.uri, request_entity.to_dict())
    res = GoodsResponse.model_validate(res)
    return que_succ, res


# 根据关键词下载视频
async def dwn_video(video_dir, goods, account, output_path):
    video_count = int(os.getenv('GOODS_VIDEO_COUNT', 5))
    os.makedirs(video_dir, exist_ok=True)
    downloaded_videos = [f for f in os.listdir(video_dir) if f.endswith('.mp4')]
    dwn_empty_count = 0  # 连续未获取到视频的次数
    offset = 0  # 查询偏移量
    limit = int(os.getenv('DWN_SEARCH_PAGE_SIZE', 10))  # 每页数量
    dwn_txt = f"../data/douyin/dwn_txt/{account.get('shop_user_id', '')}_download.txt"
    # 如果输出文件已存在，直接返回
    if os.path.exists(output_path):
        return
    # 读取已下载的视频ID
    downloaded_ids = set()
    try:
        with open(dwn_txt, 'r', encoding='utf-8') as f:
            downloaded_ids = set(line.strip() for line in f)
    except FileNotFoundError:
        os.makedirs('../data/douyin/dwn_txt', exist_ok=True)
        open(dwn_txt, 'a').close()
    # 收集所有清晰度版本的宽高信息
    resolutions = []
    # 循环查询直到获取足够数量的视频
    while len(downloaded_videos) < video_count and dwn_empty_count < 3:
        try:
            logger.info(
                f'搜索视频中，当前已下载：{len(downloaded_videos)}个，目标数量：{video_count}个，连续未获取次数：{dwn_empty_count}，offset：{offset}')

            search_reply = await search(goods.itemTitle, offset, limit)
            if search_reply['code'] != ErrorCode.OK.value:
                logger.error(f'搜索失败：{search_reply}')
                dwn_empty_count += 1
                continue

            video_list = search_reply.get('data', [])
            if not video_list:
                logger.info('没有更多视频了')
                dwn_empty_count += 1
                await asyncio.sleep(int(os.getenv('QUERY_SLEEP_TIME', 5)))
                continue
            # 更新offset到下一页
            offset += len(video_list)
            # 随机选择一个视频的desc并写入video.txt
            if not os.path.exists(os.path.join(video_dir, 'video.txt')):
                # 打乱视频列表顺序
                random.shuffle(video_list)
                valid_desc = False
                desc_title = None
                desc_topics = None
                for video in video_list:
                    random_video = video
                    desc = random_video.get('aweme_info', {}).get('desc', '')

                    if desc:
                        # 按#分割
                        parts = desc.split('#', 1)
                        # 检查title是否为空
                        if not desc_title:
                            desc_title = parts[0].strip()

                        if not desc_topics:
                            desc_topics = f"#{parts[1]}" if len(parts) > 1 else None
                        if desc_title and desc_topics:
                            break

                # 如果所有视频的title都为空，使用商品标题
                desc_title = desc_title if desc_title else goods.itemTitle
                desc_topics = desc_topics if desc_topics else f"#{goods.itemTitle}"

                # 组合最终的描述文本
                final_desc = f"{desc_title}\n#无限回购的宝藏单品 {desc_topics}"

                with open(os.path.join(video_dir, 'video.txt'), 'w', encoding='utf-8') as f:
                    f.write(final_desc)
                logger.info(f'已写入视频描述到{video_dir}/video.txt: {final_desc}')

            page_downloaded = False  # 标记本页是否下载到视频
            # 处理视频列表
            for video in video_list:
                try:
                    if len(downloaded_videos) >= video_count:
                        break

                    aweme_info = video.get('aweme_info', {})
                    video_id = aweme_info.get('aweme_id')

                    if video_id in downloaded_ids:
                        continue

                    # 获取视频信息
                    video_data = aweme_info.get('video', {})

                    # 从不同来源获取宽高
                    # 主视频信息
                    # width = video_data.get('width')
                    # height = video_data.get('height')
                    # if width and height:
                    #     resolutions.append((width, height))

                    # play_addr中的信息
                    play_addr = video_data.get('play_addr', {})
                    width = play_addr.get('width')
                    height = play_addr.get('height')
                    if width and height:
                        resolutions.append((width, height))

                    # 判断链接类型
                    url_type = url_type_code_dict.get(str(aweme_info.get("aweme_type")), 'video')

                    if url_type != 'video':
                        continue
                    duration_ms = video_data.get('duration', 0)
                    duration_sec = round(duration_ms / 1000, 2)
                    max_duration = int(os.getenv('MAX_VIDEO_DURATION_SEC', 120))
                    if duration_sec > max_duration:
                        logger.info(f'视频时长超过{max_duration}秒，跳过下载: ID={video_id}, 时长={duration_sec}秒')
                        continue
                    play_addr = video_data.get('play_addr', {})
                    url_list = play_addr.get('url_list', [])

                    if url_list and video_id:
                        download_url = url_list[-1]
                        os.makedirs(video_dir, exist_ok=True)
                        video_path = os.path.join(video_dir, f'{video_id}.mp4')
                        headers_dy = {"cookie": account.get('cookie', '')}
                        headers_dy.update(COMMON_HEADERS)
                        await fetch_data(url=download_url, headers=headers_dy, file_path=video_path)
                        logger.info(f'视频下载成功: ID={video_id}, 时长={duration_sec}秒')
                        with open(dwn_txt, 'a', encoding='utf-8') as f:
                            f.write(f'{video_id}\n')
                        downloaded_videos.append({
                            'path': video_path,
                            'duration': duration_sec
                        })
                        logger.info(f'当前已下载: {len(downloaded_videos)}个, 目标数量: {video_count}个')
                        page_downloaded = True  # 标记本页成功下载了视频
                        dwn_empty_count = 0  # 重置未获取计数
                except Exception as e:
                    logger.exception(f'视频下载出错:, 错误信息', e)
                    continue

            # 如果这一页没有成功下载任何视频
            if not page_downloaded:
                dwn_empty_count += 1
                await asyncio.sleep(int(os.getenv('QUERY_SLEEP_TIME', 5)))
        except Exception as e:
            logger.exception(f'循环处理视频时失败: shop_user_id={account.get("shop_user_id", "")}, 错误信息={str(e)}',
                             e)

    if len(downloaded_videos) < video_count:
        logger.warning(f'未能获取足够数量的视频，当前已下载: {len(downloaded_videos)}个，目标数量: {video_count}个')
        raise Exception(f'未能获取足够数量的视频，当前已下载: {len(downloaded_videos)}个，目标数量: {video_count}个')
    else:
        logger.info(f'成功获取足够数量的视频，共{len(downloaded_videos)}个')
        # 选择最合适的分辨率
        final_width = 1080
        final_height = 1920
        if resolutions:
            # 统计出现次数
            resolution_counter = Counter(resolutions)
            # 获取出现次数最多的分辨率
            most_common = resolution_counter.most_common()

            if len(most_common) == 1 or most_common[0][1] > most_common[1][1]:
                # 如果只有一种分辨率或有一个明显最多的
                final_width, final_height = most_common[0][0]
            else:
                # 如果出现次数相同，选择分辨率最高的
                max_resolution = max(resolutions, key=lambda x: x[0] * x[1])
                final_width, final_height = max_resolution
        concat_videos(video_dir, output_path, final_width, final_height)
        logger.info(f'带货视频已合并到{output_path}')
    return downloaded_videos


# 组装请求实体
# 根据查询类型，组装不同的请求实体
# Args:
#     query_type: 查询类型
#     request_entity: 请求实体
# Returns:
#     组装后的请求实体

def create_request_entity(query_type, request_entity, pcursor):
    if query_type == QueryType.SHELF_COLLECTION:
        pass
    elif query_type == QueryType.HOT_SELLING_LIST:
        return HotRankingReq(request_entity.theme_id, request_entity.channel_id)
    elif query_type == QueryType.SEASONAL_HOT_SALE or query_type == QueryType.LOW_PRICE_FIRST_CHOICE or query_type == QueryType.HIGH_COMMISSION_GOODS or query_type == QueryType.SHORT_VIDEO_HOT_SALE:
        return ThemeGoodsReq(request_entity.theme_id, request_entity.sub_theme_id, request_entity.order_type,
                             request_entity.key_word, pcursor)
    return request_entity


# 校验返回数据是否符合规则
def check_goods(query_type, request_entity: GoodsInfoHomeReq, goods, repeat_day__ids,failed_item_ids):
    commission_rate_start = os.getenv('COMMISSION_RATE_START')
    if query_type not in [QueryType.KEYWORD_COLLECTION, QueryType.CUSTOM_PRODUCT_ID, QueryType.CATEGORY_COLLECTION,
                          QueryType.ALL_PRODUCTS]:
        if request_entity.price_start is not None and goods.zkFinalPrice < request_entity.price_start:
            logger.info(
                f'商品价格不匹配，商品价格: {goods.zkFinalPrice}, 小于设置的最小商品价格: {request_entity.price_start}')
            return False
        elif request_entity.price_end is not None and goods.zkFinalPrice > request_entity.price_end:
            logger.info(
                f'商品价格不匹配，商品价格: {goods.zkFinalPrice}, 大于设置的最大商品价格: {request_entity.price_end}')
            return False
        elif request_entity.rate_start is not None and goods.commissionRate < request_entity.rate_start:
            logger.info(
                f'商品佣金比率不匹配，商品佣金比率: {goods.commissionRate}%, 小于设置的最小佣金比率: {request_entity.rate_start}%')
            return False
        elif request_entity.rate_end is not None and goods.commissionRate > request_entity.rate_end:
            logger.info(
                f'商品佣金比率不匹配，商品佣金比率: {goods.commissionRate}%, 大于设置的最大佣金比率: {request_entity.rate_end}')
            return False
    if commission_rate_start is not None and float(goods.profitAmount) < float(commission_rate_start):
        logger.info(
            f'商品{goods.itemTitle}佣金不匹配，商品佣金: {goods.profitAmount}, 小于设置的最小佣金: {commission_rate_start}')
        return False
    elif goods.relItemId in repeat_day__ids:
        logger.info(f'商品 {goods.itemTitle} 在{os.getenv("GOODS_REPEAT_DAYS", 7)}天内已发布过，跳过')
        return False
    if goods.relItemId in failed_item_ids:
        logger.info(f'商品 {goods.itemTitle} 已发布失败，跳过')
        return False
    return True

    # 将所有复杂类型的子节点转换为字符串


def convert_nested_to_str(obj):
    if isinstance(obj, dict):
        result = {}
        for k, v in obj.items():
            if hasattr(v, 'model_dump'):  # 处理 Pydantic 模型
                result[k] = str(v.model_dump())
            elif isinstance(v, (list, dict)):  # 处理列表和字典
                result[k] = str(v)
            elif isinstance(v, (int, float, bool, str)) or v is None:  # 基础类型保持不变
                result[k] = v
            else:  # 其他类型转为字符串
                result[k] = str(v)
        return result
    return obj

def sanitize_filename(filename):
    """
    清理文件名，移除Windows不允许的特殊字符
    """
    # Windows不允许的特殊字符
    invalid_chars = r'[<>:"/\\|?*（）]'
    # 替换特殊字符为空字符串
    clean_name = re.sub(invalid_chars, '', filename)
    # 移除前后的空格和点
    clean_name = clean_name.strip('. ')
    # 如果文件名为空，返回默认名称
    return clean_name if clean_name else 'default_name'
