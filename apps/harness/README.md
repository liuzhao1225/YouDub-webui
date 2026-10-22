# YouDub × Harness 融合开发版

当前分支 `codex/harness-youdub-integration` 使用 Harness 的后端框架、前端插件架构和 Electron 桌面能力，加载原 YouDub 的业务页面与工作流。桌面直接由本仓库的 Electron 运行融合后的源码开发入口，产品版本读取仓库根 `package.json`（当前 `0.0.7`）；Harness runtime 固定为 `0.2.1-rc.2`。

当前处于源码开发阶段，开发运行允许链接工作区；本轮不生成应用包或安装包。历史字幕 POC 说明原样保存在 [POC-README.md](docs/POC-README.md)，其中旧启动命令、截图和测试计数不代表本分支。

## 开发文档

[文档索引](docs/README.md) · [架构说明](docs/ARCHITECTURE.md) · [前端开发](docs/FRONTEND-DEVELOPMENT.md) · [后端与工作流开发](docs/BACKEND-DEVELOPMENT.md) · [本地开发](docs/DEVELOPMENT.md) · [多语言维护](docs/LOCALIZATION.md)

架构说明记录官方框架与业务代码的职责；开发指南按源码入口解释接入方式。当前实现与验收范围分别见[功能覆盖账本](docs/FUSION-COVERAGE.md)和[代码复核](docs/CODE-AUDIT.md)。

## 源码与职责

| 部分 | 当前承载 |
| --- | --- |
| 框架源码 | [vendor/deepseek-harness/source](../../vendor/deepseek-harness/source) 是活动 YouDub fork；原始公开 tag `dsh-v0.2.1-rc.2`、commit `687f282e8625c6b8d11ff58211a90524be2e4317` 保存在独立归档与不可改写的 source-manifest.json，活动差异逐项记录在 fork.json |
| 桌面产品入口 | [desktop-main.mjs](src/desktop-main.mjs) → [desktop-product.ts](src/desktop-product.ts)；组合官方 HostProcess、ProjectManager、BackendController、协议转发、preload、目录选择、快捷键、主题/全屏、退出确认和错误报告 |
| Host 与插件生命周期 | 复用 Desktop Host、app-boot、Cordis、Loader；YouDub bundle 正向装配需要的服务和前端条目，保留第三方 bundle 与用户 patch；Host 已解除 Office 与平台账号接线 |
| 前端框架 | 官方 Renderer、ModuleLoader、Slots、Layout、Store、locale 和 theme；官方 primitives、模型设置和插件页面承载通用交互 |
| 原 YouDub 页面与元素 | 直接导入 `apps/web/src` 的业务组件，保留原动态 Logo、大标题、首屏动效、工作流画布、任务和校对页面；通用控件通过构建边界接官方实现 |
| 原 YouDub 业务 | 直接导入 `packages/builtin` 的任务、图工作流、文件、资源与媒体合同；Python worker 和算法入口仍在 `backend` |
| 后端适配 | [src/backend](src/backend)：官方 Connection 负责 HTTP/鉴权，Subprocess 负责进程，Jobs 负责执行状态，Settings/Credentials 负责配置与密钥，LLM 负责模型调用，PluginManager 负责扩展管理 |

原始归档与活动 fork 分别校验，修改需要记录文件差异与原因。YouDub 的产品装配位于 `apps/harness`，框架内部的具体产品耦合直接在活动源码中解除。改造阶段、实际验证与未完成事项见[详细计划](docs/YOUDUB-DESKTOP-REFACTOR-PLAN.md)和[调研记录](docs/REFACTOR-RESEARCH.md)。产品入口进入 YouDub 的 `SetupGate`，不要求 DeepSeek 登录或占位 API Key。

功能/API 拆解见 [FUSION-COVERAGE.md](docs/FUSION-COVERAGE.md)，前端组件对应见 [FRONTEND-MAPPING.md](FRONTEND-MAPPING.md)。清单描述迁移范围；实际通过范围与未完成项以 [validation.md](docs/validation.md) 的本分支证据为准。

## 源码构建与开发运行

以下命令在仓库根目录执行。源码构建需要 Node.js 22.19+、npm 和 macOS 构建工具；开发启动使用本仓库 Electron，Host 使用它的 Node 模式，媒体任务使用 YouDub 自有 Python。

```sh
npm ci --registry=https://registry.npmmirror.com
npm --prefix apps/web ci --registry=https://registry.npmmirror.com
npm --prefix apps/harness ci --registry=https://registry.npmmirror.com
npm run build:framework
npm run build:youdub
```

上述依赖和构建完成后，启动器直接使用本仓库 Electron 的 Node 模式和锁文件指定的 pnpm。可单独检查开发 profile：

```sh
node apps/harness/desktop.mjs --prepare-only
```

