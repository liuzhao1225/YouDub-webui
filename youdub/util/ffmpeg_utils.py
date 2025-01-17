import json
import os
import random
import time
import traceback
import glob

import ffmpeg
from PIL import Image
import cv2
import numpy as np
import subprocess

from lxml.etree import PI

from Crawler.lib.logger import logger
from youdub.util.lock_util import with_timeout_lock


def get_video_audio(input_path, duration):
    try:
        # 获取开头和结尾去除的秒数
        start_seconds = int(os.getenv('VIDEO_SPLIT_START_SECONDS', 2))
        end_seconds = int(os.getenv('VIDEO_SPLIT_END_SECONDS', 2))
        duration = float(duration) - start_seconds - end_seconds

        # 将秒数转换为 HH:MM:SS.mmm 格式
        # 先将浮点数转换为整数再进行格式化
        start_time = f"{int(start_seconds) // 3600:02d}:{(int(start_seconds) % 3600) // 60:02d}:{int(start_seconds) % 60:02d}.000"
        end_time = f"{int(duration + start_seconds) // 3600:02d}:{(int(duration + start_seconds) % 3600) // 60:02d}:{int(duration + start_seconds) % 60:02d}.000"

        # 首先尝试使用CUDA硬件加速
        if duration > 60:
            stream = ffmpeg.input(input_path, ss=start_time, to=end_time)
        else:
            stream = ffmpeg.input(input_path)
        audio = stream.audio
        return audio, stream
    except ffmpeg.Error as e:
        logger.warning("CUDA硬件加速失败，切换到软解码模式")
        # 如果硬件加速失败，回退到软解码
        stream = ffmpeg.input(input_path, ss=start_time, to=end_time)
        audio = stream.audio
        return audio, stream


def rotate_video(input_stream, angle=90):
    # 旋转视频
    if angle == 90:
        input_stream = ffmpeg.filter(input_stream, 'transpose', 1)
    elif angle == 180:
        input_stream = ffmpeg.filter(input_stream, 'transpose', 2).filter('transpose', 2)
    elif angle == 270:
        input_stream = ffmpeg.filter(input_stream, 'transpose', 2)
    return input_stream


# 添加水印
def add_random_watermarks(input_stream, paster_dir, img_w, img_h):
    # 获取所有水印图像的路径
    watermark_images = [os.path.join(paster_dir, f) for f in os.listdir(paster_dir) if
                        f.endswith(('.gif', '.png', '.jpg', '.jpeg'))]

    # 定义四个角的位置
    positions = [
        {'x': 0, 'y': 0},
        {'x': 'main_w-overlay_w', 'y': 0},
        {'x': 0, 'y': 'main_h-overlay_h'},
        {'x': 'main_w-overlay_w', 'y': 'main_h-overlay_h'}
    ]

    # 随机选择四个水印图像
    selected_images = random.sample(watermark_images, 4)

    # 逐个添加水印
    result = input_stream
    for i, image_path in enumerate(selected_images):
        watermark = (ffmpeg
                     .input(image_path, stream_loop=-1)
                     .filter('fps', fps=60)
                     .filter('scale', w=img_w, h=img_h)
                     .filter('format', 'rgba'))

        result = (ffmpeg
                  .overlay(result, watermark,
                           x=positions[i]['x'],
                           y=positions[i]['y'],
                           shortest=1))

    return result


def save_stream_to_video(video_stream, audio_stream, output_path, vbr, video_width=None, video_height=None):
    try:
        # 使用硬件加速和优化参数
        stream = ffmpeg.output(
            video_stream, audio_stream, output_path,
            **{
                'c:v': 'hevc_nvenc',          # 使用NVIDIA的HEVC编码器
                'b_ref_mode': 'disabled',      # 禁用B帧参考
                 'rc': 'vbr',
                'cq:v': 24,                    # 视频流的恒定质量参数
                'aspect': '0.562',             # 设置视频宽高比
                'c:a': 'aac',                  # 音频编码器使用AAC
                'ar': 44100,                   # 设置音频采样率为44.1kHz
                'b:a': '192k',                 # 设置音频比特率为192kbps
                'ac': 2,                       # 设置音频通道数为2（立体声）
                'strict': '-2',                # 允许实验性编码器
                'rtbufsize': '30M',            # 实时缓冲区大小为30MB
                'max_muxing_queue_size': 1024, # 设置最大复用队列大小
                'r': 60                        # 设置输出视频的帧率
            }
        )

        # 打印 ffmpeg 命令
        ffmpeg_command = ffmpeg.compile(stream)
        logger.info("FFmpeg command: " + ' '.join(ffmpeg_command))

        ffmpeg.run(stream, overwrite_output=True)
    except ffmpeg.Error as e:
        logger.warning("NVENC编码失败，切换到软编码(libx264)")
        # libx264优化设置 - 高速高质量
        stream = ffmpeg.output(
            video_stream, audio_stream, output_path,
            vcodec='libx264',
            acodec='copy',
            video_bitrate=vbr,
            preset='fast',  # 使用快速预设
            crf=18,         # 使用CRF模式提高质量
            tune='film',
            threads='auto',
            x264opts='rc-lookahead=40:ref=4:subme=9'  # 优化的编码参数
        )

        ffmpeg_command = ffmpeg.compile(stream)
        logger.info("使用软编码的FFmpeg命令: " + ' '.join(ffmpeg_command))

        ffmpeg.run(stream, overwrite_output=True)


