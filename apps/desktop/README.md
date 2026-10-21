# YouDub 桌面应用

> 本文保留原 AppKit/WKWebView 与 Windows 桌面壳的构建和发行说明。当前 `codex/harness-youdub-integration` 分支使用 Harness 的 Electron 架构，开发入口和命令见[本地开发](../harness/docs/DEVELOPMENT.md)，桌面装配见[架构说明](../harness/docs/ARCHITECTURE.md)。

## macOS

原生 AppKit 窗口内嵌 WKWebView，启动应用时自动启动内置 Node 和 Cordis Host，加载 React 客户端。无需单独安装 Node、运行终端或打开浏览器。目标为 Apple Silicon，最低 macOS 14。

Python、模型与业务数据写入 `~/Library/Application Support/YouDub`；Python 虚拟环境位于该目录的 `runtime/venv`。首次启动准备基础环境，进入工作台后按工作流准备所需依赖与模型。应用包中不包含用户 `.env`、翻译密钥和苹果签名凭据。用户配置可放在数据目录下的 `.env`，已有 `YOUDUB_PYTHON` 等显式设置继续生效。

关闭最后一个窗口或按 ⌘Q 会停止本地服务。⌘R 刷新页面；“YouDub → 查看日志”打开 `~/Library/Logs/YouDub/desktop.log`。应用提供原生文件选择和下载保存窗口。

环境准备页和工作台的“查看内置示例”可打开黄仁勋采访、播放量与收入、Me at the zoo 三组中英对照视频。视频随安装包提供，播放无需联网、下载模型或配置翻译密钥。构建时从 `site/assets` 复用素材，并使用同一个播放器保持语言切换时的播放进度。

环境和模型准备失败时，错误框右上角可复制完整错误文本。应用会将准备好的 FFmpeg 目录加入服务的 `PATH`，供 Whisper 等通过命令名调用的组件使用。

### 构建

在 macOS arm64 上安装 Node.js 22+、Xcode Command Line Tools，初始化仓库子模块，然后执行：

```sh
npm ci --registry=https://registry.npmmirror.com
npm --prefix apps/web ci --registry=https://registry.npmmirror.com
npm run typecheck
node --import tsx --test packages/builtin/test/setup.test.ts
npm run build:desktop
```

产物为 `dist/YouDub.app`。Node.js 22.23.2 官方发行包会下载到 `.cache/mac`，按官方 SHA-256 清单校验。前端由 Vite 构建到 `apps/web/dist`，桌面启动同一个 Cordis Host 提供页面、静态资源和 API。`--reuse-web` 仅用于前端源码和构建配置均未变化时复用已验证的构建。

macOS 图标源文件为 `apps/desktop/icon.svg`，采用浅粉至淡蓝的圆角渐变底板。标志宽度占画布 78%，外接框中心下移画布高度的 3.125%；构建时生成所有 ICNS 尺寸。

### 签名与公证

将 Developer ID Application 的 P12、App Store Connect API P8 与其配置保留在仓库外的私有目录。配置使用 `.env`，并以 `ln .env env.txt` 创建代理读取的硬链接。所需键：`CODESIGN_IDENTITY`、`BUILD_CERTIFICATE_FILE`、`P12_PASSWORD`、`APP_STORE_CONNECT_API_KEY_FILE`、`APP_STORE_CONNECT_KEY_ID`、`APP_STORE_CONNECT_ISSUER_ID`。

```sh
YOUDUB_APPLE_CREDENTIALS_DIR=/absolute/private/signing-directory node scripts/sign-mac.mjs /absolute/YouDub.app --sign-only
# 在 /Applications 下启动，确认工作台可用，退出后执行 codesign --verify --deep --strict。
YOUDUB_APPLE_CREDENTIALS_DIR=/absolute/private/signing-directory node scripts/sign-mac.mjs /absolute/YouDub.app --package-signed
```

脚本使用临时钥匙串保存签名私钥，并将缺失的 Apple 官方 Developer ID G2 中间证书补充到用户默认钥匙串。`--sign-only` 签名所有 Mach-O 文件和 `.app`；`--package-signed` 检查已有签名后生成带 Applications 快捷方式的 DMG，签名、公证、装订并验证。按 [Apple 的分发说明](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)，只提交最外层 DMG 公证，其内应用也在公证范围内。任一步失败立即停止，并保留 Apple 回执。最终交付文件为 `dist/YouDub-<version>-macOS-arm64.dmg` 及相邻的 SHA-256 文件。

桌面进程使用内置 Node 的模块加载器，直接加载应用内组合，避免 Cordis 在签名应用包内写入 `.cordis`。

`scripts/smoke-mac.mjs` 需要另外提供 Python 3.12 和 `backend/requirements/base.txt` 的轻量依赖，将其绝对路径设为 `YOUDUB_TEST_PYTHON`。脚本先检查包内 Host、静态资源和扩展构建，再通过原生 WKWebView 的 `--smoke-ready` 路径跳过翻译引导，打开工作台、任务库、工作流和设置弹窗。设置检查定位弹窗内的分类与表单，并验证分类切换不增加历史项、关闭后保留原页面实例；报告写入 `dist/macos-smoke.json`。该路径不准备模型、不调用翻译 API。2026-10-21 的开发修改仅做脚本静态检查，尚未执行新的原生打包验收。

