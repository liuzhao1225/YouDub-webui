# Harness 版本地开发

以下命令在 `codex/harness-youdub-integration` 分支的仓库根目录执行。当前流程面向源码开发，不生成安装包。已记录的原生开发验证以 macOS ARM64 为主，其他平台的当前边界见[代码复核](CODE-AUDIT.md)。

## 准备工作区

新工作区可以按指定分支检出：

```sh
git clone --branch codex/harness-youdub-integration --recurse-submodules https://github.com/liuzhao1225/YouDub-webui.git
cd YouDub-webui
git status --short --branch
```

已有工作区先确认分支及未提交内容，不覆盖本地改动。默认开发保留 `main`、`atomgit` 和融合分支；本功能在融合分支继续维护。

本文命令使用 Node.js 22（至少 `22.19.0`）、npm、Git 和平台构建工具。根 package.json 的 Node 下限服务于原 YouDub；[上游 engines](../../../vendor/deepseek-harness/source/package.json) 声明为 `^22.19.0 || >=24.0.0`。macOS 使用 Xcode Command Line Tools。

## 首次构建

```sh
npm ci --registry=https://registry.npmmirror.com
npm --prefix apps/web ci --registry=https://registry.npmmirror.com
npm --prefix apps/harness ci --registry=https://registry.npmmirror.com
npm run build:framework
npm run build:youdub
```

| 步骤 | 结果 |
| --- | --- |
| 安装根依赖 | 原 YouDub 领域源码和开发工具依赖 |
| 安装 Web 依赖 | 复用业务组件、React Flow、Tailwind 与测试所需依赖 |
| 安装 Harness 接入依赖 | 产品构建工具、本仓库 Electron 与官方依赖声明 |
| `build:framework` | 校验上游，构建到 `.cache/harness/source-build`；内部使用官方 `scripts/build.ts --scope artifacts` |
| `build:youdub` | 生成 `apps/harness/dist/host.mjs`、`client.js` 和桌面产品入口 |

`vendor/deepseek-harness/source` 是活动产品 fork；原始归档和固定清单保持不变，修改逐项登记在 `fork.json`。生成目录位于 `.cache` 和 `dist`。当前开发壳使用源码构建的 preload，按源构建路径加载 CLI、Host、Web 和服务。替换框架产物前停止使用它的开发实例，避免逐文件更新触发不完整的 HMR 状态。

### 准备开发 profile

启动依赖来自上述 npm 锁文件与源码构建。Host 和下载节点使用本应用 Electron 的 Node 模式；profile 与扩展安装使用本工作区 pnpm。Python、FFmpeg、分句资源和四模型由应用首启准备。

需要单独验证 profile 时执行：

```sh
node apps/harness/desktop.mjs --prepare-only
```

`npm start` 也会完成同一准备步骤。当前启动无需复制 `primary-runtime` 或 `office-skills`，默认运行不调用已安装 Harness 应用或共享 `~/.dsh`。旧开发 App 组装脚本已移除；其历史源码可从改造基线恢复。当前仅使用源码开发入口，不组装或签名 App。

## 日常修改与启动

关闭需要替换的 YouDub 开发实例，重新构建并启动：

```sh
npm run build:youdub
npm start
```

`npm run dev` 与 `npm start` 目前都运行桌面开发启动器。它们没有监听源码变更；修改插件或产品入口后需要重建。框架依赖或官方构建产物需要重新生成时才运行 `build:framework`。

Electron 主进程通过官方控制器启动 Host，端口由桌面运行时管理，实际地址从启动输出读取。测试文件选择、保存、窗口行为及退出确认时使用这个 Electron 实例。

### 浏览器开发

浏览器入口使用同一产品插件，默认端口 `3086`。启动前检查占用：

```sh
lsof -nP -iTCP:3086 -sTCP:LISTEN
npm --prefix apps/harness start
```

发现已有监听时先识别原进程，复用已有实例或结束属于本次开发的实例，避免重复启动。`lsof` 未发现监听时可以启动。打开终端打印的认证地址；浏览器默认 home 与桌面分离，需要在对应 profile 内配置和准备资源。

### 保留的旧入口

| 命令或目录 | 当前用途 |
| --- | --- |
| `npm start` / `npm run dev` | 当前 Harness Electron 产品 |
| `npm --prefix apps/harness start` | 当前 Harness 浏览器开发入口 |
| `npm run dev:web` / `apps/web/src/main.tsx` | 原独立 Web 入口，可用于原组件对照 |
| `npm run start:legacy` / `apps/host` | 原 YouDub Host，保留历史与对照用途 |
| `npm run build:desktop` / `build:mac` / `build:windows` | 旧桌面发行脚本，当前开发任务不执行 |

## 数据与配置

