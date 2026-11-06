# 桌面版本发布

版本来自根 `package.json` 与 `package-lock.json`。先通过 PR 合入 `main`，手动构建并验收该提交的双平台候选包，再为该提交创建匹配的 `v<version>` tag。正式发布由 `.github/workflows/release.yml` 执行；不覆盖已发布 tag。

## 候选包

完成[源码构建](../apps/harness/docs/DEVELOPMENT.md)后，在 macOS ARM64 或 Windows x64 执行：

```sh
npm run package:desktop -- --dir
```

`prepareSourceDevelopment` 选取产品实际使用的 Harness 包，electron-builder 收集生产依赖并生成独立应用。安装包使用相同 Electron、preload、Host 和前端产物。媒体源码、Demucs 与一段黄仁勋采访原视频作为资源随包分发，Python 和模型按首启选择准备；环境文件、用户数据与开发缓存不进入包。

在带空格的临时目录复制应用，以空 profile 启动实际 Electron，验证无外部符号链接、首启安装阶段、页面渲染、本地工作流示例 Range 请求及退出：

```sh
# macOS
node apps/harness/test/package-smoke.mjs dist/mac-arm64/YouDub.app dist/package-smoke-mac
# Windows
node apps/harness/test/package-smoke.mjs dist/win-unpacked dist/package-smoke-windows
npm run package:desktop -- --installers-only
```

验证证据包含首启截图与 JSON 结果。手动运行「YouDub Desktop 源码开发检查」并启用 `package_desktop` 后，双平台检查同时验证候选包；任一打包或启动失败都会阻止该次检查通过。macOS 开发候选提供 ad-hoc 签名 App 压缩包，正式签名与公证 DMG、自动更新 ZIP 由发行流程生成。

## 检查范围

