# 外部节点插件验收

验收对象为 [`fixtures/plugins/graph-text-review`](../../fixtures/plugins/graph-text-review/README.md)。插件经扩展安装 API 复制到隔离数据目录，重启 Host 后加载；运行使用安装副本的版本和完整性绑定。没有把测试 provider 直接塞入运行中的 catalog。

## 环境与复现

- macOS arm64，Node 22，Host `127.0.0.1:8012`。
- 复用无 TTS 验证的独立 Python 环境与数据目录；没有 Torch、Whisper、VoxCPM、Transformers、Librosa 和模型权重。详情见[无 TTS 验收记录](workflow-no-tts-2026-10-20.md)。
- 浏览器使用现有前端生产构建，通过本地 `3012` 将 `/api/*` 转发到 `8012`，其余请求转发到前端 `3000`。
- 可重复脚本与命令见[插件说明](../../fixtures/plugins/graph-text-review/README.md)。自动化回归由 [`graph-plugin.test.ts`](../../packages/builtin/test/graph-plugin.test.ts) 覆盖安装、加载、图编译和真实 SQLite 调度。

## 实际结果

| 验证 | 证据 |
| --- | --- |
| 插件模板进入工作流库 | `example.text-review` 的 `origin` 为 `plugin`；3 种外部节点可枚举 |
| 多输入输出 | 校对节点接收 `left`、`right` 两个 JSON 输入，输出 `text`、`metadata` 两个 JSON |
| 专属页面 | 安装后的 Client 通过 `@youdub/sdk/client` 共享桥接注册 `workflow.node.details`，Chrome 正常渲染「文本校对」页面 |
| 人工暂停 | 校对节点 `awaiting_review`，任务 `paused`，导出节点保持 `pending` |
| 业务校验 | 空白文本返回 `INVALID_CORRECTION`；页面显示原始中文错误、保留未保存草稿，结果版本仍为 1 |
| 保存与刷新 | 保存订正后任务仍暂停，版本增加到 2；刷新浏览器后订正文本和版本保留 |
| 批准与产出 | 批准版本 2 后任务成功，实际 `reviewed.txt` 包含浏览器订正文本和未修改的来源数量 |

API 全链路任务：`a053b71f-84cd-4a45-a62c-3b09082991e8`。浏览器实际操作任务：`36b27b3e-6121-46b7-9958-8929d43c72f7`。

浏览器任务产物为 71 bytes，内容如下：

```text
Hello YouDub
浏览器专属页面订正已通过。

来源数量：2
```

本地证据保留于 `output/validation/graph-text-review/`：

- `result.json`、`reviewed.txt`：API 验证、原始/订正版本和文件。
- `browser/result.json`、`browser/reviewed.txt`：浏览器操作后的服务端读回。
- `browser/saved-correction.png`：刷新后的专属页及版本 2。
- `browser/completed-graph.png`、`browser/completed-output.png`：运行成功的图与下载入口。

该记录证明本地安装后的外部插件闭环。Windows/macOS 打包和 CI 结果由分支交付记录单独说明。
