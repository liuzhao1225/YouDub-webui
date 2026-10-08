# YouDub Cordis 插件化迁移与验收计划

2026-10-08 · 分支 `codex/plugin` · 基线 `e0dcb58`。[架构设计](cordis-plugin-architecture.md)定义目标，[契约设计](cordis-plugin-contracts.md)定义 workflow、operation 与进程边界。

本轮交付为设计和分支。下列实施阶段均未开始，文档检查不代表 Cordis 已运行、插件已安装、代码已重构或服务已切换。

## 1. 实施范围

首轮实现一个可运行的默认组合：本地文件导入、单活跃任务、现有字幕/配音/both 三模式、现有模型、三页界面、登录、取消/重试/重新生成/删除、预览和下载。所有这些业务由普通 Cordis 插件提供。默认 workflow 与通用 workflow 引擎分别注册；首版引擎和任务状态机同属一个插件。

外部扩展验收覆盖三个边界：替换一个模型提供者、增加一个业务 workflow、增加一个 Client 面板或页面。可将其作为同一独立测试仓库中的三个模块，避免为了演示建立多个仓库。测试夹具与真实模型结果分别标记。

延后：运行中热升级、任意 DAG、并行步骤、人工审批流程、分布式 worker、插件市场、权限沙箱、多套包管理系统、跨插件数据库和自动故障恢复。

## 2. 阶段与责任

实施负责人同时负责代码、必要验证、授权环境发布和验收；阶段记录必须写明实际版本和未完成事项。用户当前授权范围为分支与设计，后续实施按独立任务推进。

| 阶段 | 状态 | 内容 | 放行证据 |
| --- | --- | --- | --- |
| P0 最小可行性验证 | 未开始 | 固定 Cordis/Loader/Include 依赖；纯服务提供/消费/替换；Python bridge；Next 外部 Client 加载 | 生命周期、进程取消、缺依赖失败、生产构建免重建扩展全部通过 |
| P1 公共契约与基础提供者 | 未开始 | SDK、files/process/store/secrets、catalog、默认组合配置；完整事务式存储桥 | 官方和外部贡献同接口；持久化错误及原始原因准确；未启动旧任务循环 |
| P2 通用引擎与默认 workflow | 未开始 | task-runtime、默认 workflow、固定执行快照、动态步骤；提取现有 Python 计算 | 三模式实际计划正确；取消/等待/重试/迟到结果正确；默认引擎可替换 |
| P3 API 与前端插件组合 | 未开始 | auth、HTTP、v2 API、v1 映射、浏览器 Cordis、官方页面、安装管理 | 现有产品行为保留；第三方页面、步骤、产物无需改主程序代码 |
| P4 数据迁移与真实闭环 | 未开始 | 两份数据库与凭据兼容、旧历史预览；真实媒体及外部扩展验收 | 历史数据完整；真实三模式链、实际取消、下载/播放正确；切换预演通过 |
| P5 发布与运行验收 | 未开始 | 候选版本固定、停止旧 worker、迁移、启动新组合、浏览器和 API 回读 | 发布版本明确；单一调度权威；默认功能和插件切换在目标环境实际通过 |

P0 出现核心失败时先修正设计与协议，再推进业务迁移。不得以模拟接口通过代替跨语言或浏览器运行证据。

## 3. P0 必须回答的问题

1. **Cordis 启动与关闭。** 缺依赖、模块导入失败、异步初始化失败、清理失败均保留原始诊断；只有必需插件真实 ACTIVE 才就绪。关闭等待所挂载应用 Fiber 及真实进程退出，不能把 Loader settled 或 dispose 返回等同成功。
2. **Python 单次模型调用。** 一个独立目录插件使用自己的 `.venv`，接收标准输入文件，返回真实音频元信息；取消时本机进程及其子进程退出。坏 JSON、stderr、异常退出和缺输出均被准确报告。
3. **存储完整事务。** 多次并发 claim 只有一次成功；比较更新拒绝旧 attempt；在提交前后断开桥接，分别验证未提交与结果未知的报告，禁止重复模型执行。
4. **浏览器模块身份。** Next 生产构建完成后安装独立 Client ESM，刷新可见；React hook、共享 context、Cordis 生命周期和样式生效，主程序构建产物哈希不变。
5. **调用开销。** 分别记录 Python 冷启动、模型加载、推理、序列化和文件传输时间。复用现有“每阶段进程、阶段内多句”的粒度，测量后再决定是否需要模型常驻。
6. **框架耦合。** bootstrap 和 SDK 不导入 SQLite、默认 workflow、模型或产品页面。更换 workflow/provider 只改插件组合；更换整个 task-runtime 只要实现其公共契约。

