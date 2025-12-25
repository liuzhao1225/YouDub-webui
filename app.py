# import gradio as gr
# from youdub.step000_video_downloader import download_from_url
# from youdub.step010_demucs_vr import run_demucs_in_venv
# from youdub.step020_whisperx import transcribe_all_audio_under_folder
# from youdub.step030_translation import translate_all_transcript_under_folder
# from youdub.step040_tts import generate_all_wavs_under_folder
# from youdub.step050_synthesize_video import synthesize_all_video_under_folder
# from youdub.step060_genrate_info import generate_all_info_under_folder
# from youdub.step070_upload_bilibili import upload_all_videos_under_folder
# from youdub.do_everything import do_everything
# import os


# do_everything_interface = gr.Interface(
#     fn=do_everything,
#     inputs=[
#         gr.Textbox(label='Root Folder', value='videos'),  # Changed 'default' to 'value'
#         gr.Textbox(label='Video URL', placeholder='Video or Playlist or Channel URL',
#                    value='https://www.bilibili.com/list/1263732318'),  # Changed 'default' to 'value'
#         gr.Slider(minimum=1, maximum=500, step=1, label='Number of videos to download', value=20),
#         gr.Radio(['4320p', '2160p', '1440p', '1080p', '720p', '480p', '360p', '240p', '144p'], label='Resolution', value='1080p'),
#         gr.Radio(['htdemucs', 'htdemucs_ft', 'htdemucs_6s', 'hdemucs_mmi', 'mdx', 'mdx_extra', 'mdx_q', 'mdx_extra_q', 'SIG'], label='Demucs Model', value='htdemucs_ft'),
#         gr.Radio(['auto', 'cuda', 'cpu'], label='Demucs Device', value='auto'),
#         gr.Slider(minimum=0, maximum=10, step=1, label='Number of shifts', value=5),
#         gr.Radio(['large', 'medium', 'small', 'base', 'tiny'], label='Whisper Model', value='large'),
#         gr.Textbox(label='Whisper Download Root', value='models/ASR/whisper'),
#         gr.Slider(minimum=1, maximum=128, step=1, label='Whisper Batch Size', value=32),
#         gr.Checkbox(label='Whisper Diarization', value=True),
#         gr.Radio([None, 1, 2, 3, 4, 5, 6, 7, 8, 9],
#                  label='Whisper Min Speakers', value=None),
#         gr.Radio([None, 1, 2, 3, 4, 5, 6, 7, 8, 9],
#                  label='Whisper Max Speakers', value=None),
#         gr.Dropdown(['简体中文', '繁体中文', 'English', 'Deutsch', 'Français', 'русский'],
#                     label='Translation Target Language', value='简体中文'),
#         gr.Checkbox(label='Subtitles', value=True),
#         gr.Slider(minimum=0.5, maximum=2, step=0.05, label='Speed Up', value=1.05),
#         gr.Slider(minimum=1, maximum=60, step=1, label='FPS', value=30),
#         gr.Radio(['4320p', '2160p', '1440p', '1080p', '720p', '480p', '360p', '240p', '144p'], label='Resolution', value='1080p'),
#         gr.Slider(minimum=1, maximum=100, step=1, label='Max Workers', value=1),
#         gr.Slider(minimum=1, maximum=10, step=1, label='Max Retries', value=3),
#         gr.Checkbox(label='Auto Upload Video', value=True),
#     ],
#     outputs='text',
#     # allow_flagging='never',
# )
    
# youtube_interface = gr.Interface(
#     fn=download_from_url,
#     inputs=[
#         gr.Textbox(label='Video URL', placeholder='Video or Playlist or Channel URL',
#                    value='https://www.bilibili.com/list/1263732318'),  # Changed 'default' to 'value'
#         gr.Textbox(label='Output Folder', value='videos'),  # Changed 'default' to 'value'
#         gr.Radio(['4320p', '2160p', '1440p', '1080p', '720p', '480p', '360p', '240p', '144p'], label='Resolution', value='1080p'),
#         gr.Slider(minimum=1, maximum=100, step=1, label='Number of videos to download', value=5),
#     ],
#     outputs='text',
#     # allow_flagging='never',
# )

# demucs_interface = gr.Interface(
#     fn=run_demucs_in_venv,
#     inputs = [
#         gr.Textbox(label='Folder', value='videos'),  # Changed 'default' to 'value'
#         gr.Radio(['htdemucs', 'htdemucs_ft', 'htdemucs_6s', 'hdemucs_mmi', 'mdx', 'mdx_extra', 'mdx_q', 'mdx_extra_q', 'SIG'], label='Model', value='htdemucs_ft'),
#         gr.Radio(['auto', 'cuda', 'cpu'], label='Device', value='auto'),
#         gr.Checkbox(label='Progress Bar in Console', value=True),
#         gr.Slider(minimum=0, maximum=10, step=1, label='Number of shifts', value=5),
#     ],
#     outputs='text',
#     # allow_flagging='never',
# )

