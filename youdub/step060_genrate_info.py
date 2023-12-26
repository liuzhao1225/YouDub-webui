import json
import os
from PIL import Image


def resize_thumbnail(folder, size=(1280, 960)):
    image_suffix = ['.jpg', '.jpeg', '.png', '.bmp', '.webp']
    for suffix in image_suffix:
        image_path = os.path.join(folder, f'download{suffix}')
        if os.path.exists(image_path):
            break
    with Image.open(image_path) as img:
        # Calculate the ratio and the size to maintain aspect ratio
        img_ratio = img.width / img.height
        target_ratio = size[0] / size[1]

        if img_ratio < target_ratio:
            # Image is wider than target ratio, fix height to the desired size
            new_height = size[1]
            new_width = int(new_height * img_ratio)
        else:
            # Image is taller than target ratio, fix width to the desired size
            new_width = size[0]
            new_height = int(new_width / img_ratio)

        # Resize the image with high-quality resampling
        img = img.resize((new_width, new_height), Image.Resampling.LANCZOS)

        # Create a black image of the target size
        new_img = Image.new('RGB', size, "black")

        # Paste the resized image onto the center of the black image
        x_offset = (size[0] - new_width) // 2
        y_offset = (size[1] - new_height) // 2
        new_img.paste(img, (x_offset, y_offset))

        # Save or return the new image
        new_img_path = os.path.join(folder, 'video.png')  # Modify as needed
        new_img.save(new_img_path)
        return new_img_path

def generate_summary_txt(folder):
    with open(os.path.join(folder, 'summary.json'), 'r', encoding='utf-8') as f:
        summary = json.load(f)
    title = f'{summary["title"]} - {summary["author"]}'
    summary = summary['summary']
    txt = f'{title}\n\n{summary}'
    with open(os.path.join(folder, 'video.txt'), 'w', encoding='utf-8') as f:
        f.write(txt)

def generate_info(folder):
    generate_summary_txt(folder)
    resize_thumbnail(folder)
    
def generate_all_info_under_folder(root_folder):
    for root, dirs, files in os.walk(root_folder):
        if 'download.info.json' in files:
            generate_info(root)
    return f'Generated all info under {root_folder}'
if __name__ == '__main__':
    generate_all_info_under_folder('videos')
