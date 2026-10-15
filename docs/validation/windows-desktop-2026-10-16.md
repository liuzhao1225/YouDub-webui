# Windows 桌面打包验收

日期：2026-10-16（Asia/Shanghai）。本机为 Windows 10 22H2 x64（19045）、16 GB 内存、NVIDIA GeForce GTX 1080 Ti（11 GB，驱动 536.99）。构建 Node 22.17.0，内置 Node 22.23.2，WebView2 Runtime 155.0.4283.45。

## 最终产物

- `dist/YouDub-0.0.2-windows-x64.zip`，95,534,096 字节。
- SHA-256：`f6f55e4e70391091a4a93d04a00663f1dc4908e066dd0e85fce8baedfcb4787e`，相邻 `.sha256` 文件可供校验。
- 基线提交 `ac3bca60da2d1407504ac755f72d49e38ff5f4ef` 加 Unicode 解压修复；本地产物不是已发布的 GitHub Release。
- `npm run build:windows` 构建 ZIP；`npm run test:windows` 解压并验收真正的 `YouDub.exe`。
- 原生验收报告及 WebView2 截图保存在忽略目录 `dist/windows-smoke.json`、`dist/windows-smoke.png`。

## 实际安装包与首次配置

应用完整解压到含中文、空格的独立安装路径，通过包内 EXE、Node 和服务运行。首次配置使用独立空数据目录，复用本机已经下载的受管 Python、FFmpeg 和模型缓存；未改动日常数据目录，也未把本机 `.env`、密钥或模型装进分发包。

空配置场景中，未填写密钥会被拒绝；错误密钥得到 HTTP 401 对应的可读错误；失败测试不会保存配置。用原生窗口填写有效连接后，测试通过并进入工作台，密钥保存到 Windows 凭据管理器，API 仅返回 `has_api_key`。选择稍后配置不会伪造凭据。初次引导验收对应候选包 `ab8a2d60860e58a1595721b4c5e9e68c5fc1e44f7c337c118ab5b0b935cd8666`，证据保存在 `.cache/windows-real-task/config-negative.json` 和 `config-positive.json`。

默认窗口按当前屏幕工作区的 90% 打开，最低目标 1280×850，并限制在屏幕内；可调整大小。

## 完整真实任务

任务 `46e607b7-6273-4e75-a2ad-bb31b76fb90f` 在实际 Windows 候选包中完成。输入为包含真实英语讲话的 11.04 秒 MP4（640×360，25 fps），输出中文配音视频、音频及原文/译文字幕。没有用模拟模型或模拟翻译响应。

| 步骤 | 实际实现 | 耗时约 |
| --- | --- | --- |
| 准备媒体 | FFmpeg | 0.93 秒 |
| 人声分离 | Demucs htdemucs，CUDA | 7.51 秒 |
| 语音识别 | Whisper tiny，CUDA | 23.68 秒 |
| 翻译 | 已配置的 OpenAI 兼容服务 | 39.04 秒 |
| 准备参考音频 | 源音色克隆 | 1.21 秒 |
| 配音 | VoxCPM2，CUDA | 156.21 秒 |
| 混音 | 保留背景音 | 1.69 秒 |
| 字幕对齐 | Qwen3 ForcedAligner 0.6B，CUDA | 28.78 秒 |
| 导出 | H.264 / AAC，48 kHz | 1.69 秒 |

总耗时约 261 秒。导出文件重新完整解码通过，视频时长 11.04 秒，抽帧检查中文字幕正常。证据保存在 `.cache/windows-real-task/attempt-3/`。这个完整推理任务在升级到最终 0.0.2 之前的候选包运行；后续包继续验证任务恢复及从导出步骤重跑，不能把它记为最终 ZIP 重新完成所有推理。

第二次完整任务 `43c8ae14-8956-4167-b3c7-7f2837d2ab39` 在配音阶段出现原生进程退出码 `3221225477`（`0xC0000005`）。界面仍可用，任务正确标记为失败。同机当时还有另一个 CUDA 训练进程；诊断重放期间系统提交内存接近上限。使用相同包内 Python、VoxCPM2 脚本、翻译文本和参考音频单独重放成功。资源争用是可能因素，尚未证明根因；用户明确将此并发训练场景排除出本次继续复测范围。原始失败与重放记录保留在 `.cache/windows-real-task/final-full/` 和 `tts-crash-replay/`，不把它描述为已修复的模型问题。

## 包与任务生命周期

