# 从 main 发布版本

GitHub Actions 执行 CI/CD，具体流程保存在 [release.yml](../.github/workflows/release.yml)。合并到 `main` 只运行检查；推送版本 tag 才发布。

## 发布步骤

1. 从 `main` 创建短期开发分支。修改根目录 `package.json` 的 `version`，同步根目录 `package-lock.json` 的版本，通过 PR 合入 `main`。
2. 核对 CI、升级说明与本版本真实视频验收。切换到 `main` 并更新到要发布的提交。
3. 为该提交创建并推送不可变 tag。例如：

```sh
git switch main
git pull --ff-only
git tag -a v0.0.1 -m 'YouDub v0.0.1'
git push origin v0.0.1
```

工作流检查 tag 与应用版本相同、提交属于 `main`，重新执行质量检查。质量检查复用 [windows.yml](../.github/workflows/windows.yml) 构建 Windows x64 ZIP、解压后启动原生程序并检查 WebView2 页面、单实例锁及退出清理，上传 `windows-release`；同时在 macOS runner 检查共享入口和路径兼容性。随后构建 macOS arm64 应用、签名、启动服务访问页面及图标并复查签名、公证、验证 Gatekeeper。所有门禁通过后，在同一 Release 发布 DMG、Windows ZIP 和各自的 SHA-256 文件。Windows 使用同一次运行中已经验收的 ZIP，不在发布阶段重新构建。应用版本、构建元数据和安装包名称均由根目录版本生成。现有 Release 不会被静默覆盖。

Windows 便携包尚未进行 Authenticode 签名，不使用 Apple secrets。WebView2 Runtime 缺失时，Windows CI 从微软下载引导程序、核验 Microsoft Authenticode 签名后安装。PR、main 和手动触发的构建只保存 Actions artifacts，不创建 Release。Windows 本机命令、产物和验收边界见[桌面构建说明](../apps/desktop/README.md#windows-x64)。

发布失败时查看对应 job 的原始错误。未修改源码的基础设施故障可重新运行失败 job；需要修改源码时应发布新版本和新 tag，不移动已发布 tag。

## 签名材料保护

私钥和密码只保存在仓库的 `macos-release` Environment secrets，环境仅允许 `v*` tag 使用。仓库 tag 规则仅允许管理员创建 `v*`，并禁止更改或删除版本 tag。fork、PR 和普通分支构建无法取得这些环境密钥。

| Secret | 内容 |
| --- | --- |
| `APPLE_CERTIFICATE_BASE64` | 带私钥的 Developer ID Application P12，Base64 编码 |
| `P12_PASSWORD` | P12 密码 |
| `CODESIGN_IDENTITY` | Developer ID Application 身份 |
| `APPLE_API_KEY_BASE64` | App Store Connect 公证 P8，Base64 编码 |
| `APP_STORE_CONNECT_KEY_ID` | 公证密钥 ID |
| `APP_STORE_CONNECT_ISSUER_ID` | 公证签发者 ID |

无密钥构建、签名和发布使用独立的 GitHub 托管临时 runner。依赖安装不带签名 secrets；只有签名步骤取得 secrets，并将其写入权限为 0700/0600 的临时目录。P12 导入临时 keychain，结束后删除 keychain 和临时文件。发布 job 仅取得安装包及仓库发布权限，不能取得 Apple 私钥。第三方 Actions 固定完整 commit SHA。

密钥不会进入源码、DMG、日志或上传的 artifacts。仓库管理员仍能更改工作流和环境规则，因此应限制管理员和写入权限，保持 `main` 的 PR 与 CI 保护。新增协作者时重新审查发布权限。相关机制见 [GitHub 环境保护文档](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)。
