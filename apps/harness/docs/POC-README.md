# YouDub on DeepSeek Harness：桌面字幕验证

> 历史 POC 记录：以下命令和架构描述对应早期验证。当前独立源码开发请使用[开发说明](DEVELOPMENT.md)。

使用未修改的官方 **DeepSeek Harness Desktop 0.2.1-rc.2** 和同版本 Harness 发布包。YouDub 插件保留原版动态 Logo、大标题、配色及首屏动效，接入导入视频、Whisper 识别、人工校对确认和 SRT 导出。当前分支为 `codex/harness-subtitle-poc`，上游核心代码修改为 **0**。

桌面启动、原生文件选择、真实识别、修改保存、人工确认及原生下载已实测，下载文件与 Host 产物哈希一致。固定侧栏、深浅首页及 Logo 声波变化已验证。当前官方组合的浏览器首页、既有任务和再次下载回归也已通过；具体证据见 [验收记录](validation.md)。

![桌面深色首屏](evidence/desktop-home-dark.png)

[桌面浅色首屏](evidence/desktop-home-light.png)

## 官方能力与业务边界

| 边界 | 当前实现 |
| --- | --- |
| 桌面壳、Host、原生传输 | 官方安装的 Desktop，复用其 Electron、保留的 `desktop` profile 和前端资源 |
| 启动、插件装配、配置 | 官方 dsh CLI、profile、bundle、Cordis Loader；浏览器与桌面均使用 `dsh-base` + `dsh-web-app` + YouDub bundle |
| 页面框架与布局 | 官方 `AppFrame`；YouDub 注册 `sidebar`、`main`、`shell.leading` 插槽，侧栏宽度、收放、拖拽及主区域由官方布局承载 |
| 通用控件 | 官方 `Button`、`Menu`、`Tag`、`StateDot`、`Tooltip`、图标、文件类型图标和文件大小格式化 |
| 主题与滚动条 | 官方 theme 服务、`overrideTokens` 和持久化主题偏好；官方全局滚动条样式 |
| 前端状态 | 官方 `defineStore`，侧栏和业务页共享 root store |
| 请求鉴权 | 官方 `dsh-client-connection` 的 owner Fetch 路由 |
| 子进程与后台任务 | 官方 `subprocess`、`jobs` 服务；YouDub 仅适配现有 Python worker 消息协议 |
| 状态文件写入 | 官方 `writeFileAtomic`；字幕任务状态机及 `task.json` 数据合同仍由 YouDub 插件管理 |
| 原版视觉 | 直接引用现有 `BrandMark` 与 SVG；构建时从原 `apps/web/src/app/globals.css` 提取主题变量和动画，不修改原文件 |
| 业务组件与算法 | 视频预览、字幕多行编辑、识别进度保留业务实现；现有公共组件没有与这些交互直接匹配的接口。识别复用现有 FFmpeg、Whisper worker，导出复用 `Transcript` 合同与 `_write_srt` |

