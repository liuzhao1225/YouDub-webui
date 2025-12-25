# -*- coding: utf-8 -*-
import json
import os
import re
import openai
from openai import OpenAI
from dotenv import load_dotenv
import time
from loguru import logger

model_list = ["gemini-2.5-flash-lite", "gemini-2.5-flash-preview-05-20-nothinking", "gemini-2.5-flash-preview-04-17-nothinking", "gpt-5-nano"]

def init_translation(): 
    # 清除之前的MODEL_NAME环境变量
    os.environ.pop('MODEL_NAME', None)

    load_dotenv()
    global model_name, extra_body
    model_name = os.getenv('MODEL_NAME', 'gpt-5-nano')
    print(f'using model {model_name}')
    # if model_name == "01ai/Yi-34B-Chat-4bits":
    #     extra_body = {
    #         'repetition_penalty': 1.1,
    #         'stop_token_ids': [7]
    #     }
    # else:
    #     extra_body = {
    #         'repetition_penalty': 1.1,
    #     }

def get_necessary_info(info: dict):
    return {
        'title': info['title'],
        'uploader': info['uploader'],
        'description': info['description'],
        'upload_date': info['upload_date'],
        'categories': info['categories'],
        'tags': info['tags'],
    }


def ensure_transcript_length(transcript, max_length=4000):
    mid = len(transcript)//2
    before, after = transcript[:mid], transcript[mid:]
    length = max_length//2
    return before[:length] + after[-length:]

def summarize(info, transcript, target_language='简体中文'):
    global model_name
    client = OpenAI(
    # This is the default and can be omitted
    base_url=os.getenv('OPENAI_API_BASE', 'https://sg.uiuiapi.com'),
    api_key=os.getenv('OPENAI_API_KEY')
)
    transcript = ' '.join(line['text'] for line in transcript)
    transcript = ensure_transcript_length(transcript, max_length=2000)
    info_message = f'Title: "{info["title"]}" Author: "{info["uploader"]}". ' 
    # info_message = ''
    
    full_description = f'The following is the full content of the video:\n{info_message}\n{transcript}\n{info_message}\nAccording to the above content, detailedly Summarize the video in JSON format:\n```json\n{{"title": "", "summary": ""}}\n```'
    logger.info(full_description)
    messages = [
        {'role': 'system',
            'content': f'You are a expert in the field of this video. Please detailedly summarize the video in JSON format.\n```json\n{{"title": "the title of the video", "summary", "the summary of the video"}}\n```'},
        {'role': 'user', 'content': full_description},
    ]
    retry_message=''
    success = False
    for retry in range(5):
        try:
            messages = [
                {'role': 'system', 'content': f'You are a expert in the field of this video. Please summarize the video in JSON format. Make sure the summary is concise and accurate.\n```json\n{{"title": "the title of the video", "summary", "the summary of the video"}}\n```'},
                {'role': 'user', 'content': full_description+retry_message},
            ]
            response = client.chat.completions.create(
                model=model_name,
                messages=messages,
                timeout=240,
                # extra_body=extra_body
            )
            logger.info(response)
            summary = response.choices[0].message.content.replace('\n', '')
            if '视频标题' in summary:
                raise Exception("包含“视频标题”")
            logger.info(summary)
            summary = re.findall(r'\{.*?\}', summary)[0]
            summary = json.loads(summary)
            summary = {
                'title': summary['title'].replace('title:', '').strip(),
                'summary': summary['summary'].replace('summary:', '').strip()
            }
            if 'title' in summary['title']:
                raise Exception('Invalid summary')
            success = True
            break
        except Exception as e:
            retry_message += '\nSummarize the video in JSON format:\n```json\n{"title": "", "summary": ""}\n```'
            logger.warning(f'总结失败\n{e}')
            model_name = model_list[retry % len(model_list)]
            time.sleep(1)
    if not success:
        raise Exception(f'总结失败')
        
    title = summary['title']
    summary = summary['summary']
    tags = info['tags']
    messages = [
        {'role': 'system',
            'content': f'You are a native speaker of {target_language}. Please translate the title and summary into {target_language} in JSON format. ```json\n{{"title": "the {target_language} title of the video", "summary", "the {target_language} summary of the video", "tags": [list of tags in {target_language}]}}\n```.'},
        {'role': 'user',
            'content': f'The title of the video is "{title}". The summary of the video is "{summary}". Tags: {tags}.\nPlease translate the above title and summary and tags into {target_language} in JSON format. ```json\n{{"title": "", "summary", ""， "tags": []}}\n```. Remember to tranlate the title and the summary and tags into {target_language} in JSON.'},
    ]
    while True:
        try:
            response = client.chat.completions.create(
                model=model_name,
                messages=messages,
                timeout=240,
                # extra_body=extra_body
            )
            summary = response.choices[0].message.content.replace('\n', '')
            logger.info(summary)
            summary = re.findall(r'\{.*?\}', summary)[0]
            summary = json.loads(summary)
            if target_language in summary['title'] or target_language in summary['summary']:
                raise Exception('Invalid translation')
            title = summary['title'].strip()
            if (title.startswith('"') and title.endswith('"')) or (title.startswith('“') and title.endswith('”')) or (title.startswith('‘') and title.endswith('’')) or (title.startswith("'") and title.endswith("'")) or (title.startswith('《') and title.endswith('》')):
                title = title[1:-1]
            result = {
                'title': title,
                'author': info['uploader'],
                'summary': summary['summary'],
                'tags': summary['tags'],
                'language': target_language
            }
            return result
        except Exception as e:
            logger.warning(f'总结翻译失败\n{e}')
            time.sleep(1)


