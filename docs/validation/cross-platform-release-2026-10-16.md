# 跨平台打包回归（2026-10-16）

对应 [PR #144](https://github.com/liuzhao1225/YouDub-webui/pull/144)，整合 [Windows 原生实现 #143](https://github.com/liuzhao1225/YouDub-webui/pull/143)。正式产物以 [GitHub Releases](https://github.com/liuzhao1225/YouDub-webui/releases) 为准。

## 修复与统一

- 两端使用 `npm run build:desktop`，共用运行环境组装、锁定 Node 版本、npm 分发和 SDK JavaScript 导出。macOS 保留 Swift/WKWebView 和签名公证，Windows 保留 WinForms/WebView2 和便携 ZIP。
- 原 macOS 包普通 Node 导入 SDK 报 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`，也未附带 npm。新包能在限制 PATH、无全局 npm 的条件下实际安装并构建使用 SDK 的扩展；包启动前后签名校验通过。
- Windows CI 原先使用系统 tar 解压到中文路径失败。改用 .NET ZipFile 的 Unicode 路径接口，继续验收中文及空格目录中的真实 EXE。
- 后续 CI 在 Chocolatey 获取 FFmpeg 时遇到 HTTP 504；改为使用与应用相同的 FFmpeg 发行源，下载后核对发行资产 SHA-256，再执行媒体回归。
- 连接测试显式校验并传入 `max_completion_tokens=65535`，拒绝降低上限，服务不支持时保留失败。
- 质量门禁实际构建两端包。tag 发布复用本次门禁的候选包；macOS 仅在受保护签名环境取得签名材料。已有 tag 和发布资产保持不变。
- 官网根据 GitHub 已公开资产生成平台/版本列表，缺少安装包或校验文件的平台不显示下载入口。正式发布工作流成功后更新官网。

## macOS 实际验收

Apple Silicon 原生应用完成环境准备，已有模型、任务和翻译连接继续可用。此次将原有不匹配的 Torch/Audio 环境更新为 Torch 2.8.0、torchaudio 2.8.0、torchcodec 0.7.0，复用模型缓存。

实际任务 `d7ab815c-761a-4247-88a9-9c6f0017c37e` 使用已有 Me at the zoo 18.93 秒 H.264 素材，约 120 秒完成全部 9 步：

| 环节 | 实际配置及结果 |
| --- | --- |
| 识别 | Whisper tiny / CPU，完成 |
| 翻译 | 已配置的 doubao-seed-evolving / 远程，最大输出 65535，完成 |
| 人声分离 | Demucs htdemucs / MPS，完成 |
| 原声克隆 | VoxCPM2 / MPS，完成 |
| 字幕对齐 | Qwen3 ForcedAligner 0.6B / MPS，完成 |
| 预览与导出 | 原生窗口播放成功；视频、配音音频、原文字幕、译文字幕均下载成功 |

成片为 H.264/AAC、320×240、18.933 秒，FFmpeg 完整解码无错误。该任务验证流程与设备兼容性，不代表识别/翻译质量基准，不替换官网已选择的示例成片。

安装包内黄仁勋、创作者收入、Me at the zoo 三组示例均可加载播放，中英切换保持播放位置。退出原生应用后，服务端口和子进程清理，应用签名继续有效。

本地回归：Host 75 通过、1 跳过；Python 461 通过；连接测试与设备策略 16 通过；发布版本/下载列表 4 通过。前端与两端原生包已通过[整合 CI](https://github.com/liuzhao1225/YouDub-webui/actions/runs/38795790234)；后续提交的最终结果见 PR 检查。

## 验收边界

Windows 的 GPU 真实任务和初始本机验收见 [Windows 验收记录](windows-desktop-2026-10-16.md)。后续整合包使用 GitHub Windows runner 进行 EXE、WebView2、中文路径、退出及崩溃清理回归；runner 不提供该 GTX 1080 Ti 推理环境。macOS 本轮复用已有模型缓存，未重新下载全部模型。Windows 包暂未进行 Authenticode 签名；Linux、Intel Mac 和 Windows ARM64 未提供此版本安装包。
