# YouDub 框架保留范围与完整精简审计

更新：2026-10-26。当前分支：`codex/product-code-pruning`。来源与许可证见 [upstream.json](../../../vendor/deepseek-harness/upstream.json) 和[框架说明](../../../vendor/deepseek-harness/README.md)。

## 范围与结论

本次对当前 67 个框架源码包、YouDub 前后端、SDK、三个插件示例、桌面入口、工程工具、依赖和测试完成统一审计。所有已确认的删除/合并候选均在本次处理；剩余模块的具体用途见下表。历史分轮报告保存在 Git，本文只维护当前结论。

依据包括生产入口、配置与动态服务名、插件注册、实际 bundle 输入、测试独立行为、编译及界面验收。导出扫描只用来发现候选；类型契约、生命周期和动态注入继续按真实消费判断。保留量不代表每一行达到理论最小值；继续减少功能性模块需要改变当前产品或插件支持范围。

当前维护 67 个框架源码包，运行项目使用其中 59 个；其余用于构建和契约生成。YouDub 媒体、任务、工作流、校对、字幕、配音、下载、资源准备和插件能力继续保留。

## 已完成的精简

| 范围 | 删除/收敛 | 保留边界 |
| --- | --- | --- |
| Typert | 旧 tools 的命名 input/invoke、methods 索引、tool JSON Schema、严格输入副本和专属测试 | 正常 namespace RPC、Zod codec、Context/lookup、scope、stream/uplink、取消、字节编解码与生成类型 |
| 作业与进程 | 无消费者 Jobs 输出环/read/readAt/events/result、fd7 控制流及专属测试 | 真实进度、停止/等待/退出、标准 stdin/stdout/stderr、runner IPC、Windows Job 和进程树释放 |
| 启动与辅助 | 无调用的命名 profile 包装、插件清单重算、stdin 自动退出、native 通用打开/探测、部分 JSON 解析/工具、错误格式化与判别包装 | 应用显式 profile、原始错误、设置文件打开、配置迁移；Gateway/HMR 动态使用的 AppReady 完整保留 |
| 前端 | 旧登录/资源/设置文案、无使用 CSS/类型/schema、react-virtual 隐式预载、测试专用几何模拟与辅助函数、3 个旧静态资产 | 原大标题与动态 Logo、真实窗口拖动 DOM、明暗/多语言、组件/键盘/无障碍、工作流画布 |
| 业务后端 | 测试专用取消异常、旧弱探针、未执行的上传参数、恒定资源 phase、无调用模型探针动作、Context 别名、旧量化 DiffQ 开发依赖 | 真实 WorkerError 取消、四模型准备、媒体算法、数据迁移、原始结果及旧任务已审批指纹 |
| 构建与通用工具 | 旧 release 执行包装、无调用 Worker banner、分析构建旁路、部分 Cosmokit 工具与未用 timer API | 当前源码构建、产物输入验证、代码生成、签名/安装/覆盖升级脚本和测试环境隔离 |

旧 Agent、会话、终端、内嵌浏览器、文档预览、工具执行及上游发布系统已在此前退出产品。历史源码由 Git 保留；Demucs 子模块原提交、许可证和来源信息不变。

## 当前行数

| 范围 | 本次前 `368268d8` | 当前 | 本次净减 |
| --- | ---: | ---: | ---: |
| 生产源码 | 86,907 | 83,813 | 3,094 |
| 测试及源码夹具 | 74,433 | 73,081 | 1,352 |
| 构建和工程工具 | 9,992 | 9,561 | 431 |
| 官网和文档示例 | 599 | 599 | 0 |
| 合计 | 171,931 | 167,054 | 4,877 |

当前生产源码中 Harness 为 **70,024 行**，YouDub 业务与适配为 **13,789 行**。相对最初 `main/aaba8ef3` 的 202,077 行，累计净减 **35,023 行（17.33%）**。本次物理行 186,036 → 180,747；源码文件 1,143 → 1,125。


