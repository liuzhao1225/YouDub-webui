<p align="center">
  <img src="apps/web/public/youdub-logo.svg" alt="YouDub" width="520" />
</p>

# YouDub WebUI | [人才招聘](#人才招聘)

> **当前开发分支 `codex/plugin`：Cordis 插件版已在 macOS arm64 完成本地切换。** Host 基础服务、任务引擎、workflow、模型和 Client 页面均由普通插件装配。本地单视频的字幕、配音、字幕加配音三种流程已通过真实模型和 API 验收，历史任务、产物、凭据引用与登录会话已保留。最终生产构建与模型表单已回读通过，详情见[迁移验收记录](docs/design/cordis-plugin-migration.md)。

当前启动、配置和插件安装统一查看 **[Cordis 运行与扩展指南](docs/design/cordis-plugin-runtime.md)**。架构边界见[架构说明](docs/design/cordis-plugin-architecture.md)，开发接口见[插件契约](docs/design/cordis-plugin-contracts.md)，测试、媒体产物与迁移哈希见[实测记录](docs/validation/cordis-plugin-2026-10-09.json)。独立本地 workflow、Client 页面和纯 Python provider 已验证；安装后重启 Host 生效。GitHub/npm 远端实装、Windows/Linux 实机及运行时热替换尚未验收。

`codex/mvp-mainline` 的旧运行方式保存在 [MVP 说明](docs/design/mvp-runtime.md)；原 [v1 OpenAPI](docs/design/youdub-api-v0.1.openapi.json) 仅作历史记录；插件版统一使用 `/api/v2`，不再提供旧 v1 HTTP 入口。

