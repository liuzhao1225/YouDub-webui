import threading
import time
from functools import wraps

# 存储每个方法的信号量
_method_locks = {}
_locks_lock = threading.Lock()

def with_timeout_lock(timeout=60, max_workers=1):
    """
    装饰器：限制同一个方法同时执行的最大数量
    timeout: 超时时间（秒）
    max_workers: 最大并发数，默认为1
    """
    def decorator(func):
        # 为每个方法创建唯一的信号量
        method_key = f"{func.__module__}.{func.__qualname__}"
        
        @wraps(func)
        def wrapper(*args, **kwargs):
            # 确保线程安全地获取或创建信号量
            with _locks_lock:
                if method_key not in _method_locks:
                    _method_locks[method_key] = threading.Semaphore(max_workers)
                method_lock = _method_locks[method_key]
            
            start_time = time.time()
            while True:
                # 尝试获取信号量，等待1秒
                if method_lock.acquire(timeout=1):
                    try:
                        return func(*args, **kwargs)
                    finally:
                        method_lock.release()

                # 检查是否超时
                if time.time() - start_time > timeout:
                    raise TimeoutError(f"等待执行超时（{timeout}秒）")

                # 等待后继续尝试
                time.sleep(1)
        return wrapper
    return decorator