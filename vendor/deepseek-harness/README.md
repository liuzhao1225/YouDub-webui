# Harness 原样源码

`source/` 是 `deepseek-ai/deepseek-harness` 公开 tag `dsh-v0.2.1-rc.2`（commit `687f282e8625c6b8d11ff58211a90524be2e4317`）的原样文件副本。文件内容、可执行位和符号链接目标均保留；`source-manifest.json` 记录逐项 SHA-256。许可证保存在 `source/LICENSE`，第三方声明保存在 `source/THIRD_PARTY_NOTICES.md`，各包的许可证和声明也随包原样保留。

## 包含范围

复制当前 Harness 安装依赖对应的源码包及其 dependencies / optionalDependencies / peerDependencies / devDependencies 闭包，加入 Desktop、Desktop Host、Web 入口和 Desktop 直接使用的官方开发依赖。共 331 个源码包、8,951 个文件，约 70 MiB。保持上游目录结构，包含每个所选包的源码、资源、原始构建配置和测试。另保留根构建配置、锁文件、scripts、native/system、python 和 patches，以供外围构建读取。

这是一份明确选取的源码子树。官方根 workspace 还列有未使用的开发工具、网站、基准测试等包；在此目录执行完整上游 `pnpm install` / `build` 不是 YouDub 的构建方式。完整公开 tag 另有 Git bundle 与 tar.gz 基线，路径和哈希见 `apps/harness/baselines/sources.json`。

| 用途 | 原始入口 |
| --- | --- |
| Electron 产品参考入口 | `source/apps/desktop/src/main.ts`；YouDub 从同目录 helper 组合自身入口 |
| Electron preload | `source/apps/desktop/src/preload-app.ts` 及同目录其他 `preload-*.ts` |
| Electron Host 子进程 | `source/apps/desktop-host/src/index.ts` |
| 官方 Desktop 构建配置 | `source/apps/desktop/tsdown.config.ts` |
| 官方 Web 应用入口与 Vite 配置 | `source/apps/web/` |
| Web 客户端启动、插件装载 | `source/packages/client/web/`、`source/packages/client/modules/` |
| UI primitives / layout / theme / slots / store | `source/packages/client/ui-primitives/`、`ui-layout/`、`ui-theme/`、`ui-slots/`、`store/` |
| Cordis 与官方服务 | `source/vendor/`、`source/packages/`；具体包路径见清单 |

## 不可变边界

所有 YouDub 品牌、插件装配、构建入口和运行路径配置均置于 `source/` 以外。构建产物、`node_modules` 和缓存也不能写入 `source/`。需要官方服务时复用对应原始入口，不复制改写服务实现。上游升级须另取版本、重新生成清单并独立审查。

```sh
node apps/harness/baselines/vendor.mjs --verify
node apps/harness/baselines/verify.mjs --scope vendor
```

检查发现新增、删除、字节变化、执行位变化或链接变化立即失败，不会自动修复。初次重新复制时可运行 `vendor.mjs --copy`；它校验保存的官方源码归档哈希，且拒绝覆盖任何现有 `source/`。

YouDub 的全局 `.gitignore` 会忽略部分上游已跟踪的 fixture 和资源路径。提交这份原样源码时必须完整加入 `source-manifest.json` 中的文件，可使用 `git add -f vendor/deepseek-harness/source`；不能通过删除这些文件使普通 `git add` 通过。

## 来源差异

保存的已安装官方 Desktop `0.2.1-rc.2` 内嵌构建 commit 是 `332895e0f7c9d4dbfb29729f5eb367fa263ff986`。该 commit 无法从官方远程获取，与公开 tag 不同。本目录只声明来自上述公开 tag，不声明能够逐字节重建已安装 Desktop。

`@deepseek-ai/libreoffice-kit` 和 `@deepseek-ai/libreoffice-kit-darwin-arm64` 在已保存发布依赖中，但不在该 Harness 公开仓库。清单将它们明确列为外部发布包，保留原始 tarball 来源、SRI 和 SHA-256；不将发布二进制描述为源码。所有 npm 原包的独立基线仍由 `apps/harness/baselines/npm-packages.json` 校验。