国内 AtomGit 托管：[YouDub-webui](https://atomgit.com/liuzhao1225/YouDub-webui)。代码从 [GitHub 主仓库](https://github.com/liuzhao1225/YouDub-webui)单向同步；Release、Issue 和 PR 统一在 GitHub 维护。

<p align="center">
  <strong>QQ 交流群：618246010</strong>
</p>

一个被真实创作者工作流验证过的开源视频本地化工具。

当前插件版从本地视频开始，识别并翻译内容，输出保留原音的硬字幕视频、配音视频，或字幕加配音成片。配音流程分离人声与背景音、生成配音并完成混音；成品可在网页中播放和下载。

以下案例来自 YouDub 的历史生产使用；插件版当前提供本地文件导入，YouTube/Bilibili URL 下载流程已从默认产品移除。

English README: [README.en.md](README.en.md) · 作者：[刘朝 Zhao Liu](https://liuzhao1225.github.io/)（GitHub [@liuzhao1225](https://github.com/liuzhao1225)，Bilibili [黑纹白斑马](https://space.bilibili.com/1263732318)）

## 真实生产案例

**作者的 B 站频道**：[黑纹白斑马](https://space.bilibili.com/1263732318)（粉丝 100 万+，视频 2 万+，累计播放 6.8 亿+）的全站作品均使用 YouDub WebUI 自动翻译配音，覆盖科技、游戏、科普、动物、历史等题材。

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

## 插件版快速开始

先按[运行指南](docs/design/cordis-plugin-runtime.md#1-安装与配置)准备 Node.js 22、Python `.venv`、FFmpeg、`.env` 和访问密码。在根目录及 `apps/web` 分别执行 `npm ci`，然后：

```bash
npm run build:plugins
npm start
```

另一个终端执行 `npm run dev:web`，浏览器打开 `http://127.0.0.1:3000`。启动前确认 8000、3000 端口空闲。生产前端命令、数据迁移及独立 GitHub/npm/本地插件安装方式见运行指南。

## 使用和扩展

在设置页配置翻译连接并确认模型就绪，在工作台选择本地视频、语言和输出模式，然后开始处理。任务库展示步骤、错误及生成文件，支持取消、重试、重新生成和下载。

工作流和模型分别遵守公开契约，扩展可以贡献 Host 服务、workflow、provider 和 Client 页面。插件安装和启停在重启后生效；参见[运行指南](docs/design/cordis-plugin-runtime.md)和[独立示例](fixtures/plugins/file-transform/README.md)。

## 开发与测试

```bash
npm run typecheck
npm test
npm run test:backend
npm --prefix apps/web test
npm run lint:web
npm run build:web
```

主要目录：

```text
youdub.config.ts   默认 Cordis 插件组合
apps/host/        Host 启动与插件管理 CLI
packages/sdk/     公共服务与 operation 契约
packages/builtin/ 基础服务、通用任务引擎、workflow 和模型桥
backend/workers/  Python 计算与 SQLite 事务桥
backend/app/      模型、媒体、凭据与历史数据格式
apps/web/         Next 引导、Client SDK 和页面插件
fixtures/plugins/ 独立 Host/Client/Python 插件示例
submodule/demucs/  Demucs 源码子模块
```

历史设计和验证记录保留在 `docs/`，其旧命令与 API 不代表当前入口。

## 项目状态与贡献

YouDub WebUI 仍然是 MVP，但已经可以支撑真实创作者的日常视频本地化生产。当前优先级是保持最短链路稳定、保持架构简单，并让更多人能跑起来、改得动。

欢迎贡献：

- 改进安装和模型下载体验。
- 适配更多 ASR、TTS 或翻译后端。
- 优化字幕样式、横竖屏布局和语音时长对齐。
- 通过独立插件扩展输入来源和处理流程。
- 增强任务管理、产物管理和失败恢复体验。
- 补充不同平台的运行说明。

如果这个项目对你有帮助，欢迎 Star、Fork、提交 Issue 或 PR，也欢迎分享给关注 AI 视频本地化、开源工具和跨语言内容传播的人。

## 人才招聘

银河智学是一家人工智能教育科技企业，致力于将大模型技术与探究式教学范式深度融合，构建面向 AGI 时代的创新学习体系。

公司官网：[xiaoluxue.com](https://xiaoluxue.com/)

我们正在北京海淀区中关村招聘以下岗位：

- 全栈研发工程师
- 高级 Go 后端架构师（内容平台 / 长任务编排 / AI Agent Runtime）

薪资范围：**30–60K × 13 薪**。

简历投递：[liuzhao@xiaoluxue.com](mailto:liuzhao@xiaoluxue.com)

<p align="center">
  <img src="apps/web/public/recruitment-poster-2026.jpg" alt="YouDub 人才招聘海报：全栈研发工程师与高级 Go 后端架构师" width="680" />
</p>

## 社区交流

QQ 交流群：`618246010`

<p align="center">
  <img src="apps/web/public/qq-group-618246010.jpg" alt="YouDub QQ 交流群二维码" width="220" />
</p>

## 开源许可

本项目使用 Apache License 2.0，详见 [LICENSE](LICENSE)。

## Star History

<a href="https://www.star-history.com/?repos=liuzhao1225%2FYouDub-webui&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=liuzhao1225/YouDub-webui&type=date&theme=dark&legend=top-left&sealed_token=t9OTxsr7OPV9qT-QQDeYzphpOYSdcpyBno9hGLqvDQRBHhqogTh1auFAaWJaAaQQnFRCJ4eVCWm76U0W4uQAuak3r64RzoKrpjGYaNl2LetvfzQ4Y91giQ" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=liuzhao1225/YouDub-webui&type=date&legend=top-left&sealed_token=t9OTxsr7OPV9qT-QQDeYzphpOYSdcpyBno9hGLqvDQRBHhqogTh1auFAaWJaAaQQnFRCJ4eVCWm76U0W4uQAuak3r64RzoKrpjGYaNl2LetvfzQ4Y91giQ" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=liuzhao1225/YouDub-webui&type=date&legend=top-left&sealed_token=t9OTxsr7OPV9qT-QQDeYzphpOYSdcpyBno9hGLqvDQRBHhqogTh1auFAaWJaAaQQnFRCJ4eVCWm76U0W4uQAuak3r64RzoKrpjGYaNl2LetvfzQ4Y91giQ" />
 </picture>
</a>