Node.js 22、macOS arm64 为当前本地验证基线。Windows 进程树终止、路径和凭据库另列实机检查；未验证的平台不得标记已支持该重构版本。外部 LLM 验证请求遵守输出上限至少 65,535 的规则。

## 4. 现有代码的迁移落点

| 当前代码 | 目标归属 | 关键约束 |
| --- | --- | --- |
| [main.py](../../backend/app/main.py)、[worker.py](../../backend/app/worker.py) | HTTP/API 插件和 task-runtime | 新宿主不启动原 FastAPI lifespan/worker |
| [v1/executor.py](../../backend/app/v1/executor.py)、[tasks.py](../../backend/app/v1/tasks.py) | 通用任务引擎与默认 workflow | 七阶段分派移入 workflow，状态条件更新保持原子 |
| [runtime.py](../../backend/app/v1/runtime.py) | catalog 与提供者 probe | 去除固定 adapter 列表和数组下标绑定 |
| [contracts.py](../../backend/app/v1/contracts.py) | SDK 通用契约与默认 workflow schema | 默认视频字段从通用 Task 解耦 |
| [storage.py](../../backend/app/v1/storage.py)、[schema.sql](../../backend/app/v1/schema.sql) | store-sqlite 插件 | 显式 schema 升级，旧记录逐项保留 |
| [credentials.py](../../backend/app/v1/credentials.py)、[auth.py](../../backend/app/auth.py) | secrets、auth 插件 | 保留原凭据引用、哈希、Cookie 和 CSRF 语义 |
| [asr.py](../../backend/app/v1/asr.py)、[tts.py](../../backend/app/v1/tts.py) 等 | 模型提供者与 Python worker | 统一 transcript，解除 Whisper raw 的跨提供者依赖 |
| [media.py](../../backend/app/v1/media.py)、[mix.py](../../backend/app/v1/mix.py)、[export.py](../../backend/app/v1/export.py) | 媒体 operation 提供者 | 保留实际音视频及时间轴行为 |
| [前端 API](../../apps/web/src/lib/v1-api.ts)、[配置表单](../../apps/web/src/components/v1-task-config.tsx) | Client API 插件、通用配置渲染与默认 workflow UI | 默认规则不进入浏览器引导层 |
| [app-shell](../../apps/web/src/components/app-shell.tsx)、现有页面 | 官方 Client 插件 | 页面经公共注册入口加载，复用视觉组件和样式 |

## 5. 数据和凭据迁移

当前有用户数据目录内的 `desktop.sqlite` 和仓库 `data/youdub.sqlite`；后者仍保存认证与旧任务相关数据。v1 的 `current_stage` 和 settings key 有封闭 CHECK，现有 Store 只接受版本 1。动态 workflow 需要真正的 schema 升级。[v1 存储](../../backend/app/v1/storage.py)、[DDL](../../backend/app/v1/schema.sql)、[旧数据库](../../backend/app/database.py)

迁移原则：

- 保留任务 ID、attempt、状态、创建时间、输入/产物路径、原始错误、原始配置及原始模型响应。
- v1 库仍维持 tasks/settings 两类业务数据；tasks 增加固定 workflow/plan/bindings、steps 状态和通用产物描述。设置按插件命名空间组织，取消封闭 key 约束。
- 原配置与上下文保存为明确的 legacy snapshot，迁移映射不能伪造历史插件版本。历史成功任务可展示既有元信息和产物；精确旧实现无法解析时明确显示执行版本未解析。
- 旧 legacy 数据库保留原位；首版历史只读适配插件提供查询与已有产物访问。旧任务转入新系统须显式导入为新 Task，原始记录保留；没有迁移路径的旧活动任务阻止正式切换。
- 凭据继续使用 OS keyring 的 `YouDub` 命名空间，复用 reference。连接默认值变化不能删除仍由历史任务引用的密钥。密码哈希、Cookie 名、TTL、会话及 CSRF 行为按既有实现回归。
- 插件版本、目录和 UI 元数据不写入密钥值；`.env` 与 `env.txt` 保持硬链接和 Git 忽略规则。

