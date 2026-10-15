# macOS 桌面应用

原生 AppKit 窗口内嵌 WKWebView，启动应用时自动启动内置 Node、Cordis Host 和 Next.js。无需单独安装 Node、运行终端或打开浏览器。目标为 Apple Silicon，最低 macOS 14。

Python、模型与业务数据写入 `~/Library/Application Support/YouDub`；Python 虚拟环境位于该目录的 `runtime/venv`。首次启动沿用现有环境和模型准备页面。应用包中不包含用户 `.env`、翻译密钥和苹果签名凭据。用户配置可放在数据目录下的 `.env`，已有 `YOUDUB_PYTHON` 等显式设置继续生效。

关闭最后一个窗口或按 ⌘Q 会停止本地服务。⌘R 刷新页面；“YouDub → 查看日志”打开 `~/Library/Logs/YouDub/desktop.log`。应用提供原生文件选择和下载保存窗口。

环境和模型准备失败时，错误框右上角可复制完整错误文本。应用会将准备好的 FFmpeg 目录加入服务的 `PATH`，供 Whisper 等通过命令名调用的组件使用。

## 构建

在 macOS arm64 上安装 Node.js 22+、Xcode Command Line Tools，初始化仓库子模块，然后执行：

```sh
npm ci --registry=https://registry.npmmirror.com
npm --prefix apps/web ci --registry=https://registry.npmmirror.com
npm run typecheck
node --import tsx --test packages/builtin/test/setup.test.ts
npm run build:mac
```

产物为 `dist/YouDub.app`。Node.js 22.23.2 官方发行包会下载到 `.cache/mac`，按官方 SHA-256 清单校验。桌面前端使用独立的 `.next-desktop` 构建目录。`--reuse-web` 仅用于前端源码和构建配置均未变化时复用已验证的构建。

macOS 图标源文件为 `apps/desktop/icon.svg`，采用浅粉至淡蓝的圆角渐变底板。标志宽度占画布 78%，外接框中心下移画布高度的 3.125%；构建时生成所有 ICNS 尺寸。

## 签名与公证

将 Developer ID Application 的 P12、App Store Connect API P8 与其配置保留在仓库外的私有目录。配置使用 `.env`，并以 `ln .env env.txt` 创建代理读取的硬链接。所需键：`CODESIGN_IDENTITY`、`BUILD_CERTIFICATE_FILE`、`P12_PASSWORD`、`APP_STORE_CONNECT_API_KEY_FILE`、`APP_STORE_CONNECT_KEY_ID`、`APP_STORE_CONNECT_ISSUER_ID`。

```sh
YOUDUB_APPLE_CREDENTIALS_DIR=/absolute/private/signing-directory node scripts/sign-mac.mjs /absolute/YouDub.app --sign-only
# 在 /Applications 下启动，确认工作台可用，退出后执行 codesign --verify --deep --strict。
YOUDUB_APPLE_CREDENTIALS_DIR=/absolute/private/signing-directory node scripts/sign-mac.mjs /absolute/YouDub.app --package-signed
```

脚本使用临时钥匙串保存签名私钥，并将缺失的 Apple 官方 Developer ID G2 中间证书补充到用户默认钥匙串。`--sign-only` 签名所有 Mach-O 文件和 `.app`；`--package-signed` 检查已有签名后生成带 Applications 快捷方式的 DMG，签名、公证、装订并验证。按 [Apple 的分发说明](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)，只提交最外层 DMG 公证，其内应用也在公证范围内。任一步失败立即停止，并保留 Apple 回执。最终交付文件为 `dist/YouDub-0.1.0-macOS-arm64.dmg` 及相邻的 SHA-256 文件。

桌面进程使用内置 Node 的模块加载器，避免 Cordis 在应用包内写入 `.cordis`。临时组合配置的 `node_modules` 链接指向应用内依赖，退出时随临时目录清理。
