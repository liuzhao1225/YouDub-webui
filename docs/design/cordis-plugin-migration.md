# YouDub Cordis 插件化迁移与验收记录

2026-10-09 · 分支 `codex/plugin` · 基线 `e0dcb58`。本轮授权已从设计推进到全面实施；Host、Client、Python bridge 和外部插件示例已实现，当前进行本地集成验收与切换。本文保留待验收事项，最终记录由实施负责人补入。

[架构说明](cordis-plugin-architecture.md)记录替换边界，[插件契约](cordis-plugin-contracts.md)记录执行接口，[运行指南](cordis-plugin-runtime.md)是当前启动与扩展安装入口。代码完成、模拟测试、生产构建、真实媒体成功和最终切换分别记录。

## 1. 实施范围

当前默认组合包含本地文件导入、单活跃任务、字幕/配音/both 三种计划、原有模型桥、工作台/任务库/设置/登录，以及取消、重试、重新生成、删除和产物下载。所有职责由普通 Cordis 插件装配。`tasks` 同时提供通用引擎、状态机和调度，`workflow-localize` 单独定义业务计划。

外部示例 `fixtures/plugins/file-transform` 注册独立文件转换 provider、`example.uppercase` workflow、任务面板和 `/extensions/text` 页面；页面用 React Hooks 计数器验证共享模块身份。`fixtures/plugins/python-text` 提供独立 Python 脚本和 manifest，不依赖 YouDub Python 包。

MVP 不含运行时热升级、任意 DAG、并行步骤、人工审批、分布式 worker、插件市场、权限沙箱或自动故障恢复。示例为真实文件转换，不将其算作真实媒体模型验收。

## 2. 阶段与责任

实施负责人持续负责必要验证、当前授权的本地运行切换与回读。当前没有据本轮工作声明远端发布、新平台验证或 npm 包发布完成。

| 阶段 | 当前状态 | 已实现内容 | 待完成或待汇总的放行证据 |
| --- | --- | --- | --- |
| P0 框架可行性 | 实现与机制测试已落地，集成验收进行中 | 固定 Cordis/Loader/Include；依赖、清理错误可见；服务替换与 Python 协议 | 当前候选完整检查结果、生产 Next 外部页面及 Hooks 的浏览器记录 |
| P1 公共契约与基础服务 | 已实现 | SDK、files/process/store/secrets/catalog/settings、组合配置、SQLite 完整事务桥 | 最新候选的跨进程失败、存储与文件测试汇总 |
| P2 通用引擎与默认 workflow | 已实现，媒体验收进行中 | 固定计划、provider 绑定、JSON schema、产物验证、等待/取消/重试 | 三种真实输出、可选参考/对齐、末尾时间轴与播放结果 |
| P3 API 与 Client 组合 | 已实现，浏览器验收进行中 | auth/HTTP/v2、v1 投射、官方 Client 插件、扩展安装管理 | 登录会话、配置、导入残留、第三方页面/面板、下载与卸载回读 |
| P4 数据迁移与历史 | 已实现，数据验收进行中 | desktop schema v2、raw legacy snapshot、旧认证复制与 keyring 引用 | 数据副本及实际目录的数量/关键字段/文件和凭据核对 |
| P5 本地切换 | 进行中 | 启动和退出路径具备 | 固定候选、停止旧调度、实际端口与实例、默认功能和插件回读 |

## 3. 已有机制证据与边界

本轮已经运行过的相关验证包括：

- `bootstrap.test.ts`：空组合不创建产品服务/数据；选定插件缺依赖、初始化错误拒绝启动；卸载原始错误可见；只替换 `tasks` 服务即可供同一消费者使用。
- `process-protocol.test.ts`：未知 RPC 类型、坏 JSON、异常退出不能转成成功，取消等待实际进程退出。
- `task-runtime.test.ts`：真实 Python SQLite 桥驱动等待/单槽、取消与重试、迟到进度/旧 revision 拒绝和缺产物失败。
- `http.test.ts`：Cookie/CSRF/注销语义及文件 HEAD/Range。
- `extensions.test.ts`：独立本地包安装、重启激活、真实文本转换、注册释放、完整性变更拒绝激活。
- CLI 在隔离临时数据目录完成本地 Host/Client 包和纯 Python `.venv` 安装；此项仅证明对应安装路径。

