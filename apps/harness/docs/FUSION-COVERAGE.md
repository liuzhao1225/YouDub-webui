# Harness × YouDub 功能与架构覆盖账本

最新代码复核见 [CODE-AUDIT.md](CODE-AUDIT.md)：活动 fork 已完成第 25 批裁剪，正向装配所需框架服务，并保留原 YouDub 领域功能。55621d17 的 macOS 与 Windows 源码 CI 全部通过，包含新增聚合类型检查；最终原生交互及媒体质量验收仍开放。本轮只交付源码开发版，安装包、更新源与在线市场不在范围内。

本账本以冻结的 YouDub 源快照 `f6f927903581b165f2bf6c840ea65b896d319524` 为比较对象。源清单为 `../baselines/youdub-source-inventory.json`：58 条 API、11 个媒体操作、9 个页面入口、50 组元素定义。计数只说明清单覆盖范围，不能证明功能已经运行通过。

本账本区分源回归、官方 Host 边界和真实媒体运行。E1–E22 的日志与产物见文末；已完成的 Electron 交互逐项记录，未覆盖路径保持待验收。旧 POC 结果不能替代本分支验收；四模型和外部翻译已在记录的真实输入上运行通过，其他输入质量与未走分支单列。

## 基线与不可变边界

- YouDub 源快照、原 POC、官方源码标签、已安装 Desktop 二进制的保存位置与 SHA-256 见 `../baselines/sources.json`。
- 官方公开 `dsh-v0.2.1-rc.2` 源提交为 `687f282e8625c6b8d11ff58211a90524be2e4317`。Desktop 内嵌构建提交为 `332895e0f7c9d4dbfb29729f5eb367fa263ff986`；官方 Git 服务拒绝该提交，已保存其原始完整 app。不得声称公开标签能重建该 Desktop 二进制。
- `baselines/verify.mjs` 检查原始源码工作区、官方 npm 包及 app 字节；`check-composition.mjs` 检查实际产物中有输出字节的模块，排除旧 Host、HTTP、Auth、LLM、扩展加载器、React 根和复制的模型设置页面。两项均须在最终构建后再执行。

## 最底层职责

| 职责 | 官方实现 | YouDub 保留的领域逻辑 | 验收边界 |
| --- | --- | --- | --- |
| 启动、配置层叠、插件生命周期 | 从受审计活动 fork 构建的 app-boot / Cordis Loader / Electron 能力 | YouDub 自有入口、cordis.patch.yml 组合与独立 profile | 活动 fork 按差异账本维护；固定来源清单、原归档和初始 YouDub 保持不变 |
| HTTP、身份、桌面传输 | Connection.fetch / 官方 Desktop 协议 | 固定 v2/upload/file 端点内的业务路由分派 | JSON、multipart、Range、错误体都经同一官方连接 |
| 子进程、退出、取消 | Subprocess | JSONL worker 与 SQLite RPC 编解码 | worker 失败原因、取消退出、未知提交结果可见 |
| 实时执行状态 | Jobs | 图调度、持久化确认、结果修订、资源依赖选择 | operation 与资源准备都应接 Jobs；确认等待不占执行槽 |
| 配置和密钥 | Harness settings/configForms + Credentials | 业务偏好结构、任务引用快照；API 密钥字段中的只读掩码 | 保存/重开已实测；完整凭据不回填，API 密钥字段显示前六位与***；删除密钥的最终原生验收仍待完成 |
| LLM | Harness llm /官方模型设置 | 批次翻译提示、segment 对齐、结果校验、原始证据 | 单次输出上限 >=65535；不支持则调用前显式停止 |
| 页面、状态、控件 | 官方 Renderer / Slots / Layout / Store / primitives / locale / theme | 首屏、图画布、媒体播放器、字幕编辑、任务数据 | 不执行旧 PluginBootstrap/createRoot/复制模型管理 |
| 扩展安装、启停、卸载 | PluginManager + 官方 Plugins 页面 | YouDub domain bridge 与业务 slot | 官方执行结果保留 applied/restart-required/failed 区别 |
| 产品版本与发行 | 官方通用设置与 PluginManager | 通用设置显示 YouDub 产品版本，扩展展示各自版本 | 旧产品更新控件已移除，自动更新和安装包属于后续发行范围 |

YouDub 的 SQLite 任务 CAS、图文档和媒体二进制产物属于领域数据。官方 storageDomain 的单记录接口与 fs 的文本操作不能完整表达这些事务/媒体操作，保留这部分逻辑有明确功能需求。它们的进程生命周期、配置、鉴权与传输均交给 Harness。

## 源 API 逐项映射

端点名称允许迁移；对应用户能力必须保留。表内“待验收”要求通过实际 Host 或 Electron 执行，静态路由存在不算通过。

