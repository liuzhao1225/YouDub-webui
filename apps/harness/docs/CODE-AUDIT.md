# YouDub Desktop 代码复核

更新：2026-10-23。当前记录包含第 25 批裁剪及已提交的并行界面/资源修改；各验证仍以对应证据注明的输入提交为准。合并后的最终候选尚待验收。

YouDub 已使用仓库内的 Harness fork 启动 Electron、Host 和前端运行时，原业务通过同一个容器与官方服务运行。原生人工校对、九节点媒体流程、字幕保存及三类扩展有实际证据。完整产品验收仍未完成，剩余范围见下表。[改造计划](YOUDUB-DESKTOP-REFACTOR-PLAN.md)、[分批调研记录](REFACTOR-RESEARCH.md)

## 当前结构与来源

| 层 | 当前实现与证据 |
| --- | --- |
| 产品入口 | [desktop.mjs](../desktop.mjs) 与 [desktop-product.ts](../src/desktop-product.ts)；仓库内 Electron 和锁定 pnpm。正常首启配置私有安装目录，测试跳过需显式参数。独立窗口验收见[原生记录](evidence/refactor-native-zoo-review.json) |
| 框架装配 | [正向清单](../cordis.patch.yml) 组合通用服务及 YouDub 业务；[profile](../prepare-profile.mjs) 保留用户扩展与配置。旧账号、聊天、Agent、Office 的产品接线已退出；模型设置已解除 remote.session 强制依赖。[调查与修复](REFACTOR-RESEARCH.md#正向装配与退出保护) |
| 前端 | Harness Renderer、ModuleLoader、Slots、Store、主题、语言、设置和基础控件；原 YouDub 页面、Logo、动画、画布和校对逻辑直接接入。[元素映射](../FRONTEND-MAPPING.md) |
| 任务与媒体 | 原任务状态机、SQLite、图调度、修订与复用；官方 Jobs/Subprocess 执行 Python，官方 LLM 执行翻译。实际调用上限至少 65,535，拒绝时保留错误。[Host](../src/host.mjs)、[LLM 合同](evidence/refactor-experimental-contracts-prune.json) |
| 扩展 | 原 PluginManager 负责安装、版本、服务注入、启停和卸载；YouDub 提供节点、提供商与页面合同。JS、Python、多输入人工审核均经过实际 Host/原生验证。[扩展记录](evidence/refactor-extension-lifecycle.json) |
| 来源 | 原 Harness 归档、公开提交、原始清单、YouDub 初始快照保持独立；活动 fork 允许有理由的精确差异。[来源检查](../baselines/framework-source.mjs)、[差异账本](../../../vendor/deepseek-harness/fork.json) |

当前活动框架为 209 包、5,239 个树条目，源码 SHA-256 为 `360f68435977bb4785d7d9b93da6e46e7313aea8c580b5ba321b89733c10fbee`。运行时和类型闭包为 141 包，含测试为 203 包。其余 6 包为通用 Typert 生成器、native/system workspace 与 4 个平台 addon；动态/根消费者已记录。第 25 批移除了无消费者的 vendored HMR 与 console logger，保留实际使用的通用 HMR 和日志实现。[第 25 批证据](evidence/refactor-unused-vendor-prune.json)

源码构建的 235 个客户端产物包含可选框架库，不能用于推算产品实际加载的插件数。第 19 批已修复复用 staging 残留退役包编译文件的问题，全新和复用构建都检查已删除目录不存在。[构建清理证据](evidence/refactor-retired-panels-prune.json)

## 功能验收矩阵

状态区分源码/合同、真实运行和最终候选验收。历史通过保留其提交与输入范围；不能覆盖后续未验收改动。原业务逐项映射继续保存在[功能账本](FUSION-COVERAGE.md)。

| 计划项 | 已有证据 | 剩余验收 |
| --- | --- | --- |
| A1 独立启动与来源 | 官方源码构建、独立 Host/profile、原件和 fork 来源核验通过。[来源](evidence/refactor-pruned-notices.json) | 全部改造后的固定候选重新启动；Windows |
| A2 首启语言与目录 | 日语原生目录选择、确认前不下载、退出与重启读回通过。[记录](REFACTOR-RESEARCH.md#p3p4-首启目录选择与密钥展示2026-10-22) | 合并并行资源改动后的最终读回 |
| A3 环境与四模型 | 四模型/依赖门控、私有安装、旧 Whisper-only 标记重新检查通过；暂停恢复已有历史实测。[门控测试](../test/setup-onboarding.test.mjs)、[暂停恢复](evidence/model-pause-resume.json) | 当前资源界面的暂停、继续、失败重试及旧目录复用实机验收 |
| A4 模型与凭据 | 页面保存、自定义 URL、重启、API 字段内掩码；原生草稿退出保护通过。[记录](REFACTOR-RESEARCH.md#p4-模型草稿保护2026-10-22) | 最终界面与凭据边界回归 |
| A5 翻译上限与错误 | 原生外部调用和协议测试验证 65,535；低上限拒绝，错误不降额重试。[媒体记录](evidence/refactor-native-zoo-review.json)、[合同](evidence/refactor-experimental-contracts-prune.json) | 最终候选必要回归 |
| A6 首屏与窗口 | 原 Hero、主题、侧栏、设置和原生导出已有截图与操作证据。[前端映射](../FRONTEND-MAPPING.md) | 合并并行控件改动后逐页对照、焦点、键盘、缩放与动效 |
| A7 语言 | 中英日、日语原生设置、工作流本地化及导入导出通过。[语言规则](LOCALIZATION.md)、[原生记录](REFACTOR-RESEARCH.md#p4p7内置工作流多语言与原生文件往返2026-10-22) | 55621d17 的临时第四语言注册、菜单、刷新/Host 重启及卸载回退通过；最终原生布局检查仍待验收。[语言扩展](evidence/refactor-fourth-locale.json) |
| A8 本地完整媒体 | zoo 的 Demucs、Whisper、翻译、VoxCPM2、Qwen、混音/导出九节点成功；原生播放 18.9 秒。[证据](evidence/refactor-native-zoo-review.json) | 听感和音画同步质量；完整最终候选 |
| A9 YouTube 下载与代理 | 原生填写 zoo URL/7897，十节点完成并导出。[历史任务](evidence/source-native-youtube-download.json) | 本次最终候选网络与下载回归，历史结果不重复计为新通过 |
| A10 B 站下载 | 当前源码经实际 Host 验证直连完整链接、b23 短链和显式代理端口 7897，三次各自两个节点完成；视频、音频、媒体信息和 Range 读回通过。[本次证据](evidence/refactor-bilibili-download.json)、[代理合同](evidence/download-node-proxy-contract.json) | 原生页面输入、保存和播放 |
| A11 人工审核与汇合 | 两输入校对、保存后保持等待、确认再导出及原生文件保存通过。[扩展证据](evidence/refactor-extension-lifecycle.json) | 最终候选的相关回归 |
| A12 自动继续与持久化 | 默认模板去重；节点 autoContinue 控制审核；暂停退出、重启、确认通过。[九节点](evidence/refactor-native-zoo-review.json)、[模板去重](evidence/refactor-extension-lifecycle.json) | 合并后的最终候选 |
| A13 重跑与冲突 | 修订冲突、结果复用及必要审核保留；4313ec5e 的隔离副本重启后，6 个历史任务、7 个工作流和 12 个产物读回一致。[业务映射](FUSION-COVERAGE.md)、[历史数据](evidence/refactor-history-readback.json) | 8fea16f1 的实际 Host 修订、取消/重试、重跑复用及删除独立性通过；最终原生交互仍待验收。[边界证据](evidence/refactor-host-api-boundaries.json) |
| A14 取消、远端与退出 | 运行中原生退出取消保留任务，持久审核可退出；排队/远端未知状态合同及原错误传播已有回归。[活动测试](../test/desktop-activity.test.mjs)、[退出测试](../test/desktop-unload.test.mjs) | 资源下载、远端等待、排队组合的最终原生退出验收 |
| A15 工作流与任务管理 | 创建/修改、模板副本、原生导入导出、重启及模板去重通过。[前端映射](../FRONTEND-MAPPING.md) | E19 已验证实际 Host 分页、状态/活动筛选和删除保护；原生列表及节点编辑分支仍待验收 |
| A16 字幕与播放 | 原生字幕导出字节一致；播放器完整播放、产物 Range 和媒体探测有证据。[原生任务](evidence/refactor-native-zoo-review.json) | 正在并行修改的媒体拖动修复及同步播放验收 |
| A17 提供商与音色 | 原提供商合同及本地克隆配音路径保留，VoxCPM2 实际执行通过。[媒体证据](evidence/refactor-native-zoo-review.json) | 原分支与当前 VoxCPM2 均只声明 source_clone，预设音色被明确拒绝；两项能力/拒绝合同通过。其他支持的设备和输入组合仍待验收。[边界核对](evidence/refactor-voxcpm-voice-scope.json) |
| A18 扩展生命周期 | JS/Python/审核插件安装、运行、启停、卸载、重装、产物保留、原生保存；错误路径与核心保护通过。[完整记录](evidence/refactor-extension-lifecycle.json)、[重装修复](evidence/refactor-plugin-reinstall.json) | 最终候选必要回归；在线市场不在本轮范围 |
| A19 安全与数据兼容 | 官方 IPC、Connection、凭据及文件授权继续使用；profile 迁移有测试。4313ec5e 通过历史数据副本重启、产物摘要及 Range 读回，原数据库未变。[profile 测试](../test/profile.test.mjs)、[历史数据](evidence/refactor-history-readback.json) | 全新私有目录与最终原生验收；历史读回复用已有私有运行资源 |
| A20 构建与平台 | 55621d17 的 macOS 与 Windows 干净 CI 全部通过；聚合类型、GUI 8,075 项、profile 6,689 项、业务界面 264 项、产品 78 项、Python 525 项；Windows 桌面/进程 567 项、产品合同 32 项与两种实际 Host 通过。[本批 CI](evidence/refactor-unused-vendor-prune.json) | 最终原生交互、下载/退出组合、完整媒体质量及启动测量仍开放 |

## P4 基础控件统一（2026-10-23）

已删除八类控件的桌面专用实现与构建替换；业务测试和 Desktop 共用原 `components/ui/*`，通过统一入口接到 Harness 源码/官方运行时。268 项前端回归、类型检查、产品构建和活动模块检查通过；独立实际 Host 验证日语首页菜单、节点语言、人工审核开关与撤销。框架源码和原始归档未修改。原生窗口与完整媒体验收继续开放。[证据](evidence/refactor-unified-controls.json)

随后将快捷字段浮层统一到共享 `ui/popover.tsx`，删除对应桌面适配和 alias。实际页面发现隐藏 Portal 中的提前聚焦失效，以及全宽输入框加上内边距后产生横向溢出。活动 fork 的 `Menu.autoFocus` 现在等待定位后聚焦首个可用按钮或表单字段，重新定位保持用户焦点；共享 Input 使用 `border-box`。7,593 项框架 GUI、268 项业务界面、构建与实际页面验证通过，原始归档完整性不变。[浮层证据](evidence/refactor-shared-popover.json)

旧默认配置也已补齐实际 Host 验收：自动转换、重复迁移、编辑和删除后的重启读回通过；6 个历史任务和 2 个用户工作流的数据库行保持一致。[迁移证据](evidence/refactor-legacy-defaults-host.json)

## 尚需实施的收尾

1. 复核剩余通用框架、测试消费者和遗留文档/构建门禁；第 23 批已移除闭包外的 Office、搜索与旧 Agent 工具，保留通用实现和许可。Windows SDK 回退根因已定位为短路径重复 importer；8fea16f1 的实际 Windows CI 已通过三种旧锁迁移及卸载后 SDK 链接检查。第 24 批已收拢旧 Host/Web 活动入口，保留领域测试夹具与直接复用的业务组件。[入口收拢证据](evidence/refactor-legacy-entries-prune.json)
2. 收拢并行界面、资源及媒体拖动改动，形成固定候选，完成上表未通过的真实操作和输入验收。
3. 独立实际 Host 的日语设置、工作流与任务视频播放已通过浏览器验收，静态首屏截图与限制见[记录](evidence/refactor-browser-ui.json)。原生窗口、文件框、动效与最终媒体质量保持开放。已补齐当前目录体积及历史数据副本记录；当前私有路径已由实际 Host/Python 读回验证；继续测量原生冷/热启动，完成全新下载及 Windows 原生验收。[路径证据](evidence/refactor-runtime-isolation.json)、[体积条件](evidence/refactor-current-footprint.json)、[数据读回](evidence/refactor-history-readback.json)
4. 全部通过后更新两份既有飞书文档。保留未完成状态，不提前签署完整功能覆盖。

本轮交付范围为源码开发版。安装包、签名、发布、自动更新服务和在线插件市场继续按用户要求排除；已有环境/模型准备界面属于开发版功能。[发行边界](YOUDUB-DESKTOP-REFACTOR-PLAN.md#10-后续发行边界)
