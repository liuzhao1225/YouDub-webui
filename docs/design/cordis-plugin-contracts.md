# YouDub 插件与 Workflow 契约

2026-10-09 · SDK 协议 `1.0.0` / Worker 协议 `youdub-worker/v1`。实现已落地，本地验收进行中。Host 类型以 [SDK 源码](../../packages/sdk/src/index.ts)为准，Client 类型以 [Client 契约](../../apps/web/src/plugin/contracts.ts)和 [Client SDK](../../apps/web/src/plugin/sdk.tsx)为准。安装与启动见[运行指南](cordis-plugin-runtime.md)，架构依据见[架构说明](cordis-plugin-architecture.md)。

## 1. 谁拥有执行逻辑

```text
Cordis Loader + 默认组合 / 已启用扩展
  ├─ catalog                注册 workflow 与 operation 提供者
  ├─ tasks                  通用引擎、任务状态机和单活跃调度
  ├─ workflow-localize      视频本地化的配置、步骤与产物规则
  ├─ python-provider        官方模型与纯 Python 扩展的调用桥
  └─ 第三方 Host 插件        任意符合公开契约的服务、workflow 或 provider
```

`tasks` 是一项公共服务，默认由 `packages/builtin/src/tasks.ts` 提供。引擎和调度合并在这个普通插件中，保持一个执行槽；远端 waiting 仍占用该槽。完整替换 `TasksService` 时，API 和业务 workflow 使用原公共接口。bootstrap 不认识默认步骤或模型，也不运行任务循环。

workflow 只描述计划，provider 执行 operation。官方与外部 workflow 使用 `catalog.registerWorkflow`，provider 使用 `catalog.registerProvider`。注册 disposer 由贡献插件的 `ctx.effect` 持有；每个 ID 在一份组合内唯一。

## 2. 插件包和契约版本

