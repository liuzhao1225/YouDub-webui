import gradio as gr
from youdub.step000_video_downloader import download_from_url
from youdub.step010_demucs_vr import separate_all_audio_under_folder
from youdub.step020_whisperx import transcribe_all_audio_under_folder
from youdub.step030_translation import translate_all_transcript_under_folder
from youdub.step040_tts import generate_all_wavs_under_folder
from youdub.step050_synthesize_video import synthesize_all_video_under_folder
from youdub.step060_genrate_info import generate_all_info_under_folder
from youdub.step070_upload_bilibili import upload_all_videos_under_folder
from youdub.do_everything import do_everything
import os


do_everything_interface = gr.Interface(
    fn=do_everything,
    inputs=[
        gr.Textbox(label='Root Folder', value='videos'),  # Changed 'default' to 'value'
        gr.Textbox(label='Video URL', placeholder='Video or Playlist or Channel URL',
                   value='https://www.bilibili.com/list/1263732318'),  # Changed 'default' to 'value'
        gr.Slider(minimum=1, maximum=500, step=1, label='Number of videos to download', value=20),
        gr.Radio(['4320p', '2160p', '1440p', '1080p', '720p', '480p', '360p', '240p', '144p'], label='Resolution', value='1080p'),
        gr.Radio(['htdemucs', 'htdemucs_ft', 'htdemucs_6s', 'hdemucs_mmi', 'mdx', 'mdx_extra', 'mdx_q', 'mdx_extra_q', 'SIG'], label='Demucs Model', value='htdemucs_ft'),
        gr.Radio(['auto', 'cuda', 'cpu'], label='Demucs Device', value='auto'),
        gr.Slider(minimum=0, maximum=10, step=1, label='Number of shifts', value=5),
        gr.Radio(['large', 'medium', 'small', 'base', 'tiny'], label='Whisper Model', value='large'),
        gr.Textbox(label='Whisper Download Root', value='models/ASR/whisper'),
        gr.Slider(minimum=1, maximum=128, step=1, label='Whisper Batch Size', value=32),
        gr.Checkbox(label='Whisper Diarization', value=True),
        gr.Radio([None, 1, 2, 3, 4, 5, 6, 7, 8, 9],
                 label='Whisper Min Speakers', value=None),
        gr.Radio([None, 1, 2, 3, 4, 5, 6, 7, 8, 9],
                 label='Whisper Max Speakers', value=None),
        gr.Dropdown(['简体中文', '繁体中文', 'English', 'Deutsch', 'Français', 'русский'],
                    label='Translation Target Language', value='简体中文'),
        gr.Checkbox(label='Force Bytedance', value=True),
        gr.Checkbox(label='Subtitles', value=True),
        gr.Slider(minimum=0.5, maximum=2, step=0.05, label='Speed Up', value=1.05),
        gr.Slider(minimum=1, maximum=60, step=1, label='FPS', value=30),
        gr.Radio(['4320p', '2160p', '1440p', '1080p', '720p', '480p', '360p', '240p', '144p'], label='Resolution', value='1080p'),
        gr.Slider(minimum=1, maximum=100, step=1, label='Max Workers', value=1),
        gr.Slider(minimum=1, maximum=10, step=1, label='Max Retries', value=3),
        gr.Checkbox(label='Auto Upload Video', value=True),
    ],
    outputs='text',
    allow_flagging='never',
)
    
youtube_interface = gr.Interface(
    fn=download_from_url,
    inputs=[
        gr.Textbox(label='Video URL', placeholder='Video or Playlist or Channel URL',
                   value='https://www.bilibili.com/list/1263732318'),  # Changed 'default' to 'value'
        gr.Textbox(label='Output Folder', value='videos'),  # Changed 'default' to 'value'
        gr.Radio(['4320p', '2160p', '1440p', '1080p', '720p', '480p', '360p', '240p', '144p'], label='Resolution', value='1080p'),
        gr.Slider(minimum=1, maximum=100, step=1, label='Number of videos to download', value=5),
    ],
    outputs='text',
    allow_flagging='never',
)

