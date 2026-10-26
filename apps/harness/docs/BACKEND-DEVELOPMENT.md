# Host、工作流与扩展开发

YouDub Host 插件装配任务、工作流、存储、资源与媒体服务。共用 Loader、Connection、Settings、Credentials、LLM、Subprocess、Jobs 和 PluginManager 提供插件生命周期与运行能力。

## Host 初始化与服务隔离

[`src/host.mjs`](../src/host.mjs) 声明以下官方依赖：

```js
export const inject = [
  'connection', 'subprocess', 'jobs', 'credentials',
  'llm', 'settings', 'pluginManager',
];
```

`apply` 创建独立领域 context，将 `catalog`、`store`、`files`、`tasks`、`settings` 五个名字隔离到 YouDub 的标签中。Host 根 context 的 `settings` 仍指官方配置服务；领域 context 的 `settings` 负责 YouDub 偏好。两者通过适配器传入的 `forms` 关联，避免同名服务互相替换。

首先注册 worker、传输端点、示例和环境准备接口。基础环境就绪后，`activateDomain` 装配原 Store/Files、媒体提供商、LLM 目录、图工作流、Tasks、Resources 与业务 API。完整首启资源验证通过后才启动任务队列。[首启状态实现](../src/backend/setup.mjs)要求 Whisper、VoxCPM2、Demucs、Qwen Aligner 四项模型及其运行依赖全部 ready；翻译服务配置随后由前端官方模型组件承载。

模型翻译统一经过 `backend/llm.mjs` 与框架 LLM；Python 只执行本地媒体操作和资源探测。偏好与密钥分别由产品 Settings 适配器和框架 Credentials 保存。旧 Python 翻译、密钥库、连接测试，以及 builtin 的另一套 Settings/Secrets/Processes 已删除。SQLite bridge 保留历史任务、默认配置迁移和现用的存储接口。

## 常见修改位置

| 能力 | 当前源码 | 扩展方式 |
| --- | --- | --- |
| 业务 API | [`backend/api.ts`](../src/backend/api.ts) | 在现有逻辑路由表补接口，沿用原参数与错误合同 |
| 物理请求入口 | [`backend/transport.mjs`](../src/backend/transport.mjs) | 使用 `connection.fetch.register`，保持官方请求准入 |
| 工作流和任务状态 | [`tasks.ts`](../../../packages/builtin/src/tasks.ts)、[`workflow-graph.ts`](../../../packages/builtin/src/workflow-graph.ts)、[`workflow-document.ts`](../../../packages/builtin/src/workflow-document.ts) | 修改现有领域状态机、图合同与事务 |
| 操作与输入输出 | [`media-contracts.ts`](../../../packages/builtin/src/media-contracts.ts)、[`media-schemas.ts`](../../../packages/builtin/src/media-schemas.ts)、[`node-contracts.ts`](../../../packages/builtin/src/node-contracts.ts) | 同步更新端口、schema、配置与订正校验 |
| 默认工作流 | [`workflow-templates.ts`](../../../packages/builtin/src/workflow-templates.ts)、[`workflow-templates/`](../../../packages/builtin/src/workflow-templates) | 组合现有节点，保留用户文档与历史任务快照 |
| Python 提供商 | [`python-provider.ts`](../../../packages/builtin/src/python-provider.ts)、[`backend/workers`](../../../backend/workers) | 复用原 worker 操作与媒体实现 |
| 进程接线 | [`backend/worker.mjs`](../src/backend/worker.mjs)、[`process.mjs`](../src/process.mjs) | JSONL 协议交给官方 Subprocess 创建和管理的进程 |
| 运行中的操作 | [`backend/catalog.mjs`](../src/backend/catalog.mjs) | 在原 Catalog 外接官方 Jobs 的进度与取消 |
| 模型翻译 | [`backend/llm.mjs`](../src/backend/llm.mjs) | 通过官方 LLM 获取模型并执行翻译 |
| 环境和资源 | [`backend/setup.mjs`](../src/backend/setup.mjs)、[`backend/resources.ts`](../src/backend/resources.ts) | 复用原 EnvironmentSetup、DownloadClient 和资源合同 |
| 配置与扩展 | [`backend/settings.mjs`](../src/backend/settings.mjs)、[`backend/extensions.mjs`](../src/backend/extensions.mjs) | 委托官方 Settings/Credentials/PluginManager |

## 请求与文件传输

前端保留 `/api/v2/...` 等逻辑路径，传输层统一走三个官方 Connection 端点：

| 物理端点 | 行为 |
| --- | --- |
| `POST /api/youdub/v2` | 解析 `{ method, path, body }`，分发到 YouDub 逻辑路由 |
| `POST /api/youdub/upload` | 以流式请求传入创建任务的上传处理器 |
| `GET/HEAD /api/youdub/file?path=...` | 读取获准业务文件，支持下载名称和媒体 Range |

`YouDubTransport` 保存路由表并返回 `Response`，不创建额外监听器。业务失败保留 `{ error: { code, message, details? } }` 和 HTTP 状态，写入 Host 日志。文件定位和读锁继续沿用原 Files/Tasks 合同；新功能需通过这些合同访问文件。

设置、模型和插件管理的官方页面使用官方 Remote 服务。业务页面通过上述传输层访问领域 API，两条调用路径共享同一官方 Host。

## 任务与节点语义

工作流文档描述节点、端口、连接和配置；任务保存本次执行的图快照、提供商/模型绑定与版本信息。修改工作流模板不会改写已创建任务。提供商的实现和模型配置使用 integrity 标识参与绑定检查。

保持以下现有行为：

