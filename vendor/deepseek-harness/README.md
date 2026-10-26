# YouDub 的 Harness 子集

来源为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的公开 tag `dsh-v0.2.1-rc.2`，提交 `687f282e8625c6b8d11ff58211a90524be2e4317`。机器可读信息见 [upstream.json](upstream.json)，许可证见 [source/LICENSE](source/LICENSE)，声明见 [source/THIRD_PARTY_NOTICES.md](source/THIRD_PARTY_NOTICES.md)。

这里只维护 YouDub 使用的源码、共享组件、构建工具和相关测试。完整上游仓库、逐文件上游快照和差异清单不随产品同步；本地生成目录和迁移截图不进入 Git。变更历史由 Git 记录。

当前保留 67 个源码包，已移除聊天附件和多角色 RemoteAccess 包；运行包表与前端、桌面构建工具的使用方式见 [保留范围](../../apps/harness/docs/FRAMEWORK-SCOPE.md)。

构建：从仓库根运行 `npm run build:framework`。源码复制到忽略的 `.cache/harness/source-build`，依赖安装和产物生成均在该目录。构建收据只记录当前输入，防止运行陈旧产物，不再要求保存全部上游原件或更新重复的文件哈希账本。

保留框架的窗口、布局、主题、组件、Loader、插件管理、鉴权、设置和模型服务；YouDub 自己提供媒体、任务与工作流。聊天、会话浏览、Agent 执行循环、目标、计划、定时任务、终端面板、内嵌浏览器、文档预览、插件市场和历史会话迁移已移除。上游发布、文档、覆盖率及全仓规则检查也已移除。

新增代码优先复用保留的组件和服务。引入新依赖时说明当前产品用途，并一起更新包声明和实际产品验收。

## 维护中的接口范围

API Gateway 的 `RemoteJournalStream` 及其专用类型（`RemoteJournalChange`、`RemoteJournalFrame`、`RemoteJournalStreamOptions`、`RemoteStreamFactory`）没有产品消费者，已退役。无消费者的 `RemoteSnapshotStream`/`RemoteSnapshotStreamOptions` 和 `isRemoteFailure` 也已退役；普通远程调用、事件订阅、`RemoteStream` 及实际错误对象保留。

当前子集已退役文件关联应用枚举和指定应用打开接口（`nativeFileApplications`、`openNativeFileApplication`、`desktopEntryFields`、`desktopDataDirectories`、`desktopApplicationIcon` 及 `native-command/types`）。通用打开/显示文件、`canOpenNativePath` 和关联/浏览器探测已退出；配置文件仍通过 `openNativeTextFile` 打开。

桌面快捷键只承接 YouDub 主文档和原生菜单输入，原内嵌浏览器、HTML 预览的 iframe/webview 转发协议已退役。UI 插槽只承接当前页面与节点插件使用的 `root` scope，保留 single/list/keyed/chain、Component Factory、依赖注入和按渲染位置隔离的状态生命周期。`session`、`session-maybe`、`SessionProvider`、`installScope`、`bindStoreScope` 和 `inject(sessionId, ...)` 已退役，旧 scope 声明会在注册时明确报错。原聊天输入框专用的 `ChainRenderOpts.overlay` 和未使用的 `ResourceProtocolMap` 已移除。

LLM 继续使用原 Harness `prepareCall → stream`、模型发现、配置、凭据及供应商适配。请求支持 system/user 文本，响应保留文本、思考、用量、结束原因和原始错误；图片、文件、工具、工具历史和 assistant/developer/tool 历史输入明确拒绝。Agent 消息构造器、`BlockAssembler`、replay API 和附件包已退役。历史图片预算字段仍可随旧配置加载，原值不改写；新请求和表单不再使用这些字段。

Gateway 直接要求经过认证的 owner，非 owner 在方法解析和事件订阅前被拒绝；原多角色策略注册、权限快照/follow 和客户端权限 Hooks 已退役。HTTP 认证、请求上限、二进制 RPC、上传和通用流仍保留。空的上游默认 profile 模板和 snapshot replay 入口已退役，现有用户 profile、配置和外部插件继续通过原 Loader 加载；启动必须传入应用已解析的 profile。未消费的 `loadProfile` 命名包装、插件清单重算接口和 `exitOnStdinEnd` 已退役。Gateway/HMR 通过动态服务名读取的 `AppReady` 继续保留。