| 原方法和路径 | 融合承载 | 状态 |
| --- | --- | --- |
| `GET /api/health` | backend/api.ts → Connection.fetch + 原 YouDub 领域服务 | E2 官方服务组合/路由合同通过 |
| `GET /api/v2/catalog` | backend/api.ts → Connection.fetch + 原 YouDub 领域服务 | E3 真实官方 Host 字幕流程通过 |
| `GET /api/v2/workflows` | backend/api.ts → Connection.fetch + 原 YouDub 领域服务 | E19 实际 Host 读取内置与外部工作流目录通过
| `POST /api/v2/workflow-documents/migrate-defaults` | backend/api.ts → Connection.fetch + 原 YouDub 领域服务 | E19 新 profile 的迁移空操作通过；含旧默认配置的转换仍以源回归为证
| `GET /api/v2/node-types` | backend/api.ts → Connection.fetch + 原 YouDub 领域服务 | 原生图编辑器和 E17 链接运行实际读取节点目录；全部外部节点组合未覆盖 |
| `GET /api/v2/workflow-documents` | backend/api.ts → Connection.fetch + 原 YouDub 领域服务 | E19 内置/插件模板、用户文档分页及越界拒绝通过
| `POST /api/v2/workflow-documents` | backend/api.ts → Connection.fetch + 原 YouDub 领域服务 | E19 实际 Host 创建并持久化用户图通过
| `POST /api/v2/workflow-documents/validate` | backend/api.ts → Connection.fetch + 原 YouDub 领域服务 | E13/E16/E17 原生提交经过图校验并实际执行；所有拒绝分支仍以源回归为证 |
| `GET /api/v2/workflow-documents/:id` | backend/api.ts → Connection.fetch + 原 YouDub 领域服务 | E19 创建/修改后读回及删除后 404 通过
| `PUT /api/v2/workflow-documents/:id` | backend/api.ts → Connection.fetch + 原 YouDub 领域服务 | E19 修订递增、旧修订 409、内容保持通过
| `DELETE /api/v2/workflow-documents/:id` | backend/api.ts → Connection.fetch + 原 YouDub 领域服务 | E19 修订保护、删除读回及内置模板保护通过
| `GET /api/v2/updates` | 后续 YouDub 发行能力；当前开发版不加载旧更新服务 | 按当前仅编码、不打包的范围排除；不能算作已迁移发行能力 |
| `POST /api/v2/updates/check` | 后续 YouDub 发行能力；当前开发版不加载旧更新服务 | 按当前仅编码、不打包的范围排除；不能算作已迁移发行能力 |
| `GET /api/v2/runtime` | backend/settings.mjs → 官方 settings / Credentials / 领域 runtime | E1 源探针回归；E8 源码桌面私有环境实际 ready |
| `GET /api/v2/settings` | backend/settings.mjs → 官方 settings / Credentials / 领域 runtime | E2 官方服务组合/路由合同通过 |
| `POST /api/v2/settings/test-connection` | backend/settings.mjs → 官方 settings / Credentials / 领域 runtime | 旧路径显式要求官方模型设置；E5 实际官方适配器协议通过 |
| `PATCH /api/v2/settings` | backend/settings.mjs → 官方 settings / Credentials / 领域 runtime | E2 官方服务组合/路由合同通过；3087 语言切换已现场验证 |
| `POST /api/v2/tasks` | backend/api.ts → Connection.fetch + 原 YouDub 领域服务 | E3 真实官方 Host 字幕流程通过 |
| `GET /api/v2/tasks` | backend/api.ts → Connection.fetch + 原 YouDub 领域服务 | E19 分页、status/active 筛选及非法分页拒绝通过；全部状态组合未穷举
| `GET /api/v2/tasks/:id` | backend/api.ts → Connection.fetch + 原 YouDub 领域服务 | E3 真实官方 Host 字幕流程通过 |
| `POST /api/v2/tasks/:id/cancel` | backend/api.ts → Connection.fetch + 原 YouDub 领域服务 | E19 暂停任务取消、旧修订 409 及状态持久化通过；运行中媒体取消见原生历史证据
| `POST /api/v2/tasks/:id/retry` | backend/api.ts → Connection.fetch + 原 YouDub 领域服务 | E19 取消后 attempt 递增、重新执行及旧 attempt 拒绝通过
| `POST /api/v2/tasks/:id/rerun` | backend/api.ts → Connection.fetch + 原 YouDub 领域服务 | E19 依赖复用保留 second，仅重算 first/review/export，派生产物通过
| `GET /api/v2/tasks/:id/nodes/:nodeId` | backend/api.ts → Connection.fetch + 原 YouDub 领域服务 | E3 真实官方 Host 字幕流程通过 |
| `GET /api/v2/tasks/:id/nodes/:nodeId/results/:revision` | backend/api.ts → Connection.fetch + 原 YouDub 领域服务 | E3 真实官方 Host 字幕流程通过 |
| `POST /api/v2/tasks/:id/nodes/:nodeId/corrections` | backend/api.ts → Connection.fetch + 原 YouDub 领域服务 | E3 真实官方 Host 字幕流程通过 |
| `POST /api/v2/tasks/:id/nodes/:nodeId/approve` | backend/api.ts → Connection.fetch + 原 YouDub 领域服务 | E3 真实官方 Host 字幕流程通过 |
| `GET /api/v2/tasks/:id/actions/:actionId` | backend/api.ts → Connection.fetch + 原 YouDub 领域服务 | E19 校对回执读回、重复提交幂等、非法 ID 422 与未记录 UUID 404 通过
| `POST /api/v2/tasks/:id/rerun-preview` | backend/api.ts → Connection.fetch + 原 YouDub 领域服务 | E19 修改单个上游后的复用/重算清单及修订依据通过
| `GET /api/v2/tasks/:id/artifacts/:artifactId` | backend/api.ts → Connection.fetch + 原 YouDub 领域服务 | E19 所属产物内容、跨任务与原型属性访问拒绝通过
| `DELETE /api/v2/tasks/:id` | backend/api.ts → Connection.fetch + 原 YouDub 领域服务 | E19 attempt 冲突、活动任务保护、删除后 404 和派生产物独立性通过
| `GET /api/v2/tasks/:id/cover` | backend/api.ts → Connection.fetch + 原 YouDub 领域服务 | E19 无封面任务 404、E22 实际 zoo 导入任务的图片封面生成与读回通过
| `GET /api/v2/tasks/:id/files/:output` | backend/api.ts → Connection.fetch + 原 YouDub 领域服务 | E3 真实官方 Host 字幕流程通过 |
| `GET /api/v2/tasks/:id/log` | backend/api.ts → Connection.fetch + 原 YouDub 领域服务 | E19 实际 Host 日志读取及非法 lines 拒绝通过
| `GET /api/v2/extensions` | backend/extensions.mjs → 官方 pluginManager | E4 真实官方 PluginManager 安装/行为/启停/移除通过 |
| `DELETE /api/v2/imports/:id` | backend/api.ts → Connection.fetch + 原 YouDub 领域服务 | E19 已属于任务的导入删除返回 409；孤立导入清理待验收
| `POST /api/v2/extensions/install` | backend/extensions.mjs → 官方 pluginManager | E4 真实官方 PluginManager 安装/行为/启停/移除通过 |
| `PATCH /api/v2/extensions/:id` | backend/extensions.mjs → 官方 pluginManager | E4 真实官方 PluginManager 安装/行为/启停/移除通过 |
| `DELETE /api/v2/extensions/:id` | backend/extensions.mjs → 官方 pluginManager | E4 真实官方 PluginManager 安装/行为/启停/移除通过 |
| `GET /api/v2/client-manifest` | 官方 module loader；API 仅回显官方 inventory，禁止旧脚本加载 | E4 官方 inventory；E10 源码原生插件页面/自定义校对交互及卸载通过 |
| `GET /api/plugins/:packageId/:version/:asset*` | 官方 dsh client module 入口与资源发布；旧资产路径迁移 | 旧 URL 已迁官方模块入口；E10 原生插件客户端交互通过 |
| `GET /api/auth/session` | 官方 Connection 身份、Desktop 本机 owner；旧 Auth 不执行 | E3 官方 Connection token/cookie 入场通过；旧 Auth 不执行 |
| `POST /api/auth/logout` | 官方 Connection 身份、Desktop 本机 owner；旧 Auth 不执行 | 旧 Auth 不执行；官方 owner 连接退出待 Electron 验收 |
| `GET /api/v2/models/providers` | 官方模型设置 / configForms / Credentials / llm；旧模型 API 不执行 | 官方空目录、添加提供商及保存后目录读回通过，见 E13 模型配置证据 |
| `GET /api/v2/models/settings` | 官方模型设置 / configForms / Credentials / llm；旧模型 API 不执行 | 官方编辑器重开读回提供商、模型与 65535 上限通过 |
| `PATCH /api/v2/models/settings` | 官方模型设置 / configForms / Credentials / llm；旧模型 API 不执行 | 官方页面保存火山方舟 URL、模型及 65535 上限通过，实际翻译见 E13/E16/E17 |
| `POST /api/v2/models/credentials/describe` | 官方模型设置 / configForms / Credentials / llm；旧模型 API 不执行 | 官方已保存状态与产品卡片摘要经原生重启/重开读回，见 evidence/source-native-key-preview.json |
| `PUT /api/v2/models/credentials/:ref` | 官方模型设置 / configForms / Credentials / llm；旧模型 API 不执行 | 官方 UI 保存与重开通过；完整密钥不出现在卡片摘要或可访问性文本 |
| `DELETE /api/v2/models/credentials/:ref` | 官方模型设置 / configForms / Credentials / llm；旧模型 API 不执行 | 待验收 |
| `POST /api/v2/models/discover` | 官方模型设置 / configForms / Credentials / llm；旧模型 API 不执行 | 原生官方页面发现并保存 doubao-seed-evolving，通过真实调用验证，见 E13 |
| `GET /api/v2/resources` | backend/resources.ts → Subprocess / Jobs + 领域资源检查 | E12 原生四模型及全部依赖实际 ready；E13 完整模型真实执行 |
| `POST /api/v2/resources/check` | backend/resources.ts → Subprocess / Jobs + 领域资源检查 | E1 所选依赖检查回归；E7 私有目录探针通过 |
| `POST /api/v2/resources/prepare` | backend/resources.ts → Subprocess / Jobs + 领域资源检查 | E1/E7 原回归及私有安装；E12 原生完整四模型通过同一 Resources 实际准备 |
| `POST /api/v2/workflow-documents/resources/check` | backend/resources.ts → Subprocess / Jobs + 领域资源检查 | E1 工作流依赖选择回归通过 |
| `POST /api/v2/workflow-documents/resources/prepare` | backend/resources.ts → Subprocess / Jobs + 领域资源检查 | E1 所选工作流依赖准备回归通过；真实桌面准备待验收 |
| `POST /api/v2/resources/action` | backend/resources.ts → Subprocess / Jobs + 领域资源检查 | E1 暂停/继续/显式重试回归；Web VoxCPM暂停/继续真实下载见 evidence/model-pause-resume.json |
| `GET /api/setup` | backend/setup.mjs → 原 EnvironmentSetup/Resources + 官方 Jobs/Subprocess；原 SetupGate 经集中请求读取状态 | E6 空目录实际 Python/venv/base 安装；E12 新门控每次启动实查四模型及相关依赖；旧 Whisper-only 完成状态重新进入完整准备 |
| `POST /api/setup` | backend/setup.mjs → 原 EnvironmentSetup/Resources + 官方 Jobs/Subprocess；原 SetupGate 经集中请求读取状态 | E12 拒绝模型子集，原生显式准备全部四模型并实际ready；原暂停/继续/重试和原始错误保留 |

## 媒体操作逐项映射

