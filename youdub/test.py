import psutil
import time

def monitor_ffmpeg():
    while True:
        for proc in psutil.process_iter(['name', 'cmdline']):
            try:
                if proc.info['name'] == 'ffmpeg.exe':
                    print('\nFFmpeg 进程发现:')
                    print(f'命令行: {" ".join(proc.info["cmdline"])}')
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                pass
        time.sleep(1)  # 每秒检查一次

if __name__ == '__main__':
    try:
        print('开始监控 FFmpeg 进程...')
        print('按 Ctrl+C 停止监控')
        monitor_ffmpeg()
    except KeyboardInterrupt:
        print('\n监控已停止')
