# YouDub 的 Harness 子集

来源为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的公开 tag `dsh-v0.2.1-rc.2`，提交 `687f282e8625c6b8d11ff58211a90524be2e4317`。机器可读信息见 [upstream.json](upstream.json)，许可证见 [source/LICENSE](source/LICENSE)，声明见 [source/THIRD_PARTY_NOTICES.md](source/THIRD_PARTY_NOTICES.md)。

这里只维护 YouDub 使用的源码、共享组件、构建工具和相关测试。完整上游仓库、逐文件上游快照和差异清单不随产品同步；本地生成目录和迁移截图不进入 Git。变更历史由 Git 记录。当前包清单、源码统计及桌面和前端构建关系统一见 [保留范围](../../apps/harness/docs/FRAMEWORK-SCOPE.md)。

构建：从仓库根运行 `npm run build:framework`。源码复制到忽略的 `.cache/harness/source-build`，依赖安装和产物生成均在该目录。构建收据记录当前输入，防止运行陈旧产物。

保留框架的窗口、布局、主题、组件、Loader、插件管理、鉴权、设置和模型服务；YouDub 自己提供媒体、任务与工作流。聊天、会话浏览、Agent 执行循环、目标、计划、定时任务、终端面板、内嵌浏览器、文档预览和历史聊天会话迁移已移除。YouDub 的扩展页面继续使用 Harness 官方插件管理服务。上游发布、文档、覆盖率及全仓规则检查不随子集维护。

新增代码优先复用保留的组件和服务。引入新依赖时说明当前产品用途，并一起更新包声明和实际产品验收。

## 启动、配置与插件生命周期

现有用户 profile、配置和外部插件继续通过原 Loader 加载；启动必须传入应用已解析的 profile。空的上游默认 profile 模板、snapshot replay、未消费的 `loadProfile` 包装、插件清单重算接口和 `exitOnStdinEnd` 已退役。Gateway/HMR 通过动态服务名读取的 `AppReady` 及其提交、失败和释放语义继续保留。

Loader 的 `locate`、`envData` 和 `CORDIS_SHARED` 注入链已退役，实际 entry、scope、父子关系和动态加载保留。启动环境继续使用 `loadLayeredEnv`；无调用的另一入口 `loadEnv` 和闲置 `DshEnvironment/DshEnvironmentKey` 类型退出，实际环境变量清理和 Python 环境加载保留。

Cordis 已退役 `EffectMeta`、`getEffects`、静态 `Context.effect` symbol 及专用元数据收集；无消费者的 `ctx.serial`、`Promisify`、`internal/dispatch` 诊断广播及 `DispatchMode` 也已退役；实例方法 `ctx.effect(execute, label?)`、`effectInertia`、重入、异步初始化、释放和原始错误传播保留。Include 继续支持 JSON/YAML/YML，原文件权限、配置写入失败和重载处理保留；构造阶段已拒绝的 JavaScript 文件加载分支退出。

配置表单继续使用 Harness 原生 ConfigForms。前端使用 settings.mutate；无消费者的 Remote settings.update/replace 和 SettingsForms.replace 已退役，后端实际调用的 Forms.update 保留。凭据继续通过 describe(ref)、readRecord/listRecords/modifyRecord 处理，describeRecord/CredentialRecordInfo 旁路已退役。无产品入口的 JSON Schema 导出（`generateConfigSchema`、`createConfigProjector`、`isNativeConfigSchema`）、`renderConfigDump` 和 `ConfigForms.whileServed` 已退役。

插件列表的 `BundleInfo/PackageView` 不再提供恒为 false 的 `official/optional`，`PluginPackageRef.official` 同步退役，`OfficialItem` 改名为 `ConfigItem`。官方扩展 / More 分组已移除；`plugins.item` 配置扩展槽、YouDub 内置项和用户插件的安装、启停、配置与卸载生命周期保留。