`package.json.youdub` 声明 `id`、`sdkVersion` 和 `host/client/python` 入口。包版本来自 `package.json.version`。安装记录固定实际文件完整性、来源及 Git commit，启动会重新验证。安装器向 Host 配置注入 `$plugin: { id, version, integrity }`，扩展应将该身份写入贡献描述，避免使用开发目录占位身份。完整格式见[运行指南](cordis-plugin-runtime.md#4-最小插件包)。

插件实现版本、workflow 定义版本、operation ID 的数据版本与 SDK 版本分开。计划保存 workflow 身份、provider 身份、完整性、model/modelRevision/device/options；未知模型 revision 明确为 null。创建时校验所选 workflowVersion，执行与 retry 校验固定 provider 身份，不能按当前默认模型重新推导旧计划。

当前任务引擎按已保存的静态计划重试；版本不可用时返回明确错误。使用当前 workflow 重新生成走 rerun，创建新的 task ID。历史 legacy 记录不伪造插件版本，不能直接 retry。

## 3. Workflow 定义

以下为实际接口的关键字段，完整类型不在文档另建一套定义：

```ts
interface WorkflowDefinition {
  id: string
  version: string
  pluginId: string
  pluginVersion: string
  integrity: string
  describe(): WorkflowDescription
  validate(inputs: Record<string, ArtifactRef>, config: JsonObject,
           catalog: CatalogService): Diagnostic[] | Promise<Diagnostic[]>
  plan(inputs: Record<string, ArtifactRef>, config: JsonObject,
       catalog: CatalogService): WorkflowPlan | Promise<WorkflowPlan>
}
```

`describe()` 提供 `label`、`inputs`、`configSchema`、`defaults` 和可选 UI 提示。输入槽有 `name/label/required/acceptedMimeTypes/maxBytes`；每槽一份文件，可以有多个槽。Host 的 label 当前是字符串，Client 兼容带翻译映射的显示文本。

计划包含：

- `workflow`：ID、定义版本和插件身份。
- `config`：固定配置；`bindings`：按 key 保存精确 provider 绑定。
- `steps[]`：`id/label/bindingKey/operation/input/outputs`。输入为 JSON 常量、`{from:'task',name}` 或 `{from:'step',stepId,output}`。
- `outputs[]`：从步骤的 artifact 端口选择最终下载项，包含唯一 ID、label、role、source 和 required。
- `omittedSteps[]`：可选步骤的省略原因。

步骤必须有唯一 ID，引用已出现的上游输出；provider 支持指定 operation。workflow 不得删除或降级 provider 的 required 输出。所有计划数据可序列化，不携带可执行闭包。MVP 采用静态有序步骤，不提供执行中插入、循环、并行 DAG 或嵌套 workflow。

输出端口使用实际 SDK 字段：

```ts
interface OutputPort {
  name: string
  kind: 'artifact' | 'json'
  schemaId: string
  required: boolean
  schema?: JsonObject
}
```

`kind:'json'` 时必须提供 `schema`，并将 provider 的同一 schema 原样保存在计划端口中。引擎用 JSON Schema 校验结果，`schemaId` 本身只标识格式，不替代校验。必需字段缺失、结果结构不符时本步失败，不推进下游。

`kind:'artifact'` 返回 `{id,schemaId}`，由 Host `files` 签发。提供者提交工作区内相对路径、MIME、schemaId 和可选 metadata；Host 读取实际大小、检查文件及媒体流，再登记产物。结果提交时检查登记身份、schema 和文件；JSON 中嵌套的文件引用也必须有效。最终下载项只能选择 artifact 端口；未发布的诊断产物仍留在任务目录。

任务创建在 `settings.locked` 内校验配置并保存连接与凭据引用快照。设置修改使用相同锁，成功后通过 `settings/updated` 通知默认 workflow 更新默认配置；凭据值不进入公开任务响应。`describe/validate/plan` 不执行模型或供应商请求。

## 4. Operation 提供者

```ts
interface OperationProvider {
  id: string
  describe(): ProviderDescription
  probe(): Promise<JsonObject>
  execute(request: Invocation, context: InvocationContext): Promise<OperationResult>
  poll?(operation: JsonObject, context: InvocationContext): Promise<OperationResult>
}
type OperationResult =
  | { state: 'completed'; outputs: JsonObject }
  | { state: 'waiting'; operation: JsonObject; nextPollAt: string }
```

`ProviderDescription.operations` 各含 `id/inputSchema/outputs`。模型、语言、设备、voice modes、可用条件等由描述提供，业务 workflow 负责选择特性的语义校验。`probe` 表示依赖与配置检查，不表示真实供应商调用成功。

`Invocation` 提供 invocationId、taskId、attempt、stepId、operation、固定 binding、inputs、workDir、taskDir 和 config。`InvocationContext` 提供 AbortSignal、progress、externalPrepare/externalUpdate、register/resolve 和执行端需要的连接凭据。TypeScript 实现直接使用这些接口，Python 使用相同接口的 NDJSON 编码。

provider 返回 waiting 必须实现 poll，nextPollAt 必须可解析。当前纯 Python manifest 桥只实现单次 execute；远端轮询提供者使用 Host 插件实现。取消通过 context.signal 停止正在执行或轮询的本机调用；waiting 取消会结束本机步骤。当前没有自动调用供应商撤销接口；未确认远端状态保留 unknown 和 `mayStillRun`，禁止普通 retry。

```ts
export const inject = ['catalog']
export function apply(ctx: Context) {
  ctx.effect(() => ctx.catalog.registerProvider(provider))
  ctx.effect(() => ctx.catalog.registerWorkflow(workflow))
}
```

## 5. 媒体与 TTS 数据

媒体操作及可执行 JSON Schema 由[媒体契约模块](../../packages/builtin/src/media-contracts.ts)提供，通用引擎不硬编码 transcript、字幕或声线类型。Python 计算保留[现有业务结构](../../backend/app/v1/contracts.py)，桥将文件位置转换为 Host 引用。

TTS 按一次调用处理多段完整 utterance，一次模型加载可生成多句。原文 transcript、译文 translation、可选 references 进入 `speech.synthesize/v1`，结果为 speechAudio；mix 独立处理时间轴与采样率。参考音频准备成为 `voice.reference/v1`，字幕对齐成为 `text.align/v1`。具体字段以媒体 schema 为准，不将旧设计示意类型当作实际 ABI。

模型功能有差异。默认 workflow 校验模型、设备、源/目标语言、preset/source_clone 模式和参考要求；统一输入输出不代表任意模型都具备相同能力。默认组合已登记的模型以实际 catalog/Runtime 为准，未接入模型不列为已支持。

## 6. 默认 workflow 与外部示例

默认 ID 为 `youdub.localize`、版本 `1.0.0`，实现位于 [workflow-localize.ts](../../packages/builtin/src/workflow-localize.ts)。配置继续使用既有 snake_case 字段；generic Task 使用 workflowId、steps、outputs。

| 步骤 | operation | 条件 |
| --- | --- | --- |
| prepare | media.prepare/v1 | 所有模式 |
| separate | audio.separate/v1 | 原声克隆或保留背景音 |
| recognize | speech.transcribe/v1 | 所有模式 |
| translate | text.translate/v1 | 所有模式 |
| reference | voice.reference/v1 | 原声克隆 |
| synthesize | speech.synthesize/v1 | dubbing / both |
| mix | audio.mix/v1 | dubbing / both |
| align | text.align/v1 | both 且选择模型对齐 |
| export | media.export/v1 | 所有模式 |

subtitles 发布视频和原文/译文字幕；dubbing 发布视频和配音音频；both 发布上述全部产物。计划和分支已实现，真实三模式结果另见[验收记录](cordis-plugin-migration.md#7-最终验收矩阵)。

独立示例 [file-transform](../../fixtures/plugins/file-transform/README.md)声明 document 输入，实现 `example.uppercase` workflow 和真实 UTF-8 文件转换 provider，同时贡献 Client 路由、导航和任务面板。[python-text](../../fixtures/plugins/python-text/README.md)只用 Python 和 manifest 提供同类 operation，用于验证独立依赖与执行桥。导入成对字幕的媒体 operation 已存在；不要据此宣称一个独立字幕 workflow 包已交付。

## 7. 通用引擎与持久化

`TasksService` 提供 create/get/record/list/cancel/retry/rerun/delete/idle。cancel、retry 和 delete 接受 expectedAttempt。rerun 请求包含新 id、config，以及可选 workflowId/acknowledgeExternalRisk；legacy 任务必须明确选择当前 workflow。

Task 状态为 queued/running/waiting/cancelling/cancelled/succeeded/failed；Step 状态为 pending/running/waiting/completed/cancelled/failed。每次尝试增加 attempt，每步持有 invocationId。进度和结果写入检查当前 attempt、调用身份、状态与 revision，迟到消息不能覆盖新尝试。

当前 `store.call` 使用 `store.create/get/list/cas/claim/delete` 完整事务操作。持久存储桥串行执行 SQLite 事务，只有 task-runtime 决定何时领取或推进任务。连接中断返回 `COMMIT_OUTCOME_UNKNOWN` 等错误并停止推进，不能盲目重试提交或重发模型请求。

成功要求所有步骤 completed，required 最终产物有效且条件提交成功。取消必须等待本机受管进程组退出；`CANCEL_TIMEOUT` 保持 cancelling、保留原因并停止领取任务。远端结果未知禁止普通 retry；rerun 需要明确确认外部风险。retry 从固定计划起点开始，旧产物和诊断保留。

## 8. 跨进程线协议

`youdub-worker/v1` 每行 JSON 包含 version、invocationId、seq、type、payload；双向 seq 分别从 1 递增。大文件只传路径/引用。stdout 专用于协议，stderr 保留原始诊断。

| 方向 | type | 行为 |
| --- | --- | --- |
| Host → Worker | execute | 固定 binding、解析后的输入、工作区和连接凭据 |
| Worker → Host | progress | value、message |
| Worker → Host | external.prepare | 持久化 externalRequestId、requestKey 及 pending |
| Host → Worker | external.accepted | 允许对应请求真正外发 |
| Worker → Host | external.update | 对应请求的回执、operationId 或 unknown |
| Host → Worker | external.recorded | 确认已持久化回执 |
| Worker → Host | result | completed 或 waiting |
| Worker → Host | error | code/message/type 及诊断 |
| Host → Worker | cancel | 终止本机调用，Host 等待真实退出 |

每个真实外发有独立 externalRequestId，requestKey 与供应商 operationId 分别记录。某批成功不能覆盖其他批 unknown。Host 消失或取消时 Worker 应停止后续外发；已经发出的请求保留未知风险。

completed result 带 `artifacts: Record<string, ArtifactDescriptor>` 和 outputs；使用单键对象 `{"$artifact":"LOCAL_KEY"}` 引用描述符，可嵌套。Host 在成功 result 和零退出码后登记文件、替换标记，再由任务引擎验证输出 schema。坏 JSON、序号/身份不匹配、result 后异常退出、未知 key、缺产物均失败。文件路径只能位于该调用工作区内。

store 是单独长驻进程，使用同版本 envelope 的 requestId 关联 request/result/error，每次调用是完整事务。计算 Worker 没有存储接口，不运行第二套任务队列或插件树。

## 9. HTTP 与 Client 清单

API 插件提供 `/api/v2/catalog`、`workflows`、`tasks`、`settings`、`runtime`、`extensions` 和 `client-manifest`。创建有文件的任务使用 multipart，先传 `request` JSON（id/workflowId/workflowVersion/config），再传 `input.<name>` 文件。无文件 workflow 可用 JSON 创建。HTTP 不接受客户端伪造 artifacts 或任意输入路径。

失败上传保留相同 ID 的残留与错误，使用 `DELETE /api/v2/imports/:id` 显式清理尚未形成任务的导入；已有任务通过任务删除动作处理。任务响应提供 workflowId/workflowVersion、steps、outputs 和 allowedActions。产物 URL 支持 GET/HEAD/Range。

v1 由同一个普通 API 插件做兼容投射，仅包含默认 workflow 和可映射的旧 desktop 记录；不兼容 workflow 返回 CONTRACT_UNSUPPORTED。原 `data/youdub.sqlite` 的旧版 URL 下载任务不是自动转换的 v2 Task，具体迁移范围见迁移记录。

Client 清单为 `{version:1,sdkVersion:'1.0.0',platformVersion:'1',modules:[...]}`，模块含 id/version/access/url 及可选 css/config。未认证只返回 public 模块；登录后返回完整已激活组合。资产位于同源 `/api/plugins/<packageId>/<version>/<asset>`，数据 API 始终执行认证。

## 10. Client 装配与界面注册

Next 只保留文档、平台模块桥、React 根和 catch-all 路由。官方登录、工作台、任务库、设置和基础服务均通过 Client 插件加载。Host Context 与 Client Context 独立，通信经过 HTTP。

import map 固定共享 React、ReactDOM、JSX runtime、Cordis 和 `@youdub/sdk/client`。平台桥导出实际宿主实例；外部模块不打包第二份 React/Cordis。生产构建后的外部页面与 Hooks 验证另列在迁移矩阵。

公共插槽：

- `root`：唯一根渲染组件，缺失或重复报错。
- `shell.routes`：id/path/component/access；支持精确路径与 `:param`。
- `shell.navigation`：id/label/routeId/order。
- `config.editors`：id 对应 workflow/provider，接收 value/schema/diagnostics/readOnly/onChange。
- `task.detail.panels` 和 `task.detail.actions`：接收 task/refresh。
- `settings.sections`：提供扩展设置区域。

通过 `ctx.effect(() => ctx.slots.register(...))` 注册与释放。标准配置渲染器只实现支持的 JSON Schema 控件；未知结构明确报不支持，复杂配置用匹配编辑器。Client 服务通过 SDK 使用公开 API，不导入其他插件的私有实现。

public 子树提供会话、登录、导航与基础渲染；会话插件管理 authenticated 子树。退出或会话失效释放已认证页面与订阅。插件启停在 Host 重启及浏览器刷新后生效，无运行时代码热替换。