| 检查 | 结果 |
| --- | --- |
| 最终 0.0.2 ZIP | 校验和、中文/空格路径解压、内置 Node/npm 与 SDK 导入通过 |
| 原生页面 | 首页、任务、设置的首次准备页在真实 WebView2 渲染；离线示例页面及视频元数据加载通过 |
| 离线示例资源 | 3 个示例的中英文视频和封面均由包内服务返回 |
| 单实例 | 相同数据目录的第二实例被拒绝，第一实例继续响应 |
| 退出与恢复 | 正常关闭及强制结束后，Node/WebView2 和网关退出；相同数据目录可重开 |
| 包完整性 | 运行前后 5,596 个文件的路径与 SHA-256 一致 |
| 无效媒体 | 返回 `INVALID_MEDIA`；重试增加 attempt；删除后返回 404 |
| 运行中取消 | 实际 Whisper 识别阶段取消任务，最终状态为 cancelled |
| 局部重跑 | 复用成功任务，从 export 开始重跑并下载有效视频 |
| 扩展安装 | 中文/空格路径的本地扩展、隔离 Python 扩展、使用共享 SDK 的 npm 构建扩展均安装成功 |
| 重启恢复 | 设置、翻译模型和凭据可用性保持；3 个扩展启动成功；真实文本扩展任务完成 |
| 0.0.2 候选包升级 | 已配置数据目录正常启动；设置与凭据保持；禁用的测试扩展可在重启后卸载；原成功任务保留，从 export 重跑及下载通过，最终正常关闭 |

生命周期证据保存在 `.cache/windows-real-task/final-lifecycle/`；0.0.2 升级及导出证据保存在 `.cache/windows-real-task/final-v002/`，对应 Unicode 解压修复之前的候选包 `54f6cb191493989fca5a4d29d1877d5d75e74dcdc587afccfd8b75c96d4f18de`。修复后重新构建并通过最终 ZIP 原生冒烟检查；这些测试使用实际包内服务，未启动源码开发服务。

## 修复与回归

实际测试修复了 Windows 文件 URL 与插件资源分隔符问题、中文上传及 Python 管道编码问题，以及 Python stdin 阻塞读导致 NumPy/OpenBLAS DLL 导入卡住的问题。Windows Python 3.12 使用非阻塞管道读取，Unix 保持原行为。新增真实 NumPy 导入回归。

扩展安装改用所选 Python 解释器；Windows 目录共享使用 junction，避免要求开发者模式；npm 由内置 Node 直接运行 JS 入口；分发包提供 JavaScript SDK 导出，使普通 Node 构建脚本可加载 SDK。嵌套 `node_modules` 不会被复制进本地扩展。

首次远端验收进一步发现英文 Windows runner 的 `tar.exe` 会损坏中文参数路径。Windows 构建、ZIP 验收及首次 UV 工具准备改用 .NET ZIP API，通过环境变量传递原始路径；macOS/Linux 保留 tar。新增真实 ZIP 回归在未配置 Python 的环境中，验证中文、空格、引号、方括号及 URL 特殊字符路径。FFmpeg/分句资源原有 Python ZIP 解压不受影响。

| 自动回归 | 本机结果 |
| --- | --- |
| Host 全量 | 75 通过，2 跳过，0 失败；跳过项为平台专用检查或缺少 Windows 文件符号链接权限 |
| Python 全量 | 445 通过，15 跳过，0 失败；轻量测试环境不安装完整推理依赖 |
| 前端全量 | 14 个文件，66 项通过 |
| TypeScript / ESLint / 前端生产构建 | 通过 |
| 发布版本规则 | 3 项通过，版本 0.0.2 |
| 工作流语法 | actionlint 1.7.12 通过，未启用 shellcheck/pyflakes |
| 依赖与提交检查 | npm 生产依赖审计 0 漏洞；两套 Python 环境 pip check 通过；git diff --check 通过 |

## 设备与 macOS 兼容性

本机自动识别 Pascal 显卡并使用 Torch 2.8 / CUDA 12.6，实际 GPU 运算及完整任务通过。CUDA、MPS、AMD ROCm 的安装策略、实际运算可用性和 CPU 回退由单元测试覆盖；这不等于 AMD/MPS 真机推理验收。硬件支持范围见 [本地推理设备](../accelerators.md)。

文件系统使用 `node:path`/`pathlib`，文件 URL 使用 `pathToFileURL`。Windows 启动器独立于 macOS AppKit；macOS 权限掩码、数据路径、签名、公证流程保留。CI 增加 macOS 路径、环境准备、设备选择及导入回归。本机不能执行 macOS 打包、签名、公证或 MPS 实机推理。

## 自动化与边界

`windows.yml` 可手动运行，也由 PR/main/tag 的质量门禁复用。Windows runner 运行 Host/Python 回归，再构建、解压并检查原生窗口、离线示例和退出清理，上传 ZIP、校验文件及验收证据。tag 发布等待质量门禁和 macOS 签名公证完成后，一起发布 Windows ZIP 与 macOS DMG。已经发布的旧 tag 不会自动补发 Windows 包。

常规打包 CI 使用明确不存在的 Python 路径，检查首次准备错误页且不下载模型；模型推理通过上述本机真实任务单独验证。本次未重新下载完整 Python/模型缓存，也未进行 Windows Authenticode 签名。分发形式为完整解压运行的便携 ZIP。远端 CI 结果以对应提交的 GitHub Actions 为准。