版本豁免的管理 RPC `listVersionExemptions/setVersionExemption`、`setProfileVersionExemption` 及 grant 写入链已退役。已有 `compatibility.json` 仍按包和运行时标识读取，并参与启动及安装校验；历史记录不改写，校验失败和警告继续显示。

## 通信、鉴权与类型生成

Gateway 要求经过认证的 owner，非 owner 在方法解析和事件订阅前被拒绝。HTTP 认证、请求上限、二进制 RPC、YouDub 媒体上传、事件和通用流保留。原多角色策略注册、权限快照/follow 和客户端权限 Hooks 已退役。

API Gateway 的 `RemoteJournalStream` 及其专用类型（`RemoteJournalChange`、`RemoteJournalFrame`、`RemoteJournalStreamOptions`、`RemoteStreamFactory`）、`RemoteSnapshotStream/RemoteSnapshotStreamOptions` 和 `isRemoteFailure` 已退役。普通远程调用、事件订阅、`RemoteStream` 及实际错误对象保留。

Typert 保留产品使用的 namespace Remote、调用描述符、schema factory、wire codec、Context/lookup scope、字节编解码、流和取消。旧工具系统的 `TypertRemoteMethod`、`TypertRemoteInputOptions`、`isTypertRemoteMethod`、`info.methods`、命名 `input/invoke`、`strictCodec` 输入副本及 codec 的 `jsonSchema/jsonSchemaError` 投影已退役；生成 factory 不再需要第二个 Zod runtime 参数。

运行时 schema/package 反射目录的 `get/resolve/list/getPackage/listPackages/toJSONSchema`、专用 service/event/object 模型和文档元数据已退役；生成器不再维护这些反射模型、原始声明副本和跨端反射索引。实际调用的类型分析、声明合并、校验、codec、source map，以及 contribution 的注册与释放继续保留。

多角色授权遗留的 `TypertResource*` 注册、`resources/resource` 元数据、`RemoteAccessResource*` 和 `principalOf` 已退役。调用上下文中的 `Principal` 身份及 Gateway 的 owner 鉴权仍保留。产品媒体资源管理使用 YouDub 自身服务。

Webserver 的 `tapIndex/applyIndexTaps` 字符串改写入口已退役，真实 HTML 注入继续通过 `webserver/index-inject`，保留顺序、转义、插件卸载与逐请求重新收集。`ClientModules.fetchBundle` 的无消费者包装已删除，实际 bundle 路由保留 GET/HEAD、缓存、source map 和访问校验。

## 模型与翻译

LLM 继续使用原 Harness `prepareCall → stream`、供应商适配、模型发现、配置和凭据。请求支持 system/user 文本，响应保留文本、思考、用量、结束原因和原始错误；图片、文件、工具及 assistant/developer/tool 历史输入明确拒绝。Agent 消息构造器、`BlockAssembler`、replay API 和附件包已退役。历史图片预算字段仍可随旧配置加载，原值不改写；新请求和表单不再使用这些字段。

无消费者的 `resolveModelInfo/resolveCallConfig` 及专用包装链已退役；适配器的 `resolveModel`、实际模型元数据解析、`prepareCall`、请求参数与默认值、思考流、取消和供应商错误处理保留。`errorChain/isHarnessError/ACCOUNT_QUOTA_EXCEEDED_CODE` 已退役；`HarnessError`、原始错误及 cause 保留。

## 子进程、任务与代理

普通子进程通过 `ctx.subprocess.spawn` 执行并管理进程树。无消费者的 resolveExecutable 查询和 SubprocessExecutableNotFoundError 已退役，spawn 的路径解析、环境与平台处理保留。PTY 的 `spawnTerminal`、`terminalEnvironment`、终端相关类型与 `node-pty` 依赖已移除；旧 profile 中的 `node-pty` 文本仅用于识别和迁移历史安装配置。`./control` 和 fd7 退出，标准流、runner IPC 与平台进程树控制保留，旧 `stdio.control` 请求会明确拒绝。