| 操作 | 实现与对应前端 | 必要产物/行为 | 状态 |
| --- | --- | --- | --- |
| `media.download/v1` | 原 Python yt-dlp，经官方 Subprocess；现有下载节点与链接入口 | 任务内下载节点产生视频并接到 prepare；坏链接保留真实错误 | E17 原生输入 YouTube 原 zoo URL 和本机 HTTP 代理端口7897，下载533931B并完成10节点；E20 已补齐 B 站完整链接/短链/代理三次实际 Host 下载 |
| `media.prepare/v1` | Python FFmpeg，经官方 Subprocess；本地/链接导入 | 视频可播放，mediaInfo 与 sourceAudio 可读取 | E3 与 E8 源码桌面真实 FFmpeg；E9 原失败任务素材派生复验媒体准备成功 |
| `audio.separate/v1` | Python Demucs，经官方 Subprocess；分离节点 | 人声与背景音输出 | E7 源回归；E13 真实 Demucs 人声/背景双音轨，44.1kHz双声道、样本数与源音频一致 |
| `speech.transcribe/v1` | Python Whisper，经官方 Subprocess；识别/校对节点 | 有时码的 transcript、原始识别证据 | E3 与 E8 源码桌面私有 Whisper tiny 的 3 段真实识别 |
| `text.translate/v1` | Harness llm；官方模型设置与翻译校对节点 | segment_id 完整、原请求响应留存、人工修订 | E13 原生官方配置的火山方舟真实翻译成功，maxTokens=65535、3段ID完整；质量仍受原识别错误影响 |
| `voice.reference/v1` | Python 媒体处理；声音参考节点 | 源声音参考切片及映射 | E13 真实3段参考切片，16kHz单声道，时长/文本对应原识别段 |
| `speech.synthesize/v1` | Python VoxCPM，经官方 Subprocess；配音节点 | 逐句音频；按提供商公布的声音模式配置 | E13 私有VoxCPM2 CPU实际生成3段48kHz语音；源声音克隆链通过；原快照及当前 VoxCPM2 只公布 source_clone，未配置的预设模式明确拒绝。[能力边界](evidence/refactor-voxcpm-voice-scope.json) |
| `audio.mix/v1` | Python FFmpeg，经官方 Subprocess；混音节点 | finalAudio、dubbedTimeline、adjustedSpeech | E13 finalAudio、dubbedTimeline、adjustedSpeech齐全；最终WAV为48kHz双声道且精确覆盖视频时长 |
| `text.align/v1` | Python Qwen Forced Aligner；字幕对齐节点 | wordAlignment 与最终字幕时间轴 | E13 私有Qwen实际输出3片段/51词；字幕文字完整对应真实译文，原始词时码留存 |
| `media.export/v1` | Python FFmpeg；导出节点和任务输出 | 视频、音频、原文 SRT、译文 SRT；原生保存 | E13双SRT原生保存/哈希通过；E16原分句恢复后9节点及17秒播放通过；E17在线下载后10节点与14秒播放通过。E14显示换行补丁已撤回，仅保留历史证据 |
| `subtitles.import/v1` | Python 字幕解析；字幕导入节点 | transcript、translation；错误字幕显式报错 | E22 官方 Host 双语 SRT multipart 上传、真实 Python 导入和 zoo 视频/双 SRT 导出通过；时间轴不匹配与坏格式保留 INVALID_SUBTITLES |

## 页面与前端元素映射

历史 Whisper-only 首启及人工译文 fixture 流程保留为 E8 证据。当前原生页面已完成四模型和全部相关依赖准备，六项资源要求均 ready，见 [完整首次准备](evidence/desktop-full-first-run.json)。官方模型页已完成提供商保存、模型发现及 65,535 输出上限读回，保存的 API Key 卡片摘要在重启及关闭重开后保持，见 [模型配置](evidence/source-native-model-configuration.json) 与 [密钥摘要](evidence/source-native-key-preview.json)。字幕 UI 订正保存 revision 3 后仍待确认、重启恢复及人工确认已有历史实测；随后原生导入原格式 9 节点工作流、上传视频并运行完整真实配音链，播放到 11.9 秒，双 SRT 以正确默认文件名经原生保存框落盘并核对哈希，见 [完整媒体链](evidence/source-native-full-dubbing.json)、[播放与保存](evidence/source-native-full-dubbing-ui.json)。真实外部翻译证据与历史 fixture 分开记录，当前原分句恢复已完成 E16 原生全链；E17 在原生输入公网 YouTube URL 和代理端口后完成下载至导出的10节点并播放到14秒。默认模板已合为3个，见 E18。更完整的前端操作与未覆盖分支见 [前端映射](../FRONTEND-MAPPING.md)。

| 源页面 | 融合入口 | 状态 |
| --- | --- | --- |
| `/tasks` | client.jsx 中 youdub.page 官方 slot + 对应纯业务页面 | 原生任务进入详情与重启恢复已实测；列表筛选、删除等仍待验收 |
| `/tasks/:id` | client.jsx 中 youdub.page 官方 slot + 对应纯业务页面 | UI订正revision3/重启/确认、E13双SRT保存与哈希通过；E16完整原分句链播放17秒，E17在线下载10节点播放14秒，见 [最新原生画面](evidence/source-native-youtube-download-ui.png) |
| `/settings` | 官方 Settings 弹窗（models/general）；资源在 YouDub 资源页；扩展在官方 Plugins | 实测通用设置/模型；版本0.0.7，无无关字号/代码视图 |
| `/settings/:section` | 官方 Settings 弹窗（models/general）；资源在 YouDub 资源页；扩展在官方 Plugins | 官方提供商保存/模型发现/65535读回及已保存密钥摘要重开通过；核心仅一条内置卡，无重复installed项 |
| `/` | client.jsx 中 youdub.page 官方 slot + 对应纯业务页面 | 首启/重启到原hero；深色收起→展开→浅色通过；source-development-home / home-dark-collapsed |
| `/workflows` | client.jsx 中 youdub.page 官方 slot + 对应纯业务页面 | E18当前默认模板为字幕翻译、视频配音、字幕＋配音3项；历史 fusion-workflows 保留4模板旧画面，用户工作流保留 |
| `/workflows/:id` | client.jsx 中 youdub.page 官方 slot + 对应纯业务页面 | 原生完整设置、改名离开草稿保护/继续编辑、保存副本、运行面板与缺LLM原因通过 |
| `/workflows/:id/nodes/:nodeId` | client.jsx 中 youdub.page 官方 slot + 对应纯业务页面 | 原生节点设置展示通过；所有节点编辑路径仍待覆盖 |
| `/tasks/:id/nodes/:nodeId` | client.jsx 中 youdub.page 官方 slot + 对应纯业务页面 | 识别订正/保存/重启/确认、fixture翻译确认、源音频19秒通过；其他节点重跑待验收 |