配置表单继续使用 Harness 的原生 ConfigForms。无产品入口的 JSON Schema 导出（`generateConfigSchema`、`createConfigProjector`、`isNativeConfigSchema`）和 `renderConfigDump` 已退役。普通子进程仍通过 `ctx.subprocess.spawn` 执行并管理进程树；PTY 的 `spawnTerminal`、`terminalEnvironment`、终端相关类型与 `node-pty` 依赖已移除。旧版 profile 中的 `node-pty` 文本仅用于识别并迁移历史安装配置。

插件列表的 `BundleInfo` / `PackageView` 不再提供恒为 false 的 `official` / `optional`，`PluginPackageRef.official` 同步退役，`OfficialItem` 改名为 `ConfigItem`。官方扩展 / More 分组已移除；`plugins.item` 配置扩展槽、YouDub 内置项和用户插件完整生命周期继续保留。依赖旧字段或类型的外部插件需要修改声明。

图标入口保留当前页面、共享组件与插件示例实际使用的 30 个 `Icon*` 导出；其余图标不再随子集维护。通用设置已删除原本被 YouDub 隐藏的编码视图、字体行及专用 store；主题引擎、字号快捷键和历史字体配置继续生效。旧 `ui-settings.enabled` 仍被接受。桌面更新展示合同收敛为生产者实际提供的 `idle/checking/available/error`；版本检查、失败重试和打开下载页继续使用当前桌面入口。

Windows 媒体进程继续使用 `spawnCurrentTokenJobProcess` 和 Job Object。未使用的 `spawnPipedProcess`、`spawnInheritedJobProcess`、`RestrictedProcessSpawnOptions`、`drainPipe`、`waitForProcessExit` 及专用 Win32 绑定已退役；普通进程的停止、轮询、句柄释放与原始错误保留。启动环境继续使用 `loadLayeredEnv`；无调用的另一入口 `loadEnv` 已退役。

测试维护范围覆盖产品启动、配置重载、插件生命周期、普通子进程停止与平台隔离。已移除退出产品的终端和配置导出测试，以及穷举 Node 模块查找布局的差分矩阵；模块解析的直接回归与真实主机退出测试继续保留。

Typert 仅保留产品使用的 namespace Remote 和描述符合同。旧工具系统的 `TypertRemoteMethod`、`TypertRemoteInputOptions`、`isTypertRemoteMethod`、`info.methods`、命名 `input/invoke`、`strictCodec` 输入副本及 codec 的 `jsonSchema/jsonSchemaError` 投影已退役；实际 wire codec、Context/scope、流/取消和字节编解码保留。生成 factory 不再需要第二个 Zod runtime 参数。

Jobs 保留 start/get/list/kill/wait/remove、controller、progress、done 与错误；没有消费者的输出环、read/readAt/events/result 及相关配置表单退役，业务日志仍由 YouDub 持久化。普通子进程不再提供 `./control` 和 fd7；标准流、runner IPC 与平台进程树控制不变。退役的 Jobs 输出或 stdio.control 请求会明确拒绝，旧 Jobs 环大小配置仍可加载。

`PartialArguments`、`snapshotJsonValue`、`WeakMapWithValues`、数字 brand、bytesToBase64、clampTimeout、未用 home 显示/cache helper、LLM `errorChain/isHarnessError/ACCOUNT_QUOTA_EXCEEDED_CODE` 及闲置 Cosmokit array/time/string/binary 输出工具不再提供。原错误分类、cause、JSON 验证、配置锁和实际 native 文本打开保留。Timer 当前只提供 HMR 实际使用的 `debounce`，随 fiber 释放。

前端不再隐式共享 `@tanstack/react-virtual`，使用它的外部插件须声明并自行打包；旧 `ClientManifest/ClientModule`、孤立的复合 locale/theme schema、`resultOf`、store `shallowEqual` 和测试专用窗口几何模型退出。真实 Connection、store selector、拖动 DOM/CSS 与键盘仍保留。YouDub SDK 退出未使用的 `YouDubContext` 别名、无效 `Files.upload` 大小参数；纯类型 Cordis 导入继续支撑 Context 声明合并。
