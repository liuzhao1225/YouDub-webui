# MVP 开发分支运行说明

本页记录 `codex/mvp-mainline` 当前已实现的行为。本轮 macOS CPU 主干交付已完成，Windows/CUDA 实机验收列入后续范围。总体接口见[主干设计](youdub-desktop-v0.1.md)，实施顺序见[开发计划](mvp-development-plan.md)。

## 当前实现

- `/api/health` 返回 `status` 和本次进程的 `instance_id`。它表示后端可响应请求；模型能力查看 `/api/v1/runtime`。
- `/api/v1/runtime` 返回 CPU/CUDA 设备、能力目录和输入限制。Whisper、VoxCPM2、Demucs 在依赖及本地权重就绪后可选；OpenAI 兼容翻译在 SDK 与连接配置就绪后可选。四种基础能力均就绪时状态为 ready，其余为 degraded。可选的 `subtitle_alignment` 单独报告可用性，缺失该模型不会改变基础能力的就绪状态。
- `GET /api/v1/settings` 读取默认配置、界面语言和脱敏连接；`PATCH` 每次更新一个配置组。
- 登录和 CSRF 沿用现有机制。v1 的认证、参数、存储和凭据错误使用 `error.code/message/field/stage/action`。
- Task 上传、配置与连接快照、列表/详情、日志，以及产物 GET/HEAD/Range 已接入。浏览器按 UUID 提交视频和 JSON 配置；失败导入保留同 ID 残留，可通过删除接口清理。
- v1 与原 WebUI 共用单线程 worker。一个 Task 持续占用执行位置，远端 waiting 保留查询 ID；重启时中断的本地步骤明确失败，已保存的远端等待继续查询。
- 字幕模式已接通 `prepare → asr → translate → export`：FFprobe 检查媒体，FFmpeg 提取 16 kHz 单声道音频，本地 Whisper 保留原始结果并生成稳定分段 ID，翻译通过 ID 对应，导出原文/译文 SRT 和保留首音轨的字幕 MP4。
- 配音模式接通 `prepare → separate → asr → translate → tts → mix → export`。VoxCPM2 使用分离后的源音色逐段配音；mix 保留源时间戳，按实际配音样本数生成独立时间轴。dubbing 输出 MP4/WAV，both 另含源时间轴原文 SRT 和配音时间轴译文 SRT。
- cancel、retry、rerun、delete 已接入：取消确认本机进程退出；retry 保留原配置及连接快照，attempt 加一并从 prepare 开始；rerun 复制原视频并使用新配置；delete 拒绝活动任务、进行中的文件写入和下载。
- 首页、设置及任务详情已切换到 v1：按 Runtime 选择配置，导入本地视频，查看阶段、错误、固定配置和产物。任务详情按 allowed_actions 提供取消、重试、重新生成和删除，以及日志展开/下载；模型不可用时禁用创建和重新生成提交。

## 本地运行

