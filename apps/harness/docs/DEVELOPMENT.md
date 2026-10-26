# Harness 版本地开发

以下命令在 `main` 或从 main 创建的功能分支执行。源码启动与正式安装包共用同一产品组合；安装包、签名和发布见[发行流程](../../../docs/releasing.md)。

## 准备工作区

新工作区可以按指定分支检出：

```sh
git clone --branch main --recurse-submodules https://github.com/liuzhao1225/YouDub-webui.git
cd YouDub-webui
git status --short --branch
```

已有工作区先确认分支及未提交内容，不覆盖本地改动。功能改动从 `main` 创建分支，检查通过后合并。

本文命令使用 Node.js `^22.19.0 || >=24.0.0`、npm、Git 和平台构建工具。根 package.json 与[框架 engines](../../../vendor/deepseek-harness/source/package.json) 保持一致。macOS 使用 Xcode Command Line Tools。

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
| 安装 Harness 接入依赖 | 产品构建工具、本仓库 Electron；不安装第二套 Harness 发布包 |
| `build:framework` | 读取当前源码，构建到 `.cache/harness/source-build`；内部使用官方 `scripts/build.ts --scope artifacts` |
| `build:youdub` | 生成 `apps/harness/dist/host.mjs`、`client.js` 和桌面产品入口 |

`vendor/deepseek-harness/source` 只保留产品需要的框架子集，变更由 Git 记录。构建在 `.cache/harness/source-build` 进行。修改框架后统一构建，随后重启开发客户端。

运行目录由产品 patch 和实际依赖组成；编入前端和桌面产物的源码另行列出。详见[保留范围](FRAMEWORK-SCOPE.md)。

### 准备开发 profile

启动依赖来自上述 npm 锁文件与源码构建。Host 和下载节点使用本应用 Electron 的 Node 模式；profile 与扩展安装使用本工作区 pnpm。Python、FFmpeg、分句资源和四模型由应用首启准备。

需要单独验证 profile 时执行：

```sh
node apps/harness/desktop.mjs --prepare-only
```

`npm start` 也会完成同一准备步骤。当前启动无需复制 `primary-runtime` 或 `office-skills`，默认运行不调用已安装 Harness 应用或共享 `~/.dsh`。正式安装包使用 `npm run package:desktop -- --dir` 生成独立 App；发行流程对候选包做首启检查、签名和公证。

## 日常修改与启动

关闭需要替换的 YouDub 开发实例，重新构建并启动：

```sh
npm run build:youdub
npm start
```

`npm run dev` 与 `npm start` 目前都运行桌面开发启动器。它们没有监听源码变更；修改插件或产品入口后需要重建。框架依赖或官方构建产物需要重新生成时才运行 `build:framework`。

Electron 主进程通过官方控制器启动 Host，端口由桌面运行时管理，实际地址从启动输出读取。测试文件选择、保存、窗口行为及退出确认时使用这个 Electron 实例。

### 浏览器开发

浏览器入口直接运行同一 Desktop Host、产品 profile 与锁定 pnpm，默认端口 `3086`。启动前检查占用：

```sh
lsof -nP -iTCP:3086 -sTCP:LISTEN
npm --prefix apps/harness start
```

发现已有监听时先识别原进程，复用已有实例或结束属于本次开发的实例，避免重复启动。`lsof` 未发现监听时可以启动。打开终端打印的认证地址；浏览器默认 home 与桌面分离，需要在对应 profile 内配置和准备资源。

### 开发入口与共享组件

| 命令或目录 | 当前用途 |
| --- | --- |
| `npm start` / `npm run dev` | 当前 Harness Electron 产品 |
| `npm run build:youdub` / `npm run build:desktop` | 同一 Electron 开发构建，不生成安装包 |
| `npm run dev:web` / `npm --prefix apps/harness start` | 同一 Harness Host 的浏览器开发入口 |
| `apps/web/src` | 直接复用的业务组件和领域测试，无独立 Web 启动入口 |
| `packages/builtin/test/helpers` | 领域回归使用的隔离组合夹具，不进入产品构建 |

旧 Swift/C# 桌面壳与 `build:mac`、`build:windows` 已由当前 Electron 构建与打包入口替代。`apps/desktop/icon.svg` 由 Electron 产品继续复用。历史源码见[裁剪前提交](https://github.com/liuzhao1225/YouDub-webui/tree/711e40e8e69d2c6f2065f15aecc90550dcbf695d/apps/desktop)。

## 数据与配置