测试文件位于 [Host 测试目录](../../packages/builtin/test)。后续修复需要相关测试重新通过，最终候选的命令与结果统一写入第 8 节；这里不使用旧测试结果替代最终检查。生产 Next 构建和静态检查记录由前端负责人汇总，浏览器结果单独填写。

本地基线为 macOS arm64 / Node.js 22。Windows 进程树、路径、keyring 以及其他系统尚未据此验收。GitHub ref 和 npm 精确版本安装代码已实现，远端真实下载/安装仍是单独待验收项。Python 独立环境安装不代表该 provider 已完成整个任务闭环。

## 4. 代码落点

| 职责 | 当前实现 |
| --- | --- |
| 无业务 Host 引导 | [bootstrap.ts](../../apps/host/src/bootstrap.ts)、[main.ts](../../apps/host/src/main.ts) |
| 默认产品组合 | [youdub.config.ts](../../youdub.config.ts) |
| 服务/operation/Task 契约 | [SDK](../../packages/sdk/src/index.ts) |
| 任务引擎与状态机 | [tasks.ts](../../packages/builtin/src/tasks.ts) |
| 默认本地化 workflow | [workflow-localize.ts](../../packages/builtin/src/workflow-localize.ts) |
| 受管文件和进程 | [files.ts](../../packages/builtin/src/files.ts)、[process.ts](../../packages/builtin/src/process.ts) |
| Python 存储与计算桥 | [bridge.py](../../backend/workers/bridge.py)、[store.py](../../backend/workers/store.py)、[operation.py](../../backend/workers/operation.py) |
| HTTP、认证与 API | [http.ts](../../packages/builtin/src/http.ts)、[auth.ts](../../packages/builtin/src/auth.ts)、[api.ts](../../packages/builtin/src/api.ts) |
| 扩展安装和装配 | [extensions.ts](../../packages/builtin/src/extensions.ts)、[extensions-loader.ts](../../packages/builtin/src/extensions-loader.ts)、[CLI](../../apps/host/src/plugins.ts) |
| Client 引导与服务/页面 | [plugin 目录](../../apps/web/src/plugin) |

旧 `backend/app` 中的模型、媒体和纯认证/凭据函数继续复用。新 Host 不启动旧 FastAPI lifespan 或旧任务循环。Python store bridge 只处理窄事务/系统调用，模型 worker 不持有数据库或调度权。

## 5. 数据和凭据迁移

当前 `backend/workers/store.py` 将数据目录内 `desktop.sqlite` 从 schema 0/1 迁移到 2：保留原 tasks 字段，增加 `plugin_json/plugin_revision`，移除旧任务阶段和 settings key 的封闭约束，建立认证会话/登录尝试表。未知 schema 拒绝启动。旧 schema 1 中存在 queued/running/waiting/cancelling 任务时返回 `MIGRATION_ACTIVE_TASKS`，不会自动重跑旧任务。

旧 desktop 任务以 `legacy: true`、`workflowId: legacy-v1`、未解析版本和 `rawSnapshot` 呈现，不伪造历史插件身份。原输入和已有成品在任务目录内时可登记历史引用，v1 API 保留其原配置、状态与输出结构。legacy retry 被拒绝；重新生成需显式选择当前 workflow、复制输入并创建新 ID。

仓库 `data/youdub.sqlite` 保留原位，存储桥以只读方式访问。首次 schema 迁移复制已有认证会话和登录尝试；其中旧 URL 下载式任务仍是独立历史来源，桥提供 `legacy.list/get` 读取。当前通用 v2 任务列表不自动合并该旧库，API 与界面没有把这些旧记录伪装成新 workflow；该部分历史的产品入口和文件访问要以最终实际验收说明为准。