| 源元素文件 | 融合对应 | 状态 |
| --- | --- | --- |
| `apps/web/src/components/app-updates.tsx` | 当前 Electron 不加载旧更新页面；产品版本来自根 manifest，扩展版本由 PluginManager 管理 | 安装包与自动更新属于后续发行范围 |
| `apps/web/src/components/brand/brand-mark.tsx` | 原动态 Logo、大标题、首屏动效；theme token 映射和官方 shell | Web原版对照及原生深色/收起侧栏动态图标与hero通过；source-development-home-dark-collapsed |
| `apps/web/src/components/inline-alert.tsx` | 官方 StateDot/Tag + 业务状态文案 | 待验收 |
| `apps/web/src/components/language-switcher.tsx` | 官方 theme/locale 设置；业务文案跟随 locale | 实测中→英→中，官方偏好写入 |
| `apps/web/src/components/localize-task-config.tsx` | 保留纯业务组件；按钮、输入、菜单、弹窗、状态由官方组件映射 | 待验收 |
| `apps/web/src/components/models-settings/CustomProviderCard.tsx` | 停止执行复制组件；直接官方 ui-settings-models | 旧复制组件不执行；官方替代界面已完成提供商/凭据保存、模型发现及65535重开读回，见E13与模型配置证据；不代表原复制组件运行 |
| `apps/web/src/components/models-settings/DeepSeekModelsEditor.tsx` | 停止执行复制组件；直接官方 ui-settings-models | 旧复制组件不执行；官方替代界面已完成提供商/凭据保存、模型发现及65535重开读回，见E13与模型配置证据；不代表原复制组件运行 |
| `apps/web/src/components/models-settings/EditorFooter.tsx` | 停止执行复制组件；直接官方 ui-settings-models | 旧复制组件不执行；官方替代界面已完成提供商/凭据保存、模型发现及65535重开读回，见E13与模型配置证据；不代表原复制组件运行 |
| `apps/web/src/components/models-settings/ModelListEditor.tsx` | 停止执行复制组件；直接官方 ui-settings-models | 旧复制组件不执行；官方替代界面已完成提供商/凭据保存、模型发现及65535重开读回，见E13与模型配置证据；不代表原复制组件运行 |
| `apps/web/src/components/models-settings/ModelsSection.tsx` | 停止执行复制组件；直接官方 ui-settings-models | 旧复制组件不执行；官方替代界面已完成提供商/凭据保存、模型发现及65535重开读回，见E13与模型配置证据；不代表原复制组件运行 |
| `apps/web/src/components/models-settings/ProviderEditor.tsx` | 停止执行复制组件；直接官方 ui-settings-models | 旧复制组件不执行；官方替代界面已完成提供商/凭据保存、模型发现及65535重开读回，见E13与模型配置证据；不代表原复制组件运行 |
| `apps/web/src/components/models-settings/index.tsx` | 停止执行复制组件；直接官方 ui-settings-models | 旧复制组件不执行；官方替代界面已完成提供商/凭据保存、模型发现及65535重开读回，见E13与模型配置证据；不代表原复制组件运行 |
| `apps/web/src/components/models-settings/primitives.tsx` | 停止执行复制组件；直接官方 ui-settings-models | 旧复制组件不执行；官方替代界面已完成提供商/凭据保存、模型发现及65535重开读回，见E13与模型配置证据；不代表原复制组件运行 |
| `apps/web/src/components/page-layout.tsx` | 仅保留业务容器；外层 frame、滚动与主题来自官方 | 首屏与模板运行面板对照完成；原生主面板滚动、左栏固定通过 |
| `apps/web/src/components/section-card.tsx` | 仅保留业务容器；外层 frame、滚动与主题来自官方 | 待验收 |
| `apps/web/src/components/settings-resources.tsx` | 原资源业务组件；官方控件及集中请求 | 资源页实际展示私有环境/依赖；E12首启经相同Resources完成四模型，Web暂停/恢复有实测；资源页全部操作仍未逐项覆盖 |
| `apps/web/src/components/setup-diagnostics.tsx` | 原日志与错误组件；官方按钮及集中请求原错误 | 源测试覆盖完整日志复制/失败/反馈；截图证明日志入口，实际剪贴板交互待验收 |
| `apps/web/src/components/setup-gate.tsx` | 原 Controller + 官方 root 优先级插槽，资源 ready 后挂载原翻译配置视图 | E12四模型及全部依赖ready后放行；旧Whisper-only标记被拦截；历史空LLM→稍后配置→hero保留为E8，迟到轮询回归通过 |
| `apps/web/src/components/setup-resources.tsx` | 原 EnvironmentSteps/ModelDownloadRow/进度与诊断；操作控件由官方映射 | 当前四模型全部必需，E12私有环境与全部资源实际ready；Web VoxCPM下载暂停/恢复实测，其他错误/重试分支保持源回归边界 |
| `apps/web/src/components/setup-screen.tsx` | 原首启布局与ModelDownloadRow + 官方Button；原inventory四模型全部必需，显式prepare | 原生“准备全部模型”完成四模型及全部依赖，六项资源要求ready；旧Whisper-only状态被拦截，见 [完整首启](evidence/desktop-full-first-run.json) |
| `apps/web/src/components/sidebar-link.tsx` | 官方 Button/Tooltip；youdub.navigation 扩展槽 | 官方导航真实点击与选中态实测 |
| `apps/web/src/components/task-cover.tsx` | 保留纯业务组件；按钮、输入、菜单、弹窗、状态由官方组件映射 | 待验收 |
| `apps/web/src/components/theme-toggle.tsx` | 官方 theme/locale 设置；业务文案跟随 locale | 原生深色→收起侧栏→展开→浅色通过；此前Web官方偏好写入通过 |
| `apps/web/src/components/translation-setup.tsx` | 原 TranslationSetupView/Controller + 未改动的官方 ModelsSection/Store/operations | 原生空配置→稍后配置→hero及重启通过；保存凭据后继续未实测，官方草稿dirty无公开回调 |
| `apps/web/src/components/ui/button.tsx` | 原 ui 组件 → harness-primitives.ts → 官方 primitives；Label 保留原生语义 | 真实官方控件；原样式常量共用；主色实测rgb(255,0,51) |
| `apps/web/src/components/ui/input.tsx` | 原 ui 组件 → harness-primitives.ts → 官方 primitives；Label 保留原生语义 | 真实官方Input，原输入样式与全宽布局实测 |
| `apps/web/src/components/ui/label.tsx` | 原 ui 组件 → harness-primitives.ts → 官方 primitives；Label 保留原生语义 | 待验收 |
| `apps/web/src/components/ui/segmented.tsx` | 原 ui 组件 → harness-primitives.ts → 官方 primitives；Label 保留原生语义 | 原语言切换实测；官方 SegmentedControl |
| `apps/web/src/components/ui/select.tsx` | 原 ui 组件 → harness-primitives.ts → 官方 primitives；Label 保留原生语义 | 待验收 |
| `apps/web/src/components/ui/switch.tsx` | 原 ui 组件 → harness-primitives.ts → 官方 primitives；Label 保留原生语义 | 待验收 |
| `apps/web/src/components/ui/tooltip.tsx` | 原 ui 组件 → harness-primitives.ts → 官方 primitives；Label 保留原生语义 | 待验收 |
| `apps/web/src/components/video-player.tsx` | 保留纯业务组件；按钮、输入、菜单、弹窗、状态由官方组件映射 | 原生导出视频使用原播放器播放至14秒；其他播放器操作待验收 |
| `apps/web/src/plugin/builtin/library.tsx` | 保留纯业务组件；按钮、输入、菜单、弹窗、状态由官方组件映射 | 原生任务详情进入/重启恢复通过；删除/筛选等未覆盖 |
| `apps/web/src/plugin/builtin/localize-editor.tsx` | 保留纯业务组件；按钮、输入、菜单、弹窗、状态由官方组件映射 | 待验收 |
| `apps/web/src/plugin/builtin/media-upload.tsx` | 保留纯业务组件；按钮、输入、菜单、弹窗、状态由官方组件映射 | 待验收 |
| `apps/web/src/plugin/builtin/schema-form.tsx` | 保留纯业务组件；按钮、输入、菜单、弹窗、状态由官方组件映射 | 待验收 |
| `apps/web/src/plugin/builtin/settings.tsx` | 官方 Settings/Plugins；YouDub 资源业务页 | 原生通用0.0.7、官方提供商及凭据保存/发现模型/重开通过；核心仅一张内置卡，详见E13与密钥摘要证据 |
| `apps/web/src/plugin/builtin/shell.tsx` | 官方 AppFrame/Layout/Slots；client.jsx 注册 YouDub 视觉 | 旧Shell不执行；官方frame+slots导航实测 |
| `apps/web/src/plugin/builtin/studio.tsx` | 原动态 Logo、大标题、首屏动效；theme token 映射和官方 shell | 原版对照与原生首启/重启/深浅主题/收起侧栏通过；共用链接入口的端口传递有前端测试，E17工作流运行面板公网URL导入通过 |
| `apps/web/src/plugin/builtin/task-status.tsx` | 官方 StateDot/Tag + 业务状态文案 | UI订正保存revision3仍待确认，确认后导出完成状态通过；其余失败/取消分支未覆盖 |
| `apps/web/src/plugin/builtin/workflow-canvas.tsx` | 保留 ReactFlow 业务画布；字段控件替换官方 primitives | 原画布字段展示、模板改名副本保存通过；拖拽/连线操作待验收 |
| `apps/web/src/plugin/builtin/workflow-errors.tsx` | 保留纯业务组件；按钮、输入、菜单、弹窗、状态由官方组件映射 | 原生运行面板缺LLM原因可见；其他错误分支待验收 |
| `apps/web/src/plugin/builtin/workflow-guard.tsx` | 业务未保存拦截 + 官方 Modal | 改名后离开触发官方Modal→继续编辑→保存副本通过；放弃修改分支未覆盖 |
| `apps/web/src/plugin/builtin/workflow-options.tsx` | 保留纯业务组件；按钮、输入、菜单、弹窗、状态由官方组件映射 | 待验收 |
| `apps/web/src/plugin/builtin/workflow-rerun.tsx` | 保留纯业务组件；按钮、输入、菜单、弹窗、状态由官方组件映射 | 待验收 |
| `apps/web/src/plugin/builtin/workflow-resources.tsx` | 保留纯业务组件；按钮、输入、菜单、弹窗、状态由官方组件映射 | 原生运行面板缺LLM原因展示通过；多工作流资源准备冲突仍待验收 |
| `apps/web/src/plugin/builtin/workflow-run.tsx` | 保留原运行组件；链接代理字段复用ConfigEditor→官方Input | E17原生粘贴YouTube URL、输入7897并运行，源URL只进入每次运行输入，下载节点配置与固定binding一致；缺模型原因实测可见 |
| `apps/web/src/plugin/builtin/workflow-settings.tsx` | 保留纯业务组件；按钮、输入、菜单、弹窗、状态由官方组件映射 | 原生Whisper/tiny/cpu/禁止自动下一步完整字段展示、模板改名副本保存通过；全部字段写入未覆盖 |
| `apps/web/src/plugin/builtin/workflow-task.tsx` | 保留纯业务组件；按钮、输入、菜单、弹窗、状态由官方组件映射 | 原生订正revision3/重启/确认、音频19秒通过；随后9节点真实配音链及产物通过，见 [完整媒体链](evidence/source-native-full-dubbing.json)；所有节点重跑与人工校对分支仍未逐项覆盖 |
| `apps/web/src/plugin/builtin/workflows.tsx` | 保留纯业务组件；按钮、输入、菜单、弹窗、状态由官方组件映射 | 原生模板编辑/保存副本/运行面板及E13原格式9节点导入通过；E18默认3模板与既有用户副本读回；模板文件导出未实测 |

