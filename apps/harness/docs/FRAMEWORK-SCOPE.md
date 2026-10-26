# YouDub 框架保留范围与完整精简审计

更新：2026-10-26。当前分支：`codex/product-code-pruning`。来源与许可证见 [upstream.json](../../../vendor/deepseek-harness/upstream.json) 和[框架说明](../../../vendor/deepseek-harness/README.md)。

## 范围与结论

本次以基线 `fac73ac3` 的 1,540 个 Git 跟踪文件建立审计矩阵，覆盖 67 个框架源码包、YouDub 前后端、SDK、三个插件示例、桌面入口、隐藏文件、资源、工程工具、依赖和测试。审计按“核实消费者 → 清理依赖闭包 → 重新扫描 → 交叉复核”循环，最后各分区完整复扫均无新增明确可删项；剩余模块的具体用途见下表。历史分轮报告保存在 Git，本文只维护当前结论。

依据包括生产入口、配置与动态服务名、插件注册、实际 bundle 输入、测试独立行为、编译及界面验收。导出扫描只用来发现候选；类型契约、生命周期和动态注入继续按真实消费判断。此前只看导出引用遗漏了内部互相引用的旧系统，本轮补查方法、生产者字段、生成器元数据、测试专用 API、清单与样式。保留量不代表每一行达到理论最小值；结论限定为当前产品范围和已核验的扫描结果。

当前维护 67 个框架源码包，运行项目使用其中 59 个；其余用于构建和契约生成。YouDub 媒体、任务、工作流、校对、字幕、配音、下载、资源准备和插件能力继续保留。

## 已完成的精简

| 范围 | 删除/收敛 | 保留边界 |
| --- | --- | --- |
| Typert | 旧 tools 合同、schema/package 反射目录、无消费者资源权限注解、源文档渲染、跨 face 记录侧索引、仅为反射生成的声明元数据及专属测试 | 正常 namespace RPC、Zod codec、Context/lookup、scope、stream/uplink、取消、字节编解码与生成类型 |
| 作业与进程 | 无消费者 Jobs 输出环/read/readAt/events/result、fd7 控制流及专属测试 | 真实进度、停止/等待/退出、标准 stdin/stdout/stderr、runner IPC、Windows Job 和进程树释放 |
| 启动与辅助 | 无调用的命名 profile 包装、插件清单重算、stdin 自动退出、native 通用打开/探测、部分 JSON 解析/工具、错误格式化与判别包装 | 应用显式 profile、原始错误、设置文件打开、配置迁移；Gateway/HMR 动态使用的 AppReady 完整保留 |
| 前端 | 旧设置向导、无注册的全局第三栏/底栏、闲置动态主题 API、session store 尾部、RAF 自测支路、空 setup token/重复 HTTP 请求和无用依赖 | 原大标题与动态 Logo、真实窗口拖动 DOM、明暗/多语言、组件/键盘/无障碍、工作流画布 |
| 业务后端 | 重复扩展 HTTP 和旧 workflows 路由、测试专用身份字段/常量、无人读取的资源元数据、旧弱探针与量化开发依赖 | 真实 WorkerError 取消、四模型准备、媒体算法、数据迁移、原始结果及旧任务已审批指纹 |
| 框架服务与工程 | Cordis 只写不读的诊断采集、LLM 独立查询旁路、raw HTML 注入、恒 false 的定时任务状态、插件版本豁免写入接口、代理诊断镜像、Loader 共享环境尾部及无用依赖 | 当前源码构建、产物输入验证、代码生成、签名/安装/覆盖升级脚本和测试环境隔离 |

旧 Agent、会话、终端、内嵌浏览器、文档预览、工具执行及上游发布系统已在此前退出产品。历史源码由 Git 保留；Demucs 子模块原提交、许可证和来源信息不变。

## 当前行数

| 范围 | 本次前 `fac73ac3` | 当前 | 本次净减 |
| --- | ---: | ---: | ---: |
| 生产源码 | 79,980 | 79,803 | 177 |
| 测试及源码夹具 | 70,368 | 70,164 | 204 |
| 构建和工程工具 | 8,560 | 8,538 | 22 |
| 官网和文档示例 | 599 | 599 | 0 |
| 合计 | 159,507 | 159,104 | 403 |

