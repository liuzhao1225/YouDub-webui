<p align="center">
  <img src="apps/web/public/youdub-logo.svg" alt="YouDub" width="520" />
</p>

# YouDub WebUI

一个被真实创作者工作流验证过的开源视频本地化工具。

YouDub WebUI 可以把单个 YouTube 或 Bilibili 视频自动转换成目标语言配音版：下载视频、分离人声与背景音、识别字幕、翻译、生成配音、混音、压制字幕，最后输出可在线播放和下载的新视频。

核心成熟场景是 **YouTube 英文 -> 中文配音**；同时已经支持 **Bilibili 中文 -> 英文配音**。

English README: [README.en.md](README.en.md)

## 真实生产案例

**作者的 B 站频道**：[黑纹白斑马](https://space.bilibili.com/1263732318)（粉丝 80 万+，视频 2 万+）的全站作品均使用 YouDub WebUI 自动翻译配音，覆盖科技、游戏、科普、动物、历史等题材。

这不是一个只跑过 demo 的玩具项目。YouDub WebUI 的目标很明确：让个人创作者、开发者和小团队能够在本地掌控一条完整的视频本地化流水线，并且保留足够简单的架构，方便理解、调试和二次开发。

## 效果示例

下面两组样例均由本项目真实生成，可以在 GitHub 页面直接播放。左侧是原视频，右侧是自动生成的配音版本；配音版包含目标语言语音和字幕，同时保留原视频的背景音乐与音效。

### 1. Jensen Huang on Nvidia's Competition

[原视频链接](https://www.youtube.com/shorts/TbotsRXyRME) · YouTube Shorts · 英文 -> 中文

<table>
<tr><th>原始英文</th><th>中文配音版</th></tr>
<tr>
<td>

https://github.com/user-attachments/assets/befd11ca-e720-4faa-b4e0-d89bfe73df87

</td>
<td>

https://github.com/user-attachments/assets/bf01f912-eec8-4e0d-8698-0f69283a73e7

</td>
</tr>
</table>

### 2. How much YT paid me for 129 million shorts views

[原视频链接](https://www.youtube.com/watch?v=ii9Kh4XkA5g) · YouTube 横屏长视频 · 英文 -> 中文 · 下方为开头 40 秒切片，完整版可在 [`demo-assets`](https://github.com/liuzhao1225/YouDub-webui/releases/tag/demo-assets) Release 下载

<table>
<tr><th>原始英文</th><th>中文配音版</th></tr>
<tr>
<td>

https://github.com/user-attachments/assets/bd02936f-cf3c-4e4b-85b5-0410d38f69f5

</td>
<td>

https://github.com/user-attachments/assets/158de60a-7de4-4ddf-b3d8-478d0423aee6

</td>
</tr>
</table>

## 快速开始

### 1. 准备运行环境

已验证和推荐的运行方式：

- **Windows 10/11 + PowerShell 5.1+**：推荐开发环境，也是本文档优先覆盖的平台。
- **Linux / WSL2 / macOS**：后端和前端命令按 POSIX shell 给出；CUDA、FFmpeg、PyTorch/音频依赖需要按各平台实际环境安装。
- **CUDA GPU**：推荐用于完整视频处理。`DEVICE=cpu` 可以运行部分流程，但完整转写、分离、TTS 会非常慢。

基础依赖：

- Python 3.12。
- Node.js 20+。
- FFmpeg / ffprobe，并确保命令在 `PATH` 中可用。
- 可访问 YouTube 的代理（处理 YouTube 视频时需要）
- Netscape 格式的 YouTube Cookie（处理 YouTube 视频时推荐配置）
- OpenAI 兼容 Chat Completions API 的 base URL、API key 和模型名

首次运行会下载或加载较大的 ASR、TTS、音频处理模型，请预留磁盘空间和网络时间。

平台注意事项：

- Windows PowerShell 使用 `.venv\Scripts\...`，不要照抄 `.venv/bin/...`。
- macOS/Linux 使用 `.venv/bin/...`。
- 如果系统里同时存在多个 Python，请先确认 `py -0p`（Windows）或 `python3.12 --version`（macOS/Linux）的结果。
- 代理、Cookie、模型缓存和工作目录都保存在本机；路径中含空格时，建议使用引号或写入 `.env`。

常见系统依赖安装示例：

```powershell
# Windows PowerShell（任选你本机已有的包管理器）
winget install Gyan.FFmpeg
winget install OpenJS.NodeJS.LTS
```

```bash
# Ubuntu / Debian / WSL2
sudo apt update
sudo apt install -y ffmpeg nodejs npm
```

```bash
# macOS（Homebrew）
brew install ffmpeg node
```

如果你的系统包管理器无法提供 Python 3.12，建议从 Python 官网、pyenv、conda/mamba 或发行版推荐方式安装；关键是后续创建虚拟环境时确认使用的是 3.12。

### 2. 克隆项目

Windows PowerShell、macOS 和 Linux 通用：

```powershell
git clone https://github.com/liuzhao1225/YouDub-webui.git
cd YouDub-webui
git submodule update --init --recursive
```

Demucs 以源码子模块引入，请不要跳过 `git submodule update`。

### 3. 安装依赖

#### Windows PowerShell

Python 依赖：

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -U pip
.\.venv\Scripts\pip.exe install -i https://mirrors.aliyun.com/pypi/simple/ -r requirements.txt
```

前端依赖：

```powershell
npm --prefix apps/web install --registry=https://registry.npmmirror.com
```

#### macOS / Linux / WSL2

Python 依赖：

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -U pip
.venv/bin/pip install -i https://mirrors.aliyun.com/pypi/simple/ -r requirements.txt
```

前端依赖：

```bash
npm --prefix apps/web install --registry=https://registry.npmmirror.com
```

如果 Aliyun 镜像中某个 Python 包暂时不可用，再单独对失败的包使用 Tsinghua 源重试；不要把多个镜像混在同一条 resolver 命令里。

### 4. 配置环境

Windows PowerShell：

```powershell
Copy-Item env.txt.example .env
```

macOS / Linux / WSL2：

```bash
cp env.txt.example .env
```

应用运行时读取 `.env`。不要提交 API key、Cookie、下载视频或生成产物。

常用环境变量：

| 变量 | 说明 |
| --- | --- |
| `WORKFOLDER` | 每个任务的媒体、分段音频和中间产物目录。 |
| `MODEL_CACHE_DIR` | ModelScope 模型缓存目录，默认用于 VoxCPM2。 |
| `DEVICE` | 模型运行设备，例如 `cuda`、`cuda:0` 或 `cpu`。 |
| `OPENAI_BASE_URL` | OpenAI 兼容 API 地址，例如 `https://api.openai.com/v1`。 |
| `OPENAI_API_KEY` | 翻译阶段使用的 API key。 |
| `OPENAI_MODEL` | 翻译阶段使用的 Chat Completions 模型。 |
| `OPENAI_TRANSLATE_CONCURRENCY` | 翻译阶段的并发请求数，默认 `50`。 |
| `YTDLP_PROXY_PORT` | yt-dlp 使用的本机代理端口，例如 `7890`。 |
| `HTTP_PROXY` | 未在 UI 中设置代理端口时，yt-dlp 可读取的代理地址。 |
| `VOXCPM_MODEL` / `VOXCPM_MODEL_DIR` | VoxCPM2 的 ModelScope 模型名或本地模型目录。 |
| `VOXCPM_LOAD_DENOISER` / `VOXCPM_CFG_VALUE` / `VOXCPM_INFERENCE_TIMESTEPS` / `VOXCPM_MIN_REFERENCE_MS` | VoxCPM2 推理参数。 |
| `CORS_ALLOW_ORIGINS` / `CORS_ALLOW_ORIGIN_REGEX` | 自定义前端访问来源。 |

常见本机、局域网和 Tailscale 的 `:3000` 前端来源已默认允许；如果通过自定义域名访问前端，把完整 origin 追加到 `CORS_ALLOW_ORIGINS`，例如 `http://youdub.example.com:3000`。

### 5. 启动服务

#### Windows PowerShell

后端：

```powershell
.\.venv\Scripts\uvicorn.exe backend.app.main:app --reload --host 0.0.0.0 --port 8000
```

前端：

```powershell
npm --prefix apps/web run dev -- --hostname 0.0.0.0 --port 3000
```

#### macOS / Linux / WSL2

后端：

```bash
.venv/bin/uvicorn backend.app.main:app --reload --host 0.0.0.0 --port 8000
```

前端：

```bash
npm --prefix apps/web run dev -- --hostname 0.0.0.0 --port 3000
```

前端默认通过同源 `/api/...` 请求访问后端，并由 Next.js 代理到 `http://127.0.0.1:8000`。如果后端不在本机 `8000` 端口，启动前端时设置 `NEXT_SERVER_API_BASE_URL`，例如：

```bash
NEXT_SERVER_API_BASE_URL=http://192.168.1.10:8000 npm --prefix apps/web run dev -- --hostname 0.0.0.0 --port 3000
```

打开：

```text
http://localhost:3000
```

如果从局域网、WSL2 或远程机器访问，浏览器里使用运行前端机器的实际 IP 或主机名，例如 `http://192.168.1.20:3000`。后端默认监听 `0.0.0.0:8000`，前端默认监听 `0.0.0.0:3000`。

## 页面里怎么用

1. 打开右上角 Settings。
2. 粘贴 Netscape 格式 YouTube Cookie。
3. 设置 yt-dlp 代理端口，例如 `7890` 或 `20171`。
4. 填写 OpenAI base URL 和 API key。
5. 点击 `Get models` 拉取模型列表，或手动输入模型名。
6. 按 API 提供商额度调整 `Translate concurrency`。
7. 回到首页，提交 YouTube URL 或 Bilibili URL。
8. 进入任务详情页查看阶段进度、运行日志和最终视频。

API key 和 Cookie 会在页面中脱敏显示，后端不会把 Cookie 明文返回给前端。

### 导出 YouTube Cookie

推荐使用 Chrome 扩展 [Get cookies.txt LOCALLY](https://chromewebstore.google.com/detail/get-cookiestxt-locally/cclelndahbckbenkjhflpdbgdldlbecc)（开源，Cookie 不出本机）：

1. 在 Chrome 安装扩展并保持启用。
2. 登录 `https://www.youtube.com`。
3. 在 youtube.com 页面点击扩展图标，选择 `Export` -> `Netscape`，得到 `cookies.txt`。
4. 把文件内容整段粘贴到 Settings 的 YouTube cookie 输入框。

请只处理你有权下载、转换和发布的视频内容。

## 工作流程

```text
YouTube / Bilibili URL
  -> yt-dlp 下载单个视频
  -> Demucs 分离人声与背景音
  -> Whisper 识别语音并输出词级时间戳
  -> 句子与时间范围整理
  -> OpenAI 兼容 API 预处理全文并逐句并发翻译
  -> 按句切分原始人声作为参考音频
  -> VoxCPM2 生成目标语言配音
  -> 对齐配音时长并与背景音混音
  -> FFmpeg 压制字幕并输出最终 mp4
```

## 功能亮点

- **真实可用的端到端流程**：从 URL 到最终视频，不需要手动拆分音频、整理字幕或压制视频。
- **双来源入口**：YouTube 英文 -> 中文是核心成熟场景；Bilibili 中文 -> 英文也已接入同一条任务流水线。
- **本地优先**：SQLite、Cookie、日志、中间产物和最终视频都保存在本机目录中。
- **可观察任务进度**：任务历史、阶段状态、阶段耗时、运行日志和错误信息都可以在页面里查看。
- **失败可恢复**：失败任务可以从失败阶段继续执行，已成功阶段会复用缓存产物。
- **可重跑可清理**：支持按任务 rerun，也支持删除任务记录、日志和 `workfolder/` 下的会话目录。
- **结果可检查**：任务成功后可在页面内播放最终视频，也可以下载 mp4 文件。
- **设置在 UI 内完成**：YouTube Cookie、yt-dlp 代理端口、OpenAI base URL、API key、模型名和翻译并发数都可在 Settings 中维护。
- **适合二次开发**：管线串行、模块边界清晰，方便替换 ASR、翻译、TTS 或字幕样式。

## 技术栈

- Frontend: Next.js App Router, shadcn/ui, Tailwind CSS, Lucide icons
- Backend: FastAPI, SQLite, in-process background worker
- Download: yt-dlp
- Source separation: Demucs source submodule
- ASR: openai-whisper（默认 `large-v3-turbo`）
- Translation: OpenAI-compatible Chat Completions API
- TTS: VoxCPM2
- Media processing: FFmpeg, pydub, librosa, audiostretchy

## 开发与测试

后端测试：

Windows PowerShell：

```powershell
.\.venv\Scripts\pytest.exe backend/tests
```

macOS / Linux / WSL2：

```bash
.venv/bin/pytest backend/tests
```

前端检查：

```powershell
npm --prefix apps/web run lint
npm --prefix apps/web run build
```

项目的主要目录：

```text
backend/app/       FastAPI API、任务队列、流水线和模型适配器
backend/tests/     后端单元测试
apps/web/          Next.js WebUI
scripts/           辅助脚本
submodule/demucs/  Demucs 源码子模块
```

## 项目状态与贡献

YouDub WebUI 仍然是 MVP，但已经可以支撑真实创作者的日常视频本地化生产。当前优先级是保持最短链路稳定、保持架构简单，并让更多人能跑起来、改得动。

欢迎贡献：

- 改进安装和模型下载体验。
- 适配更多 ASR、TTS 或翻译后端。
- 优化字幕样式、横竖屏布局和语音时长对齐。
- 提升 YouTube / Bilibili 下载稳定性。
- 增强任务管理、产物管理和失败恢复体验。
- 补充不同平台的运行说明。

如果这个项目对你有帮助，欢迎 Star、Fork、提交 Issue 或 PR，也欢迎分享给关注 AI 视频本地化、开源工具和跨语言内容传播的人。

## 开源许可

本项目使用 Apache License 2.0，详见 [LICENSE](LICENSE)。

## Star History

<a href="https://www.star-history.com/?repos=liuzhao1225%2FYouDub-webui&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=liuzhao1225/YouDub-webui&type=date&theme=dark&legend=bottom-right" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=liuzhao1225/YouDub-webui&type=date&legend=bottom-right" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=liuzhao1225/YouDub-webui&type=date&legend=bottom-right" />
 </picture>
</a>