密钥继续使用系统 keyring 的 `YouDub` 命名空间和原 credential reference。新任务保存连接和引用快照；设置更新与任务创建共用 Host 锁。设置和 keyring 跨介质失败明确报告部分完成状态，不自动回滚或隐藏错误。访问密码仍为 `.env` 的 Argon2id 哈希；Cookie、TTL、CSRF 按旧语义实现。

先在显式数据副本上预演，核对任务数量、ID/状态/时间、原始 JSON、文件及凭据引用。正式切换必须停止原 worker，确认没有旧进程继续写同一目录。迁移失败停止启动并保留原始诊断，不静默删除或修复记录。

## 6. 本地切换流程

1. 固定待运行代码、依赖锁、插件组合和源完整性，记录候选 commit。
2. 检查 8000/3000 端口、旧进程、数据版本、活动任务、模型与凭据；隔离验证目录和实际目录分别记录。
3. 停止旧调度与本机活动计算，保留未确认的远端请求状态。
4. 执行已预演的数据迁移；构建官方 Client 资产，启动 Cordis Host 与 Next。
5. 回读登录、health、Runtime、Settings、历史任务、产物和已激活插件。
6. 完成真实三模式及外部插件的浏览器/API 验收，记录限制与剩余工作。

任一步失败就停止对应后续路径，报告实际状态。端口已监听、插件 installed、模型 ready 或单个构建成功都不代表最终切换验收完成。当前环境只运行一份任务状态权威和一个调度实现。

## 7. 最终验收矩阵

下表是最终记录要求；尚未填入实际候选与产物的条目保持待验收。

| 范围 | 必须证明 | 最终候选记录 |
| --- | --- | --- |
| 最底层插件化 | 空组合无业务；替换 tasks 不改 API/workflow；官方功能来自插件 | 待汇总 |
| 默认 workflow | 三模式与参考/对齐计划；通用引擎无默认步骤特判 | 待汇总 |
| 输出契约 | JSON schema 执行、必需端口不可降级、登记/提交文件一致 | 待汇总 |
| 外部 workflow | 安装独立包，真实转换文件，无核心源码改动 | 待汇总 |
| Python 提供者 | 独立 `.venv`、真实输入输出、退出和取消可观察 | 待汇总 |
| 任务一致性 | 单活跃、等待、条件提交、迟到结果、未知远端禁止 retry | 待汇总 |
| 生命周期 | 缺依赖/初始化/清理错误可见；真实子进程结束 | 待汇总 |
| 外部 UI | Next 构建后新增页面/导航/面板；Hooks 可点击且构建不变 | 待汇总 |
| 认证与配置 | 登录/注销/CSRF、设置修改、工作流默认值更新 | 待汇总 |
| 历史与凭据 | 迁移字段/文件/引用核对，明确旧库入口边界 | 待汇总 |
| 真实媒体 | 正式 API 和 Worker 的三模式、播放/末尾音频/字幕时间轴 | 待验收 |
| 产物访问 | 下载、HEAD、Range 与失败文件的真实状态 | 待汇总 |
| 本地切换 | 实际实例对应候选、旧调度已停、页面/API 回读 | 待验收 |
| 远端安装及其他平台 | GitHub/npm 实装、Windows 等实机行为 | 未验收 |

## 8. 最终实测记录（实施负责人填写）

- 候选 commit / 日期 / 系统 / Node、Python 版本：待填。
- 数据目录与迁移核对：待填。
- 最终检查命令和结果：待填。
- 真实三模式 task ID、实际模型及产物路径：待填。
- 外部包版本/commit/integrity、页面与 Hooks 操作证据：待填。
- 旧进程停止、新 Host/Next 端口和最终回读：待填。
- 明确失败、未完成验收与后续所需条件：待填。