当前启动无需原 Harness 应用的 runtime 副本。Python、FFmpeg、分句资源和四模型由 YouDub 首启流程准备；Windows 的实际交互仍待验收。

`build:framework` 校验活动 fork 的来源与差异后复制到 `.cache/harness/source-build`，执行保留的 `scripts/build.ts --scope artifacts`；不生成 tarball、App 或安装包。第一次构建框架后，日常 YouDub 代码修改只需：

```sh
npm --prefix apps/harness run build:product
npm start
```

`build:product` 编译 YouDub 插件和产品入口，preload 直接使用官方完整源码构建结果。启动调用上游 `prepareDevelopmentProject`，链接源构建的 CLI、Host、Web 与官方服务；YouDub 插件拥有独立的开发依赖视图，避免从旧 npm 产物加载另一份框架实例。

## 启动与首次环境准备

界面测试可用 `node apps/harness/desktop.mjs --skip-setup` 直接进入工作台。此参数只用于开发启动；未指定 `DSH_HOME` 时使用独立的 `.cache/harness/desktop-ui-test`，跳过安装、环境/模型准备和服务配置引导。任务库使用项目现有的 `.venv/bin/python`；可通过 `YOUDUB_TEST_PYTHON` 指定其他开发 Python。它不下载模型、不将资源标记为已就绪，媒体功能仍需真实环境。默认启动保留完整首启流程。

```sh
npm start
```

仓库根 `npm start` 或 `npm run dev` 直接运行本仓库 Electron 与 `apps/harness/dist/desktop`，不经过 `dsh desktop` 或已安装的 Harness 应用。启动会初始化并检查 YouDub profile。所有必需 bundle 必须成功加载，解析失败会保留官方诊断并停止启动。

首启源码按以下阶段组织，完整流程的实际验收状态见 [validation.md](docs/validation.md)：

1. 准备 YouDub 专用 Python、venv 与基础依赖。
2. 显示 Whisper tiny、VoxCPM2、Demucs htdemucs、Qwen3 Aligner 0.6B 四个必需模型。点击“准备全部模型”，安装完整依赖并校验全部模型。
3. 进入 LLM 配置，使用 Harness 官方模型配置组件和服务。

四模型与全部运行依赖就绪后才能完成首次初始化。基础环境就绪不代表模型已下载；模型下载完成也不代表模型质量已验收。安装失败显示原始原因。

默认路径如下：

| 内容 | 默认目录 |
| --- | --- |
| Electron 开发入口 | `apps/harness/dist/desktop/main.mjs` |
| 官方源码构建工作区 | `.cache/harness/source-build` |
| 桌面开发运行时 | `apps/harness/dist/desktop/runtime-project` |
| 开发包管理器 | `apps/harness/node_modules/pnpm/bin/pnpm.mjs` |
| YouDub 的 Harness home | `.cache/harness/desktop` |
| Electron 用户数据 | `.cache/harness/desktop-user-data` |
| profile | `$DSH_HOME/profiles/desktop` |
| YouDub 业务数据 | `$DSH_HOME/youdub` |
| Python 下载与环境 | `$DSH_HOME/youdub/runtime/python`、`$DSH_HOME/youdub/runtime/venv` |
| 媒体工具与分句资源 | `$DSH_HOME/youdub/runtime/ffmpeg`、`$DSH_HOME/youdub/nltk_data` |
| 模型 | `$DSH_HOME/youdub/models`；Whisper 默认在 `models/whisper` |

Host、浏览器开发入口和下载节点均使用本应用 Electron 的 Node 模式。包管理使用 `apps/harness/node_modules/pnpm`，经原 Harness `desktopNodeEnvironment` 和 `node-bin` 启动。产品将 Electron 可执行路径传给 Python worker 及 yt-dlp；缺失时保留错误并停止。媒体环境、模型、缓存和任务位于 YouDub 私有目录；实际路径与首次资源状态分别验证。

开发运行所需文件如下；这些工作区文件当前仍需保留。

| 依赖 | 来源与用途 |
| --- | --- |
| Node.js 22.19+、npm 与构建工具 | 执行开发启动脚本和源码构建 |
| `vendor/deepseek-harness/source` 与 `.cache/harness/source-build` | 保存的官方源码，以及按官方构建流程生成的 CLI、Host、Web、插件和 pnpm 工作区依赖 |
| `apps/harness/dist`、原 YouDub `backend`、`packages`、`site` 等文件 | YouDub 产品编译产物、媒体工作进程、源码校验输入和示例资源；通过 `YOUDUB_MEDIA_ROOT` 指向本仓库 |
| `apps/harness/node_modules/electron` | npm 官方 Electron 发行二进制，直接承载桌面与 Host |
| `apps/harness/node_modules/pnpm` | 锁定的开发包管理器，供原 profile 与 PluginManager 安装/卸载扩展 |
| `submodule/demucs` | YouDub 固定的 Demucs 算法源码，版本由 Git submodule 记录；选择该模型时还需完成此源码与依赖准备 |
| 各自 `$DSH_HOME/youdub` | 首启下载的媒体 Python、venv、FFmpeg、分句资源、所选模型和业务数据 |

