# YouDub Cordis 插件化迁移与验收记录

2026-10-09 · 分支 `codex/plugin` · 基线 `e0dcb58` · 实施提交 `171cc37`。Cordis Host、Client、Python bridge 和外部插件已落地，真实三模式任务与实际数据目录切换已完成。最终代码候选 `cf9f92f90d67400c43c5886e68640d77f97e880b` 已完成生产构建与本地回读，重新生成和工作台模型表单正常显示。

[架构说明](cordis-plugin-architecture.md)记录替换边界，[插件契约](cordis-plugin-contracts.md)记录执行接口，[运行指南](cordis-plugin-runtime.md)是当前启动与扩展安装入口。代码完成、模拟测试、生产构建、真实媒体成功和最终切换分别记录。

## 1. 实施范围

当前默认组合包含本地文件导入、单活跃任务、字幕/配音/both 三种计划、原有模型桥、工作台/任务库/设置/登录，以及取消、重试、重新生成、删除和产物下载。所有职责由普通 Cordis 插件装配。`tasks` 同时提供通用引擎、状态机和调度，`workflow-localize` 单独定义业务计划。

外部示例 `fixtures/plugins/file-transform` 注册独立文件转换 provider、`example.uppercase` workflow、任务面板和 `/extensions/text` 页面；页面用 React Hooks 计数器验证共享模块身份。`fixtures/plugins/python-text` 提供独立 Python 脚本和 manifest，不依赖 YouDub Python 包。

MVP 不含运行时热升级、任意 DAG、并行步骤、人工审批、分布式 worker、插件市场、权限沙箱或自动故障恢复。示例为真实文件转换，不将其算作真实媒体模型验收。

## 2. 阶段与责任

实施负责人负责当前授权的本地切换和最终回读。本轮没有远端发布、npm 包发布或其他平台实机验收。

| 阶段 | 已证实结果 | 当前边界 |
| --- | --- | --- |
| P0 框架可行性 | 空组合、服务替换、依赖与清理机制通过；独立 Python 包和外部 Client 页面运行 | 本机 macOS arm64；扩展在 Host 重启后激活 |
| P1 公共契约与基础服务 | 8 个媒体 JSON schema、10 个 operation；真实 SQLite 事务、受管文件与进程检查通过 | JSON 结构校验与媒体计算中的语义校验共同负责输入输出一致性 |
| P2 通用引擎与默认 workflow | 三模式真实任务成功，reference 与 align 独立执行；产物 HEAD/Range 通过 | 单活跃、有序步骤；供应商远端取消未实现 |
| P3 API 与 Client 组合 | 原登录会话、设置模型、历史任务、视频播放及第三方页面回读通过 | 重新生成与工作台模型表单在最终构建正常显示；浏览器文件选择器自动化未完成 |
| P4 数据迁移与历史 | 实际 schema 1→2；1 条旧任务原字段、设置/凭据引用和产物 SHA 完全一致；复制 2 个认证会话 | 旧 URL 下载库继续独立只读，不合并为新 workflow |
| P5 本地切换 | 原数据目录由 Cordis Host 8000、生产 Next 3000 提供服务 | 最终生产 BUILD_ID `wlLtMbAUXZjOpBPTIwsnm`，原会话与历史回读通过 |

## 3. 已有机制证据与边界

[Host 测试目录](../../packages/builtin/test)的 30 项测试通过，覆盖空组合、依赖/初始化/清理错误、可替换 `tasks`、协议失败、等待与单槽、CAS/迟到结果、输出 schema、文件登记与提交一致性、认证/CSRF、HEAD/Range、扩展安装与完整性，以及设置更新。首次沙箱运行的 3 个监听操作遭遇 `EPERM`，授权重跑后 30 项全部通过。

