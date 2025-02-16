import struct
import os

def find_box(data, start_offset, box_type, parent_size=None):
    """查找指定类型的box"""
    offset = start_offset
    end_offset = len(data) if parent_size is None else start_offset + parent_size
    
    while offset < end_offset:
        if offset + 8 > len(data):
            return -1
        
        size = struct.unpack('>I', data[offset:offset+4])[0]
        box = data[offset+4:offset+8]
        
        try:
            box_name = box.decode('utf-8')
            print(f"在偏移量 {offset} 处找到 box: {box_name}, size: {size}")
        except:
            print(f"在偏移量 {offset} 处找到无法解码的 box, size: {size}")
            
        if box == box_type.encode():
            return offset
            
        # 检查是否是容器box
        if box_name in ['moov', 'trak', 'mdia', 'minf', 'stbl']:
            # 递归查找子box
            child_offset = find_box(data, offset + 8, box_type, size - 8)
            if child_offset != -1:
                return child_offset
        
        if size == 0:
            break
        if size < 8:
            offset += 8
        else:
            offset += size
    return -1

def dump_boxes(data, start_offset=0, level=0, parent_size=None):
    """递归打印所有可识别的box结构"""
    offset = start_offset
    end_offset = len(data) if parent_size is None else start_offset + parent_size
    
    while offset < end_offset:
        if offset + 8 > len(data):
            break
            
        size = struct.unpack('>I', data[offset:offset+4])[0]
        box = data[offset+4:offset+8]
        
        try:
            box_name = box.decode('utf-8')
            print(f"{'  ' * level}偏移量: {offset}, Box: {box_name}, Size: {size}")
            
            # 递归打印容器box的内容
            if box_name in ['moov', 'trak', 'mdia', 'minf', 'stbl']:
                dump_boxes(data, offset + 8, level + 1, size - 8)
                
        except:
            print(f"{'  ' * level}偏移量: {offset}, Box: (无法解码), Size: {size}")
            
        if size == 0:
            break
        if size < 8:
            offset += 8
        else:
            offset += size

def modify_video_duration(input_file, target_duration):
    """
    修改MP4视频的显示时长
    
    Args:
        input_file (str): 输入视频文件路径
        target_duration (float): 目标时长(秒)
        
    Raises:
        ValueError: 当输入参数无效或文件格式不正确时
        IOError: 当文件操作失败时
    """
    if not os.path.exists(input_file):
        raise ValueError(f"文件不存在: {input_file}")
        
    try:
        with open(input_file, 'rb+') as f:
            # 一次性读取所有数据到内存
            data = bytearray(f.read())
            
            print("\n=== 文件结构分析 ===")
            dump_boxes(data)
            print("\n=== 开始处理 ===")
            
            # 验证文件格式
            ftyp_offset = find_box(data, 0, 'ftyp')
            if ftyp_offset == -1:
                raise ValueError("不是有效的MP4文件 (未找到 ftyp box)")
            
            # 定位关键box
            moov_offset = find_box(data, 0, 'moov')
            if moov_offset == -1:
                raise ValueError("未找到 moov box，可能不是标准的MP4文件")
            
            moov_size = struct.unpack('>I', data[moov_offset:moov_offset+4])[0]
            
            # 处理mvhd box
            mvhd_offset = find_box(data, moov_offset, 'mvhd', moov_size)
            if mvhd_offset == -1:
                raise ValueError("未找到 mvhd box")
            
            # 读取版本和时间刻度
            version = data[mvhd_offset + 8]
            timescale_offset = mvhd_offset + 12 + (16 if version == 1 else 8)
            timescale = struct.unpack('>I', data[timescale_offset:timescale_offset+4])[0]
            
            # 计算目标duration值
            target_duration_value = int(target_duration * timescale)
            
            # 修改mvhd duration
            duration_offset = timescale_offset + 4
            if version == 1:
                struct.pack_into('>Q', data, duration_offset, target_duration_value)
            else:
                struct.pack_into('>I', data, duration_offset, target_duration_value)
            
            # 修改所有轨道的duration
            track_count = 0
            current_offset = moov_offset
            while True:
                trak_offset = find_box(data, current_offset, 'trak', moov_size)
                if trak_offset == -1:
                    break
                    
                track_count += 1
                trak_size = struct.unpack('>I', data[trak_offset:trak_offset+4])[0]
                tkhd_offset = find_box(data, trak_offset, 'tkhd', trak_size)
                
                if tkhd_offset != -1:
                    tkhd_version = data[tkhd_offset + 8]
                    duration_offset = tkhd_offset + 12 + (20 if tkhd_version == 1 else 12)
                    
                    if tkhd_version == 1:
                        struct.pack_into('>Q', data, duration_offset, target_duration_value)
                    else:
                        struct.pack_into('>I', data, duration_offset, target_duration_value)
                
                current_offset = trak_offset + trak_size
            
            # 写回文件
            f.seek(0)
            f.write(data)
            f.truncate()
            
            print(f"\n成功修改了视频时长为 {target_duration} 秒")
            print(f"修改了 {track_count} 个轨道的时长")

    except IOError as e:
        raise IOError(f"文件操作失败: {str(e)}")
    except Exception as e:
        raise ValueError(f"处理失败: {str(e)}")