def adjust_video_properties(input_stream, saturation=1.0, brightness=0.0, contrast=1.0):
    # 调整视属性：饱和度、亮度和对比度
    input_stream = input_stream.filter('eq', brightness=brightness, contrast=contrast, saturation=saturation)
    return input_stream


def crop_video(input_stream, width, height, crop_size):
    # 裁剪视频
    crop_width = width - 2 * crop_size
    crop_height = height - 2 * crop_size
    return input_stream.filter('crop', crop_width, crop_height, crop_size, crop_size)


def remove_start_end_seconds(input_stream, start_seconds, end_seconds, duration):
    """
    去除视频开头和结束的几秒
    :param input_stream: 输入视频流
    :param start_seconds: 开头去除的秒数
    :param end_seconds: 结尾去除的秒数
    :param duration: 视频的总时长
    :return: 处理后的视频流
    """
    # 计算裁剪后的开始时间和结束时间
    start_time = start_seconds
    end_time = duration - end_seconds

    # 裁剪视频
    input_stream = input_stream.trim(start=start_time, end=end_time).setpts('PTS-STARTPTS')
    return input_stream


def add_pip_to_video(background_video, pip_video, output_video, opacity=1.0):
    # 添加画中画效果
    input_background = ffmpeg.input(background_video)
    input_pip = ffmpeg.input(pip_video)
    pip_scaled = input_pip.filter('scale', 160, 120)
    pip_with_opacity = pip_scaled.filter('lut', u=opacity)
    output = ffmpeg.overlay(input_background, pip_with_opacity, x='W-w-10', y='H-h-10')
    ffmpeg.output(output, output_video, shortest=None).run()


def get_video_files_recursive(directory):
    """
    递归获取目录及其子目录下的所有视频文件

    Args:
        directory: 根目录路径

    Returns:
        list: 视频文件路径列表
    """
    video_extensions = ('.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv')
    video_files = []

    # 使用glob递归搜索所有视频文件
    for ext in video_extensions:
        video_files.extend(glob.glob(os.path.join(directory, '**', f'*{ext}'), recursive=True))

    return video_files


# 目录内短视频拼接去重，用于带货视频生成
def concat_videos(input_folder, output_path, video_width, video_height, video_count):
    # 获取目标时长（默认为60秒，可以从环境变量中获取）
    if video_count == 1:
        target_duration = 1
    else:
        target_duration = float(os.getenv('SHORT_VIDEO_DURATION', 60))

    # 获取input_folder目录下所有的视频文件
    video_files = [os.path.join(input_folder, f) for f in os.listdir(input_folder) if f.endswith('.mp4')]
    random.shuffle(video_files)  # 随机打乱视频顺序

    # 检查是否有视频文件
    if not video_files:
        logger.error(f'目录 {input_folder} 中没有找到视频文件')
        return

    # 初始化临时文件列表和总时长
    temp_files = []
    total_duration = 0
    video_index = 0
    total_video_index = 0

    # 使用while循环，直到达到目标时长或处理完所有视频
    while total_duration < target_duration and video_index < len(video_files):
        video_file = video_files[video_index]
        video_index += 1
        total_video_index += 1
        if video_index >= len(video_files):
            video_index = 0

        try:
            # 获取当前视频的时长和尺寸信息
            probe = ffmpeg.probe(video_file)
            current_duration = float(probe['format']['duration'])

            # 处理当前视频
            video_stream = ffmpeg.input(video_file)
            audio_stream = video_stream.audio
            if video_width and video_height:
                video_stream = video_stream.filter('scale', video_width, video_height)
            # 应用视频特效
            video_stream = apply_video_effects(video_stream, video_width, video_height, current_duration,
                                               need_flip=total_video_index > len(video_files), _hflip=False)
            # base_dir = r'E:\IDEA\workspace\YouDub-webui\data'
            # overlay_files = get_video_files_recursive(base_dir)
            # overlay_videos = random.sample(overlay_files, 3)
            # # 叠加3个画中画视频
            # for i, overlay_video in enumerate(overlay_videos):
            #     overlay = (
            #         ffmpeg.input(overlay_video, stream_loop=-1, t=current_duration)
            #         .filter('scale', video_width, video_height)
            #         .filter('format', 'rgba')
            #         .filter('colorchannelmixer', aa=0.03)
            #     )
            #     video_stream = ffmpeg.overlay(video_stream, overlay)

            # 生成临时文件路径
            temp_file = os.path.join(input_folder, f'temp_{len(temp_files)}.mp4')
            # 保存处理后的视频到临时文件
            save_stream_to_video(video_stream, audio_stream, temp_file, '20000k', video_width, video_height)

            # 添加临时文件到列表
            temp_files.append(temp_file)
            total_duration += current_duration
            logger.info(
                f'添加视频: {os.path.basename(video_file)}, 时长: {current_duration:.2f}秒, 累计时长: {total_duration:.2f}秒')

        except Exception as e:
            logger.exception(f'处理视频 {video_file} 时出错: ', e)
            continue

    if not temp_files:
        logger.error('没有足够的视频文件进行拼接')
        raise Exception('没有足够的视频文件进行拼接')

    logger.info(f'完成视频处理，总时长: {total_duration:.2f}秒，使用了 {len(temp_files)} 个视频片段')

    try:
        # 创建包含所有临时文件路径的文本文件
        concat_list = os.path.join(input_folder, 'concat_list.txt')
        with open(concat_list, 'w', encoding='utf-8') as f:
            for temp_file in temp_files:
                f.write(f"file '{os.path.basename(temp_file)}'\n")

        # 修改拼接命令，添加时间戳处理参数
        concat_command = [
            'ffmpeg', '-f', 'concat', '-safe', '0',
            '-i', concat_list,
            '-c', 'copy',
            '-async', '1',
            '-vsync', '2',
            '-fflags', '+genpts',  # 生成表示时间戳
            '-reset_timestamps', '1',  # 添加重置时间戳参数
            output_path
        ]

        subprocess.run(concat_command, check=True)

        # 清理临时文件
        for temp_file in temp_files:
            try:
                os.remove(temp_file)
            except OSError:
                pass
        try:
            os.remove(concat_list)
        except OSError:
            pass

        logger.info(f'视频已保存至: {output_path}')

    except Exception as e:
        logger.exception(f'拼接视频时出错: {str(e)}')
        # 清理临时文件
        for temp_file in temp_files:
            try:
                os.remove(temp_file)
            except OSError:
                pass
        try:
            os.remove(concat_list)
        except OSError:
            pass
        raise Exception(e)


