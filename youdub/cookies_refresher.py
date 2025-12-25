# coding=gb2312

import time
import random
import redis
import json
from selenium.webdriver.chrome.options import Options
import undetected_chromedriver as uc


REDIS_HOST = 'localhost'
REDIS_PORT = 6379
POOL_KEY = "youtube:cookies:pool"
COOKIES_TXT_PATH = "cookies.txt"


# -------------------------------
# Redis Cookie Pool 管理
# -------------------------------
class CookiePool:
    def __init__(self):
        self.r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)

    def add_cookie(self, cookie_dict):
        # 使用 timestamp 作为 key 避免覆盖
        key = str(int(time.time()))
        self.r.hset(POOL_KEY, key, json.dumps(cookie_dict))

    def get_random_cookie(self):
        all_cookies = self.r.hgetall(POOL_KEY)
        if not all_cookies:
            return None
        return random.choice(list(all_cookies.values()))


# -------------------------------
# Selenium + UC 自动获取 cookies
# -------------------------------
def init_browser():
    options = Options()
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
    # options.add_argument("--headless=new")  # 重要：后台无界面运行
    driver = uc.Chrome(options=options)
    return driver

def fetch_youtube_cookies(driver=None):
    print("[INFO] 启动浏览器获取 YouTube cookies ...")

    options = uc.ChromeOptions()
    options.add_argument("--disable-blink-features=AutomationControlled")
    options.add_argument("--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
    
    # options.add_argument("--headless=new")  # 重要：后台无界面运行
    if driver is None:
        driver = init_browser()
    driver.get("https://www.youtube.com")

    # 第一次运行需手动登录
    time.sleep(60)

    cookies = driver.get_cookies()

    # 格式化成 dict 方便存储
    cookie_dict = {c["name"]: c["value"] for c in cookies}

    print("[INFO] Cookies 获取成功，共 {} 条".format(len(cookie_dict)))
    return cookie_dict, cookies


# -------------------------------
# 写入 yt-dlp 可用的 cookies.txt
# -------------------------------
def write_netscape_cookies_txt(cookies):
    print("[INFO] 写入 cookies.txt ...")
    
    with open(COOKIES_TXT_PATH, "w", encoding="utf-8") as f:
        f.write("# Netscape HTTP Cookie File\n")

        for c in cookies:
            domain = "." + c["domain"].lstrip(".")
            f.write(
                "{}\t{}\t{}\t{}\t{}\t{}\t{}\n".format(
                    domain,
                    "TRUE",
                    c.get("path", "/"),
                    "TRUE" if c.get("secure") else "FALSE",
                    int(c.get("expiry", 0)),
                    c["name"],
                    c["value"]
                )
            )

    print("[INFO] cookies.txt 写入完成")


# -------------------------------
# 主循环：每 10～30 分钟自动刷新 cookies
# -------------------------------
def auto_refresh_cookies():
    pool = CookiePool()
    driver = init_browser()
    while True:
        try:
            cookie_dict, raw_cookies = fetch_youtube_cookies(driver)

            # 写入 cookies.txt（yt-dlp 可用）
            write_netscape_cookies_txt(raw_cookies)

            # 写入 Redis Cookie Pool
            pool.add_cookie(cookie_dict)

            print("[INFO] 已更新 Redis & cookies.txt")

        except Exception as e:
            print("[ERROR]", e)

        # 随机等待 5～10 分钟
        wait_min = random.randint(5, 10)
        print(f"[INFO] 下次刷新将在 {wait_min} 分钟后执行...")
        time.sleep(wait_min * 60)


if __name__ == "__main__":
    auto_refresh_cookies()
