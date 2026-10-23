# YouDub Desktop 代码复核

更新：2026-10-23。第 27 批 aed6099c 与最终框架范围候选 079141fb 的双平台 CI 均已通过。随后实际 Host 完成 zoo 自动配音及人工订正、重启、确认、Qwen 对齐的九节点流程；修复验收发现的任务、产物和节点进度本地化缺口。源码候选 fa02da7d 的中英日页面回读通过，macOS、Windows 双平台 CI 已全部通过，结果见[本轮证据](evidence/refactor-final-media-localization.json)。最终原生交互和音画质量仍待验收。

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

当前活动框架为 203 包、5,133 个树条目，源码 SHA-256 为 `36bc087c0d57da4e3969fe81f31bab127e198b3ebf5cf2d8314e3eaf5fb21e08`。第 27 批移除五个旧账号/产品统计包，保留通用凭据、API Key、日志、模型选择和扩展服务。源码和类型引用覆盖 136 包，连同原框架测试为 197 包；剩余六包由根生成器和平台 addon 构建消费，已逐项记录。[最终范围](evidence/refactor-final-framework-scope.json) 默认产品隔离检查为 87 包、692 个运行源码、33 个 Web 插件。[本批证据](evidence/refactor-account-prune.json)

源码构建的 233 个客户端产物包含可选框架库。第 19 批修复的 staging 清理继续生效，全新和复用构建都检查已删除目录不存在。[构建清理证据](evidence/refactor-retired-panels-prune.json)


## 功能验收矩阵

状态区分源码/合同、真实运行和最终候选验收。历史通过保留其提交与输入范围；不能覆盖后续未验收改动。原业务逐项映射继续保存在[功能账本](FUSION-COVERAGE.md)。