# 去重视频
@with_timeout_lock(timeout=1, max_workers=1)
def deduplicate_video(info, output_folder):
    video_path = os.path.join(output_folder, 'download.mp4')
    if not os.path.exists(video_path):
        logger.error(f'视频还没下载完毕请稍等: {video_path}')
        traceback.print_exc()
        return

    duration = info.get('duration')
    logger.info(duration)
    if duration is None:
        # 从 video_stream 中获取 duration
        probe = ffmpeg.probe(video_path)
        duration = float(probe['format']['duration'])
    audio_stream, video_stream = get_video_audio(video_path, duration)
    best_format = get_best_bitrate_format(info)
    vbr = best_format.get("vbr", 0)
    if vbr is None or vbr == "":
        best_format = max(info['formats'], key=lambda x: x.get('height', 0) or 0)
        best_resolution = best_format.get('resolution', '3840x2160')
        vbr = calculate_bitrate(best_resolution)
    else:
        vbr = f'{vbr}k'

    # 旋转缩略图并替换原文件
    # thumbnail_path_jpg = os.path.join(output_folder, 'download.jpg')
    # thumbnail_path_webp = os.path.join(output_folder, 'download.webp')
    # thumbnail_path = thumbnail_path_jpg if os.path.exists(thumbnail_path_jpg) else thumbnail_path_webp
    # 旋转封面
    # rotate_if_landscape(thumbnail_path)
    video_stream = apply_video_effects(video_stream, best_format['width'], best_format['height'], duration, _hflip=False)

    logger.info(f'开始对视频做去重处理')
    rotated_video_path = video_path.replace('.mp4', '_final.mp4')
    save_stream_to_video(video_stream, audio_stream, rotated_video_path, vbr)
    logger.info(f'视频已去重至 {output_folder}')