口径为 Git 跟踪源码扩展名的非空行，含注释。依赖、缓存、生成产物、JSON/YAML、Markdown、快照和媒体不计入；Demucs 子模块另计 6,393 行，未修改。物理行和文件数另列，避免混用。历史 main 基线含后来删除的 178 行生成夹具；严格排除它们时，累计减量相应减 178，当前总量不变。

## 全部框架包的保留依据

下表每一行均已核对源码入口、包声明和对应测试。大量类型与配置由 Cordis/Typert 动态消费，不按静态 import 次数删除。

| 源码包目录 | 当前责任 |
| --- | --- |
| [apps/cli](../../../vendor/deepseek-harness/source/apps/cli/package.json) | 显式应用 profile 启动、AppReady 信号、异常与有序退出。 |
| [apps/desktop](../../../vendor/deepseek-harness/source/apps/desktop/package.json) | 窗口与 preload、IPC、原生快捷键、配置升级、Host 生命周期及故障记录。 |
| [apps/desktop-host](../../../vendor/deepseek-harness/source/apps/desktop-host/package.json) | 隔离的 Host 进程、就绪 IPC、任务活动与退出检查。 |
| [apps/web](../../../vendor/deepseek-harness/source/apps/web/package.json) | 框架浏览器入口与实际 Web 产物构建。 |
| [packages/api/gateway](../../../vendor/deepseek-harness/source/packages/api/gateway/package.json) | 经过 owner 认证的 RPC、事件、流、取消与二进制传输。 |
| [packages/api/remotes](../../../vendor/deepseek-harness/source/packages/api/remotes/package.json) | 设置、凭据、模型等服务的事件转发。 |
| [packages/api/settings-controller](../../../vendor/deepseek-harness/source/packages/api/settings-controller/package.json) | 设置 Remote、凭据安全视图与原生配置文件打开。 |
| [packages/boot/app-boot](../../../vendor/deepseek-harness/source/packages/boot/app-boot/package.json) | Loader/profile 合成、应用与插件解析、升级兼容和旧链接清理。 |
| [packages/boot/cmdline](../../../vendor/deepseek-harness/source/packages/boot/cmdline/package.json) | 启动参数、命令解析、AppReady 与应用退出服务。 |
| [packages/boot/config-editor](../../../vendor/deepseek-harness/source/packages/boot/config-editor/package.json) | 持久化用户 patch 并接入已有配置重载。 |
| [packages/boot/hmr](../../../vendor/deepseek-harness/source/packages/boot/hmr/package.json) | 源码开发和用户插件安装/配置后的模块热更新。 |
| [packages/boot/plugin-manager](../../../vendor/deepseek-harness/source/packages/boot/plugin-manager/package.json) | 本地与第三方插件安装、构建批准、配置、启停及卸载。 |
| [packages/bundle/web-app](../../../vendor/deepseek-harness/source/packages/bundle/web-app/package.json) | dev:web 参数、监听地址、TLS、受信任 Host 和浏览器启动。 |
| [packages/client/connection](../../../vendor/deepseek-harness/source/packages/client/connection/package.json) | Host 连接、RPC/HTTP、认证、代际失效与重连。 |
| [packages/client/hmr](../../../vendor/deepseek-harness/source/packages/client/hmr/package.json) | 客户端模块与样式的开发热更新。 |
| [packages/client/locale](../../../vendor/deepseek-harness/source/packages/client/locale/package.json) | 语言注册、选择、持久化和缺失词条解析。 |
| [packages/client/modules](../../../vendor/deepseek-harness/source/packages/client/modules/package.json) | 插件前端模块图、动态加载、失败与卸载。 |
| [packages/client/shortcuts](../../../vendor/deepseek-harness/source/packages/client/shortcuts/package.json) | 键盘/菜单、输入框与 IME 隔离及快捷键偏好。 |
| [packages/client/store](../../../vendor/deepseek-harness/source/packages/client/store/package.json) | 共享状态、快照、订阅与 action；现有 Zustand/Immer。 |
| [packages/client/ui-layout](../../../vendor/deepseek-harness/source/packages/client/ui-layout/package.json) | AppFrame、列布局及产品/插件公共布局槽。 |
| [packages/client/ui-plugin-manager](../../../vendor/deepseek-harness/source/packages/client/ui-plugin-manager/package.json) | 插件列表、详情、配置、安装进度与失败恢复控件。 |
| [packages/client/ui-primitives](../../../vendor/deepseek-harness/source/packages/client/ui-primitives/package.json) | 产品和插件示例实际使用的基础控件及图标。 |
| [packages/client/ui-renderer](../../../vendor/deepseek-harness/source/packages/client/ui-renderer/package.json) | React 渲染桥、组件工厂、状态绑定、订阅与释放。 |
| [packages/client/ui-settings](../../../vendor/deepseek-harness/source/packages/client/ui-settings/package.json) | 设置对话框与表单注册。 |
| [packages/client/ui-settings-general](../../../vendor/deepseek-harness/source/packages/client/ui-settings-general/package.json) | 外观、语言、版本与通用偏好页面。 |
| [packages/client/ui-settings-models](../../../vendor/deepseek-harness/source/packages/client/ui-settings-models/package.json) | 供应商、协议、URL、凭据遮罩和模型目录编辑。 |
| [packages/client/ui-sidebar](../../../vendor/deepseek-harness/source/packages/client/ui-sidebar/package.json) | 原生风格侧栏与折叠组件。 |
| [packages/client/ui-slots](../../../vendor/deepseek-harness/source/packages/client/ui-slots/package.json) | root single/list/keyed/chain、注入、实例隔离和插件扩展。 |
| [packages/client/ui-theme](../../../vendor/deepseek-harness/source/packages/client/ui-theme/package.json) | 明暗主题、样式 token、字号偏好与系统主题。 |
| [packages/client/web](../../../vendor/deepseek-harness/source/packages/client/web/package.json) | 平台模块、浏览器启动、基础样式和窗口拖动 DOM 标记。 |
| [packages/core/scope](../../../vendor/deepseek-harness/source/packages/core/scope/package.json) | 连接拥有的子 Context 与等待完整释放的边界。 |
| [packages/credentials/credentials](../../../vendor/deepseek-harness/source/packages/credentials/credentials/package.json) | 模型提供商凭据引用、记录及安全投影合同。 |
| [packages/credentials/credentials-local](../../../vendor/deepseek-harness/source/packages/credentials/credentials-local/package.json) | 私有凭据、原有文件迁移、锁、监听和写入。 |
| [packages/host/frontend-static](../../../vendor/deepseek-harness/source/packages/host/frontend-static/package.json) | 实际前端资源服务、路由与 Connection 注入。 |
| [packages/host/plugin-inventory](../../../vendor/deepseek-harness/source/packages/host/plugin-inventory/package.json) | 当前插件能力、来源和版本清单。 |
| [packages/host/webserver](../../../vendor/deepseek-harness/source/packages/host/webserver/package.json) | HTTP/TLS、连接升级、Origin/Host 认证与上传。 |
| [packages/jobs/jobs](../../../vendor/deepseek-harness/source/packages/jobs/jobs/package.json) | 后台作业生命周期合同、控制器、进度及取消。 |
| [packages/jobs/jobs-local](../../../vendor/deepseek-harness/source/packages/jobs/jobs-local/package.json) | 注册、等待、取消、释放和退出检查所用的作业状态。 |
| [packages/llm/llm](../../../vendor/deepseek-harness/source/packages/llm/llm/package.json) | Harness prepareCall → stream、模型配置、文本/思考/用量和错误。 |
| [packages/llm/llm-pi-ai](../../../vendor/deepseek-harness/source/packages/llm/llm-pi-ai/package.json) | 实际供应商 SDK 适配、协议默认值、模型目录与取消。 |
| [packages/settings/settings](../../../vendor/deepseek-harness/source/packages/settings/settings/package.json) | 插件配置 schema、解析、凭据隔离和配置变更。 |
| [packages/subprocess/subprocess](../../../vendor/deepseek-harness/source/packages/subprocess/subprocess/package.json) | YouDub Python/FFmpeg 的标准进程合同与环境过滤。 |
| [packages/subprocess/subprocess-local](../../../vendor/deepseek-harness/source/packages/subprocess/subprocess-local/package.json) | 标准流、进程树、停止升级、资源释放及 runner IPC。 |
| [packages/subprocess/win32-process](../../../vendor/deepseek-harness/source/packages/subprocess/win32-process/package.json) | Windows CreateProcessW、Job Object、参数及句柄生命周期。 |
| [packages/typert/generator](../../../vendor/deepseek-harness/source/packages/typert/generator/package.json) | 构建时生成服务/事件/Remote 类型图、codec、声明与 source map。 |
| [packages/typert/loader](../../../vendor/deepseek-harness/source/packages/typert/loader/package.json) | 加载并验证生成合同，跟随插件注册与卸载。 |
| [packages/typert/protocol](../../../vendor/deepseek-harness/source/packages/typert/protocol/package.json) | Remote 声明、普通 codec、流、Context/lookup 和二进制合同。 |
| [packages/typert/registry](../../../vendor/deepseek-harness/source/packages/typert/registry/package.json) | 实际服务、对象、事件及 Remote 描述符索引。 |
| [packages/util/atomic-write](../../../vendor/deepseek-harness/source/packages/util/atomic-write/package.json) | 凭据与配置锁、原子写入及真实失败恢复。 |
| [packages/util/brand](../../../vendor/deepseek-harness/source/packages/util/brand/package.json) | ID 字符串类型品牌。 |
| [packages/util/crypto](../../../vendor/deepseek-harness/source/packages/util/crypto/package.json) | 浏览器非安全 HTTP 环境可用的 UUID。 |
| [packages/util/deque](../../../vendor/deepseek-harness/source/packages/util/deque/package.json) | Gateway/事件队列。 |
| [packages/util/home-paths](../../../vendor/deepseek-harness/source/packages/util/home-paths/package.json) | YouDub 所有的 home/profile 路径规范化。 |
| [packages/util/http-proxy](../../../vendor/deepseek-harness/source/packages/util/http-proxy/package.json) | 启动、模型及下载代理与 loopback 绕过。 |
| [packages/util/launch-environment](../../../vendor/deepseek-harness/source/packages/util/launch-environment/package.json) | 启动环境快照、变量分层和 SSH 状态。 |
| [packages/util/lazy-require](../../../vendor/deepseek-harness/source/packages/util/lazy-require/package.json) | 按实际平台延迟载入原生 Koffi。 |
| [packages/util/native-command](../../../vendor/deepseek-harness/source/packages/util/native-command/package.json) | 原生文本配置打开、Windows/WSL 路径与取消。 |
| [packages/util/package-manifest](../../../vendor/deepseek-harness/source/packages/util/package-manifest/package.json) | 动态插件包入口和元数据解析。 |
| [packages/util/timeout](../../../vendor/deepseek-harness/source/packages/util/timeout/package.json) | LLM/Jobs/进程的超时分类、deadline 和释放。 |
| [packages/util/values](../../../vendor/deepseek-harness/source/packages/util/values/package.json) | 无损 JSON 校验、相等与冻结；保留深层/跨 realm/原错误语义。 |
| [vendor/cordis](../../../vendor/deepseek-harness/source/vendor/cordis/package.json) | Context、Service、注入、fiber、事件与日志底座。 |
| [vendor/cosmokit](../../../vendor/deepseek-harness/source/vendor/cosmokit/package.json) | 上述底座实际使用的对象、相等、复制、volatile 与输入转换。 |
| [vendor/group](../../../vendor/deepseek-harness/source/vendor/group/package.json) | 配置树分组插件。 |
| [vendor/include](../../../vendor/deepseek-harness/source/vendor/include/package.json) | 配置文件、patch 层次、写入与重载。 |
| [vendor/loader](../../../vendor/deepseek-harness/source/vendor/loader/package.json) | 插件解析、服务隔离、配置树和生命周期。 |
| [vendor/schemastery](../../../vendor/deepseek-harness/source/vendor/schemastery/package.json) | 官方 ConfigForms 的配置验证，字段由插件动态声明。 |
| [vendor/timer](../../../vendor/deepseek-harness/source/vendor/timer/package.json) | HMR 使用的 fiber 绑定 debounce。 |