# # transcribe_all_audio_under_folder(folder, model_name: str = 'large', download_root='models/ASR/whisper', device='auto', batch_size=32)
# whisper_inference = gr.Interface(
#     fn = transcribe_all_audio_under_folder,
#     inputs = [
#         gr.Textbox(label='Folder', value='videos'),  # Changed 'default' to 'value'
#         gr.Radio(['large', 'medium', 'small', 'base', 'tiny'], label='Model', value='large'),
#         gr.Textbox(label='Download Root', value='models/ASR/whisper'),
#         gr.Radio(['auto', 'cuda', 'cpu'], label='Device', value='auto'),
#         gr.Slider(minimum=1, maximum=128, step=1, label='Batch Size', value=32),
#         gr.Checkbox(label='Diarization', value=True),
#         gr.Radio([None, 1, 2, 3, 4, 5, 6, 7, 8, 9],
#                  label='Whisper Min Speakers', value=None),
#         gr.Radio([None, 1, 2, 3, 4, 5, 6, 7, 8, 9],
#                  label='Whisper Max Speakers', value=None),
#     ],
#     outputs='text',
#     # allow_flagging='never',
# )

# translation_interface = gr.Interface(
#     fn=translate_all_transcript_under_folder,
#     inputs = [
#         gr.Textbox(label='Folder', value='videos'),  # Changed 'default' to 'value'
#         gr.Dropdown(['简体中文', '繁体中文', 'English', 'Deutsch', 'Français', 'русский'],
#                     label='Target Language', value='简体中文'),
#     ],
#     outputs='text',
# )

# tts_interafce = gr.Interface(
#     fn=generate_all_wavs_under_folder,
#     inputs = [
#         gr.Textbox(label='Folder', value='videos'),  # Changed 'default' to 'value'
#         gr.Checkbox(label='Force Bytedance', value=False),
#     ],
#     outputs='text',
#     # allow_flagging='never',
# )
# syntehsize_video_interface = gr.Interface(
#     fn=synthesize_all_video_under_folder,
#     inputs = [
#         gr.Textbox(label='Folder', value='videos'),  # Changed 'default' to 'value'
#         gr.Checkbox(label='Subtitles', value=True),
#         gr.Slider(minimum=0.5, maximum=2, step=0.05, label='Speed Up', value=1.05),
#         gr.Slider(minimum=1, maximum=60, step=1, label='FPS', value=30),
#         gr.Radio(['4320p', '2160p', '1440p', '1080p', '720p', '480p', '360p', '240p', '144p'], label='Resolution', value='1080p'),
#     ],
#     outputs='text',
#     # allow_flagging='never',
# )

# genearte_info_interface = gr.Interface(
#     fn = generate_all_info_under_folder,
#     inputs = [
#         gr.Textbox(label='Folder', value='videos'),  # Changed 'default' to 'value'
#     ],
#     outputs='text',
#     # allow_flagging='never',
# )

# upload_bilibili_interface = gr.Interface(
#     fn = upload_all_videos_under_folder,
#     inputs = [
#         gr.Textbox(label='Folder', value='videos'),  # Changed 'default' to 'value'
#     ],
#     outputs='text',
#     # allow_flagging='never',
# )

# app = gr.TabbedInterface(
#     interface_list=[do_everything_interface,youtube_interface, demucs_interface,
#                     whisper_inference, translation_interface, tts_interafce, syntehsize_video_interface, upload_bilibili_interface],
#     tab_names=['全自动', '下载视频', '人声分离', '语音识别', '字幕翻译', '语音合成', '视频合成', '上传B站'],
#     title='YouDub')
# if __name__ == '__main__':
#     app.queue()
#     app.launch(server_name="127.0.0.4", server_port=30001)

import sys
import os

from youdub.step000_video_downloader import download_from_url
from youdub.step010_demucs_vr import run_demucs_in_venv
from youdub.step020_whisperx import transcribe_all_audio_under_folder
from youdub.step030_translation import translate_all_transcript_under_folder
from youdub.step040_tts import generate_all_wavs_under_folder
from youdub.step050_synthesize_video import synthesize_all_video_under_folder
from youdub.step060_genrate_info import generate_all_info_under_folder
from youdub.step070_upload_bilibili import upload_all_videos_under_folder
from youdub.do_everything import do_everything
from youdub.do_queue import do_queue


def ask(prompt, default=None):
    """用于获取带默认值的输入"""
    if default is not None:
        prompt = f"{prompt} [{default}]: "
    else:
        prompt = f"{prompt}: "
    value = input(prompt).strip()
    return value if value else default


