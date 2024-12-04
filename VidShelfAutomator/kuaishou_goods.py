import argparse
import asyncio
import os
import sys
from dotenv import load_dotenv
from playwright.async_api import async_playwright

from Crawler.service.douyin.views import add_account
from Crawler.service.douyin.views.add_account import Param
from Crawler.service.kuaishou.kfx.logic.entity.goods_req import GoodsInfoHomeReq
from VidShelfAutomator.goods_info import get_goods_info
from social_auto_upload.utils.base_social_media import get_platforms, SOCIAL_MEDIA_DOUYIN

# from Crawler.service.kuaishou.kfx.views import get_goods_info, add_account
# from Crawler.service.kuaishou.kfx.views.add_account import Param

load_dotenv()

# 获取当前文件所在目录的父目录（项目根目录）
root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# 将项目根目录添加到系统路径
sys.path.append(root_dir)
from datetime import datetime
from apscheduler.schedulers.blocking import BlockingScheduler


# 补充处理数据
async def auto_pub():
    # asyncio.run(add_account(Param(shop_user_id='7439695424150700328',creator_id='57779263751',cookie="passport_csrf_token=ae14f8d170071b989ce8ea37f09cce11; passport_csrf_token_default=ae14f8d170071b989ce8ea37f09cce11; is_staff_user=false; ucas_c0=CkEKBTEuMC4wEKeIgOSSxeWiZxjmJiCrkJCpx83VBSiwITC7sdDNx82NAkCvrJa6Bkiv4NK8BlCivILKosDT42ZYbxIUvx0Rcpp8TGSIWzWbWZOy6fWv5xg; ucas_c0_ss=CkEKBTEuMC4wEKeIgOSSxeWiZxjmJiCrkJCpx83VBSiwITC7sdDNx82NAkCvrJa6Bkiv4NK8BlCivILKosDT42ZYbxIUvx0Rcpp8TGSIWzWbWZOy6fWv5xg; store-region-src=uid; PHPSESSID=2e3c0fe3c38527402b349977296e9d72; PHPSESSID_SS=2e3c0fe3c38527402b349977296e9d72; qc_tt_tag=1; gfkadpd=2631,22740; s_v_web_id=verify_m3y9i3ta_BAxRA3zD_Ewhk_4u6m_BCXb_vwyQdZDAf4YF; ttwid=1%7C8jms9il5mEEudkHpjlVGjEKH0K8DcTeBzKVjY2T9qJU%7C1732613806%7C604b1400669094bf761b41396f4c9d5de4d7ccb39c4cd31d363ba7a0b2d85b26; uid_tt=db4bf259499d06ddadf118e293a6eb65; uid_tt_ss=db4bf259499d06ddadf118e293a6eb65; sid_tt=f64a9ff93dcf56edd749f73b8acd4fb0; sessionid=f64a9ff93dcf56edd749f73b8acd4fb0; sessionid_ss=f64a9ff93dcf56edd749f73b8acd4fb0; store-region=cn-ha; odin_tt=63923f89a1fcff70204f0df3582d344dbe10309bb7098697343d812de9415521e54856dc5fa447b6fae3b85b4397de076679314b704d8d10ea503acf8f8ae30f; buyin_shop_type=24; buyin_account_child_type=1128; buyin_app_id=1128; buyin_shop_type_v2=24; buyin_account_child_type_v2=1128; buyin_app_id_v2=1128; _tea_utm_cache_3813=undefined; scmVer=1.0.1.8224; ucas_c0_buyin=CkAKBTEuMC4wEICIkLSAseaiZxi9LyD6voCBwMyrAyiPETDUysDltcwyQI-zlroGSI_n0rwGUIy8rMzPvuCiZ1h-EhSESlWPuOUN8uXZgcxVMekbXWhCZQ; ucas_c0_ss_buyin=CkAKBTEuMC4wEICIkLSAseaiZxi9LyD6voCBwMyrAyiPETDUysDltcwyQI-zlroGSI_n0rwGUIy8rMzPvuCiZ1h-EhSESlWPuOUN8uXZgcxVMekbXWhCZQ; sid_guard=f64a9ff93dcf56edd749f73b8acd4fb0%7C1732614543%7C5184000%7CSat%2C+25-Jan-2025+09%3A49%3A03+GMT; sid_ucp_v1=1.0.0-KGFiNjBjOTViZDk2Zjg4OTc4NjU2OTIwNTcxNjA4ZjI3ZjI4MGI5NTgKFwjUysDltcwyEI-zlroGGI8RIAw4CEAmGgJscSIgZjY0YTlmZjkzZGNmNTZlZGQ3NDlmNzNiOGFjZDRmYjA; ssid_ucp_v1=1.0.0-KGFiNjBjOTViZDk2Zjg4OTc4NjU2OTIwNTcxNjA4ZjI3ZjI4MGI5NTgKFwjUysDltcwyEI-zlroGGI8RIAw4CEAmGgJscSIgZjY0YTlmZjkzZGNmNTZlZGQ3NDlmNzNiOGFjZDRmYjA; ttcid=253c309c93ac4eeebac917a52e701bc120; SASID=SID2_7441519428854808884; BUYIN_SASID=SID2_7441519428854808884; tt_scid=Yoe.qDkIpYaSbSFjcygNO-XzSy7hKDkMBbXoQTPfoEQ64H6BE6mYG1Mz9b0V-R0Eee7e; csrf_session_id=723f84859d36f71581f6952eedc2ac87")))
    # asyncio.run(add_account(Param(shop_user_id='1678846353',cookie="bd_ticket_guard_client_web_domain=2; passport_csrf_token=249e89e8ac2e4b7f7cef74a4c97f275f; passport_csrf_token_default=249e89e8ac2e4b7f7cef74a4c97f275f; d_ticket=6d05eec76ff8241d8acfd38871cdbc7b0dda5; passport_assist_user=CkCJmhOHP2wP1g77nEzVm9_n9A6OX7ARES_YPUErmySLKBxWyxxzytpzQH9UKNldaiks4XWSe0PYVyjX3UAS_NHJGkoKPC6q_DbZ_7-P_Ge26-vxc9wymDKNujZxE047NxsCWRMoVDO93N1K8cdF7cvtaNXv5Cqz9a6qdBwzjQaN7BCLtOANGImv1lQgASIBA1cS10I%3D; n_mh=NiSBwB41B7hKcwZENx5-VBRTWuIz4-34IVv93eV9K5U; sso_uid_tt=308cebe66875d7b05995355f07a3cbbe; sso_uid_tt_ss=308cebe66875d7b05995355f07a3cbbe; toutiao_sso_user=e4b7cde992d7cd696b4e9fbd0effe060; toutiao_sso_user_ss=e4b7cde992d7cd696b4e9fbd0effe060; sid_ucp_sso_v1=1.0.0-KGYwMjIxMDE2OGQ0MmEzN2YyMTFjMjYxN2E5YjQwOGQyOTgxMzBmZGEKIAin3pDPrvVnEMn5mLkGGNoWIAwwqr66_QU4BkD0B0gGGgJobCIgZTRiN2NkZTk5MmQ3Y2Q2OTZiNGU5ZmJkMGVmZmUwNjA; ssid_ucp_sso_v1=1.0.0-KGYwMjIxMDE2OGQ0MmEzN2YyMTFjMjYxN2E5YjQwOGQyOTgxMzBmZGEKIAin3pDPrvVnEMn5mLkGGNoWIAwwqr66_QU4BkD0B0gGGgJobCIgZTRiN2NkZTk5MmQ3Y2Q2OTZiNGU5ZmJkMGVmZmUwNjA; passport_auth_status=be5571bbcd5cfa4139361caca9f47e29%2C; passport_auth_status_ss=be5571bbcd5cfa4139361caca9f47e29%2C; uid_tt=fce2db4ed183611b2cf3a05a06272263; uid_tt_ss=fce2db4ed183611b2cf3a05a06272263; sid_tt=a6053f72206860ede9aa481cb606cced; sessionid=a6053f72206860ede9aa481cb606cced; sessionid_ss=a6053f72206860ede9aa481cb606cced; is_staff_user=false; _bd_ticket_crypt_doamin=2; _bd_ticket_crypt_cookie=019fb39d09f009ce1e4fe0cc8746628b; __security_server_data_status=1; sid_guard=a6053f72206860ede9aa481cb606cced%7C1730559183%7C5183997%7CWed%2C+01-Jan-2025+14%3A53%3A00+GMT; sid_ucp_v1=1.0.0-KDkyYTI5NGVjMjNhN2RkOWZmYzAxZmM5NWQ1ODEwZjI2MDY3MDlmNjcKGgin3pDPrvVnEM_5mLkGGNoWIAw4BkD0B0gEGgJsZiIgYTYwNTNmNzIyMDY4NjBlZGU5YWE0ODFjYjYwNmNjZWQ; ssid_ucp_v1=1.0.0-KDkyYTI5NGVjMjNhN2RkOWZmYzAxZmM5NWQ1ODEwZjI2MDY3MDlmNjcKGgin3pDPrvVnEM_5mLkGGNoWIAw4BkD0B0gEGgJsZiIgYTYwNTNmNzIyMDY4NjBlZGU5YWE0ODFjYjYwNmNjZWQ; biz_trace_id=1cad673a; ttwid=1%7Cq9lC2MyGNy3EXBkJB8Zykd767He13wN9P3_9Gk1MW2o%7C1731926350%7Cd277193482a3fb3e5e5194e767dbaffc6d7a6b270d1c2afdf2ca5c7590afe5e9; __ac_nonce=0673b19d700bb49f259f4; __ac_signature=_02B4Z6wo00f01o2xn5QAAIDDh5dEPeimIZqNkZsAAMRj4a; SEARCH_RESULT_LIST_TYPE=%22single%22; x-web-secsdk-uid=bc5da812-b2fe-454c-916f-ba963d7ae9c4; home_can_add_dy_2_desktop=%220%22; hevc_supported=true; csrf_session_id=9845943e7fdc41afc5dfd1b6267b86b0; IsDouyinActive=true; bd_ticket_guard_client_data=eyJiZC10aWNrZXQtZ3VhcmQtdmVyc2lvbiI6MiwiYmQtdGlja2V0LWd1YXJkLWl0ZXJhdGlvbi12ZXJzaW9uIjoxLCJiZC10aWNrZXQtZ3VhcmQtcmVlLXB1YmxpYy1rZXkiOiJCR0l5cEVrUVpJcjB2L2M5VzkyeGJacnNuSmZJYWozNkFneGt5STJYSkx4Z1NpeHQvcXIzK0xsS0RrUTAyd3FGSVpSSnd1OTQ5eDZMR0xPWnk1Z0RkeXM9IiwiYmQtdGlja2V0LWd1YXJkLXdlYi12ZXJzaW9uIjoyfQ%3D%3D; passport_fe_beating_status=true; fpk1=U2FsdGVkX1/DS9b+Vay8sKkKrIRIaPLLrhX0tLpLCFDaIN1a0h1/KaolBBm2smfY20vUslvm2kygC7a5ohH0AA==; fpk2=4f09e01c83d69100c363c33aecfef9f8; odin_tt=5e1c9b764de3fb7d91c5c0389f1268a11151a6a8849fae961385a969f27b379f958230170e6edec9e093f6585f1de9b4; SelfTabRedDotControl=%5B%5D")))
    for platform in get_platforms():
        if platform == SOCIAL_MEDIA_DOUYIN:
            async with async_playwright() as playwright:
                await get_goods_info(1, GoodsInfoHomeReq(key_word=""), platform, playwright)
        else:
            async with async_playwright() as playwright:
                await get_goods_info(1, GoodsInfoHomeReq(key_word=""), platform, playwright)


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