升级流程先在显式数据副本上预演，检查数量、字段、产物哈希与凭据引用。正式切换停止旧 worker 后执行 schema 事务，失败保留原始错误并停止启动。应用层不静默恢复旧配置、不跳过异常记录。迁移工具拒绝未知更高 schema 版本。

running/cancelling 任务必须先完成或明确停止。queued/waiting 任务仅在旧参数、远端 ID、请求键和 provider 绑定能精确迁移时继续；无法映射时保留原记录并阻止切换，不能重新发出远端请求冒充恢复。

## 6. 对外兼容与切换

迁移中可使用隔离测试目录与端口运行候选。新旧实例不能同时执行同一份数据中的任务；启动前检查端口和活动进程。测试用认证与模型请求不能被记为实际生产验收。

v2 API 与新 UI 随同一候选发布。v1 兼容插件保留现有默认流程与历史读取，明确拒绝不能无损表达的新 workflow。兼容层作为普通插件有独立契约测试，后续按实际使用情况退出。

正式切换由负责人依次完成：

1. 固定已经通过检查的代码、依赖锁和插件组合；记录 commit 与包完整性。
2. 只读检查端口、数据版本、活动任务、模型和凭据引用，确认迁移条件满足。
3. 停止原 worker，确认本机活动计算已经退出；保留远端未知状态。
4. 执行已预演的迁移；启动 Cordis Host 和 Client 默认组合。
5. 回读实际版本、插件 ACTIVE 状态、登录、Runtime、Settings、历史任务和文件。
6. 完成真实视频及外部插件验收，记录限制与未完成平台。

切换任一步失败即停止后续步骤并报告实际状态。服务进程存在、端口可访问和包已安装分别只是对应步骤证据。

## 7. 最终验收矩阵

| 范围 | 必须证明 |
| --- | --- |
| 最底层插件化 | 空组合无产品后台；替换 task-runtime 不改 API/workflow；所有官方功能均可追溯到所挂载插件 |
| 默认 workflow | 三模式、可选对齐和参考处理的计划准确；内核无七阶段或模型特判 |
| 外部 workflow | 独立仓库注册新步骤和产物，主程序代码与构建不变即可执行 |
| 模型替换 | 同契约第二提供者真实生成产物；不兼容语言/声线在提交前明确拒绝 |
| Python | 不运行第二套插件树或任务队列；依赖隔离、取消、退出和错误都可观察 |
| 任务一致性 | 单活跃、条件领取、迟到结果拒绝、unknown 禁止 retry、旧插件缺失明确失败 |
| 生命周期 | 停用后注册消失，监听器与执行进程退出；dispose 失败可见 |
| 外部 UI | 安装后刷新出现新面板/页面，React/Cordis 单实例，CSS 生效，主程序无需重建 |
| 历史与凭据 | 旧 ID、状态、原始数据与产物不变；可播放下载；凭据引用正确且无明文泄露 |
| 真实媒体 | 正式 API 和 worker 完成三模式；实际播放、末尾音频、字幕时间轴、文件下载及 HEAD/Range |
| 发布 | 目标运行实例为验收 commit，只运行新调度；回读结果可追溯到该候选 |

测试只覆盖上述契约和迁移风险，优先复用现有媒体夹具与回归。模拟提供者验证框架机制；真实模型与供应商成功必须另有实际调用和产物证据。

## 8. 本轮设计核验

设计检查包含：服务所有权、workflow 三层边界、Python 计算与持久化调用区别、公开注册及释放、进程与远端状态握手、版本快照、动态 Client 模块、历史数据迁移、实施与发布验收。后续实施不得将这些设计条目直接标记为已验证。
