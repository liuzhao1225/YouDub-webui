import os
import re


def sanitize_title(title):
    # Only keep numbers, letters, Chinese characters, and spaces
    title = re.sub(r'[^\w\u4e00-\u9fff \d_-]', '', title)
    # Replace multiple spaces with a single space
    title = re.sub(r'\s+', ' ', title)
    return title


for root, dirs, files in os.walk('videos'):
    if 'download.mp4' in files:
        par_folder = os.path.dirname(root)
        old_title = os.path.basename(root)
        new_title = sanitize_title(old_title)
        if old_title != new_title:
            print(old_title)
            print(new_title)
            print()
            os.rename(os.path.join(par_folder, old_title),
                      os.path.join(par_folder, new_title))
        # os.rename(os.path.join(root, file), os.path.join(root, title+'.mp4'))