PR 与 main 的 push 不自动构建。合并前将 PR 从 Draft 手动标记为 Ready for review，触发双平台源码必需检查；已是 Ready 的 PR 先转回 Draft，再标记 Ready。该入口不打包。GitHub [不将 workflow_dispatch 的结果计入 PR 必需检查](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks#checks-from-some-workflow-jobs-are-not-evaluated)。

独立验证与打包使用手动工作流入口。启用打包时增加真实安装包首启、Python worker 和 Windows 安装/卸载验证，包括已发布 v0.0.9 EXE 安装后由候选包覆盖的检查。旧安装器下载后校验固定 SHA-256，不启动旧应用。

源码检查验证保留的桌面、UI、Host 与业务合同；不执行上游发布、文档、全仓规则或每文件 100% 覆盖率门禁。tag 的来源须已合入 main；发行阶段复用 main 已验收的同提交候选包。

Electron 语言资源仅保留产品支持的中、英、日；第三方 SDK 的源码与测试不进入运行包。官网演示播放器及其余示例媒体留在 GitHub Pages。macOS 镜像使用与 Harness 相同的 HFS+ / ULMO（LZMA），避免默认 APFS / zlib 造成的压缩开销。

## 正式发行

tag 工作流核对版本、提交与 main 来源，等待同一 SHA 的 main 手动检查成功，并核对 `youdub-macos-unsigned` 和 `youdub-windows-release` 两个未过期产物，再按运行 ID 下载候选包。候选构建命令为 `gh workflow run harness-development.yml --ref main -F package_desktop=true`；运行完成后核对提交 SHA，再推送该提交的 tag。缺少该运行、验收失败、未启用打包或产物已过期时停止发布。Windows 从已验证的 `win-unpacked` 制作 ZIP，并复用原 Inno Setup 脚本和 AppId 制作 EXE。macOS 将候选 App 交给受保护的 `macos-release` 环境，使用现有 Apple 证书与 API 凭据；通过 `@electron/osx-sign` 签名后重新检查首启，再制作 DMG、公证、装订票据并执行 Gatekeeper 校验。签名材料只在临时目录生成，结束时清除。

两个平台通过后创建 GitHub 草稿 Release。保存版本文件名，同时提供固定的 `YouDub-macOS-arm64.dmg`、`YouDub-windows-x64-Setup.exe`、`YouDub-windows-x64.zip`。上传前与下载读回后均校验 SHA-256，成功后公开 Release 并设为 latest。官网在发布成功后刷新与客户端共用的版本列表，并回读确认部署内容。

Windows 手动覆盖安装前须退出 YouDub。应用内更新先完成任务检查和 Host 退出，再启动原 Inno Setup 安装器；安装器等待旧应用 PID 退出后覆盖文件，成功后以原用户数据目录重启应用。安装器保持现有 AppId 和卸载注册，不使用 Restart Manager；文件占用、等待退出和安装失败由安装器直接显示，并写入应用 logs 目录的 update-install.log。覆盖安装清理旧应用代码并保留独立数据目录。ZIP 便携版需先安装 Setup 版才能使用自动安装。

## 应用内自动更新

桌面包内的 `app-update.yml` 指向 GitHub Release 的 latest/download 更新源。每个正式版本必须同时包含 `latest-mac.yml`、`latest.yml` 和它们的 SHA-256 文件。元数据固定引用该版本的不可变资产 URL，并记录 SHA-512 与文件大小；生成和发布读回均由 [desktop-update-feed.mjs](../scripts/desktop-update-feed.mjs) 校验。

- macOS：在原有签名、公证与 Gatekeeper 检查后，将已装订公证票据的 YouDub.app 打为 `YouDub-<version>-macOS-arm64.zip`，由 Squirrel.Mac 安装；DMG 继续提供给手动安装。
- Windows：`latest.yml` 引用现有 `YouDub-<version>-windows-x64-Setup.exe`。复用 electron-updater 的完整下载、缓存与 SHA-512 校验，Inno 适配器负责安装交接，保持旧版升级身份。
- 所有更新资产与元数据先上传到草稿 Release，下载读回并核对后一起公开。未完成签名、公证或任一平台校验时不公开该版本；候选构建不会发布或修改线上更新源。

客户端复用 dsh 的更新协调器、HTTP 传输和周期检查，发现新版本即后台下载并校验，显示进度。完成后在可见窗口提示“重启更新”，隐藏窗口在下次显示时提示。选择稍后会保留更新包；普通退出不会安装。下载失败保留原始错误，由用户点击重试，不自动重下。

安装前使用 dsh 的 Host admission lock 拒绝新请求、等待已接收请求结束，再通过现有 desktop/active-tasks 检查任务和 Jobs。排队、运行、等待、取消中、仍可能在远端运行的工作以及首启环境准备都会阻止更新；任务状态未知也会阻止。持久化的人工审核暂停可在重启后继续。未保存编辑仍经过现有 beforeunload 确认。Host 未正常结束时停止安装并报告错误。

本次首次引入 updater 的版本仍需旧客户端手动安装一次；安装后才能使用后续版本的后台更新。当前版本号与发布 tag 无需因源码变更而提前修改。

验证入口：源码工作流双平台执行真实 Electron 下载校验、缓存和任务锁测试。Windows 候选包额外验证等待旧 PID、自动覆盖与启动新进程，保留安装日志；原有 v0.0.9 覆盖升级、数据保留与卸载验收继续执行。macOS 候选验证实际安装包首启，正式签名后的 ZIP 由发布流程校验。

安装包检查与完整模型准备、真实媒体任务验收分别记录。签名、公证、打包或启动失败时停止发布，保留原始诊断。

## 从已有 tag 继续发布

发布工作流修正后，可以从 main 对尚未发布的现有 tag 发起运行：

```sh
gh workflow run release.yml --ref main -f tag=v0.0.9
```

工作流仍检出该 tag 的代码、核对版本和 main 来源，并复用该提交的已验收候选包；不会移动 tag 或改用当前 main 的应用包。已公开版本不覆盖。

`macos-release` 环境允许 `v*` tag 与受保护的 `main` 分支。手动入口仅接受 main；签名材料准备和签名命令均使用前置步骤已验证的 tag 与提交上下文。

GitHub 托管 macOS runner 的 HTTP/3 连接可能在下载公证票据时中断，表现为公证已 Accepted，随后 stapler 返回 Error 68 / NSURLErrorDomain -1005。发布 runner 按 [GitHub 官方已复现的问题及处理方法](https://github.com/actions/runner-images/issues/14924#issuecomment-6188826956) 限制 UDP 443，让请求使用 TCP HTTPS；该规则仅作用于临时 runner，签名、公证、票据验证和 Gatekeeper 检查均保留。失败时保存 DMG 与公证报告为 `macos-notary-failure`，不公开失败产物。
