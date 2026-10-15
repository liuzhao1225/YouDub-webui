# 首次启动准备验收

日期：2026-10-13 至 2026-10-14。分支：`codex/mvp-mainline`。实机：macOS arm64。

## 行为

默认组合先运行 HTTP 和 setup，再运行依赖 Python 的 Store、providers 和工作台。应用入口轮询 `/api/setup`，准备完成后进入原工作台。

- 自动识别系统和架构；缺少 Python 3.12 时下载应用专用解释器并创建 `.venv`。
- 安装 Python 依赖，准备支持 subtitles 的 FFmpeg/ffprobe 和 Whisper 的 Punkt 分句资源。
- 四个模型独立并行：Whisper tiny、VoxCPM2、Demucs htdemucs、Qwen3 Aligner 0.6B。
- 下载进度来自实际写入字节；暂停保留 `.part`，继续发送 Range，新文件校验 SHA-256 后才发布。
- 下载或环境失败显示原始原因，等待用户显式重试。已有完整资源在后续启动复用。
- setup 接口校验本机访问和写请求 token；工作台仍使用原会话与 CSRF 校验。

## 已通过

| 检查 | 结果 |
| --- | --- |
| Host TypeScript | `npm run typecheck` 通过 |
| Host 测试 | 67 项通过，含四模型并发、独立暂停、启动顺序、接口访问限制、断点续传与校验失败 |
| 前端测试 | setup gate 4 项、原插件 runtime 8 项通过 |
| 前端检查 | 修改文件 ESLint、TypeScript 与 `npm run build:web` 通过 |
| Python runtime | `backend/tests/test_v1_runtime.py` 64 项通过 |
| 真实模型下载 | 隔离目录下载 Whisper 与 Demucs，大小与 SHA 校验通过；VoxCPM2、Qwen 复用现有完整权重，其固定版本配置文件已真实下载并校验 |
| 浏览器 | 正式构建 `/` 展示真实下载，点击继续后自动进入工作台；原数据目录重启后复用四个模型并进入原任务列表 |
| 无系统 Python 3.12 | 限制 PATH 后成功下载 uv 和专用 Python 3.12.15、创建新 `.venv` |
| 无系统 FFmpeg | 限制 PATH 后成功下载专用 FFmpeg/ffprobe，SHA、可执行性、subtitles 能力检查通过 |
| 无分句资源 | 空目录下载固定官方 Punkt 归档，SHA 校验、解压及四个英文资源文件检查通过 |
| 全新 Python 环境 | 删除隔离环境后自动新建 `.venv`，从已校验的 Aliyun 包缓存安装全部依赖，四个准备步骤全部 ready |
| 新环境运行检查 | 新环境实际导入 Torch、Torchaudio、Whisper、VoxCPM、Transformers、SoundFile、Librosa，并检查四模型可用性，返回 `{"ready": true}` |

## 证据

本机记录位于仓库 `output/validation/`：

- `setup-20261013/host-tests.log`
- `setup-20261013/evidence/downloaded-models.json`
- `setup-20261013/evidence/browser-ready.json`
- `setup-20261013/evidence/final-default-ready.json`
- `setup-20261013/evidence/real-download.jpg`
- `setup-20261013/evidence/ready-workbench.jpg`
- `setup-managed-python/result.json`
- `setup-managed-python/media-result.json`
- `setup-managed-python/nltk-result.json`
- `setup-clean-environment/result.json`
- `setup-clean-environment/verify.json`
- `setup-clean-environment/resolved.json` 与 `prefetch.log`

联网验收显式清空本次进程的代理环境变量。本机原 `.env` 保留了一个已停止的 localhost:20171 代理；没有改写用户配置。正式默认数据目录已恢复运行。隔离 pip 安装遇到镜像慢连接，保留中断日志后改为直连，再从同一 Aliyun 地址预取并校验依赖包。174 项解析结果均通过 SHA-256 校验，另通过 pip 获取构建所需 wheel 包。最终以标准离线包目录执行空环境安装；缓存参数仅用于验收进程。

缓存准备中 cffi 一次超时，保留错误后仅重新下载该包；首次使用直接文件约束触发 pip 的 extras 解析异常，保留诊断后改用标准离线包目录并重新创建空环境。最终安装及运行检查均成功。临时解释器和隔离 `.venv` 在验收后清理，清单和日志保留。

首次 Punkt 下载发现 NLTK 3.10.3 的代理安全检查会拒绝请求，且命令可返回 0。实现已改为从固定官方提交下载归档并验证 SHA-256，随后解压和检查资源，未关闭 NLTK 安全检查。原始诊断保留在 `setup-managed-python/nltk.log`。

## 范围

macOS arm64 已实机验证。Windows x64、Linux x64/arm64 和 macOS x64 已配置安装目标，并核对上游资产及 SHA 清单，尚未在对应系统实机执行。此次验证覆盖安装、资源准备、导入和工作台启动；完整视频推理沿用原有流程，本次未重新执行。