## Windows x64

Windows 10 22H2 / Windows 11 使用原生 WinForms 窗口和 WebView2 Evergreen Runtime。启动 `YouDub.exe` 后自动运行内置 Node 和 Cordis Host，加载 React 客户端，不需要预装 Node。运行时缺少 WebView2 时会提供[微软安装入口](https://developer.microsoft.com/microsoft-edge/webview2/)；其分发方式遵循[官方说明](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)。启动器使用系统的 .NET Framework 4.8。

数据、Python、模型和 WebView2 缓存位于 `%LOCALAPPDATA%\YouDub`，支持用 `YOUDUB_DESKTOP_DATA_DIR` 覆盖。日志位于该数据目录的 `logs\desktop.log`，可通过窗口菜单打开。F5 / Ctrl+R 刷新。关闭窗口会先停止 Host；Windows Job Object 保证启动器崩溃时 Node 及其后代进程也退出。同一个数据目录仅允许一个桌面实例运行。

默认窗口在当前屏幕可用区域内居中，占约 90% 的宽高；小屏幕会限制到可用范围内。基础环境准备完成后，没有可用翻译供应商的用户会看到与「设置 → 模型」相同的供应商目录、自定义 API 和模型编辑器。保存配置后可继续，也可在没有未保存修改时选择“稍后配置”。目录获取不发送翻译测试；真实任务检查模型及输出参数兼容性。密钥进入系统凭据管理器，不进入应用包或公开设置响应。该配置向导同样适用于 macOS。

### 构建与本机测试

在 Windows x64 安装 Node.js 22（至少 22.13.0）、Git 和 Inno Setup 6，初始化子模块。Inno 编译器默认位于 `C:\Program Files (x86)\Inno Setup 6\ISCC.exe`；安装在其他位置时将 `YOUDUB_ISCC` 设为其绝对路径。运行本机验收还需要 Python 3.12 和轻量基础依赖：

```powershell
git submodule update --init --recursive
npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmmirror.com
npm --prefix apps/web ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmmirror.com
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install --index-url https://mirrors.aliyun.com/pypi/simple/ -r backend/requirements/base.txt
$env:YOUDUB_TEST_PYTHON = (Resolve-Path .venv\Scripts\python.exe).Path
npm run build:desktop
npm run test:windows
```

构建使用 Windows 自带的 .NET Framework C# 编译器；Node 22.23.2 下载后核对官方 SHA-256，WebView2 SDK 1.0.4191.47 使用固定 SHA-256。缓存位于 `.cache/windows`。源码和构建配置未改变时，可执行 `node scripts/build-windows.mjs --reuse-web` 复用前端产物。ZIP 内不含依赖源码目录的符号链接，不要求用户启用开发者模式。

包内同时提供 npm 和可由普通 Node 加载的 JavaScript SDK，扩展构建无需全局 Node/npm。扩展的共享模块在 Windows 使用无需管理员权限的目录 junction；Python 扩展使用应用选定的 Python 创建隔离环境。

产物为 `dist/YouDub-<version>-windows-x64-Setup.exe`、`dist/YouDub-<version>-windows-x64.zip` 和各自 `.sha256`。安装包支持安装、快捷方式和保留数据卸载；ZIP 完整解压后运行 `YouDub.exe`。两者共用同一份应用，均未进行 Authenticode 签名。许可证保存在 `LICENSE.txt`、`WEBVIEW2-LICENSE.txt` 和 `resources/NODE-LICENSE.txt`；共用 runtime 还包含 `THIRD_PARTY_NOTICES.md`，保留模型设置前端与后端所用 Harness 源码的完整 MIT 声明。依赖包各自保留 `node_modules` 中的许可证。

`test:windows` 校验 ZIP 后解压到含中文和空格的独立路径，通过真实原生启动器检查页面与图标、WebView2 首次准备页渲染、单实例锁、正常退出、强制结束后的进程清理和重启，并比较运行前后的包内文件哈希。失败用例使用明确不存在的 Python；`--smoke-ready` 用例使用 `YOUDUB_TEST_PYTHON`，完成真实基础准备后跳过翻译配置，验证工作台、任务库、工作流和设置的插件页面。`npm run test:windows -- --installer` 另验收 EXE 安装、重装和保留数据卸载。均不下载模型、不调用翻译 API，不代表视频推理或 CUDA 验收。报告和示例页截图为 `dist/windows-smoke.json`、`dist/windows-smoke.png`。2026-10-21 新增的 ready 路径仅完成脚本静态检查，本轮未运行 Windows 打包验收。

### 自动化与跨平台兼容

[Windows 工作流](../../.github/workflows/windows.yml) 被 PR / main 的 CI 和 tag 发布复用，也可单独手动触发。检查通过后上传 EXE、ZIP 和各自校验文件；发布工作流等待 Windows 验收及 macOS 签名、公证全部通过，才将两平台产物发布到同一个 Release。

macOS 保留原生 AppKit 入口与构建、签名流程。共享文件路径通过 `node:path` 拼接，再通过 `pathToFileURL` 传入 Cordis；URL 相对路径继续用 `new URL` 处理。Windows CI 和独立的 macOS CI 都运行中文、空格及 URL 特殊字符路径、环境准备和退出的回归测试。
