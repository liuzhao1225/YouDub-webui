import json
import os
from PIL import Image
import re

def resize_thumbnail(folder, size=(1280, 960)):
    # 定义支持的图片后缀
    image_suffix = ['.jpg', '.jpeg', '.png', '.bmp', '.webp']
    for suffix in image_suffix:
        # 构建图片路径
        image_path = os.path.join(folder, f'download{suffix}')
        if os.path.exists(image_path):
            break
    with Image.open(image_path) as img:
        # 计算图片和目标尺寸的宽高比
        img_ratio = img.width / img.height
        target_ratio = size[0] / size[1]

        if img_ratio < target_ratio:
            # 图片比目标宽高比更宽，固定高度
            new_height = size[1]
            new_width = int(new_height * img_ratio)
        else:
            # 图片比目标宽高比更高，固定宽度
            new_width = size[0]
            new_height = int(new_width / img_ratio)

        # 使用高质量重采样调整图片大小
        img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)

        # 创建一个目标尺寸的黑色背景图片
        new_img = Image.new('RGB', size, "black")

        # 将调整大小后的图片粘贴到黑色背景图片的中心
        x_offset = (size[0] - new_width) // 2
        y_offset = (size[1] - new_height) // 2
        new_img.paste(img, (x_offset, y_offset))

        # 保存或返回新图片
        new_img_path = os.path.join(folder, 'video.png')  # 根据需要修改
        new_img.save(new_img_path)
        return new_img_path

def generate_summary_txt(folder):
    with open(os.path.join(folder, 'summary.json'), 'r', encoding='utf-8') as f:
        summary = json.load(f)
    # 构建标题
    title = f'{summary["title"]}'
    # 使用正则表达式去除日期，包括常见格式如YYYY-MM-DD, MM/DD/YYYY, DD.MM.YYYY, 240928, 20240928
    title_without_date = re.sub(
        r'\b(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[./]\d{1,2}[./]\d{4}|\d{6,8})\b', '', title)
    # summary = summary['summary']
    txt = f'{title_without_date.replace(summary["author"],"").replace(summary["author"].replace(" ",""),"")}\n#韩国女团 #美女舞蹈 #女团热舞 #这谁顶得住'
    # 将标题和摘要写入video.txt文件
    with open(os.path.join(folder, 'video.txt'), 'w', encoding='utf-8') as f:
        f.write(txt)

def generate_info(folder):
    # 生成摘要文本和调整缩略图
    generate_summary_txt(folder)
    # resize_thumbnail(folder)
    
def generate_all_info_under_folder(root_folder):
    # 遍历根文件夹下的所有文件夹
    for root, dirs, files in os.walk(root_folder):
        if 'download.info.json' in files:
            # 如果存在download.info.json文件，则生成信息
            generate_info(root)
    return f'Generated all info under {root_folder}'

if __name__ == '__main__':
    # 生成videos文件夹下的所有信息
    generate_all_info_under_folder('videos')
