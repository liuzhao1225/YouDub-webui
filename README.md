<p align="center">
  <img src="site/assets/youdub-logo.svg" alt="YouDub" width="520" />
</p>

# YouDub Desktop

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

[在官网切换中英文试听](https://liuzhao1225.github.io/YouDub-webui/?demo=zoo#demo)。工作台和环境准备页的“查看官网示例”打开官网试听。安装包只保留黄仁勋采访原视频，可直接用作本地工作流输入。

## 能做什么

| 输出模式 | 生成内容 |
| --- | --- |
| 原声 + 字幕 | 保留原始音轨，生成并烧录目标语言字幕 |
| 配音 | 生成目标语言配音，可保留分离后的背景音 |
| 字幕 + 配音 | 输出带字幕的配音视频，可选语音强制对齐 |

- **逐句原声克隆。** 每句译文使用对应原文句子的音频片段作为参考，保留句子与参考音频的一一对应关系。
- **字幕显示。** 按逗号、顿号、中文破折号等拆分显示，合并过短片段，隐藏字幕片段末尾的分隔标点。
- **任务管理。** 查看封面、步骤进度、错误和产物，支持取消、重试、重新生成、播放及下载。

工作台选择视频和工作流，并显示节点声明的快捷设置。语言、模型、设备、声音和字幕参数保存在工作流节点中；模型供应商、本地环境与模型安装在设置中管理。

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

1. 在首次配置或「设置 → 模型」添加供应商、密钥和翻译模型。
2. 在「工作台」导入视频，选择工作流并调整节点选项，按提示准备所需资源后创建任务。
3. 在「任务库」查看进度，播放或下载结果。

## 社区交流

QQ 交流群：`618246010`

<p align="center">
  <img src="apps/web/public/qq-group-618246010.jpg" alt="YouDub QQ 交流群二维码" width="220" />
</p>

## 从源码运行 YouDub Desktop

YouDub 提供视频翻译、配音、工作流编排与人工审核，使用 Electron 和裁剪后的 DeepSeek Harness 框架。开发请从[文档索引](apps/harness/docs/README.md)、[架构说明](apps/harness/docs/ARCHITECTURE.md)和[本地运行](apps/harness/docs/DEVELOPMENT.md)开始。

使用 Node.js `^22.19.0 || >=24.0.0`、npm、Git 和平台构建工具，首次检出时初始化子模块。在仓库根目录执行：

```bash
npm ci --registry=https://registry.npmmirror.com
npm --prefix apps/web ci --registry=https://registry.npmmirror.com
npm --prefix apps/harness ci --registry=https://registry.npmmirror.com
npm run build:framework
npm run build:youdub
npm start
```

`npm start` 与 `npm run dev` 启动同一 Electron 产品；`npm run build:desktop` 是 `build:youdub` 的别名，生成开发产物。`npm run package:desktop -- --dir` 生成独立应用；正式安装包、签名与发布见[发行流程](docs/releasing.md)。浏览器调试、独立数据目录和修改后重建见[本地开发](apps/harness/docs/DEVELOPMENT.md)。

首次启动选择界面语言和数据安装目录，在页面准备运行资源、配置翻译模型。应用使用自己的 Python 环境、模型和配置；翻译通过 Harness 模型服务调用，使用已配置的提供商协议和模型参数。基础环境和各工作流所需资源的准备状态分别展示。

已发布版本的源码运行、Swift/C# 桌面壳及发行流程见[改造前说明](https://github.com/liuzhao1225/YouDub-webui/blob/711e40e8e69d2c6f2065f15aecc90550dcbf695d/README.md#main-版本源码运行)。Harness 来源与保留范围见[源码说明](vendor/deepseek-harness/README.md)中。

## Everything is a plugin

YouDub 使用 Cordis 插件运行时装配任务、工作流、字幕、配音、资源与业务页面。桌面窗口、连接、模型配置、LLM、子进程、Jobs 和插件管理复用保留的框架代码；应用使用自己的启动入口与运行目录。[产品组合](apps/harness/cordis.patch.yml)定义当前服务与页面。

```text
YouDub Electron → Desktop Host ← Connection ← YouDub 页面
                         ↓
                 YouDub 工作流与任务插件
                         ↓
                 LLM / Subprocess / Jobs
                         ↓
                 翻译 / Python 媒体处理
```

前端使用 Harness Renderer、Slots、Layout、Store、主题、语言和通用控件，接入原 YouDub 业务组件、React Flow 画布及首屏动效。职责与源码映射见[架构说明](apps/harness/docs/ARCHITECTURE.md)、[前端开发](apps/harness/docs/FRONTEND-DEVELOPMENT.md)及[后端与工作流开发](apps/harness/docs/BACKEND-DEVELOPMENT.md)。

## 安装与开发插件

在应用的「扩展」页面管理插件，安装、启停和卸载由 Harness PluginManager 执行。节点、提供商和页面遵循 YouDub 业务合同；独立 Host/Client/Python 扩展的接入与示例见[后端与扩展开发](apps/harness/docs/BACKEND-DEVELOPMENT.md)。当前没有已发布的 YouDub 在线插件市场。

## 当前范围

- **英文分句。** Whisper 识别后使用 NLTK Punkt 整理完整句子，并用词级时间戳确定原声范围；原始识别结果保留。
- 默认流程接收本地视频，由 FFmpeg 检查和处理实际音视频流；不设置视频时长、文件大小、分辨率或帧率上限。
- 当前语言目录包含英文、中文、日文，具体能力取决于提供者；可选 Qwen 对齐支持英文、中文。
- 节点工作流支持分叉、汇合与人工订正，按单槽串行执行；等待人工确认会释放执行槽。插件启停在重启后生效。热替换、插件市场、循环和分布式 worker 留待后续需求。
- 本地 workflow、Client 与 Python 插件已有验证；GitHub/npm 远端插件实装尚未验收。
- 当前 HTTP 接口为 `/api/v2`，支持从指定步骤重新生成任务。旧 FastAPI / v1 HTTP 入口已移除。链接下载通过 `media.download/v1` 接入现有任务流程，支持 YouTube、Shorts、B 站及 b23.tv 单视频链接；使用 yt-dlp、Node.js 与 FFmpeg，保留源视频质量，不设置时长和文件大小上限。

旧版本升级和数据迁移请先阅读[运行指南](docs/design/cordis-plugin-runtime.md#1-安装与配置)。真实任务、迁移与未验证范围记录在[迁移验收](https://github.com/liuzhao1225/YouDub-webui/blob/c92b670f079428eed40ca6ab7bdfd69e3328fef4/docs/design/cordis-plugin-migration.md)、[逐句分句验收](docs/validation/asr-punkt-sentences-2026-10-09.json)及[字幕显示验收](docs/validation/subtitle-display-2026-10-09.json)。

## 开发与测试

```bash
npm run typecheck
npm test
npm run test:backend
npm --prefix apps/web test
npm run lint:web
npm run build:youdub
npm --prefix apps/harness test
```

```text
apps/harness/      Electron 产品入口、Host/Client 插件与开发工具
vendor/deepseek-harness/source/  Harness 框架活动 fork
packages/builtin/test/helpers/  领域测试夹具，产品由 Harness Host 启动
packages/sdk/      公共服务、workflow 与 operation 契约
packages/builtin/  基础服务、通用任务引擎、workflow 和模型桥
backend/workers/   Python 计算与 SQLite 事务桥
backend/app/       模型、媒体、凭据与历史数据格式
apps/web/          复用的业务组件、客户端逻辑、React 绑定与页面
fixtures/plugins/  独立 Host/Client/Python 插件示例
submodule/demucs/   Demucs 源码子模块
```

欢迎通过 Issue / PR 改进安装体验、适配模型、优化字幕与音画对齐，或提供独立来源/流程插件。`docs/` 保留历史设计文档，当前开发入口以本文和 [Desktop 开发指南](apps/harness/docs/DEVELOPMENT.md)为准。

## 开源许可

本项目使用 Apache License 2.0，详见 [LICENSE](LICENSE)。

国内镜像：[AtomGit](https://atomgit.com/liuzhao1225/YouDub-webui)，由 [GitHub 主仓库](https://github.com/liuzhao1225/YouDub-webui)单向同步。Release、Issue 和 PR 在 GitHub 维护。

作者：[刘朝 Zhao Liu](https://liuzhao1225.github.io/) · [GitHub](https://github.com/liuzhao1225) · [Bilibili 黑纹白斑马](https://space.bilibili.com/1263732318)

[Star History](https://www.star-history.com/?repos=liuzhao1225%2FYouDub-webui&type=date&legend=top-left)
