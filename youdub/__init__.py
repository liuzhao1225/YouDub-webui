from loguru import logger

# 定义公共日志输出模板
# 使用更详细的时间格式，添加行号和函数名
logger.add(
    "info.log",
    format="{time:YYYY-MM-DD HH:mm:ss.SSS} | {level} | {name}:{function}:{line} | {message}",
    level="INFO",
    rotation="500 MB",    # 当日志文件达到500MB时轮换
    retention="10 days"   # 保留10天的日志
)

# 定义异常日志输出模板
# 添加详细的异常跟踪信息
logger.add(
    "error.log",
    format="{time:YYYY-MM-DD HH:mm:ss.SSS} | {level} | {name}:{function}:{line} | {message}\n{exception}",
    level="ERROR",
    rotation="500 MB",
    retention="10 days",
    backtrace=True,      # 显示完整的异常回溯
    diagnose=True        # 显示变量值等诊断信息
)
