# 无 TTS 依赖的工作流验收

2026-10-20，在 macOS arm64 的独立 Python 3.12.12 环境执行。没有修改项目原有 `.venv`。

## 环境

独立环境仅从阿里 PyPI 安装 `backend/requirements/base.txt` 和 `backend/requirements/media.txt`。实际模块检查：

| 模块 | 已安装 |
| --- | --- |
| pydantic、python-dotenv、keyring、packaging | 是 |
| numpy、soundfile | 是 |
| torch、whisper、voxcpm、transformers、librosa | 否 |

该运行的数据目录中没有模型文件。使用已有 FFmpeg / FFprobe。Host 在基础 Python 和基础运行依赖就绪后达到 `phase: ready`，首次准备的模型列表为空。

## 真实执行

通过带登录会话和 CSRF 的 `/api/v2` 接口检查工作流资源、校验图，并使用具名 multipart 上传实际 MP4、原文 SRT、译文 SRT。

图由三个节点组成：

```text
视频 ──→ 媒体准备 ──────────────────→ 导出视频
  └───────────────────────────────→ 导出视频
原文字幕 + 译文字幕 ──→ 导入字幕 ──→ 导出视频
```

任务 `bc311822-3f13-40ca-a0ed-18cd5a75a65a` 的三个节点均完成，任务状态为 `succeeded`。输出：

- MP4：31,414 bytes，640 × 360，H.264 视频、AAC 音频，3.008 秒；FFmpeg 实际解码和抽帧成功。
- 译文 SRT：112 bytes，包含“ 不安装配音模型，也能导出字幕视频。 ”对应内容。
- 抽帧人工查看确认中文字幕已经烧入视频。

本项证明工作台、图编译、具名多输入、分叉汇合和媒体导出不依赖未选用的 TTS 包或模型。这个工作流使用已有字幕；ASR、外部翻译和配音推理需要各自的独立验收。

## 缺失依赖与显式准备

在同一个隔离环境中实际卸载 numpy 和 soundfile 后重新启动 Host：

- 工作台仍达到 `phase: ready`。
- `youdub.media.available` 为 `false`，原因为 `Missing dependencies: soundfile, numpy`。
- 资源检查返回 `missing`；图校验在三个实际使用媒体 provider 的节点返回 `PROVIDER_UNAVAILABLE`。
- 显式调用资源准备接口后，仅通过阿里 PyPI 安装所选基础包和媒体包；无 GPU/推理后端安装、无模型下载。
- Provider 目录刷新后，同一张图校验通过并完成上述实际媒体任务。

本地证据保存在 `output/validation/workflow-no-tts-20261020/`：
`environment.json`、`missing-media.json`、`result.json`、`workflow.json`、`result.mp4`、`result-frame.png`，以及可重放的 `verify.mjs`。输出和独立环境按仓库约定不提交到 Git。

## 针对性回归

- Node setup / download：13 项通过，覆盖基础启动、已准备路径重启恢复、按选中组安装、检查不下载、显式暂停恢复、准备期间切换图、非默认模型禁止暗中替换、下载错误原样保留。
- Python setup probe：5 项通过，覆盖不检查/导入未选依赖、所选依赖异常传播、依赖组隔离、非法组拒绝、FFmpeg 字幕能力和进程错误。