Python 普通测试命令通过 902 项。此前 47 项失败来自收集阶段读取开发者 `.env`，其中 `DEMUCS_DEVICE` 覆盖设备测试、`VOXCPM_INFERENCE_TIMESTEPS` 覆盖模型默认参数。仅在测试 `conftest.py` 中禁用开发者 `.env` 加载后，未修改业务或断言，902 项全部通过；应用启动继续读取 `.env`。取消回归包含忽略 SIGTERM 的模型子进程，确认 worker 返回前实际回收子进程。

独立 Python 音频验收使用两个仅含 `package.json` 和 `worker.py` 的包。安装器各自创建 `.venv`，标准 `speech.synthesize/v1` 按 provider ID 替换，真实 Tasks/SQLite/Files 路径登记 250 ms WAV，并由 Host ffprobe 核验。两包没有仓库 Python import 或自行编写的 JS Host 入口。该样例生成明确的正弦测试音，用于验证契约与隔离，不衡量语音合成质量。

独立 `example.file-transform@1.0.0` 经真实 multipart API 导入文本并完成 `example.uppercase` 任务；Chrome 的 `/extensions/text` 页面 React 计数器从 0 增至 2。该包在 Next 构建后安装，浏览器验证时 Next BUILD_ID 保持不变。此项证明已实现的 Client 扩展装载方式；启停扩展仍需要重启 Host。

Windows/Linux 实机、GitHub/npm 远端真实下载安装尚未验收。运行时热升级不在 MVP 范围内。浏览器文件选择器自动化挂起，未记为通过；实际 multipart 上传 API 与上传组件测试分别通过。

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

## 7. 验收矩阵

所有已证实结果对应[机器可读验证记录](../validation/cordis-plugin-2026-10-09.json)。本地切换和最终界面回读已完成，未实际执行的验收单独列出。

| 范围 | 已证实结果 | 状态 |
| --- | --- | --- |
| 最底层插件化 | 空组合无业务；替换 tasks 服务；默认功能按组合装配 | 通过机制测试 |
| 默认 workflow | 字幕、配音、both 三模式真实模型任务；独立 reference/align | 通过 API 与产物验收 |
| 输出契约 | 8 schemas / 10 operations；必需端口、JSON payload、登记文件一致性 | 通过 |
| 外部 workflow | 独立本地包真实文本转换，任务成功、文件下载 200 | 通过 |
| Python 提供者 | 两个独立 .venv、标准 stdio、可替换 provider、实际 WAV/ffprobe | 通过 |
| 任务一致性 | 等待保留单槽、条件提交、迟到写入拒绝、未知远端禁止 retry | 通过机制测试 |
| 生命周期 | 初始化/清理失败可见；取消等待实际子进程退出 | 通过；实际媒体任务取消亦验证 |
| 外部 UI | 构建后安装页面/导航/面板，React Hooks 点击 0→2，BUILD_ID 不变 | Chrome 通过 |
| 认证与配置 | 原登录会话保留，模型 ready；默认设置更新的 2 项回归纳入 Host 套件 | 测试通过；最终模型表单回读通过；未修改用户已保存默认值 |
| 历史与凭据 | 原任务字段、4 个产物 SHA、设置和 credential refs 保持一致 | 实际目录通过 |
| 真实媒体播放 | IAB 旧视频开始播放，duration 6.88、paused false、error null | 已观察播放启动；本轮未据此声明播放至结尾 |
| 产物访问 | 三模式每个成品 HEAD 200、Range 206，保留流信息与 SHA | 通过 |
| 本地切换 | 原调度已停，原目录 schema 2，Host 8000 / Next 3000 回读 | 最终候选已切换并回读；未向用户真实目录提交新任务 |
| 浏览器上传 | 文件选择器工具挂起；multipart API 和组件测试通过 | 浏览器操作未完成 |
| 远端安装及其他平台 | GitHub/npm 实装、Windows/Linux 实机 | 未验收 |

## 8. 实测记录

环境为 macOS arm64、Node.js `22.23.2`、Python `3.12.12`。实施提交为 `171cc37`，最终代码候选为 `cf9f92f90d67400c43c5886e68640d77f97e880b`。`npm --prefix apps/web run build -- --webpack` 成功，最终生产 Next BUILD_ID 为 `wlLtMbAUXZjOpBPTIwsnm`；初次切换的 `C5b441TvG4AjY05HPXJkb` 已由该构建替换。