Windows 媒体进程继续使用 `spawnCurrentTokenJobProcess` 和 Job Object。未使用的 `spawnPipedProcess`、`spawnInheritedJobProcess`、`RestrictedProcessSpawnOptions`、`drainPipe`、`waitForProcessExit` 及专用 Win32 绑定已退役；普通进程的停止、轮询、句柄释放、ABI 验证和原始错误保留。`OutputCollector.snapshot/finalize/dropped` 及 `CollectedOutput` 退出，实际 `seal/readFrom`、偏移、丢失标记、磁盘溢出与错误处理保留。

Jobs 保留 `start/attachController/hasActiveJobs`、producer done、真实退出取消与错误。`JobHandle/JobId/JobView/list/updateProgress`、get/kill/wait/remove、TASK_WAIT_TIMEOUT、输出环、read/readAt/events/result 及相关配置表单已退役。实际进度与业务日志由 YouDub snapshot 和持久化层提供；退役的输出请求仍明确拒绝，旧环大小配置仍可加载。

HTTP proxy 的 `proxyRouteFor/ProxyRoute`、仅供展示的 installed 状态副本和 `clearedProxyEnv` 已退役。实际 undici global dispatcher、进行中的请求释放、嵌套恢复、NO_PROXY/loopback、代理协议检查，以及子进程代理环境传递和 Windows 环境变量大小写处理保留。

## 桌面与前端

客户端组件按实际调用收窄：旧菜单的子菜单、多选和分组，终端会话专属模式，旧归档 Toast，TextShimmer 及 DisclosureRow 的未使用模式已退役。当前扁平菜单、插件安装日志、展开/收起、焦点、IME、无障碍和错误提示保留。未消费的设计 token、Montserrat 字体出口及仅验证这些退役能力的测试已移除；YouDub Logo、动效、实际字号和明暗主题继续使用原实现。


桌面快捷键承接 YouDub 主文档和原生菜单输入，原内嵌浏览器、HTML 预览的 iframe/webview 转发协议已退役。文件关联应用枚举和指定应用打开接口（`nativeFileApplications`、`openNativeFileApplication`、`desktopEntryFields`、`desktopDataDirectories`、`desktopApplicationIcon` 及 `native-command/types`）退出。未使用的通用打开/显示文件、`canOpenNativePath` 和关联/浏览器探测 helper 退出；配置文件仍通过 `openNativeTextFile` 打开。

全局布局保留左侧栏、主内容、`shell.leading/shell.overlay`、左侧栏拖动和窗口尺寸联动。无消费者的全局右侧第三栏、`rightbar`、`openRightbar/closeRightbar`、`shell.bottom` 及其全屏状态、拖动与样式已退役。YouDub 字幕校对和工作流页面内部的左右分区保持原有实现。

UI 插槽只承接页面与节点插件使用的 `root` scope，保留 single/list/keyed/chain、Component Factory、依赖注入和按渲染位置隔离的状态生命周期。`session/session-maybe`、`SessionProvider`、`installScope`、`bindStoreScope` 和 `inject(sessionId, ...)` 已退役，旧 scope 声明会在注册时明确报错。原聊天输入框的 `ChainRenderOpts.overlay` 和无消费者的 `ResourceProtocolMap` 已移除。

前端 store 的 `create(scopeKey)` 收敛为 `create()`；session 持久化后缀、`clearPersisted`、`MaybeSnapshotSelectorHook`、`getInitialState` 包装和无消费者的 `flush: 'raf'` 管线退出。root store、现有持久化键、实例隔离、selector 订阅和同步更新保留。

主题保留 light/dark/system、系统主题监听、首次绘制、字体配置和字号快捷键。`exportInspectTokens`、`overrideTokens`、动态主题注册与 token 累加链、无消费者的 `setFontSize/setFontFamily` setter 已退役；实际配置表单和 `adjustFontSizes` 继续生效。通用设置中被 YouDub 隐藏的编码视图、字体行及专用 store 已删除，历史字体配置和 `ui-settings.enabled` 仍被接受。

