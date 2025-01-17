import subprocess


def add_fire_border(input_video, output_video, border_size=0.02):
    """
    为视频添加火焰边框效果
    
    Args:
        input_video: 输入视频路径
        output_video: 输出视频路径
        border_size: 边框大小(相对于视频高度的比例),默认0.02
    """
    filter_complex = (
        f"[0:v]split=2[original][border];"
        f"[border]colorkey=black:0.1:0.2,split=4[t1][t2][t3][t4];"
        f"[t1]crop=iw:ih*{border_size}:0:0,colorbalance=rs=0.5:gs=0:bs=0,gblur=sigma=2,eq=brightness=0.2:saturation=5[top];"
        f"[t2]crop=iw:ih*{border_size}:0:ih-ih*{border_size},colorbalance=rs=0.5:gs=0:bs=0,gblur=sigma=2,eq=brightness=0.2:saturation=5[bottom];"
        f"[t3]crop=iw*{border_size}:ih:0:0,colorbalance=rs=0.5:gs=0:bs=0,gblur=sigma=2,eq=brightness=0.2:saturation=5[left];"
        f"[t4]crop=iw*{border_size}:ih:iw-iw*{border_size}:0,colorbalance=rs=0.5:gs=0:bs=0,gblur=sigma=2,eq=brightness=0.2:saturation=5[right];"
        "[original][top]overlay=0:0[v1];"
        "[v1][bottom]overlay=0:H-h[v2];"
        "[v2][left]overlay=0:0[v3];"
        "[v3][right]overlay=W-w:0"
    )

    command = [
        'ffmpeg', '-i', input_video,
        '-filter_complex', filter_complex,
        '-c:v', 'libx264', '-preset', 'medium',
        '-c:a', 'copy',
        output_video
    ]
    
    subprocess.run(command, check=True)


if __name__ == '__main__':
    video_path = "E:\IDEA\workspace\YouDub-webui\youdub\\videos\\20160519 160519 레이샤 LAYSHA 고은 - Chocolate Cream 신한대축제 직캠 fancam by zam\download.mp4"
    output_path = "E:\IDEA\workspace\YouDub-webui\youdub\\videos\\20160519 160519 레이샤 LAYSHA 고은 - Chocolate Cream 신한대축제 직캠 fancam by zam\download2.mp4"
   
    add_fire_border(video_path, output_path)