- 节点依赖满足后才可以运行。两个分支可以同时等待人工确认，确认一个分支只释放其符合条件的下游；汇合节点等待全部所需输入。
- `autoContinue: false` 使该节点完成后等待确认。用户确认针对当前节点及其修订，不是一次性批准整个图。
- 无可运行节点时，业务队列释放执行槽；人工等待状态持久保存。
- 保存订正保留原结果与历史。修改已完成结果通过派生任务和依赖分析决定复用或重算。
- 复用中间产物仍需满足新任务的确认规则。取消、错误重试、未知外部请求与修订冲突沿用原状态机。

[`Tasks`](../../../packages/builtin/src/tasks.ts)决定业务任务的持久状态；[`YouDubCatalog`](../src/backend/catalog.mjs)将一次 provider 执行或轮询挂到官方 Jobs。Jobs 的一次操作结束后，整个图可能仍在运行、等待远端结果或等待确认。

## 增加或调整一个节点

优先检查原[媒体操作](../../../packages/builtin/src/media-contracts.ts)。已有算法或组件直接复用源码。

1. **明确端口和结果。** 在对应操作合同中声明输入、输出、配置和可编辑结果；检查 schema 与前后端类型一致。
2. **注册提供商。** 内置媒体提供商在 `host.mjs` 的 `activateDomain` 中接入；可独立安装的能力使用 DSH bundle，在自己的 context 内注册领域插件。
3. **接入执行。** 媒体任务复用 `PythonProvider` 和原 worker 协议；远端翻译通过官方 LLM。提供商必须报告进度、明确终态并响应取消。
4. **声明资源。** 需要新模型或依赖时更新原资源描述、准备入口与校验，不依靠机器已安装的软件掩盖缺失项。
5. **接入页面。** 通用参数使用原 schema 表单；特殊参数/结果通过 `youdub.workflow.node.editors` 或 `details`，传递原保存与确认合同。
6. **组合并验证。** 按需调整模板，检查保存、重载、执行、订正、确认、导出及受影响的失败路径；原任务和工作流数据保持可读。

现有 YouTube/B 站下载节点为 `youdub.download`。`proxyPort` 为 `0` 时显式直连，`1–65535` 使用 `http://127.0.0.1:<端口>`；B 站短链沿用同一代理设置。相关实现位于原 [`download.py`](../../../backend/workers/download.py)，Harness 模式的 yt-dlp Node 路径由官方 `resolvePrimaryRuntime` 提供。

## Python 与模型调用

`YouDubWorker` 通过 `ctx.subprocess` 创建进程，并传入私有 Python、媒体工具、模型与缓存路径。领域层解析 `youdub-worker/v1` JSONL，处理请求编号、进度、结果、错误和外部请求回执。存储桥进程也沿用这一通道；旧认证、凭据和模型配置调用在接入层被拒绝。

翻译使用官方模型表单保存配置，`registerModels` 将官方 LLM 提供商映射为 `llm.<provider>` 领域提供商。旧模板中的 `openai` ID 保留为不可执行占位，供用户选定已配置模型后重新绑定。

[`translateWithHarness`](../src/backend/llm.mjs) 调用 `llm.prepareCall({ provider, model }, signal)`，再使用返回的配置与 `prepared.stream`。输出参数、协议和模型容量沿用 Harness 模型设置与适配器规则；YouDub 不再指定固定输出下限，也不使用旧节点的 `maxCompletionTokens` 覆盖请求。模型目录采用 `ctx.llm.listModels` 返回的候选与 Credentials 配置状态。翻译分批保持段落 ID，保存原始请求、流事件和响应到任务工作目录的 `translation_raw`；用户订正另行保存。供应商拒绝或响应不完整时保留原始失败，历史请求与响应保持不变。

API 密钥、提供商 URL 和模型选择通过 YouDub 的官方模型设置页面配置和测试。不要把真实凭据写入插件源码、模板、测试夹具或验证报告。

## 外部插件

直接参考已经接入的[三个示例 bundle](../test/fixtures)：`graph-text-review`、`file-transform`、`python-text`。其中 graph-text-review 展示 Host、Client、人工订正及多输入节点组合。

DSH 包需要 `dsh.bundle.patch`；带界面时还需 `dsh.client`、客户端依赖和 Client 导出。Host 插件可通过产品公开的 `youdubContext` 加入领域服务：

```js
import { youdubContext } from '@youdub/harness-subtitles';
import * as domain from './domain.mjs';

export const name = 'my-youdub-feature';
export const inject = ['youdubDomain'];

export async function apply(ctx) {
  await youdubContext(ctx).plugin(domain);
}
```

这是服务接线示意。可安装包的 manifest、patch、业务描述、版本与 integrity 请按[完整示例](../test/fixtures/graph-text-review/package.json)和[Host 实现](../test/fixtures/graph-text-review/src/host.mjs)维护。Python 插件可使用同一产品导出的 `registerPythonProvider`，详见[Python 示例](../test/fixtures/python-text/src/host.mjs)。

安装、启停和卸载使用官方 PluginManager 页面与服务。旧 `package.youdub` 声明需要迁移为 DSH bundle；旧 loader 不参与当前运行。安装机制已经接通，YouDub 在线市场目录和发行源仍待建设。

## 按改动验证

- 服务或 profile 改动：Harness 对应集成测试、profile 检查与活动模块检查。
- 图合同或状态改动：对应 `packages/builtin/test` 用例，并用真实 Host 读回任务状态和产物。
- Python 操作改动：使用项目 `.venv/bin/pytest` 执行相关 `backend/tests`；再按实际模型能力验收媒体任务。
- 外部插件改动：隔离 profile 中安装、执行、停用和卸载，确认界面及服务同时释放。

具体命令见[本地开发](DEVELOPMENT.md#验证选择)。测试通过、资源 ready 和真实媒体输出分别记录。