## 本轮已定位的问题

| 编号 | 精确问题 | 代码审计状态 | 运行验证 |
| --- | --- | --- | --- |
| A1 | 内存路径 query 未传到 WorkflowRoute，导致“使用”和 sourceTask 复用丢失 | 已补 params.__search 并逐层传递 | “使用”展开运行面板已实测；sourceTask 重跑仍待验收 |
| A2 | 旧 Button render/nativeButton 传给官方 Button，任务库新建无导航 | 任务库改显式 navigate；检查产物无其他活动旧调用 | 待验收 |
| A3 | 节点音频/中间结果 URL 仍走 /api/v2 旧静态路径 | 已统一 assetUrl → /api/youdub/file | E8原生节点音频播放19秒；E13/E16/E17真实媒体与Range读取通过 |
| A4 | 安装了旧扩展但新前端无旧 loader，启用状态不等于执行 | 改官方 PluginManager；提供 3 类原生 dsh bundle 测试包 | E4 生命周期通过；E10 原生 Client 页面/校对交互和卸载通过 |
| A5 | 官方模型更新未刷新 YouDub provider 与 query | 已复核现有 provider 重新 probe；前端订阅官方模型/配置/凭据事件并失效 query | E13页面保存模型后实际运行成功；所有增删改与保留草稿组合仍未逐项覆盖 |
| A6 | 首屏 examples 链接可能离开官方渲染且静态路径缺失 | 原 HTML/player/assets 通过官方固定端点，iframe 接回原返回导航 | fusion-examples-playing 实际播放至0:15、语言切换保持进度、暂停/返回通过 |
| A7 | 资源下载仅用领域 jobs Map，未挂官方 Jobs | backend 已接 runJob 包装准备/下载 | 待验收 |
| A8 | 缺少 Python 时整个 Host 插件启动失败，原首次准备页不可达 | 提前注册 setup 接口，原 EnvironmentSetup 准备 base 后在同一 Host 激活业务，原 Resources 完成四模型及其相关依赖后释放任务队列；失败保留原因和重试 | E2/E12 全四模型强制门控、旧完成标记不能绕过与原错误合同通过；E6 历史空目录基础安装；E12 最新原生四模型和依赖全部ready后放行 |
| A9 | 未配置模型时模板 openai 节点定义消失，目标语言字段丢失 | 保留原 translate 节点合同为不可执行的 legacy 定义；实际翻译仅调用官方 llm.* | 原生测试核对 unavailable 与 targetLanguage；桌面待验收 |

## 扩展能力迁移与测试包

标准 dsh bundle 声明 `dsh.bundle.patch`、Host 入口和可选 `dsh.client` 入口，交给官方 PluginManager 安装。旧 package.youdub 格式不能直接伪装为加载成功；转换后的业务仍在原来的同一 Harness Host 内运行。没有第二个 YouDub Loader、独立 Cordis 根或独立浏览器运行时。

- Host 插件 `inject: ["youdubDomain"]`，调用 `youdubContext(ctx).plugin(domainPlugin, config)`。扩展自己的官方 ctx 决定生命周期，桥接只加入 YouDub 业务服务的 isolate 标签。
- Python 插件调用 `registerPythonProvider(ctx, ...)`，复用 `ctx.youdubDomain.python` 与官方 Subprocess；原 JSONL worker 协议保留。
- Client 插件通过官方 `ctx.slots.inject/register` 注入 `youdub.page`、`youdub.navigation`、`youdub.task.detail.panels`、`youdub.workflow.node.editors/details`。页面 key 可以是路径模式；owner props 提供 navigate/request。设置直接使用官方 `settings.section`。
- `extensions.mjs` 将业务管理 API 委托官方 pluginManager。`application: failed/cancelled/overridden` 保留原始错误与结果；`restart-required` 明确返回。库存的 enabled、active、failed 分别表达期望配置与实际状态。

| 迁移测试包 | 源能力 | 官方挂点 | 状态 |
| --- | --- | --- | --- |
| `test/fixtures/file-transform` | 文件上传→UTF-8 大写→下载；独立页面、导航、任务面板 | domain bridge + page/navigation/task.detail.panels | E4 官方生命周期/产物通过；E10 源码原生页面按钮与最终官方卸载通过 |
| `test/fixtures/graph-text-review` | 两文本节点→合并→人工修订确认→导出；自定义校对页 | domain bridge + workflow.node.details | E10 原生自定义校对保存仍暂停、确认后83B产物、官方卸载通过；E11 两路状态机通过 |
| `test/fixtures/python-text` | 独立 Python worker→大写文本产物 | registerPythonProvider + 官方 Subprocess | E4 官方安装/启停/卸载和实际产物通过；Client UI 尚待桌面 |

构建：`node apps/harness/test/fixtures/build.mjs`。原 `fixtures/plugins` 不改，迁移包保留 SOURCE.json。生成的 dist 被 Git 忽略，安装或测试前必须先构建。本地路径安装由官方 pnpm 使用 link；开发目录需先安装声明的 SDK peer。E4 的 npm 运行时曾链接本工作区 `apps/harness`；源码开发 Electron 的 Client 验收包已明确改为 `apps/harness/dist/desktop/runtime-project/youdub-plugin`，Cordis 与 React 同样来自该源码运行时，避免引入第二份上下文。安装后核对实际解析路径，再由官方 PluginManager 启用；最初验收沿用官方解析器；随后在活动 fork 中修复顶层包卸载重装的路径解析，见[修复证据](evidence/refactor-plugin-reinstall.json)。这三类测试包覆盖源 SDK 的 JS Host、Python worker、Client 页面/节点扩展能力；未知旧插件仍需转换声明。

## 必须使用真实 Electron 的验收

