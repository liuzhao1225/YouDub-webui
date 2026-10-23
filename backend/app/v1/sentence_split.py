"""Original YouDub subtitle sentence splitting, copied verbatim.

Source: /Users/liuzhao/code/youdub-backend/youdub/utils.py
Commit: 2f30b06902e8ebc7a6469eb74ba0fcc58d279673
Function source SHA-256 (without final newline): 30a3ce6efac89f855c05041eee2422c6a00364713c1d89e6561f00159fadd4bf
Only the original pure function is copied; no application initialization runs.
"""

import re
from typing import List


def split_sentence_by_punctuation(sentence: str) -> List[str]:
    """
    将句子按标点符号分割成更短的句子片段；《》、（）、【】、「」内部不分割。
    
    Args:
        sentence: 需要分割的句子
        
    Returns:
        分割后的句子列表
    """
    if not sentence:
        return []

    original = sentence.strip()
    if not original:
        return []

    punctuation_marks = {"，", ",", "；", ";", "：", ":", "。", "?", "？", "!", "！", "、"}
    # 需要保护的标点符号对（内部不分割）
    protected_pairs = {
        "《": "》",  # 书名号
        "（": "）",  # 圆括号
        "【": "】",  # 方括号
        "「": "」",  # 日式引号
        "『": "』",  # 日式引号
    }
    
    segments: List[str] = []
    buf: List[str] = []
    inside_protected = False
    protected_start = None

    for ch in original:
        # 检查是否进入保护区域
        if not inside_protected and ch in protected_pairs:
            inside_protected = True
            protected_start = ch
            buf.append(ch)
            continue
            
        # 检查是否离开保护区域
        if inside_protected and protected_start and ch == protected_pairs[protected_start]:
            inside_protected = False
            protected_start = None
            buf.append(ch)
            continue
            
        # 在保护区域内，不分割
        if inside_protected:
            buf.append(ch)
            continue
            
        # 在保护区域外，可以分割
        if ch in punctuation_marks:
            segment = "".join(buf).strip()
            if segment:
                segments.append(segment)
            buf.clear()
            continue
            
        buf.append(ch)

    if buf:
        tail = "".join(buf).strip()
        if tail:
            segments.append(tail)

    if not segments:
        return []

    closing_quotes = {"\"", "'", "」", "』", "》", "）", "】", "”", "’", "]"}
    fixed: List[str] = []
    for seg in segments:
        if seg and seg[0] in closing_quotes and fixed:
            fixed[-1] = f"{fixed[-1]}{seg}".strip()
            continue
        fixed.append(seg.strip())

    merged: List[str] = []
    i = 0
    while i < len(fixed):
        cur = fixed[i]
        if len(cur.strip()) < 5 and i + 1 < len(fixed):
            fixed[i + 1] = f"{cur}{fixed[i + 1]}".strip()
            i += 1
            continue
        merged.append(cur)
        i += 1

    cleaned: List[str] = []
    for item in merged:
        if not item.strip():
            continue
        text = item.strip()
        if text.endswith(("，", ",", "。")):
            text = text[:-1]
        cleaned.append(re.sub(r"\s+", " ", text).strip())

    return cleaned if cleaned else [original]
