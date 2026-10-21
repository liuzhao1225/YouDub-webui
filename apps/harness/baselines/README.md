# Harness 与 YouDub 初始基线

本目录保存固定来源清单、逐文件树摘要和只读检查工具。大体积原始文件保存在 `/Users/liuzhao/code/youdub-harness-baselines/20261021`，不进入融合代码。`sources.json` 是版本与归档哈希的依据；`npm-packages.json` 记录发布包的锁定完整性值、原始 tarball 哈希及文件树摘要。

## 保存的初始状态

| 来源 | 固定版本 | 保存方式 |
| --- | --- | --- |
| 原 Harness 源码仓库 | `dsh-v0.1.0-rc.7` / `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca` | 独立 Git bundle 与源码 tar.gz；原 `/Users/liuzhao/code/deepseek-harness` 保持原提交、无源码改动 |
| 官方公开发布源码 | `dsh-v0.2.1-rc.2` / `687f282e8625c6b8d11ff58211a90524be2e4317` | 独立 Git bundle 与源码 tar.gz，来源 `https://github.com/deepseek-ai/deepseek-harness.git` |
| 官方 macOS Desktop | `0.2.1-rc.2`，内嵌构建提交 `332895e0f7c9d4dbfb29729f5eb367fa263ff986`，`dirty=false` | 完整 `.app` 副本；6,438 个文件/符号链接逐项摘要，包含 app.asar、原生二进制及 runtime |
| 官方 npm 安装内容 | 锁文件固定的 360 个实际安装 `@deepseek-ai/*` 包 | 每个原始 tarball 经过 lock SRI 校验，再解包与安装内容逐文件比较；7 个其他平台 optional 包未安装 |
| YouDub 指定分支初始状态 | `codex/harness-frontend` 原 HEAD `5c2fdf08ead4d0fd8d1c5ec7e13ea6d2e14a987f`，含未提交代码的快照 `f6f927903581b165f2bf6c840ea65b896d319524` | `youdub-initial.bundle`、原工作区 diff/status、`initial-state.json` |
| 已验证的 Harness POC | `4967caf782e96bfdf9d586406ef45733f6775323` | 同一 YouDub bundle 中的独立 tag |

Desktop 的构建提交与公开发布 tag 不同。官方远程对内嵌提交返回 `not our ref`，该精确构建源码无法取得。保存的公开 tag 源码不能被描述成当前二进制的已验证可重建来源；当前可验证的是公开源码归档完整性，以及安装包与原包逐字节一致。

YouDub 生成产物 `output/` 留在源工作区；环境、模型、凭据等 Git ignored 运行资源没有写入 bundle。源代码完整恢复使用固定快照，运行资源按 Harness profile 单独配置。

## 检查

在仓库根目录使用 Node.js 22 或 24：

```sh
node apps/harness/baselines/verify.mjs --report /tmp/youdub-harness-integrity.json
node apps/harness/baselines/inventory.mjs
node apps/harness/baselines/vendor.mjs --verify
node apps/harness/baselines/desktop-build.mjs --verify
```

完整性检查默认验证融合工作区 `apps/harness/node_modules`、原安装的 `/Applications/DeepSeek Harness.app`、原 Harness 源码仓库、原样复制的 `vendor/deepseek-harness/source`、独立 Electron 构建来源记录，以及外部基线归档。缺失文件、修改后的文件、锁版本变化、增加的未审查官方包都会返回非零退出码。`--scope sources|desktop|npm|vendor|build` 可单独复查一类；输出会明确记录检查范围。路径可以使用 `--baseline-root`、`--npm-root`、`--app`、`--original-source` 指定，调整路径不会调整预期哈希。

原样源码副本与原始归档独立保存。源码副本包含当前依赖闭包、Desktop/Web/Host 入口及其构建支持文件；逐文件清单和来源说明位于 `vendor/deepseek-harness/`。YouDub 的外围构建和插件代码不属于上游副本，不能写入其 `source/` 子树。

每次完成产品构建后运行 `desktop-build.mjs --record`，生成 `dist/desktop/source-provenance.json`。记录核对产品与官方源码输入、原样复制的 native 片段和资源、官方完整构建的两个 preload、CLI/Host/Web 来源，以及全部 362 个官方包的真实开发路径。后续 `--verify` 检查输入与产物是否变化；不能用重新记录掩盖手工改写。