1. 独立干净 profile 启动 YouDub 自有 Electron 入口，boot 无 pending 服务；vendor 源码与保存的原安装应用分别核对不变。
2. 原动态 Logo、完整大标题、首屏入场/背景动效；浅色/深色、收起侧栏、窗口缩放/全屏。右侧顶部留白只由官方 frame clearance 与页面内容关系决定；左侧固定；滚动条来自官方。
3. 原生文件选择、视频导入、Range seek、声音播放、输出下载原生保存；在校对页播放中间音频；中文/空格文件名。
4. 首屏点击模型设置，增加/编辑/删除模型与 API Key 后关闭，原页面与草稿保留且列表立即刷新。
5. “使用模板”直接进入运行；“编辑”进入画布；sourceTask 复用原素材；节点详情返回位置、缩放、未保存保护；官方 Menu/Modal 的 Tab/Escape/外部点击。
6. 安装 file-transform bundle→重启（若官方要求）→独立页面按钮→上传→下载→停用→卸载；不得只检查 inventory enabled。
7. 安装 graph-text-review bundle→自定义节点校对→保存→确认→导出；卸载后对应页面和节点贡献消失。
8. Python 插件真实执行与取消；扩展安装失败日志可见；官方UI对 restart-required 与 activation failed 表达准确。
9. 官方通用设置显示 YouDub 产品版本；内置示例入口和媒体示例真实可打开。当前开发版不显示旧产品更新入口。

## 持久化与完整工作流验收

以下是必要的状态机证据，不能用一条成功字幕链路替代。源测试如 `packages/builtin/test/graph-runtime.test.ts`、`graph-api.test.ts`、`task-runtime.test.ts` 已包含这些语义；需确认迁移后的实际官方 Host 边界同样通过。

E11 已在当前源码开发 Electron 的实际 Host 验证两路独立确认、公共下游等待、保存后仍暂停、相同动作幂等、旧修订拒绝与历史版本保留；E8 已验证原生 UI 修改后退出重启仍等待确认。下面列出的运行中取消、复用/删除等其余场景仍需区分源回归与实际 Host 证据。

- 两个并行节点均待确认时，确认一个只推进其分支，其他待确认节点保持不动；公共下游等待所有依赖。
- 等待人工确认持久化且释放执行槽；Host 重启后保留未确认修订；只保存修改不会默认自动下一步。
- 同一动作 id 幂等；过期修订被拒；并行独立确认互不误判；取消后确认不能复活任务。
- 运行中取消真实终止 Subprocess；失败原错误进入任务；远端结果未知保留风险状态，不能伪完成或静默重试。
- 重跑预览准确划分可复用/需重算节点；修订后派生任务只复用有效结果；删除原任务后派生产物仍独立可读。
- 资源检查只准备所选工作流依赖；下载失败、暂停、继续和显式重试可区分；配置服务完成后可恢复资源检查。
- 11 个操作分别有真实产物或明确当前阻塞。外部 LLM 只在 >=65535 输出上限验证通过后调用；缺资源/接口不支持应写具体阻塞，保持该项未通过。

## 后端边界核验记录（2026-10-21）

- 原领域回归：169 通过、1 项 Windows skip、0 失败；`/tmp/youdub-backend-domain-regression.log`。此证据不包含全部 Electron 操作。
- 原生边界：`backend-native.test.mjs` 使用真实官方 Cordis/Subprocess/Jobs 和 Python SQLite，7 项通过；最新用例验证旧 Whisper-only 完成标记不能绕过四模型、业务CRUD在准备前均503（`/tmp/youdub-backend-native-four-model-regression.log`）；`setup-onboarding.test.mjs` 的完整门控、写回失败和恢复12项通过（`/tmp/youdub-onboarding-all-models-tests.log`）。Connection 为接口注册测试 seam，桌面身份和协议仍需独立 Electron 验收。
- 原示例 HTML/player.js 字节与源文件一致，视频 Range 返回原 64 字节；未重写播放器源码。
- 四模型目录由官方 profile 的 YouDub dataDir/models（Whisper 使用明确的 modelsDir）一次解析，资源下载与 Python worker 共用映射；不读取机器模型环境变量。
- `backend/app/config.py` 在 `YOUDUB_HARNESS_RUNTIME=1` 时只继承 Harness 的运行环境，不再加载第二份业务 `.env`；15 项 Python 权限/环境测试通过。
- 首次下载 Python/安装 base 使用原 EnvironmentSetup 源码和原资源清单；独立干净目录实际完成阿里 npmmirror Python 3.12.15 下载、venv 创建、阿里 PyPI base 安装、同一官方 Host 启用 7 个业务 provider。`/tmp/youdub-cold-start.log` 记录 environment → ready；该 environment → ready 属较早仅基础环境版本；最新完整四模型首启见 E12。

## 当前分支后端证据索引

