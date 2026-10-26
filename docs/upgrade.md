# 安装与升级

可在[官网下载页](https://liuzhao1225.github.io/YouDub-webui/#download)选择平台，或打开 [GitHub 最新版](https://github.com/liuzhao1225/YouDub-webui/releases/latest)。固定下载入口：[Windows EXE](https://github.com/liuzhao1225/YouDub-webui/releases/latest/download/YouDub-windows-x64-Setup.exe)、[macOS DMG](https://github.com/liuzhao1225/YouDub-webui/releases/latest/download/YouDub-macOS-arm64.dmg)、[Windows ZIP](https://github.com/liuzhao1225/YouDub-webui/releases/latest/download/YouDub-windows-x64.zip)。链接随每次正式发布更新，SHA-256 文件在相同链接后加 `.sha256`。需要回退时，在官网版本选择器中选择历史版本。

v0.0.8 在首次配置和「设置 → 模型」共用模型供应商管理，可选择目录供应商或添加自定义模型 API。配置地址、协议、API Key 和模型后，在工作流节点选择实际模型。旧 `/settings/connections` 会转到模型分区；原 `openai` 连接仅保留给历史任务，初次迁移导入已有地址、模型和密钥引用。

已保存的 API Key 显示前 6 位加 `****`（短密钥全部隐藏），方便辨认。输入框留空保留已保存密钥，输入新值替换；环境变量提供的密钥只读。模型目录或“获取模型”返回候选，不能证明真实翻译已成功；修改地址或协议后获取模型，需要明确提供对应密钥，不能无提示发送旧地址的密钥。

从 `v0.0.4` 起，应用进入工作台后自动检查正式版本，随后每小时检查一次；发现新版本时显示对应平台的下载入口。当前设置入口为「关于与更新」，可手动检查或关闭自动检查，开关随应用数据保留。检查失败时显示错误并停止自动检查，手动检查成功后恢复。下载完成后按下方步骤替换应用。

翻译响应校验失败时，日志会显示批次、具体失败原因和 `translation_raw` 原始响应文件名。小米 MiMo 在 [#146](https://github.com/liuzhao1225/YouDub-webui/issues/146) 中的原始失败仍待服务地址与脱敏响应复现，此版本没有宣称已验证该问题修复。

## 国内首次启动下载

节点工作流版本先准备 Python 和基础依赖，完成后即可进入工作台。打开工作流检查资源，再准备图中节点需要的依赖与模型；字幕工作流无需安装配音模型。资源准备失败会保留错误和编辑入口，修复后可手动重试。操作见[节点工作流](workflows.md)。

准备过程遇到问题时，可展开「诊断日志」查看当前版本、系统、环境和模型状态，错误详情位于日志末尾。点击「反馈 Issue」会复制完整日志，并打开预填了版本、系统和阶段的 GitHub 表单，粘贴日志、补充问题描述后即可提交。也可点击「复制日志」单独复制；复制失败会显示原因，日志框支持全选复制。报告不包含配置文件或准备令牌，并隐藏常见凭据、下载地址查询参数及用户主目录；提交前仍可检查和编辑。

从 `v0.0.5` 起，应用自动检测系统、处理器、GPU 和已有资源，缺少时直接下载：Python / FFmpeg 使用阿里 npmmirror，Python 依赖与 CPU / CUDA / Linux ROCm 使用阿里镜像，模型使用 ModelScope，分句资源使用 ModelScope 的阿里云 OSS。新安装使用 YouDub 自有 Python，不探测系统 Python 或 Microsoft Store 占位入口，避免出现 9009 安装错误。解释器与虚拟环境分别位于首启所选数据目录下的 `runtime/python` 和 `runtime/venv`。准备页面显示下载来源。下载器不读取系统环境变量中的 HTTP 代理；失败会显示原因并保留断点，需手动重试。

Windows AMD ROCm 7.2.1 专用依赖暂无已核实的阿里或 ModelScope 镜像，仍使用 AMD 官方源。应用安装包、软件更新和用户输入的视频地址沿用各自官方服务。源码安装缺少 Demucs 子模块时仍需获取 Git 仓库；桌面包已包含该子模块。

## macOS 桌面版

支持 Apple Silicon、macOS 14 及以上。退出正在运行的 YouDub，打开 DMG，将 YouDub 拖入 Applications；已有试验版本时替换应用。再次启动后，确认已有任务、模型与供应商配置。

应用与数据分开保存。替换 `/Applications/YouDub.app` 会保留 `~/Library/Application Support/YouDub`。v0.0.8 的默认 Harness profile 位于该目录的 `harness/profiles/desktop`，默认业务目录为 `harness/youdub`；首启可另选数据目录。旧版本数据保留原位，供应商与凭据改由 Harness 设置管理，需要重新确认配置。升级前退出应用并保留原数据目录。

首次安装会准备 Python 和基础依赖，FFmpeg、推理依赖与模型按工作流准备；已有安装可能需要更新配套依赖。翻译服务通过 Harness 模型设置配置接口、模型和密钥，输出参数沿用 Harness 的调用规则。正式安装包已签名、公证，附带校验文件可用 `shasum -a 256 -c YouDub-<版本号>-macOS-arm64.dmg.sha256` 核验。

## Windows 桌面版

从 `v0.0.5` 起提供 `YouDub-<version>-windows-x64-Setup.exe` 安装包，适用于 Windows 10 22H2 / Windows 11。双击后选择安装目录，可创建开始菜单和桌面快捷方式；默认安装到 `%LOCALAPPDATA%\Programs\YouDub`，不需要管理员权限。可在 Windows「已安装的应用」中卸载。安装程序和应用尚未进行 Authenticode 签名。

升级前退出 YouDub，运行新版本安装包。v0.0.8 的 Electron 用户目录位于 `%APPDATA%\YouDub`，Harness profile 为其下 `harness\profiles\desktop`，默认业务数据为 `harness\youdub`；首启可另选目录。旧版 `%LOCALAPPDATA%\YouDub` 数据保留原位，需要重新确认数据目录、供应商与模型配置。不要让新旧版本同时写入同一数据目录。

Release 同时保留 ZIP 便携版；完整解压后运行 `YouDub.exe`，升级时解压到新的应用目录。不要把新旧版本同时运行在同一个数据目录。v0.0.8 自带 Electron，无需另装 WebView2。下载后可使用 PowerShell `Get-FileHash <文件路径> -Algorithm SHA256` 与相邻 `.sha256` 文件核对。

v0.0.5–v0.0.7 的 Windows 本机验收覆盖打包、原生窗口、首次翻译配置、路径兼容性、任务生命周期和服务退出，并使用实际 Windows 包在 GTX 1080 Ti 上完成真实视频的识别、翻译、配音、字幕对齐和导出。真实任务复用已准备的 Python 与模型缓存，不代表全新机器上的完整模型下载已验收，详见[验收记录](validation/windows-desktop-2026-10-16.md)。

## 从旧 main 源码版升级

1. 等待旧任务完成并停止旧服务，保留旧提交号，以及 `.env`、数据库和任务文件所在目录的副本。新旧服务不可同时写入同一数据目录。
2. 将源码更新到正式 tag（例如 `git checkout v0.0.3`），按 [运行指南](design/cordis-plugin-runtime.md#1-安装与配置) 安装依赖并启动。新版使用 Node.js 22 的 Cordis Host；旧 FastAPI 启动命令和 v1 HTTP 接口已移除，当前 API 为 `/api/v2`。
3. 原 `.env` 继续保留；代理读取的 `env.txt` 必须与其为硬链接。在设置中确认翻译连接，在所用工作流节点中确认模型与处理参数。已有默认处理配置会迁移为“原默认处理配置”工作流；迁移失败保留原数据并报告原因，历史任务快照保持不变。

历史数据的两种情况：

- `desktop.sqlite` 会迁移到 schema 3，保留 schema 2 的线性任务。MVP schema 1 旧任务保留原始快照；存在进行中的 schema 1 任务时迁移会报 `MIGRATION_ACTIVE_TASKS`。先在旧版完成或停止任务，再升级。MVP 历史任务不能直接按旧流程重试，重新生成会创建新任务。
- 旧 main 的 `data/youdub.sqlite` 保留原位，其 URL 下载任务不进入新版任务列表。已有成片仍在原任务目录，需要在旧版本中查看历史时，使用保留的旧源码和升级前的数据副本；新版不能直接继续这些旧任务。

迁移后的数据库不要交给旧程序继续写入。需要返回旧版时，停止新版服务，并使用升级前对应版本的数据副本。详细数据契约见 [迁移说明](https://github.com/liuzhao1225/YouDub-webui/blob/c92b670f079428eed40ca6ab7bdfd69e3328fef4/docs/design/cordis-plugin-migration.md#5-数据和凭据迁移)。

### 节点任务的执行兼容性

当前版本按各内置供应商和工作流的执行依赖计算完整性标识。设置、安装准备、HTTP 接口、前端或模板文案修改不会单独改变已保存任务的执行标识；实际执行代码、数据契约和相关依赖声明变化仍会改变标识。

本次兼容记录仅覆盖提交 `5c2fdf0` 的旧完整性标识 `sha256:0d6c1b5d4d978d7e042d408703141e41fd5e2df92db6c180579ee963c53ff18e`，涉及七个内置供应商和 `youdub.localize`、`youdub.graph` 两个工作流。只有当前实现与[已审核记录](../packages/builtin/src/builtin-compatibility.json)完全匹配时，旧任务才可通过这项兼容检查，继续重试、确认节点或复用中间结果；插件 ID、插件版本、工作流版本、模型和输入输出契约的既有检查仍生效。历史任务的计划、参数和完整性快照保持原样。

未知旧标识仍会被明确拒绝；后续执行代码变化会使本次兼容记录失效，需重新审核兼容范围。遇到不兼容时，可在对应旧版及其数据副本中完成任务，或在新版创建任务。这项记录不代表所有历史发行版或第三方插件均兼容，也不替代正式安装包验收。

## 当前范围

桌面打包覆盖 macOS Apple Silicon 和 Windows x64；Windows 的实际发行以包含 ZIP 的 Release 为准。Linux 和 Intel Mac 暂无本次验收的安装包。语言目录包含中文、英文和日文，具体可选项取决于模型能力；Qwen 字幕对齐仅支持中文和英文。源码安装与扩展插件配置见 [运行指南](design/cordis-plugin-runtime.md)。

「查看官网示例」在浏览器中打开官网的中英文试听。安装包只保留黄仁勋采访原视频，供本地工作流使用。