当前生产源码中 Harness 为 **66,277 行**，YouDub 业务与适配为 **13,526 行**。相对最初 `main/aaba8ef3` 的 202,077 行，累计净减 **42,973 行（21.27%）**。本次物理行 172,600 → 172,163；源码文件 1,106 → 1,104。

口径为 Git 跟踪源码扩展名的非空行，含注释、内置数据与可执行测试夹具。依赖、缓存、构建产物、JSON/YAML、Markdown、文本快照和媒体不计入；Demucs 子模块另计 6,393 行，未修改。物理行和文件数另列，避免混用。历史 main 基线含后来删除的 178 行生成夹具；严格排除它们时，累计减量相应减 178，当前总量不变。

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
| [packages/jobs/jobs](../../../vendor/deepseek-harness/source/packages/jobs/jobs/package.json) | 活动作业合同、控制器及取消。 |
| [packages/jobs/jobs-local](../../../vendor/deepseek-harness/source/packages/jobs/jobs-local/package.json) | 活动作业注册、退出取消、释放及 Host 退出检查。 |
| [packages/llm/llm](../../../vendor/deepseek-harness/source/packages/llm/llm/package.json) | Harness prepareCall → stream、模型配置、文本/思考/用量和错误。 |
| [packages/llm/llm-pi-ai](../../../vendor/deepseek-harness/source/packages/llm/llm-pi-ai/package.json) | 实际供应商 SDK 适配、协议默认值、模型目录与取消。 |
| [packages/settings/settings](../../../vendor/deepseek-harness/source/packages/settings/settings/package.json) | 插件配置 schema、解析、凭据隔离和配置变更。 |
| [packages/subprocess/subprocess](../../../vendor/deepseek-harness/source/packages/subprocess/subprocess/package.json) | YouDub Python/FFmpeg 的标准进程合同与环境过滤。 |
| [packages/subprocess/subprocess-local](../../../vendor/deepseek-harness/source/packages/subprocess/subprocess-local/package.json) | 标准流、进程树、停止升级、资源释放及 runner IPC。 |
| [packages/subprocess/win32-process](../../../vendor/deepseek-harness/source/packages/subprocess/win32-process/package.json) | Windows CreateProcessW、Job Object、参数及句柄生命周期。 |
| [packages/typert/generator](../../../vendor/deepseek-harness/source/packages/typert/generator/package.json) | 构建时生成实际 schema factory、Remote codec、声明与 source map。 |
| [packages/typert/loader](../../../vendor/deepseek-harness/source/packages/typert/loader/package.json) | 加载并验证生成合同，跟随插件注册与卸载。 |
| [packages/typert/protocol](../../../vendor/deepseek-harness/source/packages/typert/protocol/package.json) | Remote 声明、普通 codec、流、Context/lookup 和二进制合同。 |
| [packages/typert/registry](../../../vendor/deepseek-harness/source/packages/typert/registry/package.json) | 按包和 face 管理 Remote 描述符、lookup/context 及注册释放。 |
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
| [packages/util/timeout](../../../vendor/deepseek-harness/source/packages/util/timeout/package.json) | LLM 空闲超时、取消、超时分类、timer 范围和释放。 |
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

## 本轮收敛复核

前一轮遗漏了聚合测试/脚本类型检查、未注册的整套页面装配、生产路径和测试路径的分叉。本轮从实际入口与状态生命周期重新核对，处理确认项后再次扫描，并交叉审核其他分区。检查覆盖全部源码与测试；单次名称出现和静态未引用均只作为线索。

