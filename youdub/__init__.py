import sys
from loguru import logger


def setup_logger():
    """初始化全局日志配置"""
    # 移除默认的处理器
    logger.remove()

    # 添加带有自定义格式的处理器
    format_str = (
        "<green>{time:YYYY-MM-DD HH:mm:ss}</green> | "
        "<level>{level: <8}</level> | "
        "<cyan>{name}</cyan>:<cyan>{function}</cyan>:<cyan>{line}</cyan> - "
        "<level>{message}</level>\n"
        "{exception}"
    )

    logger.add(
        sys.stderr,
        format=format_str,
        level="DEBUG",
        backtrace=True,
        diagnose=True,
        catch=True,  # 捕获异常
        enqueue=True  # 启用异步写入
    )

    # 添加文件日志
    logger.add(
        "logs/error.log",
        rotation="500 MB",
        retention="10 days",
        level="ERROR",
        backtrace=True,
        diagnose=True,
        catch=True,
        enqueue=True
    )


# 在模块导入时自动设置日志配置
setup_logger()

# 导出 logger 实例，使其他模块可以直接从这里导入
__all__ = ['logger']