def apply_video_effects(video_stream, width, height, duration, need_flip=False, _hflip=True, is_random=True):
    # 随机决定是否应用缩放和平移效果
    if is_random:
        video_stream = random_zoom_and_pan(video_stream, width, height)

    # 竖屏视频才旋转
    if height < width:
        video_stream = rotate_video(video_stream)
    paster_dir = '../data/video/paster'
    # 添加水印
    if paster_dir and os.path.exists(paster_dir):
        video_stream = add_random_watermarks(video_stream, paster_dir, 100, 100)

    if need_flip:
        # 添加抖动效果
        video_stream = add_shake_effect(video_stream, intensity=random.uniform(0, 1))
        # 添加特效叠加
        video_stream = add_video_effect(
            video_stream,
            effect_dir='../data/video/effects',  # 特效视频目录
            duration=duration,
            width=width,
            height=height
        )
        flip_modes = ['h', 'v', 'hv', 'r90', 'l90', 'r180']
        chosen_flip = random.choice(flip_modes)
        if chosen_flip:
            video_stream = flip_video(video_stream, chosen_flip, width, height)
    elif _hflip:
        # 随机翻转
        if random.choice([True, False]):
            video_stream = ffmpeg.filter(video_stream, 'hflip')

    # 调整视频属性
    video_stream = adjust_video_properties(
        video_stream,
        saturation=random.uniform(0.95, 1.05),
        brightness=random.uniform(0, 0.05),
        contrast=random.uniform(0.95, 1.05)
    )

    base_dir = r'E:\IDEA\workspace\YouDub-webui\data'
    video_files = get_video_files_recursive(base_dir)
    overlay_videos = random.sample(video_files, 4)
    # 叠加4个画中画视频
    for i, overlay_video in enumerate(overlay_videos):
        overlay = (
            ffmpeg.input(overlay_video, stream_loop=-1, t=duration)
            .filter('scale', width // 2, height // 2)  # 确保每个视频占四分之一大小
            .filter('format', 'rgba')
            .filter('colorchannelmixer', aa=0.01)
        )

        # 计算每个画中画视频的位置
        x_pos = (i % 2) * (width // 2)
        y_pos = (i // 2) * (height // 2)

        video_stream = ffmpeg.overlay(video_stream, overlay, x=x_pos, y=y_pos, shortest=1)  # 使用shortest参数

    # 优化模糊背景处理
    background_video = random.choice(video_files)
    video_stream = add_blurred_background(
        input_stream=video_stream,
        background_stream=ffmpeg.input(background_video),
        width=width,
        height=height,
        duration=duration,  # 传入视频时长
        x_percent=random.uniform(1, 3),  # 左右各预留1-3%的边框
        y_percent=random.uniform(1, 2)   # 上下各预留1-3%的边框
    )

    return video_stream


# 旋转图片
def rotate_if_landscape(image_path):
    with Image.open(image_path) as img:
        width, height = img.size
        # 判断是否为横屏
        if width > height:
            # 旋转图像 90 度
            img = img.rotate(-90, expand=True)
            # 检查文件扩展名
            if not image_path.lower().endswith('.jpg'):
                # 如果不是 jpg，修改文件名为 jpg
                image_path = image_path.rsplit('.', 1)[0] + '.jpg'
            img.save(image_path)


# 根据分辨率计算合适的码率
def calculate_bitrate(resolution):
    """根据分辨率计算合适的码率"""
    width, height = map(int, resolution.split('x'))
    if width >= 3840 and height >= 2160:  # 4K
        return '20000k'
    elif width >= 2560 and height >= 1440:  # 2K
        return '10000k'
    elif width >= 1920 and height >= 1080:  # 1080p
        return '5000k'
    elif width >= 1280 and height >= 720:  # 720p
        return '2500k'
    elif width >= 640 and height >= 360:  # 360p
        return '1000k'
    return '1000k'  # 其他情况


# 获取最佳码率格式
def get_best_bitrate_format(info):
    best_format = None
    max_bitrate = 0
    if info.get("platform", None) == 'douyin':
        return info['formats'][0]
    else:
        for fmt in info['formats']:
            if fmt.get('vbr') and fmt['vbr'] > max_bitrate:
                best_format = fmt

    return best_format


def random_shift_channel(frame, max_shift=30):
    # 分离RGB通道
    b, g, r = cv2.split(frame)

    # 随机生成偏移角度和半径
    angle = random.uniform(0, 2 * np.pi)
    radius = random.uniform(0, max_shift)

    # 计算偏移量
    x_shift = int(radius * np.cos(angle))
    y_shift = int(radius * np.sin(angle))

    # 应用位置偏移
    b = np.roll(b, shift=(y_shift, x_shift), axis=(0, 1))
    g = np.roll(g, shift=(-y_shift, -x_shift), axis=(0, 1))
    r = np.roll(r, shift=(y_shift, -x_shift), axis=(0, 1))

    # 合并通道
    shifted_frame = cv2.merge((b, g, r))

    return shifted_frame


def process_video(input_path, output_path):
    # 打开视频文件
    cap = cv2.VideoCapture(input_path)
    # 使用 'mp4v' 编码格式
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    fps = cap.get(cv2.CAP_PROP_FPS)  # 获取原始视频的帧率
    out = cv2.VideoWriter(output_path, fourcc, fps, (int(cap.get(3)), int(cap.get(4))))

    while cap.isOpened():
        ret, frame = cap.read()
        if not ret:
            break

        # 对每一帧应用相同的随机颜色偏移
        shifted_frame = random_shift_channel(frame, max_shift=5)

        # 写入输出视频
        out.write(shifted_frame)

    cap.release()
    out.release()
    cv2.destroyAllWindows()


# 在adjust_video_properties函数之前添加新的翻转函数
def flip_video(input_stream, flip_mode='h', width=None, height=None):
    """
    翻转视频流

    Args:
        input_stream: ffmpeg视频流对象
        flip_mode (str): 翻转模式
            'h'    - 水平翻转 (左右镜像)
            'v'    - 垂直翻转 (上下镜像)
            'hv'   - 同时水平和垂直翻转 (180度旋转)
            'r90'  - 顺时针旋转90度
            'l90'  - 逆时针旋转90度
            'r180' - 顺时针旋转180度
        keep_original_dimensions (bool): 是否保持原始视频的宽高比。
            当设置为True时，对于90度和270度旋转的视频会进行缩放填充以保持原始尺寸。

    Returns:
        ffmpeg.Stream: 处理后的视频流
    """
    valid_modes = {
        'h': lambda x: ffmpeg.filter(x, 'hflip'),
        'v': lambda x: ffmpeg.filter(x, 'vflip'),
        'hv': lambda x: ffmpeg.filter(ffmpeg.filter(x, 'hflip'), 'vflip'),
        'r90': lambda x: rotate_and_scale(x, 1, width, height),  # 顺时针90度
        'l90': lambda x: rotate_and_scale(x, 2, width, height),  # 逆时针90度
        'r180': lambda x: ffmpeg.filter(x, 'transpose', 1).filter('transpose', 1),  # 顺时针180度
    }

    if not isinstance(input_stream, (ffmpeg.Stream, ffmpeg.nodes.FilterableStream)):
        raise TypeError("input_stream必须是有效的ffmpeg流对象")

    if flip_mode not in valid_modes:
        raise ValueError(f"不支持的翻转模式: {flip_mode}。支持的模式: {', '.join(valid_modes.keys())}")

    return valid_modes[flip_mode](input_stream)


def rotate_and_scale(stream, transpose_params, width, height):
    """旋转视频并在需要时进行缩放填充"""
    rotated = ffmpeg.filter(stream, 'transpose', transpose_params)
    return (
        rotated
        .filter('scale', w=width, h=height, force_original_aspect_ratio='increase')
        .filter('crop', w=width, h=height)
    )


def get_random_effect_video(effect_dir):
    # 获取effect_dir目录下所有的视频文件
    effect_videos = [os.path.join(effect_dir, f) for f in os.listdir(effect_dir) if f.endswith(('.mp4', '.mov'))]
    if not effect_videos:
        logger.error(f'目录 {effect_dir} 中没有找到特效视频文件')
        return None
    return random.choice(effect_videos)


def add_video_effect(input_stream, effect_dir, width, height, duration):
    """
    为视频添加特效叠加效果

    Args:
        input_stream: 输入视频流
        effect_dir: 特效视频目录路径
        duration: 视频时长

    Returns:
        处理后的视频流
    """
    effect_video = get_random_effect_video(effect_dir)
    if effect_video is None:
        logger.warning('未找到特效视频，返回原始视频流')
        return input_stream

    return (input_stream.overlay(
        ffmpeg.input(effect_video, stream_loop=-1, t=duration)  # 循环特效视频并设置时长
        .filter('scale', width, height)  # 调整特效素材大小
        .filter('format', 'rgba')
        .filter('colorchannelmixer', aa=random.uniform(0.01, 0.05))  # 设置透明度
    ))


def speed_change_video(input_stream, speed_factor=1.0):
    """
    改变视频播放速度

    Args:
        input_stream: ffmpeg视频流对象
        speed_factor: 速度因子 (0.5=减半速度, 2.0=倍速)

    Returns:
        ffmpeg.Stream: 处理后的视频流
    """
    if not 0.5 <= speed_factor <= 2.0:
        raise ValueError("速度因子必须在0.5到2.0之间")

    # 视频速度调整
    video = input_stream.filter('setpts', f'{1 / speed_factor}*PTS')
    return video


def add_transition_effect(input_stream, effect_type='fade'):
    """
    添加视频转场效果

    Args:
        input_stream: 输入视频流
        effect_type: 转场效果类型
            'fade' - 淡入淡出
            'wipe' - 擦除效果
            'dissolve' - 溶解效果

    Returns:
        处理后的视频流
    """
    TRANSITION_EFFECTS = {
        'fade': lambda x: (
            x.filter('fade', type='in', duration=1)
            .filter('fade', type='out', duration=1, start_time='duration-1')
        ),
        'wipe': lambda x: x.filter('wipe', duration=1),
        'dissolve': lambda x: x.filter('dissolve', duration=1)
    }

    if effect_type not in TRANSITION_EFFECTS:
        raise ValueError(f"不支持的转场效果: {effect_type}")

    return TRANSITION_EFFECTS[effect_type](input_stream)


def add_video_filter(input_stream, filter_type='vintage'):
    """
    添加视频滤镜效果

    Args:
        input_stream: 输入视频流
        filter_type: 滤镜类型
            'vintage' - 复古效果
            'vignette' - 暗角效果
            'film' - 电影效果
            'blur' - 模糊效果

    Returns:
        处理后的视频流
    """
    FILTER_EFFECTS = {
        'vintage': lambda x: (
            x.filter('colorbalance', rs=0.1, gs=0.1, bs=0.1)
            .filter('curves', r='0/0.11 1/0.95', g='0/0 1/0.95', b='0/0.22 1/0.95')
        ),
        'vignette': lambda x: x.filter('vignette', angle=PI / 4),
        'film': lambda x: (
            x.filter('unsharp')
            .filter('noise', alls=7, allf='t')
            .filter('eq', contrast=1.1)
        ),
        'blur': lambda x: x.filter('gblur', sigma=1.2)
    }

    if filter_type not in FILTER_EFFECTS:
        raise ValueError(f"不支持的滤镜效果: {filter_type}")

    return FILTER_EFFECTS[filter_type](input_stream)


def add_shake_effect(input_stream, intensity):
    """
    添加视频抖动效果

    Args:
        input_stream: 输入视频流
        intensity: 抖动强度 (0-10)
            0: 无抖动
            1-3: 轻微抖动
            4-7: 中等抖动
            8-10: 剧烈抖动

    Returns:
        处理后的视频流
    """
    print(f'************{intensity}******************')

    if intensity == 0:
        return input_stream
    if not 0 < intensity <= 10:
        raise ValueError("抖动强度必须在1到10之间")

    # 调整计算参数使抖动更加柔和
    frequency = intensity  # 降低频率
    amplitude = intensity * 0.2  # 降低幅度系数，使最小抖动更加轻微

    # 生成抖动表达式
    expr = f"{amplitude}*sin({frequency}*t)"

    # 应用抖动效果
    return input_stream.filter(
        'rotate',
        angle=expr,
        fillcolor='black',
        bilinear=1
    )


def process_video_stream_advanced(input_stream, effects=None):
    """
    高级视频处理流程

    Args:
        input_stream: 输入视频流
        effects: 字典，包含要应用的效果及其参数
            {
                'speed': 1.2,
                'transition': 'fade',
                'filter': 'vintage',
                'shake': 3
            }

    Returns:
        处理后的视频流
    """
    if effects is None:
        effects = {}

    # 应用速度变化
    if 'speed' in effects:
        input_stream = speed_change_video(input_stream, effects['speed'])

    # 应用转场效果
    if 'transition' in effects:
        input_stream = add_transition_effect(input_stream, effects['transition'])

    # 应用滤镜效果
    if 'filter' in effects:
        input_stream = add_video_filter(input_stream, effects['filter'])

    # 应用抖动效果
    if 'shake' in effects:
        input_stream = add_shake_effect(input_stream, effects['shake'])

    return input_stream


def add_transparent_overlay(
        input_video: str,
        overlay_video: str,
        output_path: str,
        opacity: float = 0.01
) -> None:
    """
    为视频添加全屏透明画中画效果，画中画视频会循环播放以匹配主视频时长

    Args:
        input_video: 主视频路径
        overlay_video: 要叠加的视频路径
        output_path: 输出视频路径
        opacity: 透明度 (0.0 完全透明 - 1.0 完全不透明)
    """
    try:
        # 获取主视频信息
        probe = ffmpeg.probe(input_video)
        video_info = next(s for s in probe['streams'] if s['codec_type'] == 'video')
        width = int(video_info['width'])
        height = int(video_info['height'])
        duration = float(probe['format']['duration'])  # 获取主视频时长

        # 设置主视频流
        main = ffmpeg.input(input_video)

        # 设置画中画视频流，缩放至与主视频相同大小，并循环播放
        overlay = (
            ffmpeg.input(overlay_video, stream_loop=-1, t=duration)  # stream_loop=-1表示无限循环，t=duration限制总时长
            .filter('scale', width, height)
            .filter('format', 'rgba')
            .filter('colorchannelmixer', aa=opacity)  # 设置透明度
        )

        # 合并视频流
        output = ffmpeg.overlay(main, overlay)

        # 输出处理后的视频
        output = ffmpeg.output(output, output_path)

        # 打印 ffmpeg 命令
        ffmpeg_command = ffmpeg.compile(output)
        logger.info("FFmpeg command: " + ' '.join(ffmpeg_command))

        # 执行FFmpeg命令
        output.run(overwrite_output=True)

    except ffmpeg.Error as e:
        logger.error(f'FFmpeg 错误: {e.stderr.decode()}')
    except Exception as e:
        logger.error(f'发生错误: {str(e)}')
        traceback.print_exc()


def random_zoom_and_pan(input_stream, width, height, zoom_range=(1.05, 1.1)):
    """
    随机放大视频并进行水平和垂直方向的平移，最后裁剪回原始尺寸

    Args:
        input_stream: 输入视频流
        width: 原始视频宽度
        height: 原始视频高度
        zoom_range: 放大倍数范围，默认(1.05, 1.1)

    Returns:
        处理后的视频流
    """
    # 随机生成缩放比例
    zoom = random.uniform(zoom_range[0], zoom_range[1])

    # 计算可移动的最大距离（基于缩放后的尺寸）
    # 将移动范围从比例转换为像素，比如1.2倍放大就是可以移动原始尺寸的0.2
    max_move_x = int((zoom - 1.0) * width)  # 使用实际宽度
    max_move_y = int((zoom - 1.0) * height)  # 使用实际高度

    # 随机生成x和y方向的移动距离
    # 水平方向移动
    x_move = random.randint(0, max_move_x) * random.choice([-1, 1])
    # 垂直方向移动
    y_move = random.randint(0, max_move_y) * random.choice([-1, 1])

    # 应用缩放和平移效果
    return (input_stream
            .filter('scale',
                   f'iw*{zoom}',
                   f'ih*{zoom}',
                   flags='fast_bilinear')  # 使用更快的缩放算法
            .filter('crop',
                    width, height,  # 直接使用原始尺寸
                    f'(in_w-{width})/2 + {x_move}',  # x偏移
                    f'(in_h-{height})/2 + {y_move}')  # y偏移
            )

def concat_videos_horizontally(random_video,
                             fixed_video,
                             fixed_video_position,
                             output_path):
    """
    将两个视频左右拼接在一起，以固定视频长度为准

    Args:
        random_video: 随机视频路径
        fixed_video: 固定视频路径
        fixed_video_position: 固定视频位置 ('left' 或 'right')
        output_path: 输出视频路径
    """
    try:
        # 确定左右视频位置

        # 获取固定视频信息
        fixed_probe = ffmpeg.probe(fixed_video)
        fixed_duration = float(fixed_probe['format']['duration'])
        fixed_video_info = next(s for s in fixed_probe['streams'] if s['codec_type'] == 'video')
        fixed_width = int(fixed_video_info['width'])
        fixed_height = int(fixed_video_info['height'])

        # 获取随机视频信息
        random_probe = ffmpeg.probe(random_video)
        random_video_info = next(s for s in random_probe['streams'] if s['codec_type'] == 'video')
        random_width = int(random_video_info['width'])
        random_height = int(random_video_info['height'])

        # 计算等高缩放后的宽度
        target_height = fixed_height
        scaled_random_width = int(random_width * (target_height / random_height))

        # 计算最终合并后的尺寸
        final_width = scaled_random_width + fixed_width
        final_height = target_height

        # 设置视频流
        random_stream = (
            ffmpeg.input(random_video, stream_loop=-1, t=fixed_duration)
            .filter('scale', scaled_random_width, target_height)
        )

        fixed_stream = (
            ffmpeg.input(fixed_video)
            .filter('scale', fixed_width, target_height)
        )

        # 根据位置设置左右视频流
        left_stream = fixed_stream if fixed_video_position == 'left' else random_stream
        right_stream = random_stream if fixed_video_position == 'left' else fixed_stream

        # 使用hstack滤镜水平拼接视频
        video_stream = ffmpeg.filter([left_stream, right_stream], 'hstack', inputs=2)

        # 应用视频特效
        if os.path.exists('../data/video/paster'):
            video_stream = add_random_watermarks(video_stream, '../data/video/paster', 100, 100)

        # 调整视频属性
        video_stream = adjust_video_properties(
            video_stream,
            saturation=random.uniform(0.95, 1.05),
            brightness=random.uniform(0, 0.05),
            contrast=random.uniform(0.95, 1.05)
        )

        # 添加模糊背景
        base_dir = r'E:\IDEA\workspace\YouDub-webui\data'
        video_files = get_video_files_recursive(base_dir)
        if video_files:
            # video_stream = add_blurred_background(
            #     input_stream=video_stream,
            #     background_stream=ffmpeg.input(random.choice(video_files)),
            #     width=final_width,
            #     height=final_height,
            #     duration=fixed_duration,
            #     x_percent=random.uniform(1, 3),
            #     y_percent=random.uniform(1, 2)
            # )
            # 计算边框尺寸
            x_margin = int(final_width * 2 / 100)
            y_margin = int(final_height * 1 / 100)

            # 计算中心视频的尺寸
            center_width = final_width - (2 * x_margin)
            center_height = final_height - (2 * y_margin)

            # 设置背景视频循环播放并匹配输入视频时长
            looped_background = (ffmpeg.input(random.choice(video_files))
                                 .filter('loop', loop=-1, size=10000)  # 设置循环，-1表示无限循环
                                 .filter('trim', duration=fixed_duration)  # 裁剪到与输入视频相同的时长
                                 .filter('scale', final_width, final_height, force_original_aspect_ratio='increase')  # 保持宽高比缩放
                                 .filter('crop', final_width, final_height)
                                 .filter('boxblur', 10))  # 添加模糊效果

            # 优化中心视频的缩放，使用智能缩放逻辑
            scaled_input = video_stream.filter('scale', center_width, center_height)

            # 叠加视频
            video_stream = ffmpeg.overlay(looped_background, scaled_input, x=x_margin, y=y_margin)

        # 输出处理后的视频
        output = ffmpeg.output(
            video_stream,
            ffmpeg.input(fixed_video).audio,
            output_path,
            **{
                'c:v': 'hevc_nvenc',          # 使用NVIDIA的HEVC编码器
                'b_ref_mode': 'disabled',      # 禁用B帧参考
                'cq:v': 24,                    # 视频流的恒定质量参数
                'preset': 'p4',                # NVENC的快速预设
                'rc': 'vbr',                   # 使用可变比特率
                'c:a': 'aac',                  # 音频编码器使用AAC
                'b:a': '192k',                 # 音频比特率
                'ar': 44100,                   # 音频采样率
                'ac': 2,                       # 音频通道数
                'max_muxing_queue_size': 1024  # 最大复用队列大小
            }
        )

        # 打印 ffmpeg 命令
        ffmpeg_command = ffmpeg.compile(output)
        logger.info("FFmpeg command: " + ' '.join(ffmpeg_command))

        # 执行FFmpeg命令
        output.run(overwrite_output=True)

        logger.info(f"视频已成功拼接并保存至: {output_path}")
        logger.info(f"最终视频尺寸: {final_width}x{final_height}")

    except ffmpeg.Error as e:
        logger.error(f'FFmpeg 错误: {e.stderr.decode() if e.stderr else str(e)}')
        raise
    except Exception as e:
        logger.error(f'发生错误: {str(e)}')
        traceback.print_exc()
        raise

def add_blurred_background(input_stream, background_stream, width, height, duration, x_percent=5, y_percent=5):
    """
    将输入视频叠加到模糊背景的中间位置，并保留可配置的边框。
    背景视频会循环播放以匹配输入视频的长度。
    同时兼容横屏和竖屏视频。

    Args:
        input_stream: 主视频流
        background_stream: 背景视频流
        width: 输出视频宽度
        height: 输出视频高度
        duration: 输入视频的时长（秒）
        x_percent: 左右边框占比(%)
        y_percent: 上下边框占比(%)

    Returns:
        ffmpeg.Stream: 处理后的视频流
    """
    # 计算边框尺寸
    x_margin = int(width * x_percent / 100)
    y_margin = int(height * y_percent / 100)

    # 计算中心视频的尺寸
    center_width = width - (2 * x_margin)
    center_height = height - (2 * y_margin)

    # 设置背景视频循环播放并匹配输入视频时长
    looped_background = (background_stream
         .filter('loop', loop='-1', size=str(int(duration * 60)))  # 设置循环帧数
         .filter('trim', duration=duration)  # 裁剪到与输入视频相同的时长
         .filter('scale', width/20, height/20)  # 降低缩放比例以提高速度
         .filter('boxblur', 5)  # 降低模糊强度
         .filter('scale', width, height, force_original_aspect_ratio='increase')  # 保持宽高比缩放
         .filter('crop', width, height))  # 添加模糊效果

    # 优化中心视频的缩放，使用智能缩放逻辑
    scaled_input = input_stream.filter('scale', center_width, center_height)

    # 叠加视频
    return ffmpeg.overlay(looped_background, scaled_input, x=x_margin, y=y_margin)

def get_random_video(directory, exclude_path=None):
    """
    从指定目录随机获取一个视频文件

    Args:
        directory: 视频目录路径
        exclude_path: 要排除的视频路径

    Returns:
        str: 随机视频的完整路径
    """
    video_extensions = ('.mp4', '.avi', '.mov', '.mkv', '.flv', '.wmv')
    video_files = []

    # 获取所有视频文件
    for ext in video_extensions:
        video_files.extend(glob.glob(os.path.join(directory, f'*{ext}')))

    # 如果有需要排除的文件，从列表中移除
    if exclude_path and exclude_path in video_files:
        video_files.remove(exclude_path)

    if not video_files:
        raise Exception(f"在目录 {directory} 中没有找到可用的视频文件")

    return random.choice(video_files)

def merge_video_audio(video_path1, video_path2, output_path):
    """
    使用 ffmpeg-python 合并视频和音频流

    Args:
        video_path1: 第一个视频文件路径
        video_path2: 第二个视频文件路径
        output_path: 输出文件路径
    """
    try:
        # 输入视频和音频
        video_input1 = ffmpeg.input(video_path1)
        video_input2 = ffmpeg.input(video_path2)

        # 合并视频和音频流
        output = ffmpeg.output(
            video_input1['v'],  # 从第一个视频获取视频流
            video_input2['v'],  # 从第二个视频获取视频流
            video_input1['a:0'],  # 从第一个视频获取第一个音频流
            video_input2['a:0'],  # 从第二个视频获取第一个音频流
            output_path,
            vcodec='copy',  # 视频流不重新编码
            acodec='copy',  # 音频流不重新编码
            strict='experimental'  # 允许实验性编码器
        )

        # 打印 ffmpeg 命令
        ffmpeg_command = ffmpeg.compile(output)
        print("FFmpeg command: " + ' '.join(ffmpeg_command))

        # 执行合并
        ffmpeg.run(output, overwrite_output=True)
        logger.info(f"视频和音频已合并至: {output_path}")

    except ffmpeg.Error as e:
        error_message = e.stderr.decode() if e.stderr else "No error message available"
        logger.error(f"合并视频和音频时出错: {error_message}")
        traceback.print_exc()


if __name__ == '__main__':
    start_time = time.time()

    try:
        # 测试视频路径
        input_video = "E:\IDEA\workspace\YouDub-webui\youdub\\videos\\20160519 160519 레이샤 LAYSHA 고은 - Chocolate Cream 신한대축제 직캠 fancam by zam\download.mp4"
        background_video = r"E:\IDEA\workspace\YouDub-webui\data\douyin\videos\zf\zfy\oo62QRII5IJhejIODTfFmMAQGeAZLCgXfE4cvI.mp4"
        output_path = "E:\IDEA\workspace\YouDub-webui\youdub\\videos\\20160519 160519 레이샤 LAYSHA 고은 - Chocolate Cream 신한대축제 직캠 fancam by zam\output_with_background.mp4"
        with open(r'E:\IDEA\workspace\YouDub-webui\social_auto_upload\videos\Angel_Wings\IG78VChJg0c_20240929_4K60P_240929_世_界_級_的_李_多_慧_迄今為止最強Solo舞完整版_在舞台上每一秒都是經典_Dragon_Beauties_味全龍_小龍女_李多慧_이다혜_台北大巨蛋\download.info.json', 'r', encoding='utf-8') as f:
            info = json.load(f)
        deduplicate_video(info, r'E:\IDEA\workspace\YouDub-webui\social_auto_upload\videos\Angel_Wings\IG78VChJg0c_20240929_4K60P_240929_世_界_級_的_李_多_慧_迄今為止最強Solo舞完整版_在舞台上每一秒都是經典_Dragon_Beauties_味全龍_小龍女_李多慧_이다혜_台北大巨蛋')
        # # 获取输入视频信息
        # probe = ffmpeg.probe(input_video)
        # video_info = next(s for s in probe['streams'] if s['codec_type'] == 'video')
        # width = int(video_info['width'])
        # height = int(video_info['height'])
        # duration = float(probe['format']['duration'])  # 获取视频时长
        #
        # # 创建输入流
        # input_stream = ffmpeg.input(input_video)
        # background_stream = ffmpeg.input(background_video)
        #
        # # 获取音频流
        # audio_stream = input_stream.audio
        #
        # # 应用模糊背景效果
        # video_stream = add_blurred_background(
        #     input_stream=input_stream,
        #     background_stream=background_stream,
        #     width=width,
        #     height=height,
        #     duration=duration,  # 传入视频时长
        #     x_percent=3,  # 左右各预留10%的边框
        #     y_percent=2   # 上下各预留10%的边框
        # )
        #
        # # 输出处理后的视频
        # output = ffmpeg.output(
        #     video_stream,
        #     audio_stream,  # 保留原始音频
        #     output_path,
        #     **{
        #         'c:v': 'hevc_nvenc',          # 使用NVIDIA的HEVC编码器
        #         'b_ref_mode': 'disabled',      # 禁用B帧参考
        #         'cq:v': 24,                    # 视频流的恒定质量参数
        #         'preset': 'p4',                # NVENC的快速预设
        #         'rc': 'vbr',                   # 使用可变比特率
        #         'c:a': 'aac',                  # 音频编码器使用AAC
        #         'b:a': '192k',                 # 音频比特率
        #         'ar': 44100,                   # 音频采样率
        #         'ac': 2,                       # 音频通道数
        #         'max_muxing_queue_size': 1024  # 最大复用队列大小
        #     }
        # )
        #
        # # 打印 ffmpeg 命令
        # ffmpeg_command = ffmpeg.compile(output)
        # logger.info("FFmpeg command: " + ' '.join(ffmpeg_command))
        #
        # # 执行FFmpeg命令
        # output.run(overwrite_output=True)

        end_time = time.time()
        processing_time = end_time - start_time
        print(f"视频处理完成，总耗时: {processing_time:.2f} 秒")
        logger.info(f"输出视频保存至: {output_path}")
        
    except Exception as e:
        logger.error(f"处理视频时出错: {str(e)}")
        traceback.print_exc()

    # 其他现有的测试代码...