官方 `ui-layout`、`ui-theme`、`ui-session`、`ui-settings` 及其依赖继续提供服务。共享 [cordis.patch.yml](../cordis.patch.yml) 关闭被 YouDub 页面替代的业务 UI，保留底层服务；[desktop.patch.yml](../desktop.patch.yml) 仅设置机器相关路径。桌面架构可对照 [Harness 官方说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md#desktop-application)。

## 环境

需要 Node.js 22.19+、已安装的官方 Harness Desktop 0.2.1-rc.2、YouDub Python 环境、FFmpeg/FFprobe、Whisper `tiny.pt` 和 NLTK `punkt_tab`。本次复用本机已有资源，没有另建资源管理器。

如需创建 Python 环境，在仓库根目录执行：

```sh
python3 -m venv .venv
.venv/bin/pip install --index-url https://mirrors.aliyun.com/pypi/simple/ \
  -r backend/requirements/base.txt \
  -r backend/requirements/media.txt \
  -r backend/requirements/whisper.txt
```

`modelsDir` 指向包含 `tiny.pt` 的目录，FFmpeg/FFprobe 位于启动环境的 PATH。NLTK 使用默认资源路径，也可通过 Harness 环境加载设置 `NLTK_DATA`。

从仓库根目录安装并构建插件：

```sh
cd apps/harness
npm ci --registry=https://registry.npmmirror.com
npm run build
```

## 启动桌面版

默认使用 `/Applications/DeepSeek Harness.app`。首次先让官方应用初始化独立 profile，然后完全退出该实例：

```sh
npm run desktop -- --initialize
```

配置 Python 和模型路径，随后启动：

```sh
npm run desktop -- --setup \
  --python /absolute/path/to/YouDub-webui/.venv/bin/python \
  --models-dir /absolute/path/to/whisper-models
npm run desktop
```

`--setup` 调用应用自带的官方 CLI 链接 YouDub bundle，并追加机器配置，保留已有 profile 配置。已完成 setup 后，直接编辑该 profile 的 `cordis.patch.yml`；重复 setup 会明确报错。

默认桌面数据位于仓库的 `.cache/harness/desktop`，Electron 用户数据位于 `.cache/harness/desktop-user-data`。启动器分别使用官方 `DSH_HOME` 和 `--user-data-dir` 隔离现有 Harness 实例；内部监听端口由官方 Desktop 动态分配。可用 `DSH_HOME` 指定另一位置，对应 Electron 用户数据目录为该路径加 `-user-data`。

本次并行演示使用官方应用的 APFS 副本 `.cache/harness/YouDub Harness.app`，便于区分两个窗口；应用内容和签名资源保持原样，原应用与副本的 `app.asar` 已核对 SHA-256 一致。已有该副本时，可以这样指定：

```sh
npm run desktop -- --app '../../.cache/harness/YouDub Harness.app'
```

这只是本机验证载体，尚未制作 YouDub 品牌安装包。

## 启动浏览器版

```sh
npm start -- --dump-config
```

首次会初始化 `.cache/harness/dsh/profiles/youdub`。按 [profile.example.yml](../profile.example.yml) 在该 profile 的 `cordis.patch.yml` 配置 Python、模型和数据路径。旧版仅含 YouDub 单 bundle 的已知 profile 会迁移为官方三 bundle 组合，其他不匹配清单会报错，已有配置保留。

```sh
# 确认端口未被占用，再启动。
lsof -nP -iTCP:3086 -sTCP:LISTEN
npm start
```

默认绑定 `127.0.0.1:3086`，也可传入官方 `--port` 参数。打开终端打印的带 token 地址；Harness 换取认证 cookie 后移除地址栏 token。重启 Host 后使用新打印的地址。浏览器与桌面默认数据目录互相独立。

## 配置与持久化

配置沿用 Harness：bundle 默认值 → profile `cordis.patch.yml` → Harness home `cordis.patch.yml` → CLI `--patch`。覆盖会替换该行的完整 `config`，请保留 `python`、`modelsDir`、`dataDir` 三项。它们由官方 Schemastery schema 校验，配置导出可直接检查：

```sh
npm start -- --dump-config
npm start -- --dump-config-schema
npm start -- --patch /absolute/path/to/override.yml
```

环境变量沿用 Harness 继承环境、调用目录 `.env`、Harness home `.env` 的规则。启动器工作目录为 `apps/harness`；没有新增 `YOUDUB_HARNESS_*` 配置入口。凭证由官方 credentials 服务管理，本次只使用本地识别，没有外部 LLM 请求。

操作顺序为：导入并识别 → 修改并保存 → 确认字幕 → 导出 SRT。未保存修改会阻止确认、导出和页面切换；修改已确认字幕并保存会撤销确认。待人工确认时识别子进程已经退出，释放执行位。

数据保存在 `$DSH_HOME/youdub/tasks/<taskId>/`：

- `source.video`：原视频。
- `recognize/asr_raw.json`、`asr.original.json`：原始识别结果。
- `task.json`：当前字幕、版本和人工确认状态。
- `transcript.confirmed.json`、`subtitles.srt`：确认后导出的产物。

校对检查点持久化保存。执行中断会在重启时显示 `HOST_INTERRUPTED`；不会自动重跑或自动确认。错误保留原因，当前通过重新导入建立新任务。版本校验拒绝旧页面写入，前端刷新遇到版本冲突会保留未保存草稿并提示。

## 验证与范围

```sh
npm test
```

当前测试汇总为 11 项通过：6 项工作流测试，加上官方子进程集成测试父项及其 4 个子项。真实桌面和历史浏览器证据见 [验收记录](validation.md)。

本次范围为本地视频、Whisper tiny/CPU、原语言字幕、固定识别时间轴、文本修改、人工确认及 SRT 导出，单个识别执行位、文件上限 512 MB。翻译、配音、完整工作流编辑器、字幕拆分合并和时间轴编辑尚未迁移。

所有新增实现和证据集中于 `apps/harness`。原 YouDub 入口、worker、上游 npm 包和官方 Desktop 均未修改；构建产物、依赖、模型、凭证和运行数据不入 Git。当前未进行安装包、签名发布、跨平台或生产验收。
