# Cordis 插件重构清理审计

日期：2026-10-09。比较基线：`a2c4250`，分支：`codex/plugin`。本轮清理在插件运行时已实现的基础上，删除失去调用入口的旧实现，收口重复逻辑，并重新验证本地应用。结构化结果见[清理验收记录](../validation/cordis-cleanup-2026-10-09.json)。启动与扩展用法以[运行指南](cordis-plugin-runtime.md)为准。

## 清理范围

| 范围 | 本轮改动 | 保留的入口与行为 |
| --- | --- | --- |
| Host HTTP | 删除 `/api/v1` 路由、旧任务投影、旧 multipart 字段兼容和默认 workflow 隐式选择 | `/api/v2` 接收显式 workflow 与命名输入；`/api/auth`、`/api/health` 和插件资产入口保留 |
| 任务视图 | 删除 API 为每条 TaskView 再读完整 TaskRecord 的重复逻辑 | tasks 生成公开产物描述；API 只附加下载 URL，TaskView 服务契约不依赖 HTTP |
| 错误类型与配置 | HTTP、认证、扩展安装统一使用 SDK `AppError`；删除未消费的 binding `contractVersion` 以及各绑定内重复的完整配置 | operation ID、插件版本和完整性仍参与计划校验；原任务快照保持原样 |
| Python 探测 | 全量 `runtime.get` 拆为 `runtime.probe({adapter})` 与 `runtime.info` | 每个 provider 仅探测自己的模型，Settings 从 catalog 合成能力列表；环境信息读取不再扫描模型 |
| 插件依赖 | 通用 Python provider 移除无条件 store 依赖 | 使用官方 `runtimeAdapter` 的 Loader entry 显式声明 `inject: ['store']`，缺失依赖导致启动失败；独立 Python 扩展仅依赖 catalog/process |
| Python 旧应用 | 删除 FastAPI 入口、旧路由、旧调度器、旧任务管理和无调用的 adapters/辅助脚本 | Cordis 是任务状态推进者；Python workers 提供窄存储、认证、探测与计算接口 |
| Client | 删除未接入现行插件宿主的旧页面组件、v1 API 客户端、旧认证/轮询状态、未使用 UI 组件与静态资产 | Next catch-all、Cordis Client 插件、公共 slots 和共享 React 模块继续提供页面与扩展入口 |
| 启动与依赖 | 删除 `dev:legacy` 及旧 Python Web/下载链依赖；共享 Host/CLI 路径计算；清理未使用前端动画依赖 | 根 Node 依赖、现役模型依赖及插件构建工具保留；CI 配置补充根依赖安装和 Host 检查 |

按 `.ts/.tsx/.py/.js/.css` 统计，并排除 `/tests/`、`/test/` 和 `*.test.*`，本轮产品源码净减少 11,354 行；该口径包含 fixtures 和 scripts，不包含本审计文档。

HTTP 业务接口现在使用 `/api/v2`。调用 `/api/v1/...` 的外部脚本需要迁移。旧数据库读取兼容继续保留；删除旧 HTTP 协议没有删除历史任务数据。

## 保留理由与边界核对

`backend/app/v1/` 目录保留现役计算模块：ASR、分离、TTS、混音、字幕对齐、导出、媒体检查、共享片段格式、凭据与默认配置校验。目录名延续已有导入路径，当前 Host 不启动其中的旧 Web 应用。`schema.sql` 保留作历史数据库迁移测试夹具。[Python operation 调用入口](../../backend/workers/operations.py)、[历史存储实现](../../backend/workers/store.py)

默认工作流仍显式传递 `reference → synthesize → mix → align → export` 的输入。TTS 接收已准备的参考音频；align 接收与 transcript ID 对齐的混音后片段；export 接收明确输出目录及可选对齐结果。因此删除旧目录推断与重复内部执行路径后，默认流程仍完整。ASR 词级时间戳、词文本完整性和时间单调性校验均保留。[默认工作流](../../packages/builtin/src/workflow-localize.ts)、[片段校验](../../backend/app/v1/segments.py)

