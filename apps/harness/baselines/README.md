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
node apps/harness/baselines/vendor.mjs --verify-archive
node apps/harness/baselines/framework-source.mjs
node apps/harness/baselines/desktop-build.mjs --verify
```

完整检查验证保存的 npm 原包、原 Desktop、原 Harness 仓库、YouDub 快照、外部归档及当前 fork 的构建来源。它依赖本机保存的历史资料，不作为新开发者启动条件。`--scope sources|desktop|npm|vendor|build` 可单独复查一类；其中 `vendor` 使用活动 fork 规则。路径可用 `--baseline-root`、`--npm-root`、`--app`、`--original-source` 指定，调整路径不改变预期哈希。

`vendor/deepseek-harness/source` 自 2026-10-22 起作为活动 fork；原始归档与 `source-manifest.json` 继续保持不变。`fork.json` 固定原始清单哈希，记录每项变化的原件、当前文件摘要和原因。活动检查拒绝未登记或与登记内容不同的变化。`vendor.mjs --verify-archive` 在临时目录恢复原始归档核验；`--verify` 保留严格原样对照语义。

每次完成产品构建后运行 `desktop-build.mjs --record`，生成 `dist/desktop/source-provenance.json`。记录区分原样上游输入、已登记 fork 输入、YouDub 产品输入和发布依赖；核对 native 复制块、资源、实际使用的 `preload-app`、CLI/Host/Web 来源和活动包路径。后续 `--verify` 检查输入与产物是否变化；重新记录前仍须通过 fork 校验。

框架构建在 `.cache/harness/source-build` 中复用 `scripts/build.ts --scope artifacts`。`youdub-source-inputs.json` 记录实际输入，`youdub-source-build.json` 记录 fork 树哈希、产品提交及 dirty 状态、改动清单和客户端构建收据。`--verify-only` 只检查，不重写收据。可用 `--stage <全新目录>` 验证独立构建；源码删除后会同步删除旧 staging 输入，最终裁剪仍须全新目录构建。原件 npm 包继续独立保存。

当前产品入口是 `src/desktop-main.mjs` → `src/desktop-product.ts`。它组合官方 Host、ProjectManager、BackendController、协议转发、目录选择、快捷键、主题、退出确认和错误报告。上游未导出的原生窗口和 Windows 菜单片段逐字复制到产品组合文件，并由来源检查核对。YouDub 通过产品 locale 注入名称，通过插件挂载原首启和业务界面。

开发启动顺序为：

```sh
npm run build:framework
npm run build:youdub
node apps/harness/desktop.mjs --prepare-only
node apps/harness/baselines/desktop-build.mjs --record
npm start
```

`npm start` 直接运行仓库 Electron 与源码开发入口，Node 模式和锁定的 pnpm 承载 Host 与包管理；无需原 Harness 的 `primary-runtime` 或 `office-skills` 副本，不生成 App 或安装包。默认 `DSH_HOME` 为 `.cache/harness/desktop`，Python、模型、缓存与任务留在该应用目录中；显式设置后可以验证另一份独立首启。当前开发运行依赖本工作区及源码构建结果。产品版本读取根 `package.json`，框架版本单独记录。

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
