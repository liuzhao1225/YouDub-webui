# YouDub 的 Harness 子集

来源为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的公开 tag `dsh-v0.2.1-rc.2`，提交 `687f282e8625c6b8d11ff58211a90524be2e4317`。机器可读信息见 [upstream.json](upstream.json)，许可证见 [source/LICENSE](source/LICENSE)，声明见 [source/THIRD_PARTY_NOTICES.md](source/THIRD_PARTY_NOTICES.md)。

这里只维护 YouDub 使用的源码、共享组件、构建工具和相关测试。完整上游仓库、逐文件上游快照和差异清单不随产品同步；本地生成目录和迁移截图不进入 Git。变更历史由 Git 记录。

当前保留 69 个源码包：61 个链接到桌面运行项目；另有 6 个共享前端包直接编入 Web/业务 bundle、1 个桌面源码包提供窗口与 preload、1 个 Typert 生成器负责构建。准确包表与使用方式见 [保留范围](../../apps/harness/docs/FRAMEWORK-SCOPE.md)。

构建：从仓库根运行 `npm run build:framework`。源码复制到忽略的 `.cache/harness/source-build`，依赖安装和产物生成均在该目录。构建收据只记录当前输入，防止运行陈旧产物，不再要求保存全部上游原件或更新重复的文件哈希账本。

保留框架的窗口、布局、主题、组件、Loader、插件管理、鉴权、设置和模型服务；YouDub 自己提供媒体、任务与工作流。聊天、会话浏览、Agent 执行循环、目标、计划、定时任务、终端面板、内嵌浏览器、文档预览、插件市场和历史会话迁移已移除。上游发布、文档、覆盖率及全仓规则检查也已移除。

新增代码优先复用保留的组件和服务。引入新依赖时说明当前产品用途，并一起更新包声明和实际产品验收。

## 维护中的接口范围

API Gateway 的 `RemoteJournalStream` 及其专用类型（`RemoteJournalChange`、`RemoteJournalFrame`、`RemoteJournalStreamOptions`、`RemoteStreamFactory`）没有产品消费者，已退役。普通远程调用、事件订阅、`RemoteStream` 和 `RemoteSnapshotStream` 保留。

当前子集已退役文件关联应用枚举和指定应用打开接口（`nativeFileApplications`、`openNativeFileApplication`、`desktopEntryFields`、`desktopDataDirectories`、`desktopApplicationIcon` 及 `native-command/types`）。配置文件仍通过 `openNativeTextFile` 打开。

桌面快捷键只承接 YouDub 主文档和原生菜单输入，原内嵌浏览器、HTML 预览的 iframe/webview 转发协议已退役。插槽仍保留通用 scope adapter、Component Factory、注册和依赖注入；原聊天输入框专用的 `ChainRenderOpts.overlay` 和未使用的 `ResourceProtocolMap` 已移除。YouDub SDK 的工作流和插件接口不受这些上游专用接口清理影响。

配置表单继续使用 Harness 的原生 ConfigForms。无产品入口的 JSON Schema 导出（`generateConfigSchema`、`createConfigProjector`、`isNativeConfigSchema`）和 `renderConfigDump` 已退役。普通子进程仍通过 `ctx.subprocess.spawn` 执行并管理进程树；PTY 的 `spawnTerminal`、`terminalEnvironment`、终端相关类型与 `node-pty` 依赖已移除。旧版 profile 中的 `node-pty` 文本仅用于识别并迁移历史安装配置。

测试维护范围覆盖产品启动、配置重载、插件生命周期、普通子进程停止与平台隔离。已移除退出产品的终端和配置导出测试，以及穷举 Node 模块查找布局的差分矩阵；模块解析的直接回归与真实主机退出测试继续保留。
