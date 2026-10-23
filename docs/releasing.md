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

## 检查范围

每次 PR 与 main 提交保留双平台构建、桌面核心行为、产品运行依赖、YouDub 业务与界面测试，以及真实安装包首启、Python worker 和 Windows 安装/卸载验证。

源码检查验证保留的桌面、UI、Host 与业务合同；不执行上游发布、文档、全仓规则或每文件 100% 覆盖率门禁。tag 的来源须已合入 main；发行阶段复用 main 已验收的同提交候选包。

## 正式发行

tag 工作流核对版本、提交与 main 来源，等待同一 SHA 的 main 检查成功，再按运行 ID 下载候选包。缺少该运行、验收失败或产物已过期时停止发布。Windows 从已验证的 `win-unpacked` 制作 ZIP，并复用原 Inno Setup 脚本和 AppId 制作 EXE。macOS 将候选 App 交给受保护的 `macos-release` 环境，使用现有 Apple 证书与 API 凭据；通过 `@electron/osx-sign` 签名后重新检查首启，再制作 DMG、公证、装订票据并执行 Gatekeeper 校验。签名材料只在临时目录生成，结束时清除。

两个平台通过后创建 GitHub 草稿 Release。保存版本文件名，同时提供固定的 `YouDub-macOS-arm64.dmg`、`YouDub-windows-x64-Setup.exe`、`YouDub-windows-x64.zip`。上传前与下载读回后均校验 SHA-256，成功后公开 Release 并设为 latest。官网在发布成功后刷新与客户端共用的版本列表，并回读确认部署内容。

安装包检查与完整模型准备、真实媒体任务验收分别记录。签名、公证、打包或启动失败时停止发布，保留原始诊断。
