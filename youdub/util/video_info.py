import ffmpeg
from pathlib import Path
from typing import Dict, Any, Optional
import json
from datetime import timedelta
import time
import subprocess
import statistics
import os

class VideoInfoExtractor:
    def __init__(self, video_path: str):
        self.video_path = Path(video_path)
        if not self.video_path.exists():
            raise FileNotFoundError(f"视频文件不存在: {video_path}")
        
    def get_full_info(self) -> Dict[str, Any]:
        """获取视频的完整信息"""
        try:
            probe = ffmpeg.probe(str(self.video_path))
            return probe
        except ffmpeg.Error as e:
            print(f"获取视频信息时出错: {str(e)}")
            return {}

    def get_basic_info(self) -> Dict[str, Any]:
        """获取视频基本信息"""
        info = self.get_full_info()
        if not info:
            return {}
            
        video_stream = next((stream for stream in info['streams'] 
                           if stream['codec_type'] == 'video'), None)
        audio_stream = next((stream for stream in info['streams'] 
                           if stream['codec_type'] == 'audio'), None)
        
        basic_info = {
            '文件名': self.video_path.name,
            '文件大小': f"{self.video_path.stat().st_size / (1024*1024):.2f} MB",
            '时长': str(timedelta(seconds=float(info['format'].get('duration', 0)))),
            '格式': info['format']['format_name'],
            '比特率': f"{int(info['format'].get('bit_rate', 0)) // 1000} kbps",
            '创建时间': time.strftime('%Y-%m-%d %H:%M:%S', 
                                time.localtime(self.video_path.stat().st_ctime))
        }
        
        if video_stream:
            basic_info.update({
                '视频编码': video_stream.get('codec_name', '未知'),
                '分辨率': f"{video_stream.get('width', '?')}x{video_stream.get('height', '?')}",
                '帧率': video_stream.get('r_frame_rate', '未知'),
                '视频比特率': f"{int(video_stream.get('bit_rate', 0)) // 1000} kbps",
                '像素格式': video_stream.get('pix_fmt', '未知'),
                '视频时长': str(timedelta(seconds=float(video_stream.get('duration', 0))))
            })
            
        if audio_stream:
            basic_info.update({
                '音频编码': audio_stream.get('codec_name', '未知'),
                '音频采样率': f"{audio_stream.get('sample_rate', '?')} Hz",
                '音频通道': audio_stream.get('channels', '未知'),
                '音频比特率': f"{int(audio_stream.get('bit_rate', 0)) // 1000} kbps",
                '音频时长': str(timedelta(seconds=float(audio_stream.get('duration', 0))))
            })
            
        return basic_info

    def get_mvhd_info(self) -> Optional[Dict[str, Any]]:
        """获取 moov.mvhd (movie header) 信息"""
        try:
            # 使用 ffprobe 获取更详细的容器信息
            cmd = [
                'ffprobe',
                '-v', 'quiet',
                '-print_format', 'json',
                '-show_format',
                '-show_streams',
                '-show_entries', 'format_tags:stream_tags',
                '-show_entries', 'stream=index,codec_type,codec_name',
                '-show_entries', 'format=duration,size,bit_rate',
                str(self.video_path)
            ]
            
            result = ffmpeg.probe(str(self.video_path), cmd=cmd)
            
            # 查找 moov.mvhd 信息
            mvhd_info = {}
            if 'format' in result and 'tags' in result['format']:
                tags = result['format']['tags']
                if 'com.apple.quicktime.movie.matrix' in tags:
                    mvhd_info['matrix'] = tags['com.apple.quicktime.movie.matrix']
                if 'com.apple.quicktime.creationdate' in tags:
                    mvhd_info['creation_time'] = tags['com.apple.quicktime.creationdate']
                if 'com.apple.quicktime.location.ISO6709' in tags:
                    mvhd_info['location'] = tags['com.apple.quicktime.location.ISO6709']
            
            # 添加时间相关信息
            if 'format' in result:
                mvhd_info['duration'] = float(result['format'].get('duration', 0))
                mvhd_info['timescale'] = 1000  # 默认时间刻度
            
            return mvhd_info if mvhd_info else None
            
        except ffmpeg.Error as e:
            print(f"获取 MVHD 信息时出错: {str(e)}")
            return None

    def get_moov_info(self) -> Optional[Dict[str, Any]]:
        """获取 moov (movie box) 完整信息"""
        try:
            result = ffmpeg.probe(
                str(self.video_path),
                show_format=None,
                show_streams=None,
                show_entries='format_tags:stream_tags:stream=index,codec_type,codec_name,time_base,duration,nb_frames,avg_frame_rate,r_frame_rate,pix_fmt,profile,level:format=duration,size,bit_rate,start_time'
            )
            
            moov_info = {
                'mvhd': {
                    '说明': 'movie header box，包含影片的全局信息',
                    '数据': {}
                },
                'trak': {
                    '说明': '轨道容器，包含媒体轨道或者hint轨道的信息',
                    '数据': []
                },
                'udta': {
                    '说明': '用户数据容器，包含用户自定义数据',
                    '数据': {}
                }
            }
            
            # 提取 mvhd 信息
            if 'format' in result and 'tags' in result['format']:
                tags = result['format']['tags']
                mvhd_data = moov_info['mvhd']['数据']
                
                # 基本时间信息
                mvhd_data.update({
                    '时长(秒)': float(result['format'].get('duration', 0)),
                    '时间刻度': 1000,  # timescale
                    '创建时间': tags.get('com.apple.quicktime.creationdate', '未知'),
                    '修改时间': tags.get('com.apple.quicktime.modificationdate', '未知')
                })
                
                # 变换矩阵
                if 'com.apple.quicktime.movie.matrix' in tags:
                    mvhd_data['变换矩阵'] = {
                        '值': tags['com.apple.quicktime.movie.matrix'],
                        '说明': '视频变换矩阵，用于视频旋转和缩放'
                    }
                
                # 首选播放速率和音量
                mvhd_data.update({
                    '首选播放速率': 1.0,
                    '首选音量': 1.0
                })
            
            # 提取 trak 信息
            for stream in result['streams']:
                trak_info = {
                    '类型': stream.get('codec_type', '未知'),
                    '编解码器': stream.get('codec_name', '未知'),
                    '时基': stream.get('time_base', '未知'),
                    '时基说明': self._get_timebase_explanation(
                        stream.get('time_base', ''),
                        stream.get('codec_type', '')
                    ),
                    '时长': stream.get('duration', '未知'),
                    '编码配置': {
                        'profile': stream.get('profile', '未知'),
                        'level': stream.get('level', '未知')
                    }
                }
                
                if stream.get('codec_type') == 'video':
                    trak_info.update({
                        '总帧数': stream.get('nb_frames', '未知'),
                        '平均帧率': stream.get('avg_frame_rate', '未知'),
                        '实际帧率': stream.get('r_frame_rate', '未知'),
                        '分辨率': f"{stream.get('width', '?')}x{stream.get('height', '?')}",
                        '像素格式': stream.get('pix_fmt', '未知'),
                        '比特率': f"{int(stream.get('bit_rate', 0)) // 1000} kbps"
                    })
                elif stream.get('codec_type') == 'audio':
                    trak_info.update({
                        '采样率': stream.get('sample_rate', '未知'),
                        '声道数': stream.get('channels', '未知'),
                        '采样格式': stream.get('sample_fmt', '未知'),
                        '比特率': f"{int(stream.get('bit_rate', 0)) // 1000} kbps"
                    })
                
                moov_info['trak']['数据'].append(trak_info)
            
            # 提取用户数据
            if 'format' in result and 'tags' in result['format']:
                tags = result['format']['tags']
                udta_data = moov_info['udta']['数据']
                
                # 常见元数据
                metadata_mapping = {
                    'title': '标题',
                    'artist': '艺术家',
                    'date': '日期',
                    'comment': '注释',
                    'copyright': '版权',
                    'genre': '类型',
                    'location': '地理位置',
                    'com.apple.quicktime.location.ISO6709': 'GPS位置',
                    'com.apple.quicktime.make': '设备制造商',
                    'com.apple.quicktime.model': '设备型号',
                    'com.apple.quicktime.software': '软件',
                }
                
                for tag_key, display_name in metadata_mapping.items():
                    if tag_key in tags:
                        udta_data[display_name] = tags[tag_key]
            
            return moov_info
            
        except ffmpeg.Error as e:
            print(f"获取 MOOV 信息时出错: {str(e)}")
            return None

    def _get_timebase_explanation(self, time_base: str, codec_type: str) -> str:
        """获取时基的解释说明"""
        try:
            if not time_base or '/' not in time_base:
                return '未知时基'
                
            num, den = map(int, time_base.split('/'))
            if num != 1:
                return '非标准时基'
                
            if codec_type == 'audio':
                if den == 44100:
                    return 'CD质量音频标准采样率 (44.1kHz)'
                elif den == 48000:
                    return '专业音频标准采样率 (48kHz)'
                else:
                    return f'音频采样率 {den}Hz'
            elif codec_type == 'video':
                frame_duration = den / num
                fps = 1 / (frame_duration / den)
                return f'可以精确表示 {fps:.3f}fps 的视频帧率'
            else:
                return f'时间精度: {den}分之一秒'
                
        except Exception:
            return '时基解析失败'

    def get_frame_info(self) -> Dict[str, Any]:
        """获取详细的帧信息分析"""
        try:
            cmd = [
                'ffprobe',
                '-v', 'quiet',
                '-select_streams', 'v:0',
                '-show_frames',
                '-show_entries', 'frame=pkt_pts_time,pkt_dts_time,pkt_duration_time,key_frame,pkt_size,pict_type',
                '-of', 'json',
                str(self.video_path)
            ]
            
            result = json.loads(subprocess.check_output(cmd).decode())
            frames = result.get('frames', [])
            
            if not frames:
                return {'错误': '无法获取帧信息'}
            
            # 分析帧时间分布
            frame_analysis = {
                '总帧数': len(frames),
                '关键帧数': sum(1 for f in frames if f.get('key_frame', 0) == 1),
                '帧时间分析': {},
                '异常帧': [],
                '帧时间分布': [],
                '帧大小分布': {}
            }
            
            prev_pts = None
            max_interval = 0
            min_interval = float('inf')
            total_duration = 0
            intervals = []
            frame_sizes = []
            
            for i, frame in enumerate(frames):
                pts = float(frame.get('pkt_pts_time', 0) or 0)  # 处理None值
                duration = float(frame.get('pkt_duration_time', 0) or 0)
                is_keyframe = frame.get('key_frame', 0) == 1
                frame_size = int(frame.get('pkt_size', 0) or 0)
                frame_sizes.append(frame_size)
                
                if prev_pts is not None and pts > prev_pts:  # 确保时间戳有效且递增
                    interval = pts - prev_pts
                    intervals.append(interval)
                    
                    if interval > 0.1:  # 检测异常间隔（大于100ms）
                        frame_analysis['异常帧'].append({
                            '帧序号': i,
                            '时间戳': pts,
                            '距上一帧': interval,
                            '是否关键帧': is_keyframe,
                            '帧大小': f"{frame_size/1024:.1f}KB"
                        })
                    
                    max_interval = max(max_interval, interval)
                    min_interval = min(min_interval, interval)
                    total_duration += interval
                
                prev_pts = pts if pts > 0 else prev_pts  # 只使用有效的时间戳
            
            # 计算帧时间统计
            if intervals:
                frame_analysis['帧时间分析'] = {
                    '平均帧间隔': total_duration / len(intervals),
                    '最大帧间隔': max_interval,
                    '最小帧间隔': min_interval,
                    '标准差': statistics.stdev(intervals) if len(intervals) > 1 else 0,
                    '理论帧率': 1 / (total_duration / len(intervals)) if total_duration > 0 else 0
                }
            
            # 分析帧大小分布
            if frame_sizes:
                frame_analysis['帧大小分析'] = {
                    '平均大小': f"{statistics.mean(frame_sizes)/1024:.1f}KB",
                    '最大帧': f"{max(frame_sizes)/1024:.1f}KB",
                    '最小帧': f"{min(frame_sizes)/1024:.1f}KB",
                    '标准差': f"{statistics.stdev(frame_sizes)/1024:.1f}KB" if len(frame_sizes) > 1 else "0KB"
                }
            
            # 分析帧时间分布
            if frames:
                first_pts = float(frames[0].get('pkt_pts_time', 0) or 0)
                last_pts = float(frames[-1].get('pkt_pts_time', 0) or total_duration)
                total_time = last_pts - first_pts
                
                if total_time > 0:  # 确保总时长大于0
                    # 将视频分成10个时间段分析帧分布
                    segments = 10
                    segment_duration = total_time / segments
                    frame_distribution = [0] * segments
                    
                    for frame in frames:
                        pts = float(frame.get('pkt_pts_time', 0) or 0)
                        if pts >= first_pts:  # 只统计有效时间戳
                            segment_index = int((pts - first_pts) / segment_duration)
                            if 0 <= segment_index < segments:
                                frame_distribution[segment_index] += 1
                    
                    frame_analysis['帧时间分布'] = [
                        {
                            '时间段': f"{i*segment_duration:.1f}-{(i+1)*segment_duration:.1f}秒",
                            '帧数': count,
                            '帧率': f"{count/segment_duration:.1f}fps" if segment_duration > 0 else "N/A"
                        }
                        for i, count in enumerate(frame_distribution)
                    ]
            
            # 添加关键帧位置分析
            keyframe_positions = []
            frame_types = {'I': 0, 'P': 0, 'B': 0}
            
            for i, frame in enumerate(frames):
                pict_type = frame.get('pict_type', '')
                if pict_type in frame_types:
                    frame_types[pict_type] += 1
                
                if frame.get('key_frame', 0) == 1:
                    pts = float(frame.get('pkt_pts_time', 0) or 0)
                    keyframe_positions.append({
                        '帧序号': i,
                        '时间戳': pts,
                        '大小': f"{int(frame.get('pkt_size', 0))/1024:.1f}KB"
                    })
            
            frame_analysis['关键帧位置'] = keyframe_positions
            frame_analysis['帧类型统计'] = {
                'I帧(关键帧)': frame_types['I'],
                'P帧(预测帧)': frame_types['P'],
                'B帧(双向帧)': frame_types['B']
            }
            
            # 计算GOP（图像组）大小
            if len(keyframe_positions) > 1:
                gop_sizes = []
                for i in range(1, len(keyframe_positions)):
                    gop_size = keyframe_positions[i]['帧序号'] - keyframe_positions[i-1]['帧序号']
                    gop_sizes.append(gop_size)
                
                frame_analysis['GOP分析'] = {
                    '平均GOP大小': f"{sum(gop_sizes)/len(gop_sizes):.1f}帧",
                    '最大GOP': f"{max(gop_sizes)}帧",
                    '最小GOP': f"{min(gop_sizes)}帧"
                }
            
            return frame_analysis
            
        except Exception as e:
            return {'错误': f'帧分析失败: {str(e)}'}

    def print_info(self, include_moov: bool = True, include_frames: bool = True):
        """打印视频的所有信息"""
        basic_info = self.get_basic_info()
        print("\n=== 视频基本信息 ===")
        for key, value in basic_info.items():
            print(f"{key}: {value}")

        if include_moov:
            moov_info = self.get_moov_info()
            if moov_info:
                print("\n=== MOOV 容器信息 ===")
                
                # 打印 mvhd 信息
                print("\n--- MVHD (Movie Header) ---")
                print("说明:", moov_info['mvhd']['说明'])
                for key, value in moov_info['mvhd']['数据'].items():
                    print(f"{key}: {value}")
                
                # 打印 trak 信息
                print("\n--- TRAK (Tracks) ---")
                print("说明:", moov_info['trak']['说明'])
                for i, track in enumerate(moov_info['trak']['数据'], 1):
                    print(f"\n轨道 {i}:")
                    for key, value in track.items():
                        print(f"  {key}: {value}")
                
                # 打印用户数据
                if moov_info['udta']['数据']:
                    print("\n--- UDTA (User Data) ---")
                    print("说明:", moov_info['udta']['说明'])
                    for key, value in moov_info['udta']['数据'].items():
                        print(f"{key}: {value}")
                
                print("\n原始 MOOV 数据:")
                print(json.dumps(moov_info, indent=2, ensure_ascii=False))

        if include_frames:
            frame_info = self.get_frame_info()
            if frame_info:
                print("\n=== 帧分析信息 ===")
                if '错误' in frame_info:
                    print(f"错误: {frame_info['错误']}")
                else:
                    print(f"\n总帧数: {frame_info['总帧数']}")
                    print(f"关键帧数: {frame_info['关键帧数']}")
                    
                    if '帧类型统计' in frame_info:
                        print("\n帧类型分布:")
                        for key, value in frame_info['帧类型统计'].items():
                            print(f"{key}: {value}")
                    
                    if '关键帧位置' in frame_info:
                        print("\n关键帧分布:")
                        for kf in frame_info['关键帧位置']:
                            print(f"  帧 {kf['帧序号']}: "
                                  f"时间戳 {kf['时间戳']:.3f}秒, "
                                  f"大小 {kf['大小']}")
                    
                    if 'GOP分析' in frame_info:
                        print("\nGOP分析:")
                        for key, value in frame_info['GOP分析'].items():
                            print(f"{key}: {value}")
                    
                    if '帧时间分析' in frame_info:
                        avg_interval = frame_info['帧时间分析'].get('平均帧间隔', 0)
                        if avg_interval > 0:
                            actual_fps = 1 / avg_interval
                            if abs(actual_fps - 30) > 5:  # 实际帧率与声称帧率差异过大
                                print(f"\n警告: 实际帧率 ({actual_fps:.1f}fps) 与声称帧率 (30fps) 不符")
                    
                    if frame_info['异常帧']:
                        print("\n警告: 检测到帧间隔异常，可能导致：")
                        print("1. 视频播放速度不均匀")
                        print("2. 画面跳跃或卡顿")
                        print("3. 音画不同步")
                    
                    print("\n视频问题分析:")
                    if frame_info['关键帧数'] < frame_info['总帧数'] / 60:  # 少于每2秒一个关键帧
                        print("警告: 关键帧过少，可能导致：")
                        print("1. 视频定位（快进/后退）不准确")
                        print("2. 播放器解码负担重")
                        print("3. 视频容易出现花屏或卡顿")
                    
                    if '帧时间分析' in frame_info:
                        avg_interval = frame_info['帧时间分析'].get('平均帧间隔', 0)
                        if avg_interval > 0:
                            actual_fps = 1 / avg_interval
                            if abs(actual_fps - 30) > 5:  # 实际帧率与声称帧率差异过大
                                print(f"\n警告: 实际帧率 ({actual_fps:.1f}fps) 与声称帧率 (30fps) 不符")
                    
                    if frame_info['异常帧']:
                        print("\n警告: 检测到帧间隔异常，可能导致：")
                        print("1. 视频播放速度不均匀")
                        print("2. 画面跳跃或卡顿")
                        print("3. 音画不同步")

