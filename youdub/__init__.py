from loguru import logger

# 定义公共日志输出模板
logger.add("info.log", format="{time} {level} {message}", level="INFO")

# 定义异常日志输出模板
logger.add("error.log", format="{time} {level} {message} {exception}", level="ERROR")
