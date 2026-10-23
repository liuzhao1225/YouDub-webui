# 资源管理统一实现与验收

日期：2026-10-22。实现位于 `codex/harness-youdub-integration`。

## 实现

- `packages/sdk/src/resource-state.ts` 集中生成资源状态、阶段、依赖和可用操作。文件齐全后仍需通过依赖及 provider 检查才显示“可用”。
- `apps/harness/src/backend/resources.ts` 在原资源服务上支持直接准备 Python 基础依赖、推理运行库、FFmpeg、分句资源和模型；继续复用 EnvironmentSetup、DownloadClient 和 Harness Jobs。
- `ResourceRow` 被资源页、首次准备页和工作流共用，统一“准备／暂停／继续／重试”。路径、来源和包列表放入详情，错误保留。
- 其他工作流读取重叠资源的当前准备状态；准备任务留在 Host，页面离开仅停止订阅。已完成任务的旧快照不覆盖重新检测的结果，检测失败清除旧的可用结论。
- 首次初始化保留四模型门槛。模型全部可用时显示“进入工作台”，点击后继续启动校验。额外安装的模型保留独立资源标识；未选中资源不改变当前工作流的可用性结论。

## 定向验证

| 验证 | 结果 |
| --- | --- |
| 资源页、首次准备页、工作流、控制器、诊断前端测试 | 57 项通过，Node 22 / Vitest |
| 共享状态及 Harness 资源服务测试 | 9 项通过 |
| 安装器及 Harness 首启测试 | 26 项通过 |
| Python setup_probe 测试 | 11 项通过 |
| 根目录和 Web TypeScript 检查 | 通过 |
| Harness 产品构建及 diff 空白检查 | 通过 |

前端测试覆盖三种语言、文件齐全但依赖缺失、准备后校验、下载暂停、失败保留、检测失败、切页释放订阅。服务测试覆盖直接环境资源的依赖范围、复用已有模型文件、跨工作流共享准备状态，以及额外模型的独立身份。

## 实际验收

使用 `.cache/harness/resource-unification` 隔离应用数据和 Python 环境，验收设备为 macOS Apple Silicon。

| 场景 | 实际结果 |
| --- | --- |
| 首次环境准备 | 独立安装 Python 3.12、基础依赖、torch/torchaudio、模型运行依赖、FFmpeg 和分句资源，通过安装后检测 |
| 模型下载与已有文件复用 | Whisper、Demucs 完成真实下载；VoxCPM2、Qwen3 Aligner 已有文件逐一核对清单大小与 SHA-256 后复用，通过启动检测 |
| 暂停与继续 | VoxCPM2 暂停后下载量停在约 140 MB，继续后增长到 226 MB、249 MB；暂停全部生效 |
| 已完成资源的状态 | 修复部分模型暂停后，其他已完成模型错误回到“待准备”的问题；暂停后重新检测已完成资源，并补充服务回归测试 |
| 单独准备分句资源 | 移走隔离目录内的 punkt_tab，重新检测后分句资源和 Whisper 均为“待准备”；点击分句资源“准备”，安装后两者恢复“可用” |
| 按需准备与切换页面 | 移走四模型后只准备 Whisper，切换到工作流期间下载继续；其他三模型目录保持缺失，所需 Whisper 与环境变为“可用” |
| 工作流范围 | 仅含媒体准备和 Whisper 识别的工作流显示“所需资源可用”；其他三模型缺失不阻止该工作流。含远程翻译的工作流保留配置缺失提示 |
| 真实执行 | 导入两节点验收工作流，执行仓库示例 zoo-en.mp4，任务完成 2/2；FFmpeg 提取音频，Whisper tiny 产出 3 段带时间戳的识别结果 |
| 窄窗口 | 800 × 720 下资源状态和按钮可见，document scrollWidth 与 clientWidth 均为 800，无横向溢出 |
| 原生桌面 | 使用同一隔离数据目录及独立验收应用标识，首启显示四模型“可用”和“进入工作台”；点击后通过校验进入工作台，资源页九项环境与模型均为“可用”，首页可读回已完成的识别任务 |

任务 ID：`109e1aa1-22e8-46cc-988a-9a460955b279`。验收工作流只使用本地 FFmpeg 和 Whisper，没有调用远程 LLM。识别结果用于验证资源能够执行，不代表字幕精度或 SRT 导出验收。

截图、验收工作流及识别结果保存在 `.cache/harness/resource-unification-evidence/`：

- `first-run-ready.png`：首次模型准备页。
- `sentence-resource-missing.png`：分句资源缺失状态。
- `workflow-ready.png`：工作流所需资源可用。
- `recognition-completed.png`、`transcript.json`：真实任务完成与结果。
- `resources-narrow.png`：窄窗口资源页。
- `native-first-run-ready.png`、`native-resources-ready.png`：最终原生首启页与资源页。
- `ui-tests.log`、`resource-service-tests.log`、`setup-tests.log`、`python-probe-tests.log`、`build.log`：定向验证输出。

验收结束前已将临时移走的模型放回隔离目录；原生资源页重新检测确认可用。

本记录只描述本地集成分支验证，不代表公开安装包或跨平台发布验收。