if __name__ == "__main__":
    # video_path = r"/youdub/videos/20160519 160519 레이샤 LAYSHA 고은 - Chocolate Cream 신한대축제 직캠 fancam by zam/download_final.mp4"
    # new_duration = 10  # 10秒
    # modify_video_duration(video_path, new_duration)
    import ffmpeg
    import os

    input_file_1 = r"E:\IDEA\workspace\YouDub-webui\social_auto_upload\videos\Catchy_Trend\WQfWQBVb9hI_20241028_street_style_fashion_chinese_girl_chinesefashion_chinafashion_shorts\download.mp4"
    input_file_2 = r"E:\IDEA\workspace\YouDub-webui\social_auto_upload\videos\Catchy_Trend\WQfWQBVb9hI_20241028_street_style_fashion_chinese_girl_chinesefashion_chinafashion_shorts\download_final.mp4"
    output_file = r"E:\IDEA\workspace\YouDub-webui\social_auto_upload\videos\Catchy_Trend\WQfWQBVb9hI_20241028_street_style_fashion_chinese_girl_chinesefashion_chinafashion_shorts\d1.mp4"
    output_file2 = r"E:\IDEA\workspace\YouDub-webui\social_auto_upload\videos\Catchy_Trend\WQfWQBVb9hI_20241028_street_style_fashion_chinese_girl_chinesefashion_chinafashion_shorts\d2.mp4"
    output_file3 = r"E:\IDEA\workspace\YouDub-webui\social_auto_upload\videos\Catchy_Trend\WQfWQBVb9hI_20241028_street_style_fashion_chinese_girl_chinesefashion_chinafashion_shorts\d3.mp4"


    import ffmpeg

    # 设置分割的时间点（秒数）
    split_time = 5  # 例如，30秒


    # # 分割成两个部分（禁用关键帧）
    # ffmpeg.input(input_file_1, ss=0, to=split_time).output(output_file, g=1000, vsync=0).run()  # 前30秒
    # ffmpeg.input(input_file_1, ss=split_time).output(output_file2, g=1000, vsync=0).run()  # 从30秒开始
    #
    # # 合成两个视频（禁用关键帧并使时间戳不连续）
    # input1 = ffmpeg.input(output_file)
    # input2 = ffmpeg.input(output_file2)
    #
    # # 使用合适的 filter_complex 参数进行视频合成
    # ffmpeg.output(input1, input2, output_file3,
    #               filter_complex='[0:v][1:v]concat=n=2:v=1:a=0', vsync=0).run()
    # 首先，将两个视频流输入到 `ffmpeg.input()`
    # ffmpeg.input(input_file_1, ss=0, to=split_time).output(output_file).run()  # 视频前30秒
    # ffmpeg.input(input_file_1, ss=split_time).output(output_file2).run()
    # input1 = ffmpeg.input(output_file)
    # input2 = ffmpeg.input(output_file2)
    #
    # # 使用合适的 filter_complex 参数进行视频合成
    # ffmpeg.output(input1, input2, output_file3,
    #               filter_complex='[0:v][1:v]concat=n=2:v=1:a=0', vsync=0).run()
# ffmpeg.input('video1.mp4').input('video2.mp4').output('output.mp4', filter_complex='[0:v][1:v]concat=n=2:v=1:a=0', vsync=0).run()