def translation_postprocess(result):
    result = re.sub(r'\（[^)]*\）', '', result)
    result = result.replace('...', '，')
    result = re.sub(r'(?<=\d),(?=\d)', '', result)
    result = result.replace('²', '的平方').replace(
        '————', '：').replace('——', '：').replace('°', '度')
    result = result.replace("AI", '人工智能')
    result = result.replace('变压器', "Transformer")
    result = result.replace('Paragon', '模范')
    result = result.replace('帕拉贡', '模范')
    result = result.replace('**', '')
    return result

def valid_translation(text, translation):
    
    if (translation.startswith('```') and translation.endswith('```')):
        translation = translation[3:-3]
        return True, translation_postprocess(translation)
    
    if (translation.startswith('“') and translation.endswith('”')) or (translation.startswith('"') and translation.endswith('"')):
        translation = translation[1:-1]
        return True, translation_postprocess(translation)
    
    # if '翻译' in translation and '：“' in translation and '”' in translation:
    #     translation = translation.split('：“')[-1].split('”')[0]
    #     return True, translation_postprocess(translation)
    
    # if '翻译' in translation and '："' in translation and '"' in translation:
    #     translation = translation.split('："')[-1].split('"')[0]
    #     return True, translation_postprocess(translation)

    # if '翻译' in translation and ':"' in translation and '"' in translation:
    #     translation = translation.split('："')[-1].split('"')[0]
    #     return True, translation_postprocess(translation)

    if translation.startswith('翻译：'):
        translation = translation[len('翻译：'):]
        if (translation.startswith('“') and translation.endswith('”')) or (translation.startswith('"') and translation.endswith('"')):
            translation = translation[1:-1]
        return True, translation_postprocess(translation)
    
    if translation.startswith('翻译:'):
        translation = translation[len('翻译:'):]
        if (translation.startswith('“') and translation.endswith('”')) or (translation.startswith('"') and translation.endswith('"')):
            translation = translation[1:-1]
        return True, translation_postprocess(translation)
    
    if len(text) <= 10:
        if len(translation) > 15:
            return False, f'Only translate the following sentence and give me the result.'
    elif len(translation) > len(text)*0.75:
        return False, f'The translation is too long. Only translate the following sentence and give me the result.'
    
    forbidden = ['翻译', '这句', '\n', '简体中文', '中文', 'translate', 'Translate', 'translation', 'Translation']
    translation = translation.strip()
    for word in forbidden:
        if word in translation:
            
            return False, f"Don't include `{word}` in the translation. Only translate the following sentence and give me the result."
    
    return True, translation_postprocess(translation)
# def split_sentences(translation, punctuations=['。', '？', '！', '\n', '”', '"']):
#     def is_punctuation(char):
#         return char in punctuations
    
#     output_data = []
#     for item in translation:
#         start = item['start'] 
#         text = item['text']
#         speaker = item['speaker']
#         translation = item['translation']
#         sentence_start = 0
#         duration_per_char = (item['end'] - item['start']) / len(translation)
#         for i, char in enumerate(translation):
#             # If the character is a punctuation, split the sentence
#             if not is_punctuation(char) and i != len(translation) - 1:
#                 continue
#             if i - sentence_start < 5 and i != len(translation) - 1:
#                 continue
#             if i < len(translation) - 1 and is_punctuation(translation[i+1]):
#                 continue
#             sentence = translation[sentence_start:i+1]
#             sentence_end = start + duration_per_char * len(sentence)