运行入口不调用 `/Applications/DeepSeek Harness.app`，也不以 `~/.dsh` 作为默认 home。基线归档用于来源核对与恢复。Office 等未使用源码及其构建依赖仍待 P6 裁剪，当前 Host 已解除对应装配。

可用独立 home 重做首启验证，保留原数据：

```sh
DSH_HOME="$PWD/.cache/harness/desktop-fresh" \
  node apps/harness/desktop.mjs
```

显式 `DSH_HOME` 会传入开发进程，Electron 用户目录为该路径加 `-user-data`。该测试共用工作区的 Electron、pnpm 与源码构建，Python/模型/任务/profile 位于新的 home。

## 配置方式

配置使用官方 Harness bundle/profile 机制：[cordis.patch.yml](cordis.patch.yml) 定义产品组合与默认路径；`$DSH_HOME/profiles/desktop/cordis.patch.yml` 保存本地 profile 覆盖，Harness home 的 patch 继续按官方优先级生效。环境变量采用官方 inherited → 调用目录 `.env` → Harness home `.env` 的加载规则；密钥交给官方 Credentials 服务。配置、凭据、依赖、模型与任务数据不提交到 Git。

YouDub 默认的 `python`、`modelsDir`、`dataDir` 由 `dshHomePath()` 解析为上述应用目录。通常通过首启和资源页面管理环境；`desktop.mjs --python … --models-dir …` 保留为显式开发覆盖，覆盖外部路径时不属于默认自有环境验收。

浏览器开发入口使用同一产品插件，默认 home 是 `.cache/harness/dsh`、profile 名为 `youdub`。确认端口未被占用后运行：

```sh
lsof -nP -iTCP:3086 -sTCP:LISTEN
npm --prefix apps/harness start
```

使用终端打印的认证地址。配置诊断可运行 `npm --prefix apps/harness start -- --dump-config`；它不会启动监听。浏览器入口用于开发，桌面入口为根目录的 `npm start`。

## 来源与验证

原 YouDub 分支快照、公开 Harness tag、官方安装 app 和 npm 原包均另存基线，位置、哈希、恢复方式见 [baselines/README.md](baselines/README.md)。原安装 app 的构建 commit 与公开 tag 不同，现有来源记录不声称可以逐字节重建该二进制。

```sh
npm --prefix apps/harness test
npm --prefix apps/harness run check:composition
node apps/harness/baselines/verify.mjs --report /tmp/youdub-harness-integrity.json
```

完整检查核对原始源码、官方 app/npm、vendor 原件及当前构建来源；`--scope sources|desktop|npm|vendor|build` 可单独检查。未修改的上游文件不因当前构建方式而获豁免；任何字节、权限、链接或来源差异都会报错。构建后 `--record` 生成产物来源记录，后续使用 `desktop-build.mjs --verify` 复核。

当前 CLI、Desktop Host、preload、主 Web 应用和动态加载的官方服务/客户端插件均来自完整保存源码的官方构建。开发运行时逐个核对 `@deepseek-ai` 包的真实路径，来源记录保存在各运行时的 `youdub-source-runtime.json`。Electron、Python、pnpm 及上游依赖的第三方原生引擎仍使用对应发行二进制。

产品页面使用原 YouDub 品牌资源。本轮直接运行 Electron 开发入口，未生成带品牌图标的应用包。开发壳尚未配置 YouDub 更新源，更新入口会明确说明，不能据此声称已完成发布升级流程。测试结果、首次安装、实际视频任务、人工确认/导出和跨平台验收分别记录，编译或进程启动成功不替代功能验收。

## 默认工作流与链接下载

默认模板保留“字幕翻译”“视频配音”“字幕＋配音”。人工审核由每个节点的“自动下一步”开关控制；关闭后，该节点完成时暂停，确认结果后继续。已有用户工作流和任务快照保留原配置。

YouTube / B 站链接沿用原 `youdub.download` 节点。节点设置、快捷字段及运行面板可以填写“本机 HTTP 代理端口（0 为直连）”：`0` 显式直连，`1–65535` 使用 `http://127.0.0.1:<端口>`，B 站短链接解析使用同一代理。运行面板中的链接作为每次执行输入，端口进入节点配置及执行绑定。

线上 zoo 视频已通过原生页面输入 URL 和 7897 端口完成 10 节点真实处理，见 [验证记录](docs/evidence/source-native-youtube-download-node.json)。B 站路径保留原实现并通过代理合同测试，本轮未作公网实测。
