# 安装与升级

`v0.0.1` 是新版主线的首个正式版本，`v0.0.3` 开始统一发布 macOS 与 Windows 包。可在[官网下载页](https://liuzhao1225.github.io/YouDub-webui/#download)选择平台和版本，或下载 [GitHub Releases](https://github.com/liuzhao1225/YouDub-webui/releases) 中对应 tag 的安装包及 SHA-256 文件。

`v0.0.4` 补齐跳过首次配置后的服务连接入口。可在「设置 → 服务连接」修改服务地址、模型名称和 API Key，并测试连接；同一地址下密钥留空会保留已有密钥。新任务使用保存后的模型，已有任务保留创建时的配置。

从 `v0.0.4` 起，应用进入工作台后自动检查正式版本，随后每小时检查一次；发现新版本时显示对应平台的下载入口。在「设置 → 软件更新」可手动检查或关闭自动检查，开关随应用数据保留。检查失败时显示错误并停止自动检查，手动检查成功后恢复。下载完成后按下方步骤替换应用。

翻译响应校验失败时，日志会显示批次、具体失败原因和 `translation_raw` 原始响应文件名。小米 MiMo 在 [#146](https://github.com/liuzhao1225/YouDub-webui/issues/146) 中的原始失败仍待服务地址与脱敏响应复现，此版本没有宣称已验证该问题修复。

## 国内首次启动下载

从 `v0.0.5` 起，应用自动检测系统、处理器、GPU 和已有资源，缺少时直接下载：Python / FFmpeg 使用阿里 npmmirror，Python 依赖与 CPU / CUDA / Linux ROCm 使用阿里镜像，模型使用 ModelScope，分句资源使用 ModelScope 的阿里云 OSS。准备页面显示下载来源。下载器不读取系统环境变量中的 HTTP 代理；失败会显示原因并保留断点，需手动重试。

Windows AMD ROCm 7.2.1 专用依赖暂无已核实的阿里或 ModelScope 镜像，仍使用 AMD 官方源；WebView2 仍由微软分发。应用安装包、软件更新和用户输入的视频地址沿用各自官方服务。源码安装缺少 Demucs 子模块时仍需获取 Git 仓库；桌面包已包含该子模块。

## macOS 桌面版

支持 Apple Silicon、macOS 14 及以上。退出正在运行的 YouDub，打开 DMG，将 YouDub 拖入 Applications；已有试验版本时替换应用。再次启动后，在工作台确认已有任务、模型与服务连接。

应用与数据分开保存。替换 `/Applications/YouDub.app` 会保留 `~/Library/Application Support/YouDub` 中的模型、任务和配置，以及系统钥匙串中的翻译密钥。升级前退出应用并保留该数据目录的副本。不要在升级时删除数据目录。

首次安装会准备 Python、FFmpeg、推理依赖和模型；已有安装可能需要更新配套推理依赖。翻译服务需配置兼容接口、模型和密钥，并支持至少 65535 token 的最大输出参数。安装包已签名、公证，附带校验文件可用 `shasum -a 256 -c YouDub-<版本号>-macOS-arm64.dmg.sha256` 核验。

## Windows 桌面版

Windows x64 便携包由新增的 Windows 发布流程生成，适用于 Windows 10 22H2 / Windows 11；历史 tag 不会自动补发。下载包含 `YouDub-<version>-windows-x64.zip` 的 Release，使用 PowerShell 的 `Get-FileHash <zip路径> -Algorithm SHA256` 与相邻 `.sha256` 文件核对后，将整个 ZIP 解压到本地目录，运行 `YouDub.exe`。需要 WebView2 Evergreen Runtime，缺少时启动器会提供微软下载入口。此便携包尚未进行 Authenticode 签名。

升级前关闭 YouDub，将新包解压到新的应用目录。保留 `%LOCALAPPDATA%\YouDub` 中的模型、任务和配置，以及 Windows 凭据管理器中的翻译密钥；不要把新旧版本同时运行在同一个数据目录。日志位于 `%LOCALAPPDATA%\YouDub\logs\desktop.log`。使用 `YOUDUB_DESKTOP_DATA_DIR` 时，数据和日志位于指定目录。

Windows 本机验收覆盖打包、原生窗口、首次翻译配置、路径兼容性、任务生命周期和服务退出，并使用实际 Windows 包在 GTX 1080 Ti 上完成真实视频的识别、翻译、配音、字幕对齐和导出。真实任务复用已准备的 Python 与模型缓存，不代表全新机器上的完整模型下载已验收，详见[验收记录](validation/windows-desktop-2026-10-16.md)。

## 从旧 main 源码版升级

1. 等待旧任务完成并停止旧服务，保留旧提交号，以及 `.env`、数据库和任务文件所在目录的副本。新旧服务不可同时写入同一数据目录。
2. 将源码更新到正式 tag（例如 `git checkout v0.0.3`），按 [运行指南](design/cordis-plugin-runtime.md#1-安装与配置) 安装依赖并启动。新版使用 Node.js 22 的 Cordis Host；旧 FastAPI 启动命令和 v1 HTTP 接口已移除，当前 API 为 `/api/v2`。
3. 原 `.env` 继续保留；代理读取的 `env.txt` 必须与其为硬链接。工作台内重新确认可用模型、默认处理配置和翻译连接。旧版供应商与模型选项不会全部自动转换为新版插件配置。

历史数据的两种情况：

- MVP 试验版的 `desktop.sqlite` 会迁移到 schema 2。旧任务保留原始快照；存在进行中的旧任务时迁移会报 `MIGRATION_ACTIVE_TASKS`。先在旧版完成或停止任务，再升级。历史任务不能直接按旧流程重试，重新生成会创建新任务。
- 旧 main 的 `data/youdub.sqlite` 保留原位，其 URL 下载任务不进入新版任务列表。已有成片仍在原任务目录，需要在旧版本中查看历史时，使用保留的旧源码和升级前的数据副本；新版不能直接继续这些旧任务。

迁移后的数据库不要交给旧程序继续写入。需要返回旧版时，停止新版服务，并使用升级前对应版本的数据副本。详细数据契约见 [迁移说明](design/cordis-plugin-migration.md#5-数据和凭据迁移)。

## 当前范围

桌面打包覆盖 macOS Apple Silicon 和 Windows x64；Windows 的实际发行以包含 ZIP 的 Release 为准。Linux 和 Intel Mac 暂无本次验收的安装包。语言目录包含中文、英文和日文，具体可选项取决于模型能力；Qwen 字幕对齐仅支持中文和英文。源码安装与扩展插件配置见 [运行指南](design/cordis-plugin-runtime.md)。

安装包内「查看内置示例」包含黄仁勋采访、创作者收入和 Me at the zoo 三组英文原声/中文配音，可在模型准备前试听并保持播放位置切换语言；官网提供相同示例。