| 内容 | 桌面默认路径 |
| --- | --- |
| YouDub home（开发） | `.cache/harness/desktop` |
| Electron 用户数据 | `.cache/harness/desktop-user-data` |
| 桌面 profile | `$YOUDUB_HOME/profiles/desktop` |
| YouDub 任务、配置与产物根 | `$YOUDUB_HOME/youdub` |
| Python / venv | `$YOUDUB_HOME/youdub/runtime/python`、`runtime/venv` |
| 模型 | `$YOUDUB_HOME/youdub/models` |
| 媒体工具与分句资源 | `$YOUDUB_HOME/youdub/runtime/ffmpeg`、`$YOUDUB_HOME/youdub/nltk_data` |
| Node / pnpm | 本工作区 `apps/harness/node_modules/electron` 与 `pnpm` |
| 桌面源码运行时链接 | `apps/harness/dist/desktop/runtime-project` |
| 浏览器 home / profile | `.cache/harness/dsh` / `profiles/youdub` |

首启实验使用新的 home：

```sh
YOUDUB_HOME="$PWD/.cache/harness/desktop-fresh" npm start
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

集成测试通过 `test/source-framework.mjs` 将业务测试导入指向当前源码构建。`npm --prefix apps/harness test` 先检查当前源码与构建收据；缺失产物或源码变更应先重建，不会改用 npm 发布包。

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
| 框架输入与产物 | `npm run build:framework` |
| 框架 TypeScript、测试夹具或构建脚本 | 先构建框架，再在 `.cache/harness/source-build` 运行 `node node_modules/tsx/dist/cli.mjs scripts/build.ts --scope check`，并运行受影响的原测试 |

项目 `.venv` 不存在时用 `python3 -m venv .venv` 创建，依赖优先从阿里 PyPI 安装。测试具体依赖以对应 requirements 为准，不把模型大文件安装到源码测试环境来代替应用资源准备。

完整来源核对命令：



验收记录区分源码完整性、构建、插件 active、首启资源 ready、实际任务和最终媒体产物。后续实验默认使用“字幕＋配音”完整流程覆盖 Demucs、Whisper、翻译与 TTS；涉及对齐和混音时一并检查相应节点及输出。

## 常见问题定位

| 现象 | 先检查 |
| --- | --- |
| 找不到 `.dsh-build/client-build-environment.json` 或 profile runner/Host | `build:framework` 是否成功，源码构建目录是否完整 |
| Electron 或 pnpm 缺失 | `npm --prefix apps/harness ci` 是否成功，Electron 平台二进制是否安装完整 |
| Host / web boot 报 pending service | 官方诊断中的条目与 `inject`，产品 patch 是否关闭了所需服务 |
| `Legacy platform code entered the Harness plugin bundle` | 构建输入中的旧框架依赖，修正导入/接线后重建 |
| 修改页面后界面未变化 | 是否构建产品并重启正确的 Electron/浏览器实例，当前使用哪个 home |
| 初始化停在模型阶段 | 四模型及全部依赖的实际 ready 状态，资源页面的原始错误 |
| 翻译不可用或输出容量错误 | 官方模型页的 API 协议、URL、凭据、模型与输出容量至少 65,535 的配置 |
| 扩展提示 `not-a-bundle` | 是否声明 `dsh.bundle` 和官方入口，参照[外部插件说明](BACKEND-DEVELOPMENT.md#外部插件) |

启动器输出 profile 路径，桌面错误界面显示官方诊断报告路径。保留失败原因，修正后重新验证受影响路径；不要删去必需服务或吞掉错误来跳过启动检查。

### 已安装应用与 Harness 隔离

已安装版本默认使用 Electron 的 YouDub 用户数据目录下的 `harness` 子目录，Windows 为 `%APPDATA%\YouDub\harness`。保留这个既有目录可继续使用旧版的配置、凭据与任务。业务安装目录仍以首启页面保存的选择为准。`YOUDUB_HOME` 是 YouDub 的显式路径覆盖；外部 `DSH_*` 环境变量不会选择 YouDub 的数据或运行时，框架内部使用的 `DSH_HOME` 由 YouDub 启动入口赋值。

Windows 使用独立的安装器 AppId `{C28A6869-1C98-4FA0-BBE5-E5C579B0A602}`、应用标识 `com.youdub.desktop`、`YouDub.exe`、开始菜单及卸载项。安装器覆盖旧版时替换 `resources/app` 和 `resources/youdub`，保留应用目录以外的配置、凭据、环境、模型和任务。更新和卸载均不操作 Harness 的目录或注册项。`dsh-app://app` 仅是 Electron 会话内部页面协议，不注册为系统 URL 协议。

安装回归覆盖真实安装位置下的中文确认按钮、带外部 Harness 环境变量的启动、重启后安装目录恢复、旧代码清理与用户数据保留。测试不将环境下载开始视为所有模型准备完成。