沿用仓库 [README](../../README.md) 的环境配置，在仓库根目录运行 `.venv/bin/uvicorn backend.app.main:app --host 127.0.0.1 --port 8000`。应用读取 `.env`；新增 `keyring>=25.6,<26` 依赖，用于[系统凭据存储](https://keyring.readthedocs.io/en/latest/)。

`.env` 是配置来源，`env.txt` 为同一文件的硬链接；两者均被 Git 忽略。新 worktree 通过 `.worktreeinclude` 复制 `.env` 后，执行 `ln .env env.txt` 和 `test .env -ef env.txt` 重建并核对链接。配置复制到另一台机器后仍需按运行环境选择设备及模型目录；v1 翻译连接通过 Settings 保存到系统凭据库。

Web 开发和检查使用与 CI 一致的 Node.js 22。视频准备依赖 FFmpeg/FFprobe；当前 Runtime 不会把仅安装 Python 包视为完整模型能力。生产构建会固定 API 代理地址：使用非默认端口时，在 `npm run build` 前设置 `NEXT_SERVER_API_BASE_URL`，后端启动端口应与其一致。常规后端测试使用 `PYTHON_DOTENV_DISABLED=1 .venv/bin/pytest backend/tests`，避免本机真实配置影响隔离测试。

### 字幕链模型配置

- 安装 `openai-whisper`、`torch` 和 `openai`。将 [Whisper 官方](https://github.com/openai/whisper)兼容的 `.pt` 权重放入数据目录的 `models/whisper/`，例如 `tiny.pt`；可通过 `YOUDUB_WHISPER_MODELS_DIR` 指定目录。Runtime 只读文件元数据，不下载或加载模型；权重实际加载失败时任务会明确报错。
- 当前 Whisper 读取音频还要求 `ffmpeg` 位于 PATH；prepare/export 支持现有 `FFMPEG_PATH`、`FFPROBE_PATH` 配置。选择 `.en` 权重时仅支持英语输入。
- `asr.initial_prompt` 可填写最多 500 字符的专名提示，随 Task 配置固定并传给 Whisper。未提供时保持模型默认行为；不会把本产品名称写成所有视频的默认提示。
- 原始 ASR JSON 保持不变。处理用 transcript 为每条完整 ASR utterance 分配稳定 ID，保留原文、起止时间和 speaker。翻译、TTS 和 mix 按该 ID 一对一处理整句；逗号、字幕长度和 8 秒时长均不拆分语音生成单元。
- export 独立把一个整句拆成多个字幕显示片段，完整保留文本及顺序。原文字幕使用源区间；译文在 subtitles 模式使用源区间，在 both 模式使用 mix 输出的实际配音区间。`subtitle_alignment` 省略或为 `null` 时，按各片段可见字符权重估算显示时间；both 模式可选择下节的 Qwen 字词强制对齐。这两种方式均保留原始 ASR 时间戳、整句 TTS 音频与 mix 排程。
- 在设置中保存 OpenAI 兼容的 base URL 与 API key。翻译模型候选默认 `gpt-4.1-mini`，可用 `YOUDUB_TRANSLATION_MODELS` 配置逗号分隔列表；已保存的默认模型也会保留。目录可选表示前置条件满足，实际模型名称与权限由调用验证。
- 英语、中文、日语是当前字幕链的语言范围。自动检测到其他语言或源语言与目标相同时，翻译前明确失败。
- 翻译逐批请求，每批最多 20 段、源文本合计最多 6000 个字符；原始单段超过字符限制时明确失败。供应商需支持 Chat Completions JSON object 响应；连接超时为 10 秒，读取超时为 300 秒，自动重试次数为 0。读取超时或连接中断时任务明确失败，远端结果标记 unknown，并保留任务及其远端状态；不自动拆句或重排源时间轴。
- 外部 LLM 接口的输出上限至少为 65,535。v1 翻译请求显式固定 `max_completion_tokens=65535`，当前 TaskConfig 不提供可降低该值的参数。供应商拒绝该上限时，任务明确失败且不自动换参数重试。火山方舟 `doubao-seed-evolving` 已接受该参数并完成三句真实翻译，见[输出上限验证](../validation/mvp-translation-output-limit-2026-09-22.json)。
- 中文/日文字幕需要可用字体。macOS 默认 `Hiragino Sans GB`、Windows 默认 `Microsoft YaHei`、Linux 默认 `Noto Sans CJK SC`；Linux 需安装对应字体包，也可通过 `YOUDUB_SUBTITLE_FONT` 指定字体名。

同步翻译在发出请求前持久化 pending。收到完整成功响应后标记 succeeded，再校验 JSON 与分段；明确拒绝标记 failed。超时、连接中断或等待期间取消保留 unknown 风险，禁止直接 retry。取消会关闭本机异步请求，远端是否继续执行由 `external_operation` 表达。

### 可选字幕字词对齐

- TaskConfig 的 `subtitle_alignment` 使用 `ModelSelection`，省略或 `null` 保持按字符估算。只有 `output_mode=both` 接受非空值，设置、导入与重新生成沿用同一配置结构和校验；已保存的默认配置保持原选择。
- 选择值为 `{"adapter":"qwen_forced_aligner","model":"Qwen3-ForcedAligner-0.6B-hf","device":"cpu"}`；CUDA 设备使用 Runtime 返回的 `cuda:n`。本次适配支持目标语言 `en`、`zh`，每条完整配音最多 300 秒。Runtime 返回 `capability=subtitle_alignment` 及这些限制。
- [Qwen3 ForcedAligner 官方模型](https://huggingface.co/Qwen/Qwen3-ForcedAligner-0.6B-hf)通过 `transformers>=5.17,<6` 原生加载。将完整模型目录放在数据目录的 `models/qwen3-forced-aligner/Qwen3-ForcedAligner-0.6B-hf/`，或用 `YOUDUB_FORCED_ALIGNER_MODEL_DIR` 指向该目录；可从 [ModelScope 模型仓库](https://modelscope.cn/models/Qwen/Qwen3-ForcedAligner-0.6B-hf)取得模型。执行时只读本地文件。
- 对齐在 export 内执行：输入 mix 生成的 `work/adjusted/` 整句干声与对应完整译文；输出字词相对起止时间，再加上该句 `dubbed_start_ms` 得到视频时间。每条字幕采用模型对齐的首词起点和末词终点，保留词间停顿；显示分段边界落在一个词内部时，合并相邻显示片段。
- `work/subtitle_alignment/words.json` 原样保存原生解码返回的字词与时间结果，生成的显示片段另存为 `cues.json`。时间精度取决于模型；该模型的时间格为 80 ms，原生解码本身包含时间戳修正。若预测时间边界跨越整句干声尾端，且越界不超过一格（80 ms），仅在生成显示片段时将该边界映射到实际音频终点，并在阶段日志记录转换的词区间数；原生解码结果保持不变。越界超过 80 ms、文本不匹配或时间非单调时直接报错。当前未逐词进行人工精度标注核验。该步骤保持现有七阶段、整句 TTS 与混音结构；不新增常驻模型服务。
- 缺少可选权重时，基础能力状态和原有字符估算任务保持可用。显式选择 Qwen 后，模型缺失、推理失败、文本不匹配或无效时间戳会直接报错，任务不会自动改用估算结果。

### 配音链模型配置与边界

- 仓库固定 `voxcpm==2.0.3`。将 [VoxCPM2 官方模型](https://modelscope.cn/models/OpenBMB/VoxCPM2)放入数据目录的 `models/voxcpm/VoxCPM2/`，或设置 `YOUDUB_VOXCPM_MODEL_DIR`。目录需含 config、tokenizer、主模型和 AudioVAE 权重。推理只加载本地文件，明确使用所选 CPU/CUDA；关闭自动下载、降噪和质量重试。
- 当前提供 `source_clone`，默认使用 VoxCPM2 官方[极致克隆](https://github.com/OpenBMB/VoxCPM/blob/main/README_zh.md#-极致克隆)：同时传入参考音频、同一提示音频及其源文本。参考窗口总跨度最多 10 秒，优先覆盖更多源语音；短 utterance 可按连续同 speaker 组成完整窗口。超过 10 秒的 utterance 仅在参考音频选择时，从同源原始词时间戳中选取不超过 10 秒的窗口，并使用对应源文本；该选择不拆分完整 TTS 译文，不跨已标记的 speaker。Whisper 本身不提供说话人区分；未标注 speaker 的分段按同一源音色配音。官方建议参考音频约 5–30 秒；短参考仍需实际听感评估。尚未提供预设声线。
- Demucs 使用仓库子模块和官方 `htdemucs` 权重 `955717e8-8726e21a.th`，置于数据目录的 `models/demucs/`，或设置 `YOUDUB_DEMUCS_MODELS_DIR`。它从原视频首音轨提取 44.1 kHz 双声道音频，保持完整音频长度；不使用已降采样的 ASR 输入做分离。
- 混音输出 48 kHz、双声道 PCM16 WAV。配音沿用参考生产主干的有界时长倍率变速，先获得所有完整调整后音频的样本数和首选起点，再从视频末端反向排程：`start = min(preferred_start, next_start - clip_frames)`。尾部需要前移时使用前面的已有空隙，`dubbed_start_ms` 可早于对应源起点；原始 ASR 时间、配音顺序、完整音频样本、变速倍率和原画面总长保持不变。源分段重叠返回 `UNSUPPORTED_OVERLAPPING_SPEECH`；全部完整语音仍放不下、首段计算起点小于 0 时返回 `AUDIO_EXCEEDS_VIDEO`。保留背景时使用 `(dub + 0.3 × background) / 1.3` 的固定混音增益。
- 末端反向排程为本次 YouDub WebUI 基于真实视频问题新增的逻辑；独立 youdub-backend 提供有界倍率与顺序排程的参考，其原实现允许动态延长输出，没有这项原视频尾部容纳保障。
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

早期浏览器验证使用独立测试数据库，样例名称明确标注 Mock；已核对登录、模型不可用提示、设置保存、列表/详情和视频首帧。经 Next 代理的实际下载、HEAD 和 Range 请求通过，下载文件与测试源 SHA-256 一致。该次内置浏览器在点击播放时页面崩溃；后续 Chrome 完整播放结果见下文。

任务动作另经 Chrome 实际验收：queued 取消、waiting 经 cancelling 到 cancelled、重试 attempt 1→2、终态删除返回首页且数据库与目录移除、日志下载字节相同。远端 unknown 保留请求 ID 并禁止 retry；重新生成可编辑配置和勾选风险，在模型不可用时禁止提交。此次使用隔离 Mock 数据库，未调用真实外部模型。

早期真实 CPU Whisper tiny 已识别约 7 秒英语语音视频并保留原始文本和时间戳；未加专名提示时，tiny 将样例中的 YouDub 识别为 UDob，历史结果按原样保留。该问题的逐词分句与专名提示复验见下文。权重来自官方地址并核对完整 SHA-256。字幕导出使用真实 FFmpeg 验证了首音轨、视频尾帧字幕、中文及特殊路径和原视频未改写。

同一语音样例已通过真实 Demucs、VoxCPM2 CPU 推理、混音和三模式导出。原始 TTS 为 7040 ms，排程后实际配音区间为 0–6680 ms，最终 WAV 和配音 MP4 为 6880 ms。该验证使用明确标记的人工译文，原视频和 ASR 文件哈希保持不变；[验证记录](../validation/mvp-local-media-2026-09-22.json)包含配置范围、模型哈希、分段与输出哈希。

上述 both 产物经实际任务详情页在 Chrome 播放至 6.88 秒结束，`ended=true`、`error=null`，画面中的中文字幕可见。页面下载的 133732 字节视频与原产物 SHA-256 一致；视频 Range 返回 206，登录、列表、详情和下载返回 200。未评价听感或音质，未据此宣称远端翻译通过。

另通过登录、Settings 和 `POST /api/v1/tasks` 公开接口，连续创建 both、subtitles、dubbing 三个任务，由未替换阶段函数的正式 worker 自动执行。Whisper、Demucs、VoxCPM2 与 FFmpeg 均真实运行；翻译适配器通过 OpenAI SDK 调用本机 HTTP 测试服务，返回明确的人工译文。三个任务均在 attempt=1 成功结束，执行时段无重叠，日志中的完成阶段与模式一致，外部调用状态为 succeeded 且无未知结果风险。全部产物通过 API 下载并与磁盘哈希核对，视频 HEAD/Range 返回 200/206，音视频完整解码通过。临时测试凭据与自启服务已清理；[API 编排验收记录](../validation/mvp-api-orchestration-2026-09-22.json)记录任务时间、阶段与产物。该记录证明真实本地模型的任务编排链可运行；真实供应商验证见下文。

配置来源明确后，使用火山方舟 `doubao-seed-evolving` 真实调用，再次通过正式 API 和 worker 完成 subtitles、both、dubbing 三个任务。此次翻译未替换为人工内容：现有 Chat Completions JSON object 请求与该配置兼容，三个任务均在 attempt=1 成功，步骤日志、外部回执和约定产物完整。所有产物下载后与磁盘哈希一致，音视频可完整解码。将 MP4 音轨解码到相同 PCM 格式后，字幕模式与源音轨、配音模式与输出 WAV 的相关系数均大于 0.998；该检查证明音轨来源一致，不评价主观音质。[真实供应商验收记录](../validation/mvp-real-provider-2026-09-22.json)保留了模型、配置、ASR、真实译文、阶段和产物哈希。三个旧版产物均在 Chrome 完整播放、下载哈希一致。用户认可该版声音完整清楚、时序可接受，随后指出专名和未分句问题。

提交 `984ce5e`、`6cd150d`、`477319f` 分别接入 VoxCPM2 极致克隆、逐词分句与专名提示、前端配置。在此版本重新运行同一视频，三个模式全部在 attempt=1 成功。每个任务填写 `asr.initial_prompt="YouDub."`，原始 ASR 正确识别 YouDub；处理 transcript 根据原始词时间戳拆成三句，三句依次翻译和配音。配音参考音频覆盖连续完整原文，both 为 6680 ms，dubbing 为 6700 ms；同时提供同一音频作为 reference/prompt 以及匹配原文。

该历史版本的所有音视频完整解码、API 下载哈希与 HEAD/Range 均通过。原文 SRT 对应源时间轴，译文 SRT 对应实际配音时间轴，三段完整调整后音频均落在原视频范围内。Chrome 中三个视频都播放至结束且 `error=null`；表单显示 VoxCPM2 原声克隆默认值，专名提示上限为 500。both 的三条字幕已逐帧核对。浏览器点击下载返回 200，当次未独立核对浏览器保存文件；全部产物的 API 下载字节已核对。[极致克隆与分句验收记录](../validation/mvp-hifi-sentences-2026-09-22.json)保留原始证据及自动检查结果。2026-09-23 用户明确反馈“听感不行”，要求“一整句生成tts，只不过字幕要分段显示”；该版三条 TTS 的听感验收未通过。

2026-09-23 提交 `e7d3d46` 恢复完整 ASR utterance → 整句翻译 → 整句 TTS → 整句混音排程的一对一关系，在 export 内生成一对多的字幕显示片段。媒体流程参考的 youdub-backend 本地与生产运行目录提交均已核对为 `1e738a89bfc27fa5602d0442b317ecedfacb20e5`，详见[参考依据](youdub-desktop-v0.1.md#参考依据与接口附件)。同一视频的三个模式均在 attempt=1 成功，后端 **838 项通过**。both 样例只有一次完整译文 TTS，原始配音 7200 ms，完整变速后的配音区间为 0–6680 ms；三条字幕在该区间内分别显示，YouDub 拼写正确。API 产物字节、HEAD/Range、完整解码、音轨来源及完整音频排程核对通过。详见[整句配音与字幕分段验收](../validation/mvp-utterance-subtitles-2026-09-23.json)。用户随后反馈“可以不错”，接受本轮整句配音样例；该反馈记录在同一验收文件中。

2026-09-22 版本后端全量 **840 项通过**；前端 **43 项测试**、TypeScript、ESLint 和生产构建通过。供应商响应单元测试使用明确的 MockTransport，真实供应商验证另见上文记录。依赖更新后，隔离后端的新进程登录、session、Runtime、Settings 和任务列表实际读回均为 200；`pip check` 通过。本次整句修正的回归和真实样例另行记录。

Windows、CUDA、长视频与多说话人场景列入后续实机验收，不作为本轮 macOS 主干交付门槛。2026-09-22 已按用户指示从实际运行的 youdub-backend 同步 `.env`，复制时核对内容一致并重建 `env.txt` 硬链接；随后在本机配置 `YOUDUB_TTS_ENGINE=voxcpm2`、CPU、WebUI 登录哈希和本机 HTTP Cookie，硬链接保持不变。真实媒体验收使用独立数据目录，临时凭据已清理。另按用户指示在本机默认 Settings 保存真实翻译连接和 VoxCPM2 `source_clone` 默认配置，密钥保存在系统凭据库；专名提示保持每任务可选，未全局写入 YouDub。

正常启动另已核对：直接运行仓库 `.venv/bin/uvicorn backend.app.main:app`，应用自行读取 `.env`，前端使用 Node.js 22 的生产构建。通过 Next 同源代理，health、真实本机登录、session、Runtime、Settings 和任务列表全部返回 200，Runtime 为 ready，默认声音回读为 VoxCPM2 `source_clone`。该验证未替换配置函数、未导入测试认证、未创建模型任务；自启服务已停止。见[正常启动验收记录](../validation/mvp-standard-startup-2026-09-22.json)。

2026-09-23 补齐正常启动的页面闭环：Chrome 使用现有本机密码登录，在首页文件选择器导入同一视频，采用已保存的模型配置并填写任务专名提示 `YouDub.`，正式 worker 完成整句配音与字幕任务 `0446ee5f-8360-4346-9f13-a3c9337f8e68`。详情页显示 Completed，视频实际播放至 6.88 秒结束且无播放器错误；四份产物经 API 下载与磁盘逐字节一致，HEAD/Range 返回 200/206。点击页面下载链接后，浏览器保存文件的路径未独立核对，内部下载页面受浏览器安全策略限制。见[正常页面闭环记录](../validation/mvp-normal-ui-2026-09-23.json)。用户已接受上文整句配音样例；该意见的对象为此前提供的样例，本段页面任务另保留客观播放与文件验证记录。

2026-09-22 的三模式验收发生在用户新增“外部 LLM 接口请求显式输出上限至少 65,535”规则之前，历史请求参数及原始响应保持原样。随后单独验证 v1 文本翻译的 `max_completion_tokens=65535`，返回 HTTP 200、`finish_reason=stop`，三个 segment ID 完整；27 项翻译回归通过，SDK 序列化请求体的上限已核对。2026-09-23 整句修正的三模式真实请求均使用此上限。

2026-09-23 用户澄清：65,535 指调用外部 LLM 接口时的输出参数。规则已按该作用域执行，此前的范围误读阻塞已移除；历史请求和原始响应不变。

2026-09-23 使用 [README 的黄仁勋真实视频](../../README.md)《Jensen Huang on Nvidia’s Competition》（原容器约 59.34 秒）完成修正后的真实 mix/export 阶段复验并生成成片，详见[黄仁勋与 Qwen 验收记录](../validation/mvp-jensen-qwen-2026-09-23.json)。原完整 API 运行第一轮在翻译读取 60 秒后超时，第二轮完成真实翻译与 25 条完整 TTS 后因尾部超出画面 166 ms 在 mix 失败，两轮失败状态均保留。修正后复用第二轮的 25 条完整配音执行 mix/export，新增 LLM 与 TTS 请求均为 0；本次结论限定为这两个真实阶段和本地产物复验成功。该成片未重新注册为新的成功 API Task，其 API 下载、HEAD/Range 尚未针对本次产物复验。

复验保持 25 条原始 ASR utterance、25 条完整译文、25 条完整 TTS 与 25 条完整调整后音频的一一对应；原始与调整后音频 SHA-256 均保持，源 ASR 与原文 SRT 时间未改写。Qwen 原生解码返回 357 个字词，生成 35 条字幕，其中 8 个 utterance 显示为多条字幕；4 个末词的时间格跨尾边界按上述规则转换并留有日志。导出画面和 WAV 时长均为 59.326 秒，MP4 完整解码通过，左右音轨与 WAV 的相关系数分别为 0.998937、0.998969。Qwen 与字符估算两版以同一份最终 WAV 为输入，在同步对比页均完整播放到 59.326 秒，`ended=true`、`error=null`。相同文本的 70 个字幕起止边界相对字符估算平均绝对差为 157.24 ms，最大 433 ms；该差值仅用于比较两种定时输出，人工准确率尚未测量。相关 mix/export/align 66 项检查、前端 29 项检查、TypeScript、ESLint 和生产构建通过。

画面抽查覆盖 12、30、58.8 秒，后两处可见新中文字幕与黄仁勋实片。源视频已有烧录英文字幕，部分区域与新增中文上下较挤，保留为现有渲染限制。Whisper tiny 的专业名词误识别与未区分采访者/黄仁勋声线也保留在验收记录，后续按真实效果改进。用户试听反馈继续作为改进依据，不作为后续开发与推送的阻塞条件。
