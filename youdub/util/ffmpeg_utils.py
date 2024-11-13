import os
import random
import time
import traceback

import ffmpeg
from PIL import Image
from loguru import logger
import cv2
import numpy as np
import subprocess


def get_video_audio(input_path, duration):
    try:
        # 获取开头和结尾去除的秒数
        start_seconds = int(os.getenv('VIDEO_SPLIT_START_SECONDS', 2))
        end_seconds = int(os.getenv('VIDEO_SPLIT_END_SECONDS', 2))
        duration = duration - start_seconds - end_seconds
        # 首先尝试使用CUDA硬件加速
        stream = ffmpeg.input(input_path, ss=start_seconds, t=duration, hwaccel='cuda')
        audio = stream.audio
        return audio, stream
    except ffmpeg.Error as e:
        logger.warning("CUDA硬件加速失败，切换到软解码模式")
        # 如果硬件加速失败，回退到软解码
        stream = ffmpeg.input(input_path, ss=start_seconds, t=duration)
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


def add_img_sy(watermark_image_path, input_stream, x, y, img_w, img_h):
    # 处理 GIF 水印
    watermark_stream = ffmpeg.input(watermark_image_path, stream_loop=-1)
    watermark_stream = ffmpeg.filter(watermark_stream, 'scale', w=img_w, h=img_h)
    input_stream = ffmpeg.overlay(input_stream, watermark_stream, x=x, y=y, shortest=1)
    return input_stream


def add_random_watermarks(input_stream, paster_dir, img_w, img_h):
    # 获取所有水印图像的路径
    watermark_images = [os.path.join(paster_dir, f) for f in os.listdir(paster_dir) if
                        f.endswith(('.gif', '.png', '.jpg', '.jpeg'))]

    # 定义四个角的位置
    positions = [(0, 0), ('main_w-overlay_w', 0), (0, 'main_h-overlay_h'), ('main_w-overlay_w', 'main_h-overlay_h')]

    # 随机选择四个水印图像
    selected_images = random.sample(watermark_images, 4)

    for i, image_path in enumerate(selected_images):
        x, y = positions[i]
        input_stream = add_img_sy(image_path, input_stream, x, y, img_w, img_h)

    return input_stream