## YouDub、工程和测试保留依据

| 范围 | 必须保留的当前行为 |
| --- | --- |
| `apps/web`、Harness 前端适配 | 首屏、上传/视频链接、任务库、人工修改确认、画布、播放器、资源和插件页；query 缓存、导航保护、主题和三语同步。业务薄组件复用 Harness 控件。 |
| `packages/sdk`、`builtin`、Harness Host | 节点和图合同、队列、状态/冲突、文件归属、重跑与取消、逐项资源准备、模型配置和官方 LLM 调用。SDK 保留用于声明合并的纯类型 Cordis 导入。 |
| Python `backend` | Demucs、Whisper/分句、VoxCPM2、Qwen 对齐、混音、字幕/视频导出、YouTube/Bilibili 下载、SQLite 与 NDJSON 协议。父进程取消与子进程模型加载责任各自保留。 |
| 三个插件 fixture | 文件转换、图文本审核、Python 节点的可安装合同与真实集成验收，共用当前 Loader。 |
| 桌面/启动/打包脚本 | 独立应用/数据、Windows覆盖升级、原生文件框、窗口/快捷键、退出检查和源码开发启动。源码编译、图标、签名、下载feed各有实际入口。 |
| 测试 | 删除退役能力的自测与无业务几何模型；保留协议、鉴权/密钥、升级、文件/数据一致性、取消/释放、媒体与插件生命周期。页面和底层测试覆盖不同边界，失败分支不因行数较多而删除。 |
| 官网/安装器/CI/资源 | 当前官网与试听、应用图标、安装覆盖与发布时验收、来源/许可证。安装包任务仍需显式开启。 |

