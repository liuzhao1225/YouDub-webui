YouDub Windows x64

Setup.exe 提供安装、快捷方式和卸载；ZIP 完整解压后运行 YouDub.exe。支持 Windows 10 22H2 / Windows 11 x64。
需要 Microsoft Edge WebView2 Evergreen Runtime；缺少时启动器会提供微软下载入口。
Node 已内置，无需安装 Node 或打开终端；首次启动在应用数据目录准备独立 Python 和基础依赖。FFmpeg、推理依赖和模型按工作流准备，主要资源使用阿里和 ModelScope 国内源。

数据、模型和配置：%LOCALAPPDATA%\YouDub
日志：%LOCALAPPDATA%\YouDub\logs\desktop.log
自定义数据目录：YOUDUB_DESKTOP_DATA_DIR 环境变量。
翻译密钥保存在 Windows 凭据管理器。

升级：退出 YouDub，运行新 Setup.exe；便携版将新 ZIP 解压到新目录。
保留上述数据目录；不要把新旧版本同时运行在同一个数据目录。
卸载安装版会保留数据目录中的 Python 环境、模型和任务。
安装包及便携包尚未进行 Authenticode 签名。

源码与安装说明：https://github.com/liuzhao1225/YouDub-webui