保留 `installed/enabled/active`，用于区分已安装、下一次启动选中和本次运行已激活。扩展变更仍要求任务空闲并在重启后生效；CLI 的 tasks 依赖继续承担这一检查。安装失败保留错误与诊断文件，文件残留不会被标记为安装成功。[扩展服务](../../packages/builtin/src/extensions.ts)、[CLI 组合](../../apps/host/src/plugins.ts)

保留 Task 原始快照、产物注册、CAS 修订检查、文件读写锁与远端结果不确定状态。历史任务不会伪造已解析的插件版本；`mayStillRun` 继续限制重试。SQLite 迁移、session/CSRF 摘要和认证记录读取没有因删除旧路由而移除。操作错误继续经 worker error envelope 返回，并保留脱敏后的异常诊断。[任务服务](../../packages/builtin/src/tasks.ts)、[worker 协议](../../backend/workers/protocol.py)

## 本地验证

| 检查 | 结果 | 说明 |
| --- | --- | --- |
| Host 测试 | 32 项通过 | 覆盖生命周期、进程协议、认证、扩展、设置和任务运行时 |
| 最终 TaskView/任务修改复测 | 12 项通过 | 是最终修改后的子集复测，不与 32 项相加作为唯一用例数 |
| Python | 377 项通过 | 最终日志保留；清理中间轮次的失败日志也保持不变 |
| Web | 6 个测试文件、25 项通过 | 最终 TS/TSX 源码，本轮命令输出；2.53 秒 |
| TypeScript / ESLint | 通过 | 根 Host 与前端类型检查通过；ESLint 0 errors、2 条原生 img warnings |
| Next 生产构建 | 通过 | Build ID：`ft24yaYyzkut4udStgbF7` |
| 真实媒体 | 三种模式全部 `succeeded` | subtitles、dubbing、both；both 包含实际 Qwen 对齐步骤 |
| 产物下载 | 全部通过 | 9 个产物均为 HEAD 200、Range 206；记录文件大小、SHA-256 与媒体探测结果 |
| 外部工作流 | 通过 | 本地独立包 `example.uppercase` 完成真实文本转换，下载结果为 `HELLO CORDIS PLUGIN!` |
| 本地取消 | 通过 | 在 separation 阶段结束为 `cancelled`，后续步骤未执行，`mayStillRun=false` |
| 原始数据 | 通过 | 原 1 条任务字段、设置与凭据引用、历史产物 SHA-256 均一致 |
| 最终浏览器回读 | 通过 | 原会话有效；工作台模型与参数正常；历史任务及 4 个产物可见；视频 `readyState=4`、时长 6.88 秒、无播放错误；设置显示 6 个提供方就绪 |

真实媒体使用既有合成英语测试素材，SHA-256 为 `4354443de42f476bf3dee03fb133a99a4f6c298f11a999480cc39f852e8e9c6d`，没有使用用户媒体发起本轮模型任务。回归环境为 macOS arm64；最后回读时生产 Next 在本机 3000 端口、原数据 Host 在 8000 端口运行。详细任务 ID、步骤和产物摘要见[结构化记录](../validation/cordis-cleanup-2026-10-09.json)。

前端测试、类型检查和 lint 之后，只删除了未使用的 CSS import 及对应依赖，并调整 Next 配置注释；后续 CSS/依赖清理由最终生产构建覆盖。前端检查没有独立落盘日志，来源为本轮命令输出。

## 验证限制

- GitHub CI 配置已更新并完成本地检查；本轮没有 GitHub Actions 运行结果。
- 本轮没有验证 Windows/Linux 运行效果，也没有重新执行远端 GitHub/npm 包下载。扩展验收使用本地包、实际本地 npm build 和独立 Python 入口。
- 本地取消实测覆盖本地 separation 阶段。远端结果未知的处理有协议/任务测试；本轮没有进行真实远端异步撤销。
- 三种短素材任务验证执行链和产物，不代表所有媒体、语言或模型组合的质量评估。
- 单机任务执行、扩展重启生效和固定版本契约保持现有 MVP 范围；本轮没有新增缓存、服务层、市场、HMR 或分布式执行框架。

本记录汇总清理后的验收。[首次插件实现验收](../validation/cordis-plugin-2026-10-09.json)及更早证据保持原样。临时证据仅在结构化记录中列出文件名与摘要，不包含认证凭据、Cookie、完整内部路径或用户原始数据。