资源声明中重复的依赖属于独立安装组，单独安装每组仍需要它们；不合并为依赖用户先安装另一组的隐式前提。旧 defaults 解码、数据库升级、凭据迁移和已审批执行指纹均为现有用户使用路径。

## 验证和实际限制

- 新源码框架、YouDub Host/Client/Electron 编译与装配检查通过；root/web 类型检查和中英日检查通过（547 业务键、7 个框架 namespace）。
- 最终全框架 **246 文件，3,850 项通过，0 失败，19 项跳过**。跳过项为当前 macOS 无法执行的 Windows/Linux 原生检查及大小写敏感文件系统案例。
- YouDub 宿主 **80 项**、builtin **141 项**、Python **422 项**、Web **245 项**通过；共 **4,738 个唯一通过用例**。重复定向重跑不重复计数。builtin 封面测试初次误用缺库的 Homebrew FFmpeg；改为 YouDub 私有 FFmpeg，仅重跑失败的 3 项通过。
- 最终独立中文 Electron profile 检查工作台大标题和运行中的 Logo 动效、视频输入、任务库、内置工作流/画布、资源、插件详情/安装弹窗、明暗设置和模型页；页面运行错误为 0。测试配置如实显示未准备的资源。
- 四方交叉审查与最后的函数/常量/动态服务复扫完成；已发现候选没有遗留。剩余单处函数引用为插件示例消费的 `registerPythonProvider` 和验证实际 Win32 ABI 的结构 getter。


交叉审查纠正了 AppReady 的动态消费者误判，恢复真实启动语义；没有删除消费者来维持减量。SDK 的类型导入与退役接口的旧测试也在本次验证中修正。业务的 8 个 provider/workflow、20 个既往 hash 已逐项确认仍被批准兼容。

当前公开子集发生的退役 API 详见[维护中的接口范围](../../../vendor/deepseek-harness/README.md#维护中的接口范围)。使用旧接口的外部插件需适配；当前三个插件示例使用保留合同。没有承诺任意上游插件原样兼容。

详细四方审计、统计、测试日志和中文截图保存在本地 `output/full-pruning-2026-10-26/`。本次未调用外部 LLM，未重新进行四模型真实视频端到端推理、Windows/Linux 实机或安装覆盖验收；这些不计入通过结果。未打包、推送或发布。