| 计划项 | 已有证据 | 剩余验收 |
| --- | --- | --- |
| A1 独立启动与来源 | 官方源码构建、独立 Host/profile、原件和 fork 来源核验通过。[来源](evidence/refactor-pruned-notices.json) | 全部改造后的固定候选重新启动；Windows |
| A2 首启语言与目录 | 日语原生目录选择、确认前不下载、退出与重启读回通过。[记录](REFACTOR-RESEARCH.md#p3p4-首启目录选择与密钥展示2026-10-22) | e0f899a1 浏览器选择中文及含空格、中文路径，完整安装后 Host 重启读回通过；最终原生候选仍待验收。[全新安装](evidence/refactor-fresh-installation.json) |
| A3 环境与四模型 | 四模型/依赖门控、私有安装、旧 Whisper-only 标记重新检查通过；暂停恢复已有历史实测。[门控测试](../test/setup-onboarding.test.mjs)、[暂停恢复](evidence/model-pause-resume.json) | e0f899a1 实际 Host 浏览器完成损坏文件拒绝、显式重试、真实下载、资源页暂停/续传和重启；两次 Whisper 下载哈希符合清单，其余资源复用既有私有目录。e0f899a1 的全新私有安装与同配置重启另已通过；原生退出仍待验收。[全新安装](evidence/refactor-fresh-installation.json)[下载记录](evidence/refactor-resource-download-browser.json) |
| A4 模型与凭据 | 页面保存、自定义 URL、重启、API 字段内掩码；原生草稿退出保护通过。[记录](REFACTOR-RESEARCH.md#p4-模型草稿保护2026-10-22) | e0f899a1 隔离页面新增、掩码复制、删除与重载读回通过；第 26 批编辑器浏览器检查通过，最终原生回归保持开放。[凭据删除](evidence/refactor-credential-lifecycle.json)、[引导清理](evidence/refactor-onboarding-prune.json) |
| A5 翻译上限与错误 | 原生外部调用和协议测试验证 65,535；低上限拒绝，错误不降额重试。[媒体记录](evidence/refactor-native-zoo-review.json)、[合同](evidence/refactor-experimental-contracts-prune.json) | 本轮实际 Host 的两次翻译请求均保留 maxTokens=65,535，原始响应未改写。[当前媒体证据](evidence/refactor-final-media-localization.json) |
| A6 首屏与窗口 | 原 Hero、主题、侧栏、设置和原生导出已有截图与操作证据。[前端映射](../FRONTEND-MAPPING.md) | e0f899a1 的中英日设置、深浅主题、首屏、侧栏开合、工作流和扩展浏览器回归通过；原生缩放与动效待验收。[页面记录](evidence/refactor-page-matrix.json) |
| A7 语言 | 中英日、日语原生设置、工作流本地化及导入导出通过。[语言规则](LOCALIZATION.md)、[原生记录](REFACTOR-RESEARCH.md#p4p7内置工作流多语言与原生文件往返2026-10-22) | 55621d17 的临时第四语言注册、菜单、刷新/Host 重启及卸载回退通过；最终原生布局检查仍待验收。[语言扩展](evidence/refactor-fourth-locale.json) |
| A8 本地完整媒体 | zoo 的 Demucs、Whisper、翻译、VoxCPM2、Qwen、混音/导出九节点成功；原生播放 18.9 秒。[证据](evidence/refactor-native-zoo-review.json) | 97686f13 的隔离实际 Host 九节点成功；fa02da7d 页面回读通过。听感和音画同步质量、最终原生播放待验收。[当前媒体证据](evidence/refactor-final-media-localization.json) |
| A9 YouTube 下载与代理 | 原生填写 zoo URL/7897，十节点完成并导出。[历史任务](evidence/source-native-youtube-download.json) | 本次最终候选网络与下载回归，历史结果不重复计为新通过 |
| A10 B 站下载 | 当前源码经实际 Host 验证直连完整链接、b23 短链和显式代理端口 7897，三次各自两个节点完成；视频、音频、媒体信息和 Range 读回通过。[本次证据](evidence/refactor-bilibili-download.json)、[代理合同](evidence/download-node-proxy-contract.json) | 原生页面输入、保存和播放 |
| A11 人工审核与汇合 | 两输入校对、保存后保持等待、确认再导出及原生文件保存通过。[扩展证据](evidence/refactor-extension-lifecycle.json) | 本轮 recognize revision 2、translate revision 3 保存后均保持等待，确认后下游继续；多输入审核保留既有证据。[当前媒体证据](evidence/refactor-final-media-localization.json) |
| A12 自动继续与持久化 | 默认模板去重；节点 autoContinue 控制审核；暂停退出、重启、确认通过。[九节点](evidence/refactor-native-zoo-review.json)、[模板去重](evidence/refactor-extension-lifecycle.json) | 本轮译文订正保存后干净关闭 Host，重启仍为同一 revision 3 和等待确认状态；确认后九节点完成。[当前媒体证据](evidence/refactor-final-media-localization.json) |
| A13 重跑与冲突 | 修订冲突、结果复用及必要审核保留；4313ec5e 的隔离副本重启后，6 个历史任务、7 个工作流和 12 个产物读回一致。[业务映射](FUSION-COVERAGE.md)、[历史数据](evidence/refactor-history-readback.json) | 8fea16f1 的实际 Host 修订、取消/重试、重跑复用及删除独立性通过；最终原生交互仍待验收。[边界证据](evidence/refactor-host-api-boundaries.json) |
| A14 取消、远端与退出 | 运行中原生退出取消保留任务，持久审核可退出；排队/远端未知状态合同及原错误传播已有回归。[活动测试](../test/desktop-activity.test.mjs)、[退出测试](../test/desktop-unload.test.mjs) | 资源下载、远端等待、排队组合的最终原生退出验收 |
| A15 工作流与任务管理 | 创建/修改、模板副本、原生导入导出、重启及模板去重通过。[前端映射](../FRONTEND-MAPPING.md) | E19 已验证实际 Host 分页、状态/活动筛选和删除保护；原生列表及节点编辑分支仍待验收 |
| A16 字幕与播放 | 原生字幕导出字节一致；播放器完整播放、产物 Range 和媒体探测有证据。[原生任务](evidence/refactor-native-zoo-review.json) | 本轮浏览器完整播放 18.9 秒、拖动至 8.5 秒并显示订正字幕，下载 SRT 与生成文件字节一致。原文 6 段、译文 5 段时间有序且不超出视频；音画同步听感和最终原生保存仍待验收。[当前媒体证据](evidence/refactor-final-media-localization.json)、[倍速记录](evidence/refactor-page-matrix.json) |
| A17 提供商与音色 | 原提供商合同及本地克隆配音路径保留，VoxCPM2 实际执行通过。[媒体证据](evidence/refactor-native-zoo-review.json) | 原分支与当前 VoxCPM2 均只声明 source_clone，预设音色被明确拒绝；两项能力/拒绝合同通过。其他支持的设备和输入组合仍待验收。[边界核对](evidence/refactor-voxcpm-voice-scope.json) |
| A18 扩展生命周期 | JS/Python/审核插件安装、运行、启停、卸载、重装、产物保留、原生保存；错误路径与核心保护通过。[完整记录](evidence/refactor-extension-lifecycle.json)、[重装修复](evidence/refactor-plugin-reinstall.json) | 最终候选必要回归；在线市场不在本轮范围 |
| A19 安全与数据兼容 | 官方 IPC、Connection、凭据及文件授权继续使用；profile 迁移有测试。4313ec5e 通过历史数据副本重启、产物摘要及 Range 读回，原数据库未变。[profile 测试](../test/profile.test.mjs)、[历史数据](evidence/refactor-history-readback.json) | 全新私有目录与最终原生验收；历史读回复用已有私有运行资源 |
| A20 构建与平台 | a6c4d1a 的 macOS 与 Windows 干净 CI 全部通过。[CI](https://github.com/liuzhao1225/YouDub-webui/actions/runs/39866708470) 第 27 批本地七项构建、两项类型门、647 项定向、7,927 项 GUI、11 项实际 Host/profile 回归通过。[记录](evidence/refactor-account-prune.json) | aed6099c 与 079141fb 双平台 CI 均通过；fa02da7d 的结果见[本轮证据](evidence/refactor-final-media-localization.json)。最终原生交互、下载/退出组合、媒体质量和启动测量保持开放 |

## P4 基础控件统一（2026-10-23）

已删除八类控件的桌面专用实现与构建替换；业务测试和 Desktop 共用原 `components/ui/*`，通过统一入口接到 Harness 源码/官方运行时。268 项前端回归、类型检查、产品构建和活动模块检查通过；独立实际 Host 验证日语首页菜单、节点语言、人工审核开关与撤销。框架源码和原始归档未修改。原生窗口与完整媒体验收继续开放。[证据](evidence/refactor-unified-controls.json)

随后将快捷字段浮层统一到共享 `ui/popover.tsx`，删除对应桌面适配和 alias。实际页面发现隐藏 Portal 中的提前聚焦失效，以及全宽输入框加上内边距后产生横向溢出。活动 fork 的 `Menu.autoFocus` 现在等待定位后聚焦首个可用按钮或表单字段，重新定位保持用户焦点；共享 Input 使用 `border-box`。7,593 项框架 GUI、268 项业务界面、构建与实际页面验证通过，原始归档完整性不变。[浮层证据](evidence/refactor-shared-popover.json)

旧默认配置也已补齐实际 Host 验收：自动转换、重复迁移、编辑和删除后的重启读回通过；6 个历史任务和 2 个用户工作流的数据库行保持一致。[迁移证据](evidence/refactor-legacy-defaults-host.json)

## 尚需实施的收尾

1. 最终框架范围已复核：保留的源码/类型、测试、根生成器和原生 addon 都有消费者；079141fb 的双平台源码 CI 已通过。[范围证据](evidence/refactor-final-framework-scope.json) 第 23 批已移除闭包外的 Office、搜索与旧 Agent 工具，保留通用实现和许可。Windows SDK 回退根因已定位为短路径重复 importer；8fea16f1 的实际 Windows CI 已通过三种旧锁迁移及卸载后 SDK 链接检查。第 24 批已收拢旧 Host/Web 活动入口，保留领域测试夹具与直接复用的业务组件。[入口收拢证据](evidence/refactor-legacy-entries-prune.json)
2. 源码固定于 fa02da7d；本轮没有修改框架源码，新增修复仅涉及已观察到的业务本地化缺口。继续完成上表未通过的原生操作、网络输入和媒体质量验收。
3. 独立实际 Host 的日语设置、工作流与任务视频播放已通过浏览器验收，静态首屏截图与限制见[记录](evidence/refactor-browser-ui.json)。原生窗口、文件框、动效与最终媒体质量保持开放。已补齐当前目录体积及历史数据副本记录；当前私有路径已由实际 Host/Python 读回验证；全新私有安装、下载暂停/续传和重启已有当前证据，继续测量原生冷/热启动及完成 Windows 原生验收。[路径证据](evidence/refactor-runtime-isolation.json)、[体积条件](evidence/refactor-current-footprint.json)、[数据读回](evidence/refactor-history-readback.json)
4. 全部通过后更新两份既有飞书文档。保留未完成状态，不提前签署完整功能覆盖。

本轮交付范围为源码开发版。安装包、签名、发布、自动更新服务和在线插件市场继续按用户要求排除；已有环境/模型准备界面属于开发版功能。[发行边界](YOUDUB-DESKTOP-REFACTOR-PLAN.md#10-后续发行边界)

## P4 弹窗与状态存储统一（2026-10-23）

工作流离开保护直接调用官方 Modal，删除桌面 Dialog 适配及对应构建替换；查询、资源、首启和草稿控制器共用 Harness Store 来源入口，删除桌面专用 Store 和 Zustand 构建替换。268 项前端回归、类型、产品构建与组合检查通过。独立实际 Host 已验证日语弹窗焦点循环、Escape 保留草稿、放弃后读回原工作流，以及打开设置后首页视频链接仍保留；没有提交媒体任务。剩余 locale/theme 绑定只读写官方服务，文件及导航边界有明确消费者。原生文件框、窗口动效和最终平台验收继续开放。[证据](evidence/refactor-shared-modal-store.json)

## 第 27 批：账号链清理与插件 SDK 解析

五个旧账号/统计包及 75 个原包文件已退出活动 fork；清除对应的 Remote 事件、专属默认模型初始化和可选统计调用。通用提供商编辑、凭据、错误传播、插件操作和 API Key 传输断言保留。缺失的消息回放夹具直接复制冻结原档中的原字节。[清理记录](evidence/refactor-account-prune.json)

实际 Host 安装本地扩展时暴露 `@youdub/harness-subtitles` 无法解析。开发运行时现显式声明并链接应用自己的 SDK，继续由 Harness 原解析器处理。隔离日语页面已验证安装、页面按钮、停用、同进程启用和卸载；清理后 profile 不再引用测试插件，控制台无警告或错误。此次使用浏览器交互，原生文件框仍待最终验收。

## 最终框架范围复核

统计链移除后，`dsh-otel` 已无运行、类型、测试或根脚本消费者，随 17 个包/组文件移除。根目录说明、生成器目录项与第三方声明同步；依赖检查发现的三条无消费者导出白名单也已清理，实际源码检查纳入 CI。完整模块分类与目录体积保存在[最终范围记录](evidence/refactor-final-framework-scope.json)。

本轮本地复用依赖的七项构建耗时 16.47 秒。该值没有包含下载、安装、原生窗口就绪，也不用于声称冷启动收益。原件仍由独立清单校验，历史体积记录保持不变。

## P3 原版私有环境复用（079141fb）

原版 `Application Support/YouDub` 的 runtime/models 通过 APFS 克隆到隔离目录，测试副本内的 Python 绝对路径同步重定位。实际 Host 识别四模型可用，缺少的私有分句资源准备完成后才进入 ready；同一 profile 重启后无需再次选择或提交准备。对比原目录 74,932 项模式、大小、修改时间和链接目标均未改变，原任务、数据库和凭据未触碰。[验证记录](evidence/refactor-original-runtime-compat.json)

该验证覆盖原环境结构复用与资源门控，没有宣称用户安装目录可自动搬迁，也没有替代最终原生交互或媒体质量验收。

## P7 当前媒体流程与本地化回归

在隔离私有环境中通过页面填写原有提供商、URL、密钥、模型和 65,535 上限，导入仓库 zoo 样本。自动八节点任务保留 Whisper tiny 的原始误识别；由页面复制工作流并关闭识别、翻译自动继续，增加 Qwen 对齐，完成英文与中文订正。译文 revision 3 经 Host 重启仍保持待确认；确认后九节点全部完成。导出 H.264/AAC 视频、WAV 和两种 SRT，字幕时间和下载字节检查通过。[完整记录](evidence/refactor-final-media-localization.json)

真实英语页面暴露的任务模板标题、文件标签和步骤中文名称已复用现有 workflowTemplateTitle、workflowPortLabel、插件描述符及语言服务修复；已知内置进度显示按界面语言转换。自定义名称、数据库原文、请求和响应保持不变。fa02da7d 的中英日回读和当前 Host 控制台检查通过。浏览器音频原生控件跟随浏览器系统语言，用户自定义工作流/端口文字保留原名。

本轮原生工具仍返回 Mac 锁屏，浏览器证据没有记作原生保存或窗口动效通过。当前 YouTube 网络下载和主观听感仍开放；两份飞书文档遵循全部验收结束后统一更新的约定。
