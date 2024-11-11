#!/usr/bin/env python3

# Allow direct execution
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import yt_dlp
import yt_dlp.options

create_parser = yt_dlp.options.create_parser


def parse_patched_options(opts):
    patched_parser = create_parser()
    patched_parser.defaults.update({
        'ignoreerrors': False,
        'retries': 0,
        'fragment_retries': 0,
        'extract_flat': False,
        'concat_playlist': 'never',
    })
    yt_dlp.options.create_parser = lambda: patched_parser
    try:
        return yt_dlp.parse_options(opts)
    finally:
        yt_dlp.options.create_parser = create_parser


default_opts = parse_patched_options([]).ydl_opts


def cli_to_api(opts, cli_defaults=False):
    opts = (yt_dlp.parse_options if cli_defaults else parse_patched_options)(opts).ydl_opts

    diff = {k: v for k, v in opts.items() if default_opts[k] != v}
    if 'postprocessors' in diff:
        diff['postprocessors'] = [pp for pp in diff['postprocessors']
                                  if pp not in default_opts['postprocessors']]
    return diff


if __name__ == '__main__':
    from pprint import pprint

    # # 获取用户输入的参数
    # user_input = input("请输入参数（用空格分隔）：\n")
    # args = user_input.split()

    # print('\nThe arguments passed translate to:\n')
    # pprint(cli_to_api(args))
    # print('\nCombining these with the CLI defaults gives:\n')
    # pprint(cli_to_api(args, True))
    # yt-dlp -S +codec:avc:m4a --max-downloads 5 --print filename -o "test video.%(ext)s" BaW_jenozKc


    import os

    def find_small_videos(directory, size_limit=200 * 1024 * 1024):
        video_extensions = ('.mp4', '.mkv', '.avi', '.mov', '.flv', '.wmv', '.webm', '.mpeg', '.mpg', '.m4v', '.3gp')
        small_videos = []
        for root, dirs, files in os.walk(directory):
            for file in files:
                file_path = os.path.join(root, file)
                if os.path.getsize(file_path) < size_limit and file_path.endswith(video_extensions):
                    small_videos.append(file_path)
        return small_videos

    directory = input("请输入要搜索的视频文件目录：\n")
    small_videos = find_small_videos(directory)
    print("\n小于200MB的视频文件路径如下：\n")
    for video in small_videos:
        print(video)