| 检查 | 结果 | 范围 |
| --- | --- | --- |
| Host `npm test` | 30 passed | 包含插件设置持久化与 v1/v2 接口 2 项回归 |
| Host `npm run typecheck` | 通过 | 当前 Host 候选 |
| `.venv/bin/pytest -q backend/tests --tb=short` | 902 passed，2 warnings，19.79 s | 无外部环境覆盖的普通命令；警告为 audioop、Starlette/httpx 弃用 |
| Web 测试 | 51 passed，11 files | 包含慢 runtime 请求在重渲染中的生命周期回归 |
| Web 生产构建 | 通过 | `next build --webpack`，BUILD_ID 见上 |
| Web lint | 0 errors，2 warnings | 既有 img 优化提示 |
| 媒体 schema 校验 | 8 schemas，10 operation contracts | 含真实 Whisper/reference/TTS/mix/align/export 产物 |

三模式均使用有历史 SHA 证据的 macOS Samantha 合成英语测试视频，源文件 76,971 字节、6.88 s；真实翻译为已保存 OpenAI 兼容连接的 `doubao-seed-evolving`。请求显式发送 `max_completion_tokens=65535`、`max_retries=0`，保留原始请求与响应。验证记录包含输出大小、SHA、流信息及远端完成回执。

| 模式 | 任务 ID | 结果 |
| --- | --- | --- |
| subtitles | `20bd3ead-082d-484c-84de-c15844c45cb6` | 视频、原文字幕、译文字幕 |
| dubbing | `aeae741a-2eaf-4b9d-a449-c9ebfebeafab` | 视频、配音音频 |
| both | `531704e0-9ca4-4837-ab89-a630f54e3352` | 视频、配音音频、原文字幕、译文字幕；独立 align 完成 |
| 外部 uppercase | `f1749eb4-d9fc-426e-8bbd-a67d32e181cc` | `HELLO CORDIS PLUGIN!`，下载 200 |
| 实际媒体取消 | `6aa5321d-2fc5-41fb-9fe6-91bbdc2b0d8a` | separate 中取消，最终 cancelled，mayStillRun=false |

正式本地目录为 `~/Library/Application Support/YouDub`。切换前后均为 1 条历史任务 `0446ee5f-8360-4346-9f13-a3c9337f8e68`；原字段、设置/credential refs、4 份产物 SHA 保持一致，原登录会话在 IAB 可继续使用。独立 QA 数据目录中的三模式和插件实验没有混入该正式历史。

新 Python 进程的 5 次 16,395 字节 JSON 往返中位数为 20.43 ms，进程内 loads+dumps 中位数为 0.0614 ms。该测量使用现有 OS 缓存、没有加载模型。真实模型已有阶段记录只能提供启动、加载、推理与产物登记的合计，不能据此拆出纯模型加载或推理耗时。

最终构建已修复重新生成页慢 runtime 请求反复取消的问题：Cordis `apiClient` 每次访问返回新 Proxy，查询 effect 现绑定稳定 Context。正常停止旧 Host/Next 并重启后，IAB 原登录会话保留，重新生成表单显示全部模型，工作台显示模型、语言、输出模式与本地文件输入，浏览器 console error 为 0。本次页面回读未向用户真实数据提交新任务，历史仍为 1 条 succeeded。最终只读检查中，Host `/api/health` 返回 200、`status=ready`、`api_version=v2`，Next `/` 返回 200；进程快照仅有 Node Host、其 Python store 子进程及 Next，未发现 uvicorn 或模型 worker。

明确限制仍为 GitHub/npm 远端实装、Windows/Linux 实机和浏览器文件选择器自动化未验收；模型加载与推理耗时也未独立计时。运行时热替换不在 MVP 范围内，扩展启停需要重启 Host。
