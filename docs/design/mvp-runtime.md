# MVP 开发分支运行说明

本页记录 `codex/mvp-mainline` 当前已实现的行为。总体接口见[主干设计](youdub-desktop-v0.1.md)，实施顺序见[开发计划](mvp-development-plan.md)。

## 当前实现

- `/api/health` 返回 `status` 和本次进程的 `instance_id`。它表示后端可响应请求；模型能力查看 `/api/v1/runtime`。
- `/api/v1/runtime` 返回 CPU/CUDA 设备、能力目录和输入限制。Whisper、VoxCPM2、Demucs 在依赖及本地权重就绪后可选；OpenAI 兼容翻译在 SDK 与连接配置就绪后可选。四种能力均就绪时状态为 ready，其余为 degraded。
- `GET /api/v1/settings` 读取默认配置、界面语言和脱敏连接；`PATCH` 每次更新一个配置组。
- 登录和 CSRF 沿用现有机制。v1 的认证、参数、存储和凭据错误使用 `error.code/message/field/stage/action`。
- Task 上传、配置与连接快照、列表/详情、日志，以及产物 GET/HEAD/Range 已接入。浏览器按 UUID 提交视频和 JSON 配置；失败导入保留同 ID 残留，可通过删除接口清理。
- v1 与原 WebUI 共用单线程 worker。一个 Task 持续占用执行位置，远端 waiting 保留查询 ID；重启时中断的本地步骤明确失败，已保存的远端等待继续查询。
- 字幕模式已接通 `prepare → asr → translate → export`：FFprobe 检查媒体，FFmpeg 提取 16 kHz 单声道音频，本地 Whisper 保留原始结果并生成稳定分段 ID，翻译通过 ID 对应，导出原文/译文 SRT 和保留首音轨的字幕 MP4。
- 配音模式接通 `prepare → separate → asr → translate → tts → mix → export`。VoxCPM2 使用分离后的源音色逐段配音；mix 保留源时间戳，按实际配音样本数生成独立时间轴。dubbing 输出 MP4/WAV，both 另含源时间轴原文 SRT 和配音时间轴译文 SRT。
- cancel、retry、rerun、delete 已接入：取消确认本机进程退出；retry 保留原配置及连接快照，attempt 加一并从 prepare 开始；rerun 复制原视频并使用新配置；delete 拒绝活动任务、进行中的文件写入和下载。
- 首页、设置及任务详情已切换到 v1：按 Runtime 选择配置，导入本地视频，查看阶段、错误、固定配置和产物。任务详情按 allowed_actions 提供取消、重试、重新生成和删除，以及日志展开/下载；模型不可用时禁用创建和重新生成提交。

## 本地运行