#             # Append the new item
#             output_data.append({
#                 "start": round(start, 3),
#                 "end": round(sentence_end, 3),
#                 "text": text,
#                 "speaker": speaker,
#                 "translation": sentence
#             })

#             # Update the start for the next sentence
#             start = sentence_end
#             sentence_start = i + 1
#     return output_data


def split_text_into_sentences(para):
    para = re.sub('([。！？\?])([^，。！？\?”’》])', r"\1\n\2", para)  # 单字符断句符
    logger.info(f'After first split: {para}')
    para = re.sub('(\.{6})([^，。！？\?”’》])', r"\1\n\2", para)  # 英文省略号
    logger.info(f'After second split: {para}')
    para = re.sub('(\…{2})([^，。！？\?”’》])', r"\1\n\2", para)  # 中文省略号
    logger.info(f'After third split: {para}')
    para = re.sub('([。！？\?][”’])([^，。！？\?”’》])', r'\1\n\2', para)
    logger.info(f'After fourth split: {para}')
    # 如果双引号前有终止符，那么双引号才是句子的终点，把分句符\n放到双引号后，注意前面的几句都小心保留了双引号
    para = para.rstrip()  # 段尾如果有多余的\n就去掉它
    logger.info(f'After rstrip: {para}')
    # 很多规则中会考虑分号;，但是这里我把它忽略不计，破折号、英文双引号等同样忽略，需要的再做些简单调整即可。
    sentences = para.split("\n")    
    return [s for s in sentences if s]  # 过滤掉空字符串

def split_sentences(translation):
    output_data = []
    for item in translation:
        start = item['start']
        text = item['text']
        speaker = item['speaker']
        translation_text = item['translation']
        sentences = split_text_into_sentences(translation_text)
        duration_per_char = (item['end'] - item['start']
                             ) / len(translation_text)
        sentence_start = 0
        for sentence in sentences:
            logger.info(f'Splitting sentence: {sentence}')
            sentence_end = start + duration_per_char * len(sentence)

            # Append the new item
            output_data.append({
                "start": round(start, 3),
                "end": round(sentence_end, 3),
                "text": text,
                "speaker": speaker,
                "translation": sentence
            })

            # Update the start for the next sentence
            start = sentence_end
            sentence_start += len(sentence)
    return output_data
    
