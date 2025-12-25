# scheduler.py
import threading
import time
from loguru import logger
import torch
from .task_manager import load_tasks, save_single_task
from .step_functions import *
from concurrent.futures import ThreadPoolExecutor

RESOURCE_LIMITS = {"gpu": 1, "cpu": 1, "web": 2}
CURRENT_USAGE = {"gpu": 0, "cpu": 0, "web": 0}

STEPS = [
    "download",
    "demucs",
    "whisper",
    "translate",
    "tts",
    "synthesis",
    "info",
    "upload",
]

STEP_TO_RESOURCE = {
    "download": "web",
    "demucs": "gpu",
    "whisper": "gpu",
    "translate": "web",
    "tts": "gpu",
    "synthesis": "cpu",
    "info": None,
    "upload": "web",
}

STEP_FUNCTIONS = {
    "download": step_download,
    "demucs": step_demucs,
    "whisper": step_whisper,
    "translate": step_translate,
    "tts": step_tts,
    "synthesis": step_synthesis,
    "info": step_info,
    "upload": step_upload,
}

executor = ThreadPoolExecutor(max_workers=3)
lock = threading.Lock()


def try_run_next_step(task):
    step_name = STEPS[task["step"]]
    resource = STEP_TO_RESOURCE[step_name]

    # Check resource availability
    if resource and CURRENT_USAGE[resource] >= RESOURCE_LIMITS[resource]:
        return False # wait for resource

    logger.info(f"Dispatch {step_name} for {task['url']}")

    # Occupy resource
    if resource:
        CURRENT_USAGE[resource] += 1

    # Submit thread execution
    future = executor.submit(run_step, task, step_name)
    future.add_done_callback(
        lambda f: step_callback(f, task, resource)
    )
    return True


def run_step(task, step_name):
    func = STEP_FUNCTIONS[step_name]
    return func(task)


def step_callback(future, task, resource):
    global CURRENT_USAGE

    exc = future.exception()
    if exc:
        logger.error(f"Step failed: {exc}")
        task["status"] = "failed"
    else:
        result = future.result()
        task["folder"] = result
        task["step"] += 1
        if task["step"] >= len(STEPS):
            task["status"] = "success"
        else:
            task["status"] = "pending"

    # Release resource
    if resource:
        CURRENT_USAGE[resource] -= 1

    # Save task status
    save_single_task(task)


def scheduler_loop():
    logger.info("Scheduler started...")
    while True:
        tasks = load_tasks()
        any_pending = False
        for task in tasks:
            if task["status"] != "pending":
                continue
            any_pending = True
            if try_run_next_step(task):
                task["status"] = "running"
                save_single_task(task)
                break

        if not any_pending and all(x["status"] != "pending" for x in tasks):
            logger.info("All tasks finished, waiting...")
        else:
            logger.info("Waiting for resources or next task...")

        logger.info(f"CUDA Mem Reserved: {torch.cuda.memory_reserved()}")

        time.sleep(5)  # polling tick