- 首页固定使用已注册的图工作流，删除旧首页选择器及父层锁状态；第三方工作流仍由 GraphStudio 调用 Composer，旧任务的 localize 编辑和重跑继续保留。GraphStudio 参数按实际唯一调用设为必传。
- 删除未注册的旧插件管理页面装配和专用图标。YouDub 继续使用原管理器、列表、配置、安装进度、导航和插槽；Host Remote、声明合并和动态注册合同保留。
- 文件 URL 与剪贴板统一到实际运行实现，删除构建替换和重复 SDK 重定向；测试覆盖鉴权文件路由及复制失败。删去不存在的旧模型 HTTP 路由匹配，模型更新仍接收官方服务事件。
- 删除只被测试读取的 DesktopPaths.lock、BootSeams 和 cmdline internals，测试改用真实 profile 锁路径、模块传输入口和标准输出；浏览器启动的临时对象收回局部变量。进程退出与原生系统调用等必要测试边界保留。
- 布局只计算真正消费的侧栏宽度，内容宽度交给现有 CSS；去掉中心宽度副本、恒定 clamp 参数和无效 title cleanup。响应式窗口尺寸、侧栏折叠和拖动保持。
- Typert 删除无人消费的成员 abstract 与只扩展孤立工厂的 implements 边；对象成员、构造类型 abstract、extends、实际类型引用和 schema 保留。构建移除无调用参数与常量，并增加两项现有 TypeScript 聚合检查，覆盖生产引用之外的脚本和测试。
- 内部服务按实际注入合同移除目录、安装配置和回调的虚假缺省分支；文件响应、依赖准备与节点 schema 去掉重复默认值。组件和非组件调用链均按实际参数值复查，真实空值、动态插件和工程脚本消费者保留。
- Python 媒体取消链直接接收实际检查函数，去掉重复存在性判断；字幕语言与下载代理只由上层配置提供默认值，容器时长回退和代理规范化保留。当前执行源码指纹更新并保留此前审核记录；Worker 外部请求握手仍属于插件公开协议。
- 凭据测试共用同包 fixture；子进程普通测试直接运行 Node，真实 POSIX 信号/进程组仍用 shell；模块加载测试复用同文件引导，原生路径案例并入原参数表。仅删除已被完整集合断言覆盖的机械测试，以及退役布局/首页专属案例。

剩余相似代码有明确边界：独立竞态的初始化、不同平台原生协议、不同包 Loader fixture、配置草稿与已提交值、模块目标版本与已装载版本。把这些合并会新增跨边界依赖或改变行为。最后字面量归一化测试体扫描无重复候选；完整复扫与交叉复核未发现新增可安全删除项。这里记录当前功能范围下的审计结论，不把保留行数当作理论最小值。

## 验证结果与边界

- 最终框架 8 步编译、YouDub 源码编译、装配检查和 root/web 类型检查通过；中英日 542 个业务键、7 个框架 namespace 校验通过。
- 全框架 243 个测试文件：3,716 项通过、0 项失败、19 项平台用例跳过。Host 80 项、SDK/工作流 140 项、Web 240 项、Python 420 项通过，共 **4,596 个唯一通过用例**；定向预验与重复运行不累加。
- Python 使用已安装的 YouDub 私有 Python、FFmpeg/ffprobe，覆盖真实媒体生成、字幕、混音及取消回收。环境、模型与历史用户任务不改动。
- 首次聚合检查发现退役字段与无用导入；旧插件入口删除后遗漏的纯类型声明依赖已补齐。Web 复制日志测试改为验证正式剪贴板的失败提示，保留诊断全文。原失败日志均保留。首次安装页验收脚本先误选了 HTML img，按实际 SVG image 修正后验证内嵌资源解码和画面，产品代码无变更。
- 并发运行多套回归时，框架有 3 项失败；独立复现的 45 项及降低并发后的完整框架回归通过，未放宽断言或超时。只以最后完整回归作为通过证据。
- 独立中文 Electron profile 验证首屏与运行中的 Logo 动效、键盘菜单、任务库、工作流画布、资源、插件详情/安装弹窗、明暗设置和模型页。另用全新 profile 验证首次安装的语言、目录与内嵌 Logo。页面运行错误为 0，验收实例已关闭。
- 最后分区完整复扫、全仓扫描和独立交叉复核均无新增确认可安全删除项。审计覆盖当前功能、插件合同、数据兼容、错误和安全边界；逐包用途与候选保留依据见上文。
- 本轮未进行模型下载、外部 LLM 调用、四模型真实推理或 Windows/Linux 实机安装；未打包、推送或发布。

本地证据目录：`output/pruning-exhaustive-2026-10-26/`，包含分类计数、全仓候选、分区报告、复扫结果、原始失败日志、最终回归和中文截图。报告在此记录已验证边界，忽略目录不进入提交。
