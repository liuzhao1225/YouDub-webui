# YouDub 桌面应用

## macOS

原生 AppKit 窗口内嵌 WKWebView，启动应用时自动启动内置 Node、Cordis Host 和 Next.js。无需单独安装 Node、运行终端或打开浏览器。目标为 Apple Silicon，最低 macOS 14。

Python、模型与业务数据写入 `~/Library/Application Support/YouDub`；Python 虚拟环境位于该目录的 `runtime/venv`。首次启动沿用现有环境和模型准备页面。应用包中不包含用户 `.env`、翻译密钥和苹果签名凭据。用户配置可放在数据目录下的 `.env`，已有 `YOUDUB_PYTHON` 等显式设置继续生效。

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

产物为 `dist/YouDub.app`。Node.js 22.23.2 官方发行包会下载到 `.cache/mac`，按官方 SHA-256 清单校验。桌面前端使用独立的 `.next-desktop` 构建目录。`--reuse-web` 仅用于前端源码和构建配置均未变化时复用已验证的构建。

macOS 图标源文件为 `apps/desktop/icon.svg`，采用浅粉至淡蓝的圆角渐变底板。标志宽度占画布 78%，外接框中心下移画布高度的 3.125%；构建时生成所有 ICNS 尺寸。

### 签名与公证

将 Developer ID Application 的 P12、App Store Connect API P8 与其配置保留在仓库外的私有目录。配置使用 `.env`，并以 `ln .env env.txt` 创建代理读取的硬链接。所需键：`CODESIGN_IDENTITY`、`BUILD_CERTIFICATE_FILE`、`P12_PASSWORD`、`APP_STORE_CONNECT_API_KEY_FILE`、`APP_STORE_CONNECT_KEY_ID`、`APP_STORE_CONNECT_ISSUER_ID`。

```sh
YOUDUB_APPLE_CREDENTIALS_DIR=/absolute/private/signing-directory node scripts/sign-mac.mjs /absolute/YouDub.app --sign-only
# 在 /Applications 下启动，确认工作台可用，退出后执行 codesign --verify --deep --strict。
YOUDUB_APPLE_CREDENTIALS_DIR=/absolute/private/signing-directory node scripts/sign-mac.mjs /absolute/YouDub.app --package-signed
```

脚本使用临时钥匙串保存签名私钥，并将缺失的 Apple 官方 Developer ID G2 中间证书补充到用户默认钥匙串。`--sign-only` 签名所有 Mach-O 文件和 `.app`；`--package-signed` 检查已有签名后生成带 Applications 快捷方式的 DMG，签名、公证、装订并验证。按 [Apple 的分发说明](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)，只提交最外层 DMG 公证，其内应用也在公证范围内。任一步失败立即停止，并保留 Apple 回执。最终交付文件为 `dist/YouDub-<version>-macOS-arm64.dmg` 及相邻的 SHA-256 文件。

桌面进程使用内置 Node 的模块加载器，避免 Cordis 在应用包内写入 `.cordis`。临时组合配置的 `node_modules` 链接指向应用内依赖，退出时随临时目录清理。

## Windows x64

Windows 10 22H2 / Windows 11 使用原生 WinForms 窗口和 WebView2 Evergreen Runtime。启动 `YouDub.exe` 后自动运行内置 Node、Cordis Host 和 Next.js，不需要预装 Node。运行时缺少 WebView2 时会提供[微软安装入口](https://developer.microsoft.com/microsoft-edge/webview2/)；其分发方式遵循[官方说明](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)。启动器使用系统的 .NET Framework 4.8。

数据、Python、模型和 WebView2 缓存位于 `%LOCALAPPDATA%\YouDub`，支持用 `YOUDUB_DESKTOP_DATA_DIR` 覆盖。日志位于该数据目录的 `logs\desktop.log`，可通过窗口菜单打开。F5 / Ctrl+R 刷新。关闭窗口会先停止 Host；Windows Job Object 保证启动器崩溃时 Node 及其后代进程也退出。同一个数据目录仅允许一个桌面实例运行。

默认窗口在当前屏幕可用区域内居中，占约 90% 的宽高；小屏幕会限制到可用范围内。环境与模型准备完成后，没有翻译配置的用户会看到接口地址、模型名称和密钥表单。点击“测试连接并继续”会发送一条简短测试请求，通过后才保存；密钥进入系统凭据管理器，不进入应用包或设置响应。也可选择“稍后配置”，之后在设置中填写。该配置向导同样适用于 macOS。

### 构建与本机测试

在 Windows x64 安装 Node.js 22（至少 22.13.0）和 Git，初始化子模块，然后运行：

```powershell
git submodule update --init --recursive
npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmmirror.com
npm --prefix apps/web ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmmirror.com
npm run build:desktop
npm run test:windows
```

构建使用 Windows 自带的 .NET Framework C# 编译器；Node 22.23.2 下载后核对官方 SHA-256，WebView2 SDK 1.0.4191.47 使用固定 SHA-256。缓存位于 `.cache/windows`。源码和构建配置未改变时，可执行 `node scripts/build-windows.mjs --reuse-web` 复用前端产物。ZIP 内不含依赖源码目录的符号链接，不要求用户启用开发者模式。

包内同时提供 npm 和可由普通 Node 加载的 JavaScript SDK，扩展构建无需全局 Node/npm。扩展的共享模块在 Windows 使用无需管理员权限的目录 junction；Python 扩展使用应用选定的 Python 创建隔离环境。

产物为 `dist/YouDub-<version>-windows-x64.zip` 和对应 `.sha256`，完整解压后运行其中的 `YouDub.exe`。当前是未进行 Authenticode 签名的便携包。应用包含的许可证分别保存在 `LICENSE.txt`、`WEBVIEW2-LICENSE.txt` 和 `resources/NODE-LICENSE.txt`。

`test:windows` 校验 ZIP 后解压到含中文和空格的独立路径，通过真实原生启动器检查页面与图标、WebView2 首次准备页渲染、单实例锁、正常退出、强制结束后的进程清理和重启，并比较运行前后的包内文件哈希。使用隔离数据目录和明确不存在的 `YOUDUB_PYTHON` 验证准备错误页，不下载模型；不代表模型安装、视频推理或 CUDA 已验收。报告和页面截图为 `dist/windows-smoke.json`、`dist/windows-smoke.png`。

### 自动化与跨平台兼容

[Windows 工作流](../../.github/workflows/windows.yml) 被 PR / main 的 CI 和 tag 发布复用，也可单独手动触发。检查通过后上传 ZIP 和校验文件；发布工作流等待 Windows 验收及 macOS 签名、公证全部通过，才将两平台产物发布到同一个 Release。

macOS 保留原生 AppKit 入口与构建、签名流程。共享文件路径通过 `node:path` 拼接，再通过 `pathToFileURL` 传入 Cordis；URL 相对路径继续用 `new URL` 处理。Windows CI 和独立的 macOS CI 都运行中文、空格及 URL 特殊字符路径、环境准备和退出的回归测试。