旧 `settings.onboarding`、`openOnboarding`、`SettingsOnboarding*`、欢迎通知版本和对应样式已退役。YouDub 首次启动的语言、安装目录、环境、模型和翻译服务配置继续由 SetupGate 提供。原 setup 的恒空 token、`X-YouDub-Setup` 和仅供测试使用的 fetch 分支退出；请求统一使用注入的 Harness Connection，API 密钥、密码、token、认证头及签名 URL 的通用诊断脱敏保留。

图标入口只维护当前页面、共享组件与插件示例实际使用的 `Icon*` 导出。无消费者的账号、Agent 预设、归档会话导航和相应图标退出；YouDub 首屏、动效与中文、英文、日文界面保留。桌面更新状态为 `idle/checking/available/error`，版本检查、失败重试和打开下载页保留。退出确认移除恒为空的 scheduledTasks 分支，活动任务和未知状态/超时提醒保留。

前端不再隐式共享 `@tanstack/react-virtual`，使用它的外部插件须声明并自行打包。旧 `ClientManifest/ClientModule`、孤立的复合 locale/theme schema、`resultOf`、store `shallowEqual` 和测试专用窗口几何模型已退役。YouDub 的重复 `/api/v2/extensions*`、`/api/v2/client-manifest` HTTP 适配及其资源失效规则退出，扩展页继续使用官方 `uiPluginManager`。YouDub SDK 退出未使用的 `SDK_VERSION/YouDubContext` 导出和无效 `Files.upload` 大小参数，Context 声明合并保留。

Connection 的重复 `requestRejection/createPeer` 包装、未读 `allowsRemoteAuthorities/isRemoteAuthority` 和 ClientEntries 的无人调用 `retry` 退出；HTTP `admit`、owner 鉴权、实际 API/browser peer 和 `sync` 重试保留。

YouDub 首次模型设置直接消费 Harness activity，移除重复回传状态；旧 `youdub.settings.sections/settings.sections` 空插槽退出，设置扩展使用实际 Harness item/section 注册。模型编辑器仅保留当前 `input` 字段，供应商目录探测对历史字段的转换继续保留。通用词条只维护实际调用项，插件仍通过原语言服务注册自身词条。

## 工具、测试与兼容边界

`PartialArguments`、`snapshotJsonValue`、`WeakMapWithValues`、数字 brand、`bytesToBase64`、`clampTimeout`、无消费者的 home 显示/cache helper 和 Cosmokit array/time/string/binary 输出工具已退役。`mapValues` 的同义别名退出，实际 `valueMap` 保留；Deque 保留使用中的 `pushBack/popFront`，移除 `pushFront`。Timer 只维护 HMR 使用的 `debounce`，随 fiber 释放，未消费的返回 `.dispose` 属性退出。无生产调用的 `deadline/Deadline`、只供测试的 FFI 类型 getter 和 Deque benchmark 退出；LLM 空闲超时、真实 Koffi ABI/句柄验证保留。JSON 验证、配置锁和原错误传播保留。

生成器不再保留无读的成员标记、枚举初始化值和重复文档元数据；实际 schema 描述、Remote 参数/返回说明和错误源位置保留。构建脚本退出不可达的 official profile 和旧 staged provider metadata 校验；当前源码/产物收据验证继续生效。

测试维护范围覆盖实际协议请求、鉴权、凭据脱敏、配置重载和迁移、插件生命周期、启动就绪、取消、普通子进程停止及平台隔离。退出产品的终端、配置导出和反射接口专属测试，以及穷举 Node 模块查找布局的重复矩阵已移除；实际模块解析、主机退出、媒体和工作流回归继续保留。

这是随 YouDub 产品维护的框架子集。依赖上述退役导出、服务方法、插槽、类型或隐式共享包的外部插件需要更新；保留接口的实际行为以源码和对应回归为准。旧任务、用户配置、凭据及已有版本兼容记录继续按各自加载和迁移路径处理，精简不改写这些历史数据。
