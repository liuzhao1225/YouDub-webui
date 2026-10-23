# 桌面版本发布

版本来自根 `package.json` 与 `package-lock.json`。先通过 PR 合入 `main`，再为该提交创建匹配的 `v<version>` tag。正式发布由 `.github/workflows/release.yml` 执行；不覆盖已发布 tag。

## 候选包

完成[源码构建](../apps/harness/docs/DEVELOPMENT.md)后，在 macOS ARM64 或 Windows x64 执行：

```sh
npm run package:desktop -- --dir
```

`prepareSourceDevelopment` 选取产品实际使用的 Harness 包，electron-builder 收集生产依赖并生成独立应用。安装包使用相同 Electron、preload、Host 和前端产物。媒体源码、Demucs 与示例作为资源随包分发，Python 和模型按首启选择准备；环境文件、用户数据与开发缓存不进入包。

在带空格的临时目录复制应用，以空 profile 启动实际 Electron，验证无外部符号链接、首启安装阶段、页面渲染、示例 Range 请求及退出：

```sh
# macOS
node apps/harness/test/package-smoke.mjs dist/mac-arm64/YouDub.app dist/package-smoke-mac
# Windows
node apps/harness/test/package-smoke.mjs dist/win-unpacked dist/package-smoke-windows
npm run package:desktop -- --installers-only
```

验证证据包含首启截图与 JSON 结果。PR 的原有必需检查同时覆盖这两种平台的候选包，任一打包或启动失败都会阻止合并。

## 正式发行

tag 工作流核对版本、提交与 main 来源，复用源码检查生成一次候选包。Windows 从已验证的 `win-unpacked` 制作 NSIS EXE 和 ZIP。macOS 将候选 App 交给受保护的 `macos-release` 环境，使用现有 Apple 证书与 API 凭据；通过 `@electron/osx-sign` 签名后重新检查首启，再制作 DMG、公证、装订票据并执行 Gatekeeper 校验。签名材料只在临时目录生成，结束时清除。

两个平台通过后发布 GitHub Release 并设为 latest。保存版本文件名，同时提供固定的 `YouDub-macOS-arm64.dmg`、`YouDub-windows-x64-Setup.exe`、`YouDub-windows-x64.zip`。上传前与下载读回后均校验 SHA-256。官网在发布成功后刷新版本列表。

安装包检查与完整模型准备、真实媒体任务验收分别记录。签名、公证、打包或启动失败时停止发布，保留原始诊断。