def menu_download_video():
    url = ask("请输入视频/播放列表/频道 URL")
    output = ask("输出目录", "videos")
    resolution = ask("分辨率(如1080p)", "1080p")
    count = int(ask("下载视频数量", "1"))
    print(download_from_url(url, output, resolution, count))


def menu_demucs():
    folder = ask("音频所在目录", "videos")
    model = ask("选择人声分离模型", "htdemucs_ft")
    device = ask("设备(auto/cuda/cpu)", "auto")
    shifts = int(ask("number of shifts", "5"))
    show_progress = ask("是否显示进度条(True/False)", "True") == "True"
    print(run_demucs_in_venv(folder, model, device, show_progress, shifts))


def menu_whisper():
    folder = ask("音频目录", "videos")
    model = ask("Whisper 模型 (large/medium/...)", "large")
    download_root = ask("模型下载目录", "models/ASR/whisper")
    device = ask("设备(auto/cuda/cpu)", "auto")
    batch_size = int(ask("batch size", "8"))
    diarize = ask("是否分离说话人(True/False)", "True") == "True"
    min_speaker = ask("最小人数(或空)", None)
    max_speaker = ask("最大人数(或空)", None)

    print(transcribe_all_audio_under_folder(
        folder, model, download_root, device, batch_size,
        diarize, min_speaker, max_speaker
    ))


def menu_translate():
    folder = ask("字幕所在目录", "videos")
    target = ask("目标语言(简体中文/繁体中文/English...)", "简体中文")
    print(translate_all_transcript_under_folder(folder, target))


def menu_tts():
    folder = ask("字幕所在目录", "videos")
    print(generate_all_wavs_under_folder(folder))


def menu_synthesize():
    folder = ask("目录", "videos")
    subtitles = ask("是否包含字幕(True/False)", "True") == "True"
    speed = float(ask("加速倍率(0.5~2)", "1.05"))
    fps = int(ask("FPS", "30"))
    resolution = ask("分辨率", "1080p")
    print(synthesize_all_video_under_folder(folder, subtitles, speed, fps, resolution))


def menu_generate_info():
    folder = ask("目录", "videos")
    print(generate_all_info_under_folder(folder))


def menu_upload():
    folder = ask("目录", "videos")
    print(upload_all_videos_under_folder(folder))


def menu_do_everything():
    root = ask("根目录", "videos")
    url = ask("视频/播放列表URL", "")
    count = int(ask("下载数量", "1"))
    resolution = ask("分辨率", "1080p")

    demucs_model = ask("Demucs 模型", "htdemucs_ft")
    demucs_device = ask("Demucs device", "auto")
    shifts = int(ask("number of shifts", "5"))

    whisper_model = ask("Whisper 模型", "large")
    whisper_root = ask("Whisper 模型目录", "models/ASR/whisper")
    batch_size = int(ask("batch size", "8"))
    diarization = ask("是否分离说话人(True/False)", "True") == "True"

    min_speaker = ask("最小人数(或空)", None)
    max_speaker = ask("最大人数(或空)", None)

    translate_target = ask("翻译目标语言", "简体中文")
    subtitles = ask("是否包含字幕(True/False)", "True") == "True"
    speed = float(ask("视频加速倍率", "1.05"))
    fps = int(ask("FPS", "30"))
    resolution_out = ask("输出分辨率", "1080p")

    max_retries = int(ask("最大重试次数", "3"))
    auto_upload = ask("自动上传B站(True/False)", "True") == "True"
    print(do_everything(
        root, url, count, resolution,
        demucs_model, demucs_device, shifts,
        whisper_model, whisper_root, batch_size, diarization,
        min_speaker, max_speaker,
        translate_target,
        subtitles, speed, fps, resolution_out,
        max_retries, auto_upload
    ))

def menu_do_queue():
    print(do_queue())

def main_menu():
    while True:
        print("\n====== YouDub 命令行控制台 ======")
        print("1. 下载视频")
        print("2. 人声分离 (Demucs)")
        print("3. 语音识别 (WhisperX)")
        print("4. 字幕翻译")
        print("5. 语音合成 (TTS)")
        print("6. 视频合成")
        print("7. 生成视频信息")
        print("8. 上传到 Bilibili")
        print("9. 一键全流程处理")
        print("10. 处理任务队列")
        print("0. 退出")
        print("=================================")

        choice = input("请选择功能编号：").strip()

        if choice == "1": menu_download_video()
        elif choice == "2": menu_demucs()
        elif choice == "3": menu_whisper()
        elif choice == "4": menu_translate()
        elif choice == "5": menu_tts()
        elif choice == "6": menu_synthesize()
        elif choice == "7": menu_generate_info()
        elif choice == "8": menu_upload()
        elif choice == "9": menu_do_everything()
        elif choice == "10": menu_do_queue()
        elif choice == "0":
            print("退出程序。")
            sys.exit(0)
        else:
            print("无效输入，请重新选择。")


if __name__ == "__main__":
    main_menu()
