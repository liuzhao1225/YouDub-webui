import json
import os
import time
from loguru import logger
from .scheduler import scheduler_loop


def do_queue():
    logger.info("Task queue enabled!")
    scheduler_loop()
    return "Queue processing completed."