def get_video_info(video_path: str, print_info: bool = True) -> Dict[str, Any]:
    """
    便捷函数：获取视频信息
    
    Args:
        video_path: 视频文件路径
        print_info: 是否打印信息
        
    Returns:
        包含视频信息的字典
    """
    extractor = VideoInfoExtractor(video_path)
    info = extractor.get_basic_info()
    
    if print_info:
        extractor.print_info()
        
    return info 

def extract_frames(video_path, output_dir, fps=1):
    """
    将视频文件分解为图片序列
    
    Args:
        video_path (str): 输入视频文件路径
        output_dir (str): 输出图片目录
        fps (float): 每秒提取的帧数，默认为1帧/秒
        
    Returns:
        str: 输出目录路径
        
    Raises:
        ValueError: 当输入参数无效时
        subprocess.CalledProcessError: 当ffmpeg执行失败时
    """
    if not os.path.exists(video_path):
        raise ValueError(f"视频文件不存在: {video_path}")
        
    # 确保输出目录存在
    os.makedirs(output_dir, exist_ok=True)
    
    output_pattern = os.path.join(output_dir, 'frame_%04d.jpg')
    
    try:
        # 构建ffmpeg命令
        cmd = [
            'ffmpeg',
            '-i', video_path,
            '-vf', f'fps={fps}',  # 设置提取帧率
            '-frame_pts', '1',    # 在文件名中包含时间戳
            '-q:v', '2',          # 设置图片质量（2是较好的质量）
            output_pattern
        ]
        
        # 执行ffmpeg命令
        subprocess.run(cmd, check=True, capture_output=True)
        
        print(f"已成功将视频分解为图片序列，存储在: {output_dir}")
        print(f"提取帧率: {fps} fps")
        
        return output_dir
        
    except subprocess.CalledProcessError as e:
        raise ValueError(f"视频帧提取失败: {e.stderr.decode()}")
    except Exception as e:
        raise ValueError(f"处理失败: {str(e)}")

if __name__ == '__main__':
    video_path = r"D:\system\Videos\4.1.mp4"
    output_dir = r"D:\system\Videos\41"
    frames_dir = extract_frames(video_path, output_dir, 30)
