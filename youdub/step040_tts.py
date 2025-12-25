import json
import os
import re
import librosa

from loguru import logger
import numpy as np
import torch
# import time
from .utils import save_wav, save_wav_norm
from .cn_tx import TextNorm
# from indextts.infer_v2 import IndexTTS2
from indextts.infer import IndexTTS
from audiostretchy.stretch import stretch_audio

normalizer = TextNorm()
tts = None

def preprocess_text(text):
    text = text.replace('Paragon', '模范')
    text = text.replace('Paragons', '模范们')
    text = text.replace('帕拉贡', '模范')
    text = text.replace('帕贡', '模范')
    text = text.replace('塞拉斯', '西拉斯')
    text = text.replace('AI', '人工智能')
    text = text.replace('标签射手', '图钉射手')
    text = text.replace('标签塔', '图钉塔')
    text = text.replace('税务射手', '图钉射手')
    text = text.replace('飞艇塔', '模范')

    text = re.sub(r'(?<!^)([A-Z])', r' \1', text)
    text = normalizer(text)
    # 使用正则表达式在字母和数字之间插入空格
    text = re.sub(r'(?<=[a-zA-Z])(?=\d)|(?<=\d)(?=[a-zA-Z])', ' ', text)
    return text
    
    
def adjust_audio_length(wav_path, desired_length, sample_rate = 24000, min_speed_factor = 0.6, max_speed_factor = 1.1):
    wav, sample_rate = librosa.load(wav_path, sr=sample_rate)
    current_length = len(wav)/sample_rate
    speed_factor = max(
        min(desired_length / current_length, max_speed_factor), min_speed_factor)
    desired_length = current_length * speed_factor
    target_path = wav_path.replace('.wav', f'_adjusted.wav')
    stretch_audio(wav_path, target_path, ratio=speed_factor, sample_rate=sample_rate)
    wav, sample_rate = librosa.load(target_path, sr=sample_rate)
    return wav[:int(desired_length*sample_rate)], desired_length

def load_tts_model():
    global tts
    if tts is not None:
        return
    # tts = IndexTTS2(cfg_path="checkpoints/config.yaml", model_dir="checkpoints", use_fp16=True, use_cuda_kernel=True, use_deepspeed=False)
    tts = IndexTTS(cfg_path="checkpoints/config.yaml", model_dir="checkpoints")

def unload_tts_model():
    global tts
    if tts is not None:
        del tts
        tts = None
        torch.cuda.empty_cache()
        torch.cuda.ipc_collect()
        logger.info(f'TTS model unloaded')

def generate_wavs(folder):
    transcript_path = os.path.join(folder, 'translation.json')
    output_folder = os.path.join(folder, 'wavs')
    if not os.path.exists(output_folder):
        os.makedirs(output_folder)
    with open(transcript_path, 'r', encoding='utf-8') as f:
        transcript = json.load(f)
    speakers = set()
    
    for line in transcript:
        speakers.add(line['speaker'])
    num_speakers = len(speakers)
    logger.info(f'Found {num_speakers} speakers')

    full_wav = np.zeros((0, ))
    load_tts_model()

    for i, line in enumerate(transcript):
        
        speaker = line['speaker']
        text = preprocess_text(line['translation'])
        output_path = os.path.join(output_folder, f'{str(i).zfill(4)}.wav')
        speaker_wav = os.path.join(folder, 'SPEAKER', f'{speaker}.wav')

        # tts.infer(spk_audio_prompt=speaker_wav, text=text, output_path=output_path, emo_alpha=0.6, use_emo_text=True, verbose=True)
        tts.infer(speaker_wav, text, output_path)

        start = line['start']
        end = line['end']
        length = end-start
        last_end = len(full_wav)/24000
        if start > last_end:
            full_wav = np.concatenate((full_wav, np.zeros((int((start - last_end) * 24000), ))))
        start = len(full_wav)/24000
        line['start'] = start
        if i < len(transcript) - 1:
            next_line = transcript[i+1]
            next_end = next_line['end']
            end = min(start + length, next_end)
        wav, length = adjust_audio_length(output_path, end-start)

        full_wav = np.concatenate((full_wav, wav))
        line['end'] = start + length
    
    try:
        vocal_wav, sr = librosa.load(os.path.join(folder, 'audio_vocals.wav'), sr=24000)
        full_wav = full_wav / np.max(np.abs(full_wav)) * np.max(np.abs(vocal_wav))
        save_wav(full_wav, os.path.join(folder, 'audio_tts.wav'))
        with open(transcript_path, 'w', encoding='utf-8') as f:
            json.dump(transcript, f, indent=2, ensure_ascii=False)
        
        instruments_wav, sr = librosa.load(os.path.join(folder, 'audio_instruments.wav'), sr=24000)
        len_full_wav = len(full_wav)
        len_instruments_wav = len(instruments_wav)
        
        
        if len_full_wav > len_instruments_wav:
            # 如果 full_wav 更长，将 instruments_wav 延伸到相同长度
            instruments_wav = np.pad(
                instruments_wav, (0, len_full_wav - len_instruments_wav), mode='constant')
        elif len_instruments_wav > len_full_wav:
            # 如果 instruments_wav 更长，将 full_wav 延伸到相同长度
            full_wav = np.pad(
                full_wav, (0, len_instruments_wav - len_full_wav), mode='constant')
        combined_wav = full_wav + instruments_wav
        # combined_wav /= np.max(np.abs(combined_wav))
        save_wav_norm(combined_wav, os.path.join(folder, 'audio_combined.wav'))
        logger.info(f'Generated {os.path.join(folder, "audio_combined.wav")}')
    except Exception as e:
        logger.error(f"Error generating combined wav: {e}")



def generate_all_wavs_under_folder(root_folder):
    for root, dirs, files in os.walk(root_folder):
        if 'translation.json' in files and 'audio_combined.wav' not in files:
            try:
                generate_wavs(root)
            except Exception as e:
                unload_tts_model()
                raise e
    return f'Generated all wavs under {root_folder}'

if __name__ == '__main__':
    import sys

    folder = sys.argv[1]

    output = generate_all_wavs_under_folder(
        folder
    )
    print(output)