def save_stream_to_video(video_stream, audio_stream, output_path, vbr):
    try:
        # 移除 'k' 后缀并转换为浮点数
        vbr_value = float(vbr.replace('k', ''))
        # 使用 round() 确保结果更精确，避免出现过多小数位
        maxrate = f"{round(vbr_value * 1.5, 0)}k"  # 最大码率为目标码率的1.5倍
        bufsize = f"{round(vbr_value * 2, 0)}k"    # 缓冲区大小设为目标码率的2倍
        print(maxrate)
        # NVENC优化设置 - 高速高质量
        stream = ffmpeg.output(
            video_stream, audio_stream, output_path,
            vcodec='h264_nvenc',
            acodec='copy',
            video_bitrate=vbr,
            maxrate=maxrate,      # 最大码率限制
            bufsize=bufsize,      # 添加缓冲区大小设置
            # rc='vbr',            # 明确指定使用VBR模式
            # qmin=20,  # 保证最高质量
            # qmax=23,  # 限制质量下限
            # profile='high',
            preset='p5',  # 提高质量的预设
            spatial_aq=1,  # 保持空间细节
            temporal_aq=1,  # 保持动态质量
            rc_lookahead=32,  # 增加前向分析窗口
            b_ref_mode='middle'  # 保持好的压缩率
        )

        # 打印 ffmpeg 命令
        ffmpeg_command = ffmpeg.compile(stream)
        logger.info("FFmpeg command:", ' '.join(ffmpeg_command))

        ffmpeg.run(stream, overwrite_output=True)
    except ffmpeg.Error as e:
        logger.warning("NVENC编码失败，切换到软编码(libx264)")
        # libx264优化设置 - 高速高质量
        stream = ffmpeg.output(
            video_stream, audio_stream, output_path,
            vcodec='libx264',
            acodec='copy',
            video_bitrate=vbr,
            preset='slow',  # 提高质量的预设
            crf=18,  # 使用CRF模式提高质量
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


# 去重视频
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
    audio_stream, video_stream = get_video_audio(video_path,duration)
    best_format = get_best_bitrate_format(info)
    vbr = best_format['vbr']
    if vbr is None or vbr == "":
        best_format = max(info['formats'], key=lambda x: x.get('height', 0) or 0)
        best_resolution = best_format.get('resolution', '3840x2160')  # 默认值为480p
        vbr = calculate_bitrate(best_resolution)
    else:
        vbr = f'{vbr}k'

    # 删除视频开头和结尾各2秒
    # video_stream = remove_start_end_seconds(video_stream, 2, 2, duration=duration)
    # 竖屏视频才旋转
    if best_format['height'] < best_format['width']:
        video_stream = rotate_video(video_stream)
    # 旋转缩略图并替换原文件
    thumbnail_path_jpg = os.path.join(output_folder, 'download.jpg')
    thumbnail_path_webp = os.path.join(output_folder, 'download.webp')
    thumbnail_path = thumbnail_path_jpg if os.path.exists(thumbnail_path_jpg) else thumbnail_path_webp
    # 旋转封面
    rotate_if_landscape(thumbnail_path)
    # 增加水印
    video_stream = add_random_watermarks(video_stream, 'paster', 100, 100)
    # 随机镜像
    if random.choice([True, False]):
        video_stream = ffmpeg.filter(video_stream, 'hflip')
    # 调整视频属性 饱和度、亮度、对比度
    video_stream = adjust_video_properties(video_stream, saturation=1.05, brightness=0.05, contrast=1.05)
    logger.info(f'开始对视频做去重处理')
    rotated_video_path = video_path.replace('.mp4', '_final.mp4')
    save_stream_to_video(video_stream, audio_stream, rotated_video_path, vbr)
    logger.info(f'视频已去重至 {output_folder}')

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
if __name__ == '__main__':
    start_time = time.time()
    video_path = "E:\IDEA\workspace\YouDub-webui\youdub\\videos\\20160519 160519 레이샤 LAYSHA 고은 - Chocolate Cream 신한대축제 직캠 fancam by zam\download.mp4"
    output_path = "E:\IDEA\workspace\YouDub-webui\youdub\\videos\\20160519 160519 레이샤 LAYSHA 고은 - Chocolate Cream 신한대축제 직캠 fancam by zam\download2.mp4"
    # video_path ="E:\IDEA\workspace\YouDub-webui\youdub\\videos\z a m\\20240928 걸크러쉬 신곡 DRIVE 240928 걸크러쉬 Girl Crush 하윤 - DRIVE 드라이브 진도의날 청계광장 직캠 fancam by zam\download.mp4"
    # output_path ="E:\IDEA\workspace\YouDub-webui\youdub\\videos\z a m\\20240928 걸크러쉬 신곡 DRIVE 240928 걸크러쉬 Girl Crush 하윤 - DRIVE 드라이브 진도의날 청계광장 직캠 fancam by zam\download1.mp4"
    # probe = ffmpeg.probe(video_path)
    # duration = float(probe['format']['duration'])
    # audio_stream1, video_stream1 = get_video_audio(video_path,  duration)
    # # video_stream1 = rotate_video(video_stream1)
    # root_folder = '../../social_auto_upload/videos'
    # background_video = random.choice([os.path.join(root, f) for root, _, files in os.walk(root_folder) for f in files if f.endswith('.mp4')])
    process_video(video_path ,output_path)
    # video_stream1 = add_random_watermarks(video_stream1, '../paster', 100, 100)
    # save_stream_to_video(video_stream1, audio_stream1,
    #                      output_path,
    #                      '22454k')
    output_folder = "E:\IDEA\workspace\YouDub-webui\youdub\\videos\\20160519 160519 레이샤 LAYSHA 고은 - Chocolate Cream 신한대축제 직캠 fancam by zam"
    # random_shift_rgb(video_path, output_path)
    end_time = time.time()
    processing_time = end_time - start_time
    # rotate_if_landscape('E:\IDEA\workspace\YouDub-webui\social_auto_upload\\videos\B_cut\AyUStJDt3Ls_20231221_섹시걸그룹_막내의_Hot한_변신_하윤_Kokain_2_Phút_Hơn_HandClap_2023_K-XF_231210\download.webp')
    logger.info(f"视频处理完成，总耗时: {processing_time:.2f} 秒")
    # video_path = "E:\IDEA\workspace\YouDub-webui\youdub/videos\z a m/20240928 걸크러쉬 신곡 DRIVE 240928 걸크러쉬 Girl Crush 하윤 - DRIVE 드라이브 진도의날 청계광장 직캠 fancam by zam\download.mp4"

    # # 使用 ffmpeg 旋转视频
    # rotated_video_path = video_path.replace('.mp4', '_rotated.mp4')
    # command = f'ffmpeg -i "{video_path}" -vf "transpose=1" -c:v copy -c:a copy "{rotated_video_path}"'
    # logger.info(command)
    # subprocess.run(command, shell=True)
    # for root, _, files in os.walk('E:\IDEA\workspace\YouDub-webui\social_auto_upload\\videos'):
    #     for filename in files:
    #         if filename.lower().endswith('.webp'):
    #             image_path = os.path.join(root, filename)
    #             rotate_if_landscape(image_path)