- **E1 源领域回归**：169 通过、1 个 Windows 跳过、0 失败，`/tmp/youdub-backend-domain-regression.log`。包含 CAS、幂等动作、并行确认分支、取消、重跑复用、源任务删除后派生产物、所选依赖准备等原状态机；它们在源码回归中通过，不能据此称全部 Electron 路径通过。
- **E2 官方服务组合**：`backend-native.test.mjs` 使用真实 Cordis/Subprocess/Jobs/Python SQLite，最新7项通过（`/tmp/youdub-backend-native-four-model-regression.log`），包含私有 media/model/cache 路径与禁用 user site 的真实探针、隔离域11项操作、旧 Whisper-only ready 标记与空模型目录仍回到完整准备、所有业务CRUD在准备前返回503。此前只等待ready的旧测试前提在新门控下失败，原失败日志 `/tmp/youdub-key-preview-harness-tests.log` 保留；只更新测试预期，未降低生产门控。Connection为注册seam，不在测试中下载或伪造模型ready。完整门控12项合同见E12；当前初始化后HTTP导入/读取/执行由E13真实原生任务验证。官方 Subprocess 6项通过，含省略cwd（`/tmp/youdub-subprocess-cwd-test.log`）。
- **E3 真实字幕 Host**：任务 `aa6e9ec4-d22e-4b3a-a692-a1e7bc904629`，官方 Connection 认证→multipart 导入 zoo-en.mp4→FFmpeg→真实 Whisper tiny CPU→人工将 long arms 改为 long trunks→保存后保持暂停 revision 2→Host 重启保留→确认→本地翻译 fixture 审核→确认→实际 FFmpeg 导出并经官方文件端点下载。`/tmp/youdub-asr-evidence.json` 与 `.cache/harness/backend-acceptance/evidence/` 保存 MP4、两个 SRT 和 SHA-256。翻译为明确的本地 fixture，无真实外部 LLM。该轮使用明确配置的已有 Python/模型，后续私有目录实现需桌面新任务另验。
- **E4 官方扩展生命周期**：`/tmp/youdub-plugin-evidence.json`。三个转换包均官方 inspect/install applied，执行业务产物，disable 后 catalog 移除、enable 后恢复、remove 后 inventory/catalog 移除。JS/Python 文本结果为 `YOUDUB PLUGIN`；图插件两路输入合并，修改后仍暂停，确认后产物保留来源数量 2。首次本地 link 缺 SDK peer 的原失败见 `/tmp/youdub-plugin-install.log`；给 fixture 开发目录配置其声明的本地 peer 后再显式启用，原失败未伪装成成功。未知旧 package.youdub 插件仍需转换声明，不能直接加载。
- **E5 LLM 协议**：官方 Pi-ai 适配器与本地 HTTP 端点 4 项通过（`/tmp/youdub-harness-final-tests.log`）；实际序列化输出上限 65535，模型容量不足调用前停止，HTTP 400 原因可见，保存原始调用事件。没有把 fixture 翻译视为外部模型质量验收。
- **E6 干净首次安装（历史基础安装证据）**：`/tmp/youdub-cold-start.log` 证明空目录实际下载原清单 Python 3.12.15、创建venv、安装base、同一官方Host启用业务provider。随后一版曾允许从四模型清单勾选子集，E8保留其Whisper-only过程；该选择门控已被最新完整首启替代，不能再据此放行。当前必须准备原manifest四模型、media/download及各模型相关依赖，再进入LLM设置，实际完成状态见E12。原Resources安装清单、校验及Demucs子模块初始化继续复用。本轮仅源码开发，不打包。
- **E7 源 Python/私有环境**：媒体必要回归 226 通过（`/tmp/youdub-media-python-regression.log`），覆盖原媒体操作、ASR、混音、对齐、分离、TTS、导出、下载及资源探针。真实模型执行与 mock 协议分开看待。新增私有环境分支由 setup 10 项通过（`/tmp/youdub-private-environment-tests.log`）及受影响 Python 159 项通过（`/tmp/youdub-private-python-tests.log`），明确拒绝机器 FFmpeg/FFprobe 与 NLTK；Harness 固定私有 runtime/cache/模型目录，Python 禁用 user site，原 Web 通用行为保持。独立审查另复现机器 `PIP_TARGET` 会绕过 venv 安装位置，已在私有安装分支清空 `PIP_TARGET/PIP_PREFIX/PIP_ROOT` 并禁用 `PIP_USER`，产品 worker 清空 `PYTHONHOME`；未下载软件的 pip 参数检查通过，3 项针对性安装/路径测试通过（`/tmp/youdub-setup-review-private.log`），官方子进程实际 Python 探针也通过。
- **E8 源码开发 Electron 私有环境（历史可选模型首启）**：新任务 `f3cbb9fe-2452-4c17-9572-a887d7672677` 在当前开发桌面同一 Host 内完成。四项模型清单由桌面勾选 Whisper 后实际准备，`GET /api/setup` ready、所选资源 prepared；LLM 页面选择稍后配置并进入工作台。官方 Connection 上传真实 zoo-en.mp4，私有 FFmpeg 与 Whisper 识别成功；第二段 long arms 改为 long trunks，桌面又修改第一段并保存 revision 3，退出重启后仍 paused / awaiting_review、approvedRevision null，三个版本均保留。随后在真实 UI 分别确认识别与人工测试译文，实际导出 MP4（608045 字节）、source.srt（385 字节）、translated.srt（282 字节），内容对应批准的识别 revision 3 / 译文 revision 1，SHA-256 与 Range 206 字节核对通过。普通官方 dsh 人工测试字幕 bundle 全程无 LLM 调用，不修改模型配置，已官方卸载并在重启后读回 inventory/catalog 消失、LLM metadata 不变。可提交摘要为 `evidence/source-native-subtitle-workflow.json`，原始证据保留在 `.cache/harness/native-subtitle-acceptance/`。桌面保存框最初默认名只有 file，已修业务 transport 的 inline Content-Disposition；最新 Host HEAD 返回正确文件名；E13随后已通过双SRT原生默认名保存与真实落盘哈希验证。E8本身不作为四模型强制首启证据。
- **E9 原失败路径准确复验**：原任务 `de9dafba-a048-4491-afc7-fb024adada5c` 的原日志栈指向 Files.register → usingProcess → 官方 targetEnvironment 对缺失 cwd 调用 includes。产品 process.mjs 已补传 `request.cwd ?? process.cwd()`，官方源码不改，现有真实 Subprocess 回归覆盖省略 cwd。派生任务 `8c807d62-f492-4d75-a0fa-e1154d347551` 复制该任务原视频，仅执行同一个 prepare 节点，成功生成 3364382 字节 RIFF/WAVE 音频。原任务保持 failed / revision 5 / 原错误，无覆盖、删除或外部 LLM；这只接受当时失败的媒体路径。摘要 `evidence/source-native-historical-prepare.json` 保留两次测试参数被合同拒绝的事实。
- **E10 扩展与依赖锁**：真实官方卸载暴露 pnpm 对未触及依赖沿用旧锁而恢复旧 SDK 链接的问题，离线最小案例确认后，prepare-profile 改用当前源码运行时官方 runPluginCommand 同步变化的 SDK 锁条目；既有扩展依赖保留，失败原样停止。profile 回归包含真实 pnpm add → 迁移 → remove 后 source SDK 链接不变。file-transform 与 graph-text-review 两个 Client 测试包经官方安装均 applied；原生外部文本页按钮计数 0→1，自定义图校对实际保存 revision 2 后仍待确认，原生点击确认后任务 `8b88138a-58f8-4f5a-acda-e5d8161353e7` succeeded，83 字节输出及 SHA-256 核对通过。两个包随后官方 remove 均 applied，inventory/provider/workflow 消失，实际 SDK realpath 与 lock specifier 均保持 `desktop/runtime-project/youdub-plugin`，无需重启。摘要 `evidence/source-native-client-plugins.json`，截图 `evidence/source-native-plugin-review.png`。此前 E4 的 npm SDK 开发链接不能直接用于源码运行时。
- **E11 官方 Host 两路状态机**：独立任务 `2c0547f1-6992-410e-89c6-9c949bc77927` 使用已安装的 `example.graph-text`，两个输入节点均显式 `autoContinue=false`。两路同时待确认时只确认 first，second 保持 awaiting_review，公共 review 等待依赖；second 使用其未变化的输出修订独立确认后，review 才进入待确认。重复 first 确认与修订保存的相同 actionId 均返回原 receipt，任务修订不再增加；保存 review 修订 2 后仍暂停，使用旧修订 1 确认返回 HTTP 409 / OUTPUT_REVISION_CONFLICT，原修订内容仍可读。确认修订 2 后实际输出 67 字节 UTF-8 文本，内容与 SHA-256 核对通过。无 LLM 调用；留给原生 UI 的任务 `8b88138a-58f8-4f5a-acda-e5d8161353e7` 未改动。摘要 `evidence/source-native-state-machine.json`，原始请求、检查点与产物在 `.cache/harness/native-state-acceptance/`。
- **E12 完整首次初始化门控**：按最新要求，首启必须完成原 manifest 的 Whisper tiny、VoxCPM2、Demucs htdemucs、Qwen3 Aligner 以及 media/download 和各模型相关依赖。后端从原 inventory 派生完整准备集合，拒绝子集请求；每次启动通过原 checkResources 复查实际文件与依赖，旧 `resourcesPrepared=true` 和 Whisper-only 选择不能直接放行。已下载资源保留，缺项时回到显式“准备全部模型”，不会自动下载；官方 preferences 写回失败及原资源错误保留。`setup-onboarding.test.mjs` 12 项通过（`/tmp/youdub-onboarding-all-models-tests.log`），覆盖部分旧状态恢复、完成标记不可信、模型/依赖/环境任一未就绪均阻止业务 API。最新原生强制准备已完成四模型与全部相关依赖，见 `evidence/desktop-required-model-gate.json`、`evidence/desktop-full-first-run.json`；E13运行前再次读回setup全ready。Web完整下载及独立SHA-256/环境探针见 `evidence/four-model-first-run.json`。E6/E8 中较早的可选模型首启记录仅作历史过程证据。

- **E13 原生完整真实配音链**：原生界面导入 `full-source-clone-dubbing.workflow.json`，选择原zoo-en.mp4并创建任务 `0d77dbf3-a39c-4713-b91c-ecacbe777014`。同一源码Electron/官方Host/private环境完成 prepare→Demucs→Whisper→真实火山方舟翻译→原声参考→VoxCPM2→mix→Qwen→export，9/9 succeeded，无人工译文fixture。官方模型通过页面配置，真实调用maxTokens=65535、finish=stop，3段ID保留；剔除凭据的请求响应副本与未改动原证据见 `evidence/source-native-real-translation.json`。MP4 741602B、WAV3635180B、原文SRT281B、译文SRT260B，文件名/HTTP Range206/摘要通过；Demucs样本数保持源音频、三参考16kHz单声道、三Vox语音48kHz、混音精确视频时长，导出WAV与混音相同，MP4 AAC与该WAV编码逐字节一致，Qwen51词/3片段及完整文字核对通过。验收脚本首次误将分离音频长度与视频长度相比而失败（原音19.072s，视频18.933s），保留 `/tmp/youdub-native-full-verification.log`，按源音样本数复核通过，未改业务结果。完整证据 `evidence/source-native-full-dubbing.json`；实际播放11.9秒、默认文件名与双SRT原生落盘哈希见 `evidence/source-native-full-dubbing-ui.json`。

E13同时暴露长中文烧录行裁切。随后增加的显示换行补丁曾通过40项导出回归及E14完整运行，但仅改变同一cue内排版。用户要求对照原YouDub分句后，此补丁撤回；原始两轮产物、模型请求响应和失败画面继续保留，不能作为分句恢复验收。