def _translate(summary, transcript, target_language='简体中文'):

    client = OpenAI(
        # This is the default and can be omitted
        base_url=os.getenv('OPENAI_API_BASE', 'https://api.openai.com/v1'),
        api_key=os.getenv('OPENAI_API_KEY')
    )
    info = f'This is a video called "{summary["title"]}". {summary["summary"]}.'
    full_translation = []

    fixed_message = [
        {'role': 'system', 'content': f'You are a expert in the field of this video.\n{info}\nTranslate the sentence into {target_language}.下面假设你是一个中文社区的自媒体创作者，你的目标是把任何语言翻译成中文，请翻译时不要带翻译腔，而是要翻译得自然、流畅和地道，使用优美和风趣的表达方式。不要使用任何特殊格式如lataX、markdown。原文为语音识别结果，可能存在错误，不要强行翻译，识别错误的地方请根据上下文修复，并直接给出翻译结果。\
            若视频内容是气球塔防6，注意以下内容：MOAB、BFB、ZOMG、DDT、BAD、CHIMPS等专业术语请保留原文，\
            把以下英雄名称翻译成对应的中文名称：Quincy-昆西, Gwendolin-格温多琳, Striker Jones-先锋琼斯, Obyn Greenfoot-奥本, Rosalia-罗莎莉娅, Captain Churchill-上尉丘吉尔, Benjamin-本杰明, Pat Fusty-帕特, Ezili-艾泽里, Adora-阿多拉, Etienne-艾蒂安, Sauda-萨乌达, Admiral Brickell-海军上将布里克尔, Psi-灵机, Geraldo-杰拉尔多, Corvus-科沃斯, Silas-西拉斯。\
            把以下猴子名称翻译成对应的中文名称：Dart Monkey-飞镖猴, Boomerang Monkey-回旋镖猴, Bomb Shooter-大炮, Tack Shooter-图钉塔, Ice Monkey-冰猴, Glue Gunner-胶水猴, Desperado-亡命猴, Sniper Monkey-狙击猴, Monkey Sub-潜水艇猴, Monkey Buccaneer-海盗猴, Monkey Ace-王牌飞行员, Heli Pilot-直升机, Mortar Monkey-迫击炮猴, Dartling Gunner-机枪猴, Wizard Monkey-法师猴, Super Monkey-超猴, Ninja Monkey-忍者猴, Alchemist-炼金术士, Druid-德鲁伊, Mer Monkey-人鱼猴, Banana Farm-香蕉农场, Spike Factory-刺钉工厂, Monkey Village-猴村, Engineer Monkey-工程师猴, Beast Handler-驯兽大师。'},
        {'role': 'user', 'content': '使用地道的中文Translate:"Knowledge is power."'},
        {'role': 'assistant', 'content': '翻译：“知识就是力量。”'},
        {'role': 'user', 'content': '使用地道的中文Translate:"To be or not to be, that is the question."'},
        {'role': 'assistant', 'content': '翻译：“生存还是毁灭，这是一个值得考虑的问题。”'},]
    
    history = []
    for line in transcript:
        text = line['text']
        # history = ''.join(full_translation[:-10])
        
        retry_message = 'Only translate the quoted sentence and give me the final translation.'
        for retry in range(30):
            messages = fixed_message + \
                history[-30:] + [{'role': 'user',
                                  'content': f'使用地道的中文Translate:"{text}"'}]
            
            try:
                response = client.chat.completions.create(
                    model=model_name,
                    messages=messages,
                    timeout=240,
                    # extra_body=extra_body
                )
                translation = response.choices[0].message.content.replace('\n', '')
                logger.info(f'原文：{text}')
                logger.info(f'译文：{translation}')
                success, translation = valid_translation(text, translation)
                if not success:
                    retry_message += translation
                    raise Exception('Invalid translation')
                break
            except Exception as e:
                logger.error(e)
                if e == 'Internal Server Error':
                    client = OpenAI(
                        # This is the default and can be omitted
                        base_url=os.getenv(
                            'OPENAI_API_BASE', 'https://api.openai.com/v1'),
                        api_key=os.getenv('OPENAI_API_KEY')
                    )
                # logger.warning('翻译失败')
                time.sleep(1)
        full_translation.append(translation)
        history.append({'role': 'user', 'content': f'Translate:"{text}"'})
        history.append({'role': 'assistant', 'content': f'翻译：“{translation}”'})
        time.sleep(0.1)

    return full_translation

def translate(folder, target_language='简体中文'):
    if os.path.exists(os.path.join(folder, 'translation.json')):
        logger.info(f'Translation already exists in {folder}')
        return True
    
    info_path = os.path.join(folder, 'download.info.json')
    if not os.path.exists(info_path):
        return False
    # info_path = r'videos\Lex Clips\20231222 Jeff Bezos on fear of death ｜ Lex Fridman Podcast Clips\download.info.json'
    with open(info_path, 'r', encoding='utf-8') as f:
        info = json.load(f)
    info = get_necessary_info(info)
    
    transcript_path = os.path.join(folder, 'transcript.json')
    with open(transcript_path, 'r', encoding='utf-8') as f:
        transcript = json.load(f)
    
    summary_path = os.path.join(folder, 'summary.json')
    if os.path.exists(summary_path):
        summary = json.load(open(summary_path, 'r', encoding='utf-8'))
    else:
        summary = summarize(info, transcript, target_language)
        if summary is None:
            logger.error(f'Failed to summarize {folder}')
            return False
        with open(summary_path, 'w', encoding='utf-8') as f:
            json.dump(summary, f, indent=2, ensure_ascii=False)

    translation_path = os.path.join(folder, 'translation.json')
    translation = _translate(summary, transcript, target_language)
    for i, line in enumerate(transcript):
        line['translation'] = translation[i]
    transcript = split_sentences(transcript)
    with open(translation_path, 'w', encoding='utf-8') as f:
        json.dump(transcript, f, indent=2, ensure_ascii=False)
    return True

def translate_all_transcript_under_folder(folder, target_language):
    init_translation()
    for root, dirs, files in os.walk(folder):
        if 'transcript.json' in files and 'translation.json' not in files:
            translate(root, target_language)
    return f'Translated all videos under {folder}'

if __name__ == '__main__':
    import sys
    folder = sys.argv[1]
    target_language = sys.argv[2]
    translate_all_transcript_under_folder(folder, target_language)
    # test_str = "废弃工厂”可是最长的地图，足足有60.7个“红气球秒”那么长；而“金发女郎”地图最短，只有可怜的4个“红气球秒”。"
    # sentences = split_text_into_sentences(test_str)
    # print(sentences)
