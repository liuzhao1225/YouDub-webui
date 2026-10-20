<p align="center">
  <img src="site/assets/youdub-logo.svg" alt="YouDub" width="520" />
</p>

# YouDub WebUI

开源视频本地化工作台：导入视频，识别、翻译并逐句克隆原声，生成字幕和配音成片。

[English](README.en.md) · [官网与试听](https://liuzhao1225.github.io/YouDub-webui/) · [下载最新版](https://github.com/liuzhao1225/YouDub-webui/releases/latest) · [安装与升级](docs/upgrade.md) · [社区交流](#社区交流)

## 效果示例

默认演示为 2026-10-09 生成的黄仁勋采访：逐句原声克隆、中文字幕与背景音保留，完整时长约 59 秒。源视频链接用于说明样例出处，工作台支持视频链接和本地文件导入。

### 1. 黄仁勋采访 · 最新效果

[原视频链接](https://www.youtube.com/shorts/TbotsRXyRME) · YouTube Shorts · 英文 -> 中文

<table>
<tr><th>原始英文</th><th>中文配音版</th></tr>
<tr>
<td>

https://github.com/user-attachments/assets/befd11ca-e720-4faa-b4e0-d89bfe73df87

</td>
<td>

https://github.com/user-attachments/assets/60d5dbb0-f346-4c14-adad-2d0c481ac4fb

</td>
</tr>
</table>

### 2. 历史样例：How much YT paid me for 129 million shorts views

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

### 3. Me at the zoo

[原视频](https://www.youtube.com/watch?v=jNQXAC9IVRw) · 英文 → 中文 · 19 秒

[在官网切换中英文试听](https://liuzhao1225.github.io/YouDub-webui/?demo=zoo#demo)。v0.0.2 起，安装包包含这三个示例，可从工作台或环境准备页的“查看内置示例”离线播放。

## 能做什么

| 输出模式 | 生成内容 |
| --- | --- |
| 原声 + 字幕 | 保留原始音轨，生成并烧录目标语言字幕 |
| 配音 | 生成目标语言配音，可保留分离后的背景音 |
| 字幕 + 配音 | 输出带字幕的配音视频，可选语音强制对齐 |

- **逐句原声克隆。** 每句译文使用对应原文句子的音频片段作为参考，保留句子与参考音频的一一对应关系。
- **字幕显示。** 按逗号、顿号、中文破折号等拆分显示，合并过短片段，隐藏字幕片段末尾的分隔标点。
- **任务管理。** 查看封面、步骤进度、错误和产物，支持取消、重试、重新生成、播放及下载。

工作台保留视频、语言和输出模式等基本选项；模型、设备、声音、字幕对齐、背景音默认值及服务连接统一在设置中管理。

## 界面预览

工作台：导入视频，选择语言和输出内容。

![YouDub 工作台：视频导入、原文与目标语言、配音与字幕选项](docs/images/workbench.jpg)

<details>
<summary>查看任务库与任务详情</summary>

任务库：视频封面、处理状态和历史任务。

![YouDub 任务库：视频封面与已完成任务](docs/images/task-library.jpg)

任务详情：成片预览、处理步骤、配音音频和字幕下载。

![YouDub 任务详情：带中文字幕的成片、八个已完成步骤与生成文件](docs/images/task-detail.jpg)

</details>

## 下载与使用

[Windows EXE 安装包](https://github.com/liuzhao1225/YouDub-webui/releases/latest/download/YouDub-windows-x64-Setup.exe) · [macOS DMG](https://github.com/liuzhao1225/YouDub-webui/releases/latest/download/YouDub-macOS-arm64.dmg) · [版本说明与便携包](https://github.com/liuzhao1225/YouDub-webui/releases/latest)

首次启动准备基础运行环境；所需模型和推理依赖按工作流准备。安装要求与升级方法见[安装指南](docs/upgrade.md)。

1. 在「设置」配置翻译连接，确认所需模型就绪，保存默认处理配置。
2. 在「工作台」导入视频，选择语言和输出模式，创建任务。
3. 在「任务库」查看进度，播放或下载结果。

## 社区交流

QQ 交流群：`618246010`

<p align="center">
  <img src="apps/web/public/qq-group-618246010.jpg" alt="YouDub QQ 交流群二维码" width="220" />
</p>

## 快速开始

[节点工作流](docs/workflows.md) · [运行与扩展指南](docs/design/cordis-plugin-runtime.md) · [插件开发契约](docs/design/cordis-plugin-contracts.md) · [版本发布](docs/releasing.md)

以下为从源码运行的步骤，命令面向 macOS / Linux shell。真实模型流程已在 **macOS arm64 / CPU** 以及 **Windows x64 / NVIDIA CUDA** 验证；Windows 包的首次配置、完整视频任务和验收边界见[验收记录](docs/validation/windows-desktop-2026-10-16.md)，构建方法见[桌面说明](apps/desktop/README.md#windows-x64)。应用自动检测 CUDA、MPS、AMD ROCm 并保留 CPU 回退，支持范围见[设备说明](docs/accelerators.md)；Linux、AMD 和 MPS 推理尚未完成本轮真机验收。

### 1. 安装依赖

准备 Node.js 22（至少 22.13.0）和 Git。首次启动会识别操作系统与架构，准备 Python 3.12 和基础运行依赖。FFmpeg/ffprobe、分句资源和模型依赖按所选工作流准备，已有资源会复用。

```bash
git clone --branch main --recurse-submodules https://github.com/liuzhao1225/YouDub-webui.git
cd YouDub-webui
npm ci --registry=https://registry.npmmirror.com
npm --prefix apps/web ci --registry=https://registry.npmmirror.com
```

已有 checkout 时直接启动即可检查缺失项。Python / FFmpeg 使用阿里 npmmirror，Python 依赖使用阿里 PyPI，模型使用 ModelScope；来源与例外见[国内首次启动下载说明](docs/upgrade.md#国内首次启动下载)。基础环境失败会停在准备页，工作流资源失败显示在对应准备面板；两者均保留原因，可修复后手动重试。

### 2. 创建本地配置

首次创建配置；已有 `.env` 时保留原文件：

```bash
cp .env.example .env
ln .env env.txt
test .env -ef env.txt
```

打开工作台即可使用，无需设置或输入访问密码。应用加载 `.env`，代理工具读取同 inode 的 `env.txt`；两者均忽略提交。

### 3. 准备模型

基础环境就绪后进入工作台。在「工作流」中选择模板、检查资源并准备缺失项，页面显示所选节点的依赖和下载进度。字幕工作流无需下载配音模型；导入已有字幕并导出视频的工作流可只安装媒体依赖。详细操作见[节点工作流](docs/workflows.md)。

默认数据目录：macOS 为 `~/Library/Application Support/YouDub`，Linux 为 `~/.local/share/youdub`，Windows 为 `%LOCALAPPDATA%/YouDub`；可用 `YOUDUB_DESKTOP_DATA_DIR` 覆盖。

| 能力 | 默认提供者 | 模型路径（相对数据目录） |
| --- | --- | --- |
| 语音识别 | Whisper | `models/whisper/`，如 `tiny.pt`；另需上面安装的 `punkt_tab` |
| 翻译 | OpenAI 兼容 API | 在设置页配置连接、密钥及模型 |
| 配音生成 | VoxCPM2 | `models/voxcpm/VoxCPM2/` |
| 人声分离 | Demucs htdemucs | `models/demucs/955717e8-8726e21a.th` |
| 字幕对齐 | Qwen3 Forced Aligner | `models/qwen3-forced-aligner/Qwen3-ForcedAligner-0.6B-hf/` |

Whisper、VoxCPM2、Demucs 和 Qwen 均从 ModelScope 获取固定版本；VoxCPM2 和 Qwen 包含 tokenizer/processor 配置。中断文件保留为 `.part`，继续下载需要下载源支持 Range。自定义模型路径和运行条件见[运行指南](docs/design/cordis-plugin-runtime.md#1-安装与配置)。启动准备接口仅允许本机访问。

翻译密钥保存在系统 keyring。自定义翻译模型候选名单通过 `.env` 中的 `YOUDUB_TRANSLATION_MODELS` 配置，在设置页选择。默认翻译请求的最大输出 token 数至少为 **65,535**，连接的服务和模型需要接受该参数；不兼容时会明确报错。

### 4. 启动

确认 8000、3000 端口没有其他进程占用，然后在仓库根目录执行：

```bash
npm run build:plugins
npm start
```

另开一个终端，在同一目录启动前端：

```bash
npm --prefix apps/web run dev -- --hostname 127.0.0.1 --port 3000
```

打开 [http://127.0.0.1:3000](http://127.0.0.1:3000)，首次使用显示基础环境准备；环境已就绪时直接进入工作台，再按工作流准备所需资源。

需要运行构建后的前端时，用以下命令替代开发前端；Host 仍单独运行：

```bash
npm run build:web
npm --prefix apps/web start -- --hostname 127.0.0.1 --port 3000
```

## Everything is a plugin

YouDub 使用 **Cordis** 装配服务。任务引擎、默认 workflow、模型提供者、HTTP/API、认证和前端页面都以插件实现；默认组合见 [`youdub.config.ts`](youdub.config.ts)。

```text
Client 页面插件 → API / 认证插件 → 通用任务引擎插件
                                      ↓
                                workflow 插件
                                      ↓
                                provider 插件
                                      ↓
                         Python 计算进程 / 远端服务
```

workflow 声明处理步骤和输入输出，provider 实现约定的 operation，文件通过 ArtifactRef 传递。Python 继续承担媒体处理与模型推理，每次 operation 通过受管进程和 stdio 协议调用；纯 Python 插件也可以直接接入。

替换 ASR、翻译或 TTS 时，提供符合契约的插件即可；新的处理流程可以注册自己的 workflow。架构和边界见[架构说明](docs/design/cordis-plugin-architecture.md)，数据结构见[插件契约](docs/design/cordis-plugin-contracts.md)。

## 安装与开发插件

先完成或取消活动任务，停止 Host，再管理插件：

```bash
npm run plugins -- list
npm run plugins -- install --source ./fixtures/plugins/file-transform
npm run plugins -- disable --id example.file-transform
npm run plugins -- enable --id example.file-transform
```

也支持从其他 GitHub 仓库或 npm 精确版本安装，下面的仓库、commit 和包名需替换为实际值：

```bash
npm run plugins -- install --source https://github.com/OWNER/REPO --ref FULL_COMMIT_SHA
npm run plugins -- install --source npm:PACKAGE_NAME@1.0.0
```

安装默认启用，重启 Host 后生效；带有预编译 Client 入口的扩展刷新页面即可加载。插件安装脚本与 Host 代码使用本机权限，安装前应信任其来源；Python 独立环境用于隔离依赖。

从两个最小示例开始：

- [Host / workflow / Client 插件](fixtures/plugins/file-transform/README.md)：注册处理流程、页面和导航。
- [纯 Python provider](fixtures/plugins/python-text/README.md)：通过 manifest 声明 operation，使用 stdio 输入输出协议。

包结构、文件契约、凭据与取消处理见[插件开发契约](docs/design/cordis-plugin-contracts.md)；安装、启停与卸载见[运行指南](docs/design/cordis-plugin-runtime.md#3-安装启停和重启)。当前 SDK 随仓库提供，尚未作为公共 npm 包发布。

## 当前范围

- **英文分句。** Whisper 识别后使用 NLTK Punkt 整理完整句子，并用词级时间戳确定原声范围；原始识别结果保留。
- 默认流程接收本地 `mp4`、`mov`、`mkv`、`webm` 视频；默认限制 4 GiB、10 分钟、宽高各不超过 1920、60 fps。
- 当前语言目录包含英文、中文、日文，具体能力取决于提供者；可选 Qwen 对齐支持英文、中文。
- 节点工作流支持分叉、汇合与人工订正，按单槽串行执行；等待人工确认会释放执行槽。插件启停在重启后生效。热替换、插件市场、循环和分布式 worker 留待后续需求。
- 本地 workflow、Client 与 Python 插件已有验证；GitHub/npm 远端插件实装尚未验收。
- 当前 HTTP 接口为 `/api/v2`，支持从指定步骤重新生成任务。旧 FastAPI / v1 HTTP 入口已移除。链接下载通过 `media.download/v1` 接入现有任务流程，支持 YouTube、Shorts、B 站及 b23.tv 单视频链接；使用 yt-dlp、Node.js 与 FFmpeg，沿用 10 分钟和文件大小限制。

旧版本升级和数据迁移请先阅读[运行指南](docs/design/cordis-plugin-runtime.md#1-安装与配置)。真实任务、迁移与未验证范围记录在[迁移验收](docs/design/cordis-plugin-migration.md)、[逐句分句验收](docs/validation/asr-punkt-sentences-2026-10-09.json)及[字幕显示验收](docs/validation/subtitle-display-2026-10-09.json)。

## 开发与测试

```bash
npm run typecheck
npm test
npm run test:backend
npm --prefix apps/web test
npm run lint:web
npm run build:web
```

```text
youdub.config.ts    默认 Cordis 插件组合
apps/host/         Host 启动与插件管理 CLI
packages/sdk/      公共服务、workflow 与 operation 契约
packages/builtin/  基础服务、通用任务引擎、workflow 和模型桥
backend/workers/   Python 计算与 SQLite 事务桥
backend/app/       模型、媒体、凭据与历史数据格式
apps/web/          Next 引导、Client SDK 和页面插件
fixtures/plugins/  独立 Host/Client/Python 插件示例
submodule/demucs/   Demucs 源码子模块
```

欢迎通过 Issue / PR 改进安装体验、适配模型、优化字幕与音画对齐，或提供独立来源/流程插件。`docs/` 保留历史设计文档，当前入口以本文和 Cordis 运行指南为准。

## 开源许可

本项目使用 Apache License 2.0，详见 [LICENSE](LICENSE)。

国内镜像：[AtomGit](https://atomgit.com/liuzhao1225/YouDub-webui)，由 [GitHub 主仓库](https://github.com/liuzhao1225/YouDub-webui)单向同步。Release、Issue 和 PR 在 GitHub 维护。

作者：[刘朝 Zhao Liu](https://liuzhao1225.github.io/) · [GitHub](https://github.com/liuzhao1225) · [Bilibili 黑纹白斑马](https://space.bilibili.com/1263732318)

[Star History](https://www.star-history.com/?repos=liuzhao1225%2FYouDub-webui&type=date&legend=top-left)
