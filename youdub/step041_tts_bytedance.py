# coding=utf-8

'''
requires Python 3.6 or later
pip install requests
'''
import base64
import json
import os
import time
import uuid
import librosa
import numpy as np
import requests
from loguru import logger
from dotenv import load_dotenv
from pyannote.audio import Model, Inference
from scipy.spatial.distance import cosine

load_dotenv()
# 填写平台申请的appid, access_token以及cluster
appid = os.getenv('BYTEDANCE_APPID')
access_token = os.getenv('BYTEDANCE_ACCESS_TOKEN')

host = "openspeech.bytedance.com"
api_url = f"https://{host}/api/v1/tts"

header = {"Authorization": f"Bearer;{access_token}"}

request_json = {
    "app": {
        "appid": appid,
        "token": "access_token",
        "cluster": 'volcano_tts'
    },
    "user": {
        "uid": "https://github.com/liuzhao1225/YouDub-webui"
    },
    "audio": {
        "voice_type": 'BV001_streaming',
        "encoding": "wav",
        "speed_ratio": 1.0,
        "volume_ratio": 1.0,
        "pitch_ratio": 1.0,
    },
    "request": {
        "reqid": str(uuid.uuid4()),
        "text": "Hello World!",
        "text_type": "plain",
        "operation": "query",
        "with_frontend": 1,
        "frontend_type": "unitTson"

    }
}

embedding_model = Model.from_pretrained(
    "pyannote/embedding", use_auth_token=os.getenv('HF_TOKEN'))
embedding_inference = Inference(
    embedding_model, window="whole")

def generate_embedding(wav_path):
    embedding = embedding_inference(wav_path)
    return embedding

def generate_speaker_to_voice_type(folder):
    speaker_to_voice_type_path = os.path.join(folder, 'speaker_to_voice_type.json')
    if os.path.exists(speaker_to_voice_type_path):
        with open(speaker_to_voice_type_path, 'r', encoding='utf-8') as f:
            speaker_to_voice_type = json.load(f)
        return speaker_to_voice_type
    
    speaker_to_voice_type = {}
    speaker_folder = os.path.join(folder, 'SPEAKER')
    voice_types = {}
    if not os.path.exists('voice_type'):
        get_available_speakers()
    for file in os.listdir('voice_type'):
        voice_type = file.replace('.wav', '')
        voice_types[voice_type] = np.load(f'voice_type/{file.replace(".wav", ".npy")}')
        
    for file in os.listdir(speaker_folder):
        if not file.endswith('.wav'):
            continue
        speaker = file.replace('.wav', '')
        wav_path = os.path.join(speaker_folder, file)
        embedding = generate_embedding(wav_path)
        # find the 
        np.save(wav_path.replace('.wav', '.npy'), embedding)
        speaker_to_voice_type[speaker] = sorted(voice_types.keys(), key=lambda x: 1 - cosine(voice_types[x], embedding))[0]
    for k, v in speaker_to_voice_type.items():
        new_v = v.replace('.npy', '')
        speaker_to_voice_type[k] = new_v
        logger.info(f'{k}: {new_v}')
    with open(speaker_to_voice_type_path, 'w', encoding='utf-8') as f:
        json.dump(speaker_to_voice_type, f, indent=2, ensure_ascii=False)
    return speaker_to_voice_type
    

def tts(text, output_path, speaker_wav, voice_type=None):
    if os.path.exists(output_path):
        logger.info(f'火山TTS {text} 已存在')
        return
    folder = os.path.dirname(os.path.dirname(output_path))
    if voice_type is None:
        speaker_to_voice_type = generate_speaker_to_voice_type(folder)
        speaker = os.path.basename(speaker_wav).replace('.wav', '')
        voice_type = speaker_to_voice_type[speaker]
    for retry in range(3):
        try:
            global request_json
            request_json["audio"]["voice_type"] = voice_type
            request_json["request"]["text"] = text
            request_json["request"]["reqid"] = str(uuid.uuid4())
            resp = requests.post(api_url, json.dumps(request_json), headers=header, timeout=60)
            # print(f"resp body: \n{resp.json()}")
            if "data" in resp.json():
                data = resp.json()["data"]
                with open(output_path, "wb") as f:
                    f.write(base64.b64decode(data))
                # file_to_save = open(output_path, "wb")
                # file_to_save.write(base64.b64decode(data))
                
                # ensure the file is saved
                wav, sample_rate = librosa.load(output_path, sr=24000)
                logger.info(f'火山TTS {text} 保存成功: {output_path}')
                time.sleep(0.1)
                break
        except Exception as e:
            logger.warning(e)

def get_available_speakers():
    if not os.path.exists('voice_type'):
        os.makedirs('voice_type')
    voice_types = ['BV001_streaming', 'BV002_streaming', 'BV005_streaming', 'BV007_streaming', 'BV033_streaming', 'BV034_streaming', 'BV056_streaming', 'BV102_streaming', 'BV113_streaming', 'BV115_streaming', 'BV119_streaming', 'BV700_streaming', 'BV701_streaming']
    for voice_type in voice_types:
        output_path = f'voice_type/{voice_type}.wav'
        if os.path.exists(output_path):
            continue
        retry = 3
        while retry > 0:
            try:
                tts('YouDub 是一个创新的开源工具，专注于将 YouTube 等平台的优质视频翻译和配音为中文版本。此工具融合了先进的 AI 技术，包括语音识别、大型语言模型翻译以及 AI 声音克隆技术，为中文用户提供具有原始 YouTuber 音色的中文配音视频。', output_path, None, voice_type=voice_type)
                embedding = embedding_inference(output_path)
                np.save(output_path.replace('.wav', '.npy'), embedding)
                break
            except Exception as e:
                logger.warning(e)
                retry -= 1
                time.sleep(0.1)
        
if __name__ == '__main__':
    # tts('你好，你叫什么名字？', f'videos\Lex Clips\20231222 Jeff Bezos on fear of death ｜ Lex Fridman Podcast Clips\wavs\{str(uuid.uuid4())}.wav',
    #     r'videos\Lex Clips\20231222 Jeff Bezos on fear of death ｜ Lex Fridman Podcast Clips\SPEAKER\SPEAKER_01.wav')
    get_available_speakers()
