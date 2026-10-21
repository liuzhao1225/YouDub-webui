# YouDub 使用的 Harness 源码

`source/` 是 YouDub 维护的活动 fork，来源为 `deepseek-ai/deepseek-harness` 公开 tag `dsh-v0.2.1-rc.2`（commit `687f282e8625c6b8d11ff58211a90524be2e4317`）。`source-manifest.json` 固定记录最初复制的文件；`fork.json` 单独记录活动源码相对原件的精确差异与原因。许可证保存在 `source/LICENSE`，第三方声明保存在 `source/THIRD_PARTY_NOTICES.md`。

## 包含范围

原始选入范围共 362 个源码包、9,817 个文件，包含完整 apps、packages、vendor 以及根构建支持、scripts、native/system、python 和 patches。保持上游目录结构与成熟实现。当前范围由活动源码和差异账本共同决定，裁剪须同步处理依赖、生成工具与测试。

完整公开 tag 另有 Git bundle 与 tar.gz 基线，路径和哈希见 `apps/harness/baselines/sources.json`。从仓库根运行 `npm run build:framework`；安装与编译在 `.cache/harness/source-build` 中进行，不向活动源码写入依赖和产物。

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

## 原件与活动 fork

2026-10-22 起允许按 [改造计划](../../apps/harness/docs/YOUDUB-DESKTOP-REFACTOR-PLAN.md) 修改活动源码。优先复用现有服务和组件，修改对应明确产品需求。原始归档和 `source-manifest.json` 保持不变；不能通过重写原件哈希接受修改。

```sh
node apps/harness/baselines/framework-source.mjs
node apps/harness/baselines/verify.mjs --scope vendor
node apps/harness/baselines/vendor.mjs --verify-archive
```

活动源码检查要求每个新增、删除、字节、执行位或链接变化与 `fork.json` 完全一致，并附上原因。归档检查校验保存的 tar.gz，再恢复到临时目录逐项验证原始选入文件。两者分别报告。`vendor.mjs --verify` 仍可检查活动目录是否与原件完全相同，发生合法 fork 改动后此项预期失败；产品构建使用活动 fork 检查。

改造前产品标签为 `youdub-desktop-refactor-base-20261022`，提交 `4b9dc0a7168135f191dd4050a6d1d9a32d9e14b9`。恢复到单独目录，不覆盖活动 fork。初次复制/补齐命令在存在 `fork.json` 时拒绝执行。

YouDub 的全局 `.gitignore` 会忽略部分上游 fixture 和资源路径。新增此类文件时精确使用 `git add -f <文件>`，检查提交输入与 fork 账本一致。

## 来源差异

保存的已安装官方 Desktop `0.2.1-rc.2` 内嵌构建 commit 是 `332895e0f7c9d4dbfb29729f5eb367fa263ff986`。该 commit 无法从官方远程获取，与公开 tag 不同。本目录只声明来自上述公开 tag，不声明能够逐字节重建已安装 Desktop。

`@deepseek-ai/libreoffice-kit` 和 `@deepseek-ai/libreoffice-kit-darwin-arm64` 在已保存发布依赖中，但不在该 Harness 公开仓库。清单将它们明确列为外部发布包，保留原始 tarball 来源、SRI 和 SHA-256；不将发布二进制描述为源码。所有 npm 原包的独立基线仍由 `apps/harness/baselines/npm-packages.json` 校验。
