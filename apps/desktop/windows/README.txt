YouDub Windows x64

完整解压 ZIP 后运行 YouDub.exe。支持 Windows 10 22H2 / Windows 11 x64。
需要 Microsoft Edge WebView2 Evergreen Runtime；缺少时启动器会提供微软下载入口。
Node 已内置，无需安装 Node 或打开终端；首次启动准备 Python、FFmpeg 和模型。

数据、模型和配置：%LOCALAPPDATA%\YouDub
日志：%LOCALAPPDATA%\YouDub\logs\desktop.log
自定义数据目录：YOUDUB_DESKTOP_DATA_DIR 环境变量。
翻译密钥保存在 Windows 凭据管理器。

升级：退出 YouDub，将新 ZIP 解压到新目录，运行其中的 YouDub.exe。
保留上述数据目录；不要把新旧版本同时运行在同一个数据目录。
此便携包尚未进行 Authenticode 签名。

源码与安装说明：https://github.com/liuzhao1225/YouDub-webui