demucs_interface = gr.Interface(
    fn=separate_all_audio_under_folder,
    inputs = [
        gr.Textbox(label='Folder', value='videos'),  # Changed 'default' to 'value'
        gr.Radio(['htdemucs', 'htdemucs_ft', 'htdemucs_6s', 'hdemucs_mmi', 'mdx', 'mdx_extra', 'mdx_q', 'mdx_extra_q', 'SIG'], label='Model', value='htdemucs_ft'),
        gr.Radio(['auto', 'cuda', 'cpu'], label='Device', value='auto'),
        gr.Checkbox(label='Progress Bar in Console', value=True),
        gr.Slider(minimum=0, maximum=10, step=1, label='Number of shifts', value=5),
    ],
    outputs='text',
    allow_flagging='never',
)

# transcribe_all_audio_under_folder(folder, model_name: str = 'large', download_root='models/ASR/whisper', device='auto', batch_size=32)
whisper_inference = gr.Interface(
    fn = transcribe_all_audio_under_folder,
    inputs = [
        gr.Textbox(label='Folder', value='videos'),  # Changed 'default' to 'value'
        gr.Radio(['large', 'medium', 'small', 'base', 'tiny'], label='Model', value='large'),
        gr.Textbox(label='Download Root', value='models/ASR/whisper'),
        gr.Radio(['auto', 'cuda', 'cpu'], label='Device', value='auto'),
        gr.Slider(minimum=1, maximum=128, step=1, label='Batch Size', value=32),
        gr.Checkbox(label='Diarization', value=True),
        gr.Radio([None, 1, 2, 3, 4, 5, 6, 7, 8, 9],
                 label='Whisper Min Speakers', value=None),
        gr.Radio([None, 1, 2, 3, 4, 5, 6, 7, 8, 9],
                 label='Whisper Max Speakers', value=None),
    ],
    outputs='text',
    allow_flagging='never',
)

translation_interface = gr.Interface(
    fn=translate_all_transcript_under_folder,
    inputs = [
        gr.Textbox(label='Folder', value='videos'),  # Changed 'default' to 'value'
        gr.Dropdown(['简体中文', '繁体中文', 'English', 'Deutsch', 'Français', 'русский'],
                    label='Target Language', value='简体中文'),
    ],
    outputs='text',
)

tts_interafce = gr.Interface(
    fn=generate_all_wavs_under_folder,
    inputs = [
        gr.Textbox(label='Folder', value='videos'),  # Changed 'default' to 'value'
        gr.Checkbox(label='Force Bytedance', value=False),
    ],
    outputs='text',
    allow_flagging='never',
)
syntehsize_video_interface = gr.Interface(
    fn=synthesize_all_video_under_folder,
    inputs = [
        gr.Textbox(label='Folder', value='videos'),  # Changed 'default' to 'value'
        gr.Checkbox(label='Subtitles', value=True),
        gr.Slider(minimum=0.5, maximum=2, step=0.05, label='Speed Up', value=1.05),
        gr.Slider(minimum=1, maximum=60, step=1, label='FPS', value=30),
        gr.Radio(['4320p', '2160p', '1440p', '1080p', '720p', '480p', '360p', '240p', '144p'], label='Resolution', value='1080p'),
    ],
    outputs='text',
    allow_flagging='never',
)

genearte_info_interface = gr.Interface(
    fn = generate_all_info_under_folder,
    inputs = [
        gr.Textbox(label='Folder', value='videos'),  # Changed 'default' to 'value'
    ],
    outputs='text',
    allow_flagging='never',
)

upload_bilibili_interface = gr.Interface(
    fn = upload_all_videos_under_folder,
    inputs = [
        gr.Textbox(label='Folder', value='videos'),  # Changed 'default' to 'value'
    ],
    outputs='text',
    allow_flagging='never',
)

app = gr.TabbedInterface(
    interface_list=[do_everything_interface,youtube_interface, demucs_interface,
                    whisper_inference, translation_interface, tts_interafce, syntehsize_video_interface, upload_bilibili_interface],
    tab_names=['全自动', '下载视频', '人声分离', '语音识别', '字幕翻译', '语音合成', '视频合成', '上传B站'],
    title='YouDub')
if __name__ == '__main__':
    app.launch()