沿用仓库 [README](../../README.md) 的环境配置和启动方式，更新依赖后运行 `npm run dev:api`。应用读取 `.env`；新增 `keyring>=25.6,<26` 依赖，用于[系统凭据存储](https://keyring.readthedocs.io/en/latest/)。

Web 开发和检查使用与 CI 一致的 Node.js 22。视频准备依赖 FFmpeg/FFprobe；当前 Runtime 不会把仅安装 Python 包视为完整模型能力。

### 字幕链模型配置

- 安装 `openai-whisper`、`torch` 和 `openai`。将 [Whisper 官方](https://github.com/openai/whisper)兼容的 `.pt` 权重放入数据目录的 `models/whisper/`，例如 `tiny.pt`；可通过 `YOUDUB_WHISPER_MODELS_DIR` 指定目录。Runtime 只读文件元数据，不下载或加载模型；权重实际加载失败时任务会明确报错。
- 当前 Whisper 读取音频还要求 `ffmpeg` 位于 PATH；prepare/export 支持现有 `FFMPEG_PATH`、`FFPROBE_PATH` 配置。选择 `.en` 权重时仅支持英语输入。
- 在设置中保存 OpenAI 兼容的 base URL 与 API key。翻译模型候选默认 `gpt-4.1-mini`，可用 `YOUDUB_TRANSLATION_MODELS` 配置逗号分隔列表；已保存的默认模型也会保留。目录可选表示前置条件满足，实际模型名称与权限由调用验证。
- 英语、中文、日语是当前字幕链的语言范围。自动检测到其他语言或源语言与目标相同时，翻译前明确失败。
- 翻译逐批请求，每批最多 20 段、源文本合计最多 6000 个字符；原始单段超过字符限制时明确失败。供应商需支持 Chat Completions JSON object 响应；不自动重试、拆句或重排源时间轴。
- 中文/日文字幕需要可用字体。macOS 默认 `Hiragino Sans GB`、Windows 默认 `Microsoft YaHei`、Linux 默认 `Noto Sans CJK SC`；Linux 需安装对应字体包，也可通过 `YOUDUB_SUBTITLE_FONT` 指定字体名。

同步翻译在发出请求前持久化 pending。收到完整成功响应后标记 succeeded，再校验 JSON 与分段；明确拒绝标记 failed。超时、连接中断或等待期间取消保留 unknown 风险，禁止直接 retry。取消会关闭本机异步请求，远端是否继续执行由 `external_operation` 表达。

### 配音链模型配置与边界

- 仓库固定 `voxcpm==2.0.3`。将 [VoxCPM2 官方模型](https://modelscope.cn/models/OpenBMB/VoxCPM2)放入数据目录的 `models/voxcpm/VoxCPM2/`，或设置 `YOUDUB_VOXCPM_MODEL_DIR`。目录需含 config、tokenizer、主模型和 AudioVAE 权重。推理只加载本地文件，明确使用所选 CPU/CUDA；关闭自动下载、降噪和质量重试。
- 当前提供 `source_clone`，尚未提供预设声线。参考音频按每个 speaker 的最长源分段选择，最多 10 秒。Whisper 本身不提供说话人区分；未标注 speaker 的分段按同一源音色配音。
- Demucs 使用仓库子模块和官方 `htdemucs` 权重 `955717e8-8726e21a.th`，置于数据目录的 `models/demucs/`，或设置 `YOUDUB_DEMUCS_MODELS_DIR`。它从原视频首音轨提取 44.1 kHz 双声道音频，保持完整音频长度；不使用已降采样的 ASR 输入做分离。
- 混音输出 48 kHz、双声道 PCM16 WAV。配音按生产主干的有界时长倍率变速，并以实际样本数排程；源分段重叠返回 `UNSUPPORTED_OVERLAPPING_SPEECH`，完整配音放不进原视频返回 `AUDIO_EXCEEDS_VIDEO`，不截断语音。保留背景时使用 `(dub + 0.3 × background) / 1.3` 的固定混音增益。
- prepare 按毫秒比较首视频与首音轨的起点，起点不同明确返回 `UNSUPPORTED_MEDIA`，避免提取后整体错位。任务创建保持异步语义，此类任务会在 prepare 失败。

MVP 业务数据使用新目录中的 `desktop.sqlite`，保留旧 WebUI 数据库的原有语义。可以通过 `YOUDUB_DESKTOP_DATA_DIR` 指定独立目录；默认位置如下：

| 平台 | 默认目录 |
| --- | --- |
| Windows | `%LOCALAPPDATA%/YouDub` |
| macOS | `~/Library/Application Support/YouDub` |
| Linux | `$XDG_DATA_HOME/youdub`，未设置时为 `~/.local/share/youdub` |

新库只含 `tasks`、`settings` 两张业务表。旧认证机制继续使用现有认证存储；两套任务入口共用执行器，v1 文件保存在新数据目录下的 `tasks/<UUID>/input|work|output`。

## 设置与密钥

在现有界面登录后，业务请求使用同一会话 Cookie。写请求携带登录或 session 接口返回的 `X-CSRF-Token`。

例如更新界面语言：

```http
PATCH /api/v1/settings
Content-Type: application/json
X-CSRF-Token: <session csrf token>

{"ui_language":"zh"}
```

连接按适配器单独设置，目前可配置远端翻译适配器 `openai`。`api_key` 省略表示保留，非空值表示替换，`null` 表示清除。更换 `base_url` 时不会将旧地址的密钥发到新地址。

密钥仅写入系统凭据库；SQLite 保存引用，GET 返回 `has_api_key`。任务保存的凭据引用由任务持有；轮换默认连接时清理未被任务引用的旧凭据。系统凭据库不可用时明确失败。密钥操作和 SQLite 写入发生部分提交时返回 `SETTINGS_PARTIALLY_APPLIED`，需要读取设置核对实际状态。

## 已验证与待完成

2026-09-22：契约、Runtime、Settings 及相关旧认证/API 回归通过；macOS 系统凭据库的实际写入、读取、删除通过。凭据验证使用临时测试值，验证后已删除。

任务链已用真实合成视频和显式测试适配器验证上传、顺序执行、远端等待、错误、产物注册及文件下载；测试中的 ASR、翻译、导出结果不代表真实模型效果。媒体准备单独验证了真实 FFmpeg 输出和原视频未改写。

动作接口验证包含重试幂等、复制输入、文件失败保留记录、下载期间拒绝删除，以及真实子进程取消后退出。远端 waiting 的取消只保证本机停止；已接受的远端请求遇到结果校验错误时仍保留 ID 和 unknown 风险，禁止直接 retry，rerun 需要 `acknowledge_external_risk=true`。

浏览器使用独立测试数据库，样例名称明确标注 Mock；已核对登录、模型不可用提示、设置保存、列表/详情和视频首帧。经 Next 代理的实际下载、HEAD 和 Range 请求通过，下载文件与测试源 SHA-256 一致。内置浏览器在点击播放时页面崩溃，完整播放尚未验收。

任务动作另经 Chrome 实际验收：queued 取消、waiting 经 cancelling 到 cancelled、重试 attempt 1→2、终态删除返回首页且数据库与目录移除、日志下载字节相同。远端 unknown 保留请求 ID 并禁止 retry；重新生成可编辑配置和勾选风险，在模型不可用时禁止提交。此次使用隔离 Mock 数据库，未调用真实外部模型。

本次真实 CPU Whisper tiny 已识别约 7 秒英语语音视频并保留原始文本和时间戳；tiny 将样例中的 YouDub 识别为 UDob，结果按原样保留。权重来自官方地址并核对完整 SHA-256。字幕导出使用真实 FFmpeg 验证了首音轨、视频尾帧字幕、中文及特殊路径和原视频未改写。

同一语音样例已通过真实 Demucs、VoxCPM2 CPU 推理、混音和三模式导出。原始 TTS 为 7040 ms，排程后实际配音区间为 0–6680 ms，最终 WAV 和配音 MP4 为 6880 ms。该验证使用明确标记的人工译文，原视频和 ASR 文件哈希保持不变；[验证记录](../validation/mvp-local-media-2026-09-22.json)包含配置范围、模型哈希、分段与输出哈希。

上述 both 产物经实际任务详情页在 Chrome 播放至 6.88 秒结束，`ended=true`、`error=null`，画面中的中文字幕可见。页面下载的 133732 字节视频与原产物 SHA-256 一致；视频 Range 返回 206，登录、列表、详情和下载返回 200。未评价听感或音质，未据此宣称远端翻译通过。

最新后端全量 **783 项通过**；前端 **35 项测试**、TypeScript、ESLint 和生产构建通过。供应商响应测试使用明确的 MockTransport，不代表真实远端翻译已验收。依赖更新后，隔离后端的新进程登录、session、Runtime、Settings 和任务列表实际读回均为 200；`pip check` 通过。

当前尚未完成真实远端翻译闭环、完整任务端到端验收、人工音质试听及 Windows 实机验收。已有 `.env` 与 `env.txt` 内容不一致，保持两份文件未覆盖；实际远端联调配置来源待用户确定。模型缺失或依赖不完整时，公开接口明确拒绝对应组合。