框架构建在 `.cache/harness/source-build` 的原样副本中运行官方 `scripts/build.ts --scope artifacts`。官方构建收据验证 325 个客户端产物；vendor 与 staging 中的 9,817 个原始文件逐项与固定归档校验。当前官方服务和客户端插件均来自这次完整源码构建，npm 原件保留作独立来源基线。

当前产品入口是 `src/desktop-main.mjs` → `src/desktop-product.ts`。它组合官方 Host、ProjectManager、BackendController、协议转发、目录选择、快捷键、主题、退出确认和错误报告。上游未导出的原生窗口和 Windows 菜单片段逐字复制到产品组合文件，并由来源检查核对。YouDub 通过产品 locale 注入名称，通过插件挂载原首启和业务界面。

开发启动顺序为：

```sh
npm run build:framework
npm run build:youdub
node apps/harness/desktop.mjs --prepare-only
node apps/harness/baselines/desktop-build.mjs --record
npm start
```

首次准备前需按主 README 放置官方 `primary-runtime` 与 `office-skills` payload。`npm start` 直接运行仓库 Electron 与源码开发入口；不生成 App 或安装包。默认 `DSH_HOME` 为 `.cache/harness/desktop`，Python、模型、缓存与任务留在该应用目录中；显式设置后可以验证另一份独立首启。当前开发运行依赖本工作区及源码构建结果，无需启动已安装的 Harness。产品版本读取根 `package.json`，框架版本单独记录。

当前开发壳尚未配置 YouDub 更新源，更新操作明确显示该限制。真实交互、首次安装和任务验收见 `../docs/validation.md`，构建来源验证不替代功能验收。

Desktop 与 npm 文件树摘要包含相对路径、文件字节 SHA-256、大小、可执行位和符号链接目标；不包含文件时间、扩展属性或目录权限。npm 包内另行安装的 `node_modules` 不属于发布 tarball，按锁文件中的独立包校验。检查工具只读被检查对象；失败不会重装、修复或重写基线。

初次全量验证报告保存在外部基线的 `initial-integrity-check.json`，其中 npm 检查对象为已完整安装的 POC 工作区。融合版本必须另行运行默认检查，不能引用初次报告代替最终验收。

## 恢复

恢复始终写入新的目录。以下命令不会覆盖原工作区：

```sh
git clone --branch codex/youdub-harness-source-baseline-20261021 /Users/liuzhao/code/youdub-harness-baselines/20261021/youdub-initial.bundle /tmp/youdub-initial-restored
git -C /tmp/youdub-initial-restored rev-parse HEAD

git clone --branch dsh-v0.2.1-rc.2 /Users/liuzhao/code/youdub-harness-baselines/20261021/harness-source-0.2.1-rc.2.bundle /tmp/harness-source-restored
```

YouDub 恢复后的 HEAD 应为 `f6f927903581b165f2bf6c840ea65b896d319524`。官方源码恢复后的 HEAD 应为 `687f282e8625c6b8d11ff58211a90524be2e4317`。也可直接解开对应源码 tar.gz 阅读。保持归档原文件，恢复副本仅供对照。

## 功能覆盖清单

`youdub-source-inventory.json` 从保存的 YouDub commit 提取 58 个 HTTP 路由、11 个媒体 operation、11 个 Python operation handler、9 个页面路由、2 个工作流模板及 50 个前端组件文件。每项有原始文件与行号；动态 route 的 action 列表会展开。清单由 `inventory.mjs` 固定读取原始 commit，默认只校验；只有显式 `--write` 才重写清单。

该清单提供功能和元素的拆解起点。清单存在、目标模块存在和 API 返回 200 都不足以证明功能覆盖。融合验收须为每个原始功能注明 Harness 官方服务或 YouDub 插件的对应位置，并保存实际交互、状态持久化、失败行为及产物检查证据。由官方服务替换的账户、配置、更新等流程应注明对应的官方实现；媒体预览、字幕编辑等业务元素仍需实际 UI 验收。