- **E14 历史显示换行补丁的原生重跑（补丁已撤回）**：未添加兼容指纹或改变重跑语义，由原生工作流再次选择原视频创建任务 `6d898822-3e81-4df2-8e38-1979a05a7efe`，真实完整9节点全部成功。第二次外部翻译请求仍为65535、finish=stop，脱敏请求/响应与摘要见 `evidence/source-native-real-translation-cjk.json`。MP4 745010B、WAV3635180B、双SRT各282B，全部SHA-256、文件名、Range206、音轨来源及实际Qwen47词/3输入片段验证通过，见 `evidence/source-native-full-dubbing-cjk.json`。逐条比较同一任务的 downloadable translated.srt 与 translated-display.srt，cue ID、时码、完整文字均相同，仅烧录版本增加换行；没有把两次随机模型输出强行视为相同。10.88秒实际视频帧 `evidence/source-native-full-dubbing-cjk-frame.png` 目视确认长中文完整两行且左右未裁切；具体核对见 `evidence/source-native-cjk-subtitle-fix.json`。原生播放器最终确认由桌面证据另记，首轮已完成双SRT原生保存。

- **E15 原分句源码恢复与真实词时码重放**：`youdub-backend/youdub/utils.py@2f30b06902e8ebc7a6469eb74ba0fcc58d279673` 的 `split_sentence_by_punctuation` 逐字复制到 `backend/app/v1/sentence_split.py`，函数 SHA-256 为 `30a3ce6efac89f855c05041eee2422c6a00364713c1d89e6561f00159fadd4bf`。中文显式按配置语言调用原函数，最小适配只将其片段映射回包含标点和空白的原文；非中文仍走现有英文点号、小数、ASCII括号规则。`word_cues` 与冻结基线逐字相同。导出、Qwen对齐和设备回归共71项通过（`/tmp/youdub-original-sentence-regression.log`），包括原函数hash、两次真实长句、原词边界和全文校验。重放E13/E14未修改的真实译文及Qwen词结果，cue数分别3→4、4→5，“这很酷。”分别独立使用12060–12620ms、12680–13240ms；没有插值时码或重写历史产物。见 `evidence/source-original-sentence-split-replay.json`。原函数会保留无分隔标点的长句，离线重放本身不作为视频验收；后续原生运行和成片画面见E16/E17。

仍未验证的真实外部能力：B站公网视频下载、官方Host字幕文件导入、Vox预设音色，以及未逐项覆盖的取消/重跑/复用/删除等分支；YouTube公网下载已由E17实际完成。模型质量单独评估：E13等历史上传素材的Whisper tiny结果为long arms；E17在线下载素材实际识别为long fronts，后续翻译沿用本次原识别结果。两者均保留原响应，不能把流程成功记为字幕准确率通过。

- **E16 原生原分句恢复完整运行**：任务 `01bbba6b-c230-436f-b0e0-ad7fe7890fc7`，原生UI从原完整模板上传zoo-en.mp4，9节点全部成功。3个译文/TTS单元产生6个独立字幕cue；原函数+保存的Qwen真实词时间重放逐条等于最终wordAlignment，原文标点完整，未插值或增加显示换行。原四条翻译规则确实出现在65535外部调用的system中，SHA与源相同。MP4/WAV/双SRT及视频音轨来源、Range、哈希全部通过；桌面实际播放17秒。8.5秒长片段、11.5秒短尾的真实视频帧分别完整显示，无左右裁切。证据 `evidence/source-native-full-dubbing-sentences.json`、`evidence/source-native-sentence-split.json`、`evidence/source-native-real-translation-sentences.json`；识别arms错误保留，未人为改写历史响应。

- **E17 原生公网 YouTube 下载与完整10节点**：复用既有 `youdub.download` / `media.download/v1`，新增节点配置 `proxyPort`，整数范围0–65535，默认0明确直连；正数构造 `http://127.0.0.1:<port>`，yt-dlp 与 b23 短链解析使用同一代理，不继承机器代理。节点设置和链接快捷入口复用原 ConfigEditor 与 Harness 官方 Input；URL 保持每次运行输入，未写入可导出图配置。原生运行面板输入 [Me at the zoo](https://www.youtube.com/watch?v=jNQXAC9IVRw) 与7897，创建任务 `874d381f-4750-459a-aa07-ebb1c435715a`，下载节点与固定 binding 的端口一致，真实下载533931B视频后接入prepare，至导出的10个节点全部完成。MP4 745386B、WAV3635180B、原文SRT285B、译文SRT340B，摘要/Range/音轨来源通过；真实翻译上限65535，Qwen输出56词/3输入片段，最终5条独立字幕。原生视频实际播放14秒，两帧成片另留证。见 [下载节点](evidence/source-native-youtube-download-node.json)、[完整产物](evidence/source-native-youtube-download.json)、[实际翻译](evidence/source-native-real-translation-youtube.json)、[原生回看](evidence/source-native-youtube-download-ui.png)、[代理输入](evidence/source-native-youtube-proxy-input.png)。本次ASR为long fronts；B站实际公网下载、其他代理端口/网络条件未做实机验收。针对性合同见 [代理与私有Node](evidence/download-node-proxy-contract.json)：Python29项、图编译8项；前端51项、旧localize端口传递1项及Web/根类型检查日志为 `/tmp/youdub-download-proxy-frontend-tests.log`、`/tmp/youdub-download-proxy-localize-tests.log`、`/tmp/youdub-download-proxy-web-tsc.log`、`/tmp/youdub-download-proxy-root-tsc.log`。

- **E18 默认模板合并**：当前内置默认列表保留 `youdub.subtitles`（字幕翻译）、`youdub.dubbing`（视频配音）、`youdub.subtitles-dubbing`（字幕＋配音）三项。移除只在自动下一步配置上不同的独立“字幕翻译 · 人工校对”入口；用户仍通过同一节点的“自动下一步”配置决定该节点是否暂停确认。原识别/翻译人工确认状态机保留，15项模板/图回归通过，日志 `/tmp/youdub-merged-workflow-tests.log`。E17真实Host读回恰好三项默认ID，并保留两个用户工作流；前一任务的图快照与输出未改变，见 [默认列表与历史任务核对](evidence/source-native-youtube-download-node.json)。历史 `fusion-workflows.png` 和人工校对模板截图仅记录合并前状态，不能表示当前模板数量；未把历史任务或用户副本改成自动运行。

## 当前 fork 的历史数据读回补验收

提交 `4313ec5e` 使用独立副本启动真实 Desktop Host，四模型就绪检查通过，读回 6 个历史任务和 7 个工作流。重启同一副本后，12 个产物通过官方 Connection 下载，其字节数与 SHA-256 均匹配历史文件；两份视频的 Range 206 与头部字节一致。原始数据库哈希未变。没有触发外部 LLM 调用；复用既有 YouDub 私有 runtime/model 的此次检查不代表全新安装、原生播放器或听感验收。[完整记录](evidence/refactor-history-readback.json)

## 本轮补充证据

- **E19 当前 Host 业务边界（8fea16f1）**：独立 profile、实际 Desktop Host 和官方 Connection，直接使用既有 Harness 文本校对 fixture。7 组场景、105 次请求通过；覆盖工作流 CRUD/CAS、分页、任务取消/重试、人工修订与回执、部分依赖复用、文件归属和删除保护，退出正常。完整请求结果和夹具修正历史见[业务边界证据](evidence/refactor-host-api-boundaries.json)。没有外部 LLM 调用；不代表原生界面或真实媒体推理验收。
- **E20 B 站公网下载**：在隔离实际 Host 中验证完整链接直连、b23 短链、显式本机代理三条路径；各自完成下载与媒体准备，产物和 Range 读回通过。见[B 站证据](evidence/refactor-bilibili-download.json)。原生输入/保存/播放仍待验收。
- **E21 当前私有运行资源（8fea16f1）**：实际 Host/Python 读回 Node、pnpm、Python、FFmpeg、模型、缓存和配置解析路径；显式提交全部资源选择后四模型 ready，正常退出。合成凭据验证管理存储优先级；复用已有私有资源，不声明全新下载或原生验收。见[隔离证据](evidence/refactor-runtime-isolation.json)。

- **E22 双语字幕导入与真实媒体导出（8fea16f1）**：官方 Connection multipart 上传英文 BOM/CRLF SRT、中文 SRT 和 zoo 视频，经原 Python `subtitles.import/v1` 保留两段文本、语言和精确时码；FFmpeg 导出视频、双 SRT，封面实际生成并读回。时间轴不匹配及坏 SRT 均保留原始 `INVALID_SUBTITLES`，不产生最终输出。导出继续沿用原分句/去末尾标点规则，原导入结果保留完整文本。见[字幕导入证据](evidence/refactor-subtitle-import.json)。未调用 ASR/LLM/TTS；原生保存与播放另验收。