| 内容 | 桌面默认路径 |
| --- | --- |
| Harness home | `.cache/harness/desktop` |
| Electron 用户数据 | `.cache/harness/desktop-user-data` |
| 桌面 profile | `$DSH_HOME/profiles/desktop` |
| YouDub 任务、配置与产物根 | `$DSH_HOME/youdub` |
| Python / venv | `$DSH_HOME/youdub/runtime/python`、`runtime/venv` |
| 模型 | `$DSH_HOME/youdub/models` |
| 媒体工具与分句资源 | `$DSH_HOME/youdub/runtime/ffmpeg`、`$DSH_HOME/youdub/nltk_data` |
| Node / pnpm | 本工作区 `apps/harness/node_modules/electron` 与 `pnpm` |
| 桌面源码运行时链接 | `apps/harness/dist/desktop/runtime-project` |
| 浏览器 home / profile | `.cache/harness/dsh` / `profiles/youdub` |

首启实验使用新的 home：

```sh
DSH_HOME="$PWD/.cache/harness/desktop-fresh" npm start
```

Electron 用户数据跟随为该 home 加 `-user-data`。新 home 复用工作区的 Electron、pnpm 和源码构建，独立保存 profile、业务环境、模型和数据；重新使用同一路径会继续读取前次实验数据。不要通过删除用户 home 来制造首启场景。

bundle 默认配置在 [`cordis.patch.yml`](../cordis.patch.yml)，用户覆盖位于 profile 的同名文件；加载和优先级遵循官方机制。密钥和模型配置通过页面输入，保存到官方 Settings/Credentials 管理的位置。

需要 `.env` 时保留已有文件，并为代理读取创建硬链接：

```sh
test -f .env || cp .env.example .env
test -e env.txt || ln .env env.txt
test .env -ef env.txt
```

最后一项失败时先核对两个文件，保留已有配置再修正链接。应用读取 `.env`，代理读取 `env.txt`；两个文件及 `.venv/` 均应保持 Git 忽略。此配置用于运行环境，页面模型配置的实际测试仍从官方模型表单完成。

源码测试使用项目 `.venv`；应用首启创建的私有 venv 服务于实际媒体运行。二者路径和用途分别记录。

## 验证选择

按实际改动选择检查，不因文档修改重复构建或调用模型：

| 改动 | 检查 |
| --- | --- |
| 文档 | 文件链接、命令与脚本一致，`git diff --check` |
| 产品组合、Host/Client 接入 | `npm --prefix apps/harness test`，构建后执行 `npm --prefix apps/harness run check:composition` |
| 领域逻辑 | 根目录 `npm test`，或 `node --import tsx --test packages/builtin/test/<文件>.test.ts` |
| 原页面组件 | `npm --prefix apps/web test -- src/<相关测试>.test.tsx`，相关类型检查与实际 Harness 页面 |
| 语言 | `npm --prefix apps/harness run check:locales`，实际设置页面切换与重启读回 |
| Python 操作 | `.venv/bin/pytest backend/tests/<相关文件>.py`，受影响的真实媒体任务 |
| 官方源码与来源 | `node apps/harness/baselines/vendor.mjs --verify`；完整检查见下方 |

项目 `.venv` 不存在时用 `python3 -m venv .venv` 创建，依赖优先从阿里 PyPI 安装。测试具体依赖以对应 requirements 为准，不把模型大文件安装到源码测试环境来代替应用资源准备。

完整来源核对命令：

```sh
node apps/harness/baselines/verify.mjs --report /tmp/youdub-harness-integrity.json
```

完整检查还需要[基线说明](../baselines/README.md)中的原应用/npm/初始源码归档和本地构建产物。归档缺失应报告为检查条件不足；不要修改保存的清单让校验通过。`--scope sources|desktop|npm|vendor|build` 可分别检查相应范围。

验收记录区分源码完整性、构建、插件 active、首启资源 ready、实际任务和最终媒体产物。后续实验默认使用“字幕＋配音”完整流程覆盖 Demucs、Whisper、翻译与 TTS；涉及对齐和混音时一并检查相应节点及输出。对照样本与已知缺口见[验证记录](validation.md)。

## 常见问题定位

| 现象 | 先检查 |
| --- | --- |
| 找不到 `.dsh-build/client-build-environment.json` 或官方 CLI/Host | `build:framework` 是否成功，源码构建目录是否完整 |
| Electron 或 pnpm 缺失 | `npm --prefix apps/harness ci` 是否成功，Electron 平台二进制是否安装完整 |
| Host / web boot 报 pending service | 官方诊断中的条目与 `inject`，产品 patch 是否关闭了所需服务 |
| `Legacy platform code entered the Harness plugin bundle` | 构建输入中的旧框架依赖，修正导入/接线后重建 |
| 修改页面后界面未变化 | 是否构建产品并重启正确的 Electron/浏览器实例，当前使用哪个 home |
| 初始化停在模型阶段 | 四模型及全部依赖的实际 ready 状态，资源页面的原始错误 |
| 翻译不可用或输出容量错误 | 官方模型页的 API 协议、URL、凭据、模型与输出容量至少 65,535 的配置 |
| 扩展提示 `not-a-bundle` | 是否声明 `dsh.bundle` 和官方入口，参照[外部插件说明](BACKEND-DEVELOPMENT.md#外部插件) |

启动器输出 profile 路径，桌面错误界面显示官方诊断报告路径。保留失败原因，修正后重新验证受影响路径；不要删去必需服务或吞掉错误来跳过启动检查。
