# YouDub 插件与 Workflow 契约

2026-10-08 · 协议设计稿 `youdub-plugin/v1`。适用于 [Cordis 架构设计](cordis-plugin-architecture.md)。下列接口为拟实现的 YouDub SDK；Cordis 只承担服务、依赖与生命周期机制。

## 1. 谁拥有执行逻辑

```text
Cordis Loader
  ├─ catalog 插件              注册 workflow 与 operation 提供者
  ├─ task-runtime 插件         通用 workflow 引擎、任务状态机和单活跃调度
  ├─ workflow-localize 插件    视频本地化的配置、步骤与产物规则
  ├─ provider-voxcpm 插件      本地 TTS 实现
  └─ provider-example 插件     外部 TTS 或其他 operation 实现
```

`task-runtime` 通过 `tasks` 一项公共服务统一提供任务管理、workflow 引擎和调度。插件激活/释放拥有调度循环的启动/停止，首版不再暴露一份重复的引擎服务或独立 scheduler。将整个默认引擎插件替换为另一实现时，API 和业务 workflow 保持不变。

通用引擎只认识 task、attempt、step、operation、artifact、error。七阶段名称、三模式、字幕、声线和模型名称全部属于业务插件。默认 workflow 和第三方 workflow 使用相同注册入口与执行路径；删除默认 workflow 后框架仍可运行另一业务流程。

## 2. 插件包和契约版本

每个包声明唯一 `pluginId`、版本、SDK 兼容范围，以及 Host/Client 入口或官方 Python bridge 配置。安装记录固定包完整性及 Git commit；禁止使用可漂移分支作为已有任务的执行身份。SDK、workflow 定义、operation 数据格式各自有明确版本。

- 插件版本描述实现变化；契约版本描述数据与行为变化，二者分别记录。
- SDK v1 的必填字段与既有字段语义保持稳定；新增可选能力需显式声明。
- 不支持的契约主版本拒绝加载。插件参数由其 JSON Schema 校验，未知参数按 schema 处理。
- 旧任务依赖版本缺失时可以查看和下载历史产物；retry 明确失败。使用新版本执行走 rerun，生成新 task ID。
- 一个包可包含多个插件模块和多个贡献，同一个 workflow/provider ID 重复注册属于配置错误。

## 3. Workflow 定义

```ts
interface WorkflowDefinition {
  id: string
  version: string
  configSchema: JsonSchema
  inputSchema: JsonSchema
  describe(): WorkflowDescription
  validate(input: WorkflowInput, config: unknown, catalog: CatalogView): Diagnostic[]
  plan(input: WorkflowInput, config: unknown, catalog: CatalogView): WorkflowPlan
}

interface CreateTask {
  id: string
  workflowId: string
  workflowVersion: string
  config: JsonObject
  inputs: Record<string, ArtifactRef>
}

type WorkflowInput = Record<string, ArtifactRef>

interface InputSlot {
  name: string
  label: LocalizedText
  required: boolean
  acceptedMimeTypes: string[]
  maxBytes: number
}

interface WorkflowPlan {
  workflow: ExactWorkflowRef
  config: JsonObject
  bindings: Record<string, ExactProviderBinding>
  steps: StepSpec[]
  outputs: PlannedOutput[]
}

interface StepSpec {
  id: string
  label: LocalizedText
  bindingKey: string
  operation: string
  input: Record<string, InputRef | JsonValue>
  outputs: OutputPort[]
}

type InputRef =
  | { from: 'task'; name: string }
  | { from: 'step'; stepId: string; output: string }

interface OutputPort {
  name: string
  kind: 'artifact' | 'json'
  schemaId: string
  required: boolean
}

interface PlannedOutput {
  id: string
  label: LocalizedText
  source: { stepId: string; output: string }
  role: string
  required: boolean
}

interface ArtifactDescriptor {
  path: string // provider 工作区内的相对路径
  mimeType: string
  schemaId: string
  metadata: JsonObject
}

interface ArtifactRef {
  id: string // files 服务签发的稳定引用，禁止复用为任意文件路径
  schemaId: string
}
```

`ExactWorkflowRef` 包含 workflow ID/定义版本和提供插件的 ID/版本/完整性。`WorkflowDescription` 包含名称、说明、`InputSlot[]` 及配置 UI 提示；首版每个具名槽只接收一个文件，允许多个槽。`LocalizedText` 为必填默认文本和可选语言映射；缺语言只影响显示文案，不能影响业务解释。`JsonValue/JsonObject/JsonSchema` 分别为合法 JSON 值、对象和 JSON Schema 2020-12 的数据定义。

HTTP 创建任务使用一次 multipart：`request` 字段包含 id/workflowId/workflowVersion/config，`input.<name>` 字段分别上传视频、字幕等输入。入口按 slot 校验并写入该任务的受管输入目录后，构造带 ArtifactRef 的内部 CreateTask；不允许客户端用任意路径伪造输入。相同 task ID 的上传保留查询、明确残留和显式清理语义，禁止产生两份任务。首版无需单独新增持久化上传对象或上传数据库。

`OutputPort` 定义 provider 结果中每个键的类型；JSON 结果须符合对应 schema，文件结果使用 files 签发的 ArtifactRef。提供者通过 InvocationContext 的受管文件接口提交 ArtifactDescriptor，由 files 检查路径、非空和声明格式后注册；引擎再次检查输出引用属于本次任务和调用。Python bridge 的批量文件注册规则见第 8 节。`PlannedOutput` 只允许引用 artifact 端口，决定最终可下载成品；role 为开放字符串，预览器按 MIME/role 匹配。必需产物缺失使任务失败，诊断文件仍保留但不自动发布。文件字节大小由 Host 读取，禁止仅信任 provider 的声明。

`ExactProviderBinding` 至少包含插件 ID/版本/完整性、provider ID、operation 契约版本、模型及已知 revision、device、校验后的参数、脱敏连接信息和凭据引用。无法获得模型 revision 时明确记录 null；不能宣称供应商模型可完全复现。

`describe/validate/plan` 不执行推理或供应商请求。`plan` 使用一份一致的 catalog/settings 快照，产出规范化配置和静态有序计划；Task 创建时原样固定。MVP 允许可选步骤在规划时省略，记录省略原因；执行中的任意插入、循环、并行分支和嵌套 workflow 后置。

计划必须通过公共结构校验：ID 唯一、引用的步骤在前、输出端口存在、输入输出契约兼容、所选 provider 支持请求特性、必需产物可由计划产生。业务语义由 workflow 校验，结构和绑定有效性由通用引擎再次校验。

`plan` 返回的数据不能包含可执行闭包。所有操作通过固定的 provider binding 执行，使重启、历史展示和第三方实现不依赖原 Node 内存。

settings 服务提供一个 Host 内的配置互斥入口：创建快照、读取/钉住凭据引用、持久化新任务，以及连接修改/旧凭据清理都经过同一入口串行。catalog 在当前启动组合内保持固定。Store 的请求串行本身不能替代此边界；禁止任务创建和设置修改各自直接跨调用操作 keyring/DB。任一步失败立即终止当前路径并释放锁，部分写入按实际状态报告。

## 4. 最小 operation 提供者

```ts
interface OperationProvider {
  id: string
  describe(): ProviderDescription
  probe(): Promise<Readiness>
  execute(request: Invocation, context: InvocationContext): Promise<OperationResult>
  poll?(operation: ExternalOperationRef, context: InvocationContext): Promise<OperationResult>
  cancel?(operation: ExternalOperationRef, context: InvocationContext): Promise<CancelResult>
}

type OperationResult =
  | { state: 'completed'; outputs: Record<string, ArtifactRef | JsonValue> }
  | { state: 'waiting'; operation: ExternalOperationRef; nextPollAt: string }
```

`ProviderDescription` 包含 operation ID、契约版本、输入输出 schema、模型、语言、设备、特性、参数 schema、外部数据发送类型，以及 submit/poll/cancel 支持情况。`probe` 只检查声明范围内的依赖、权重和配置；供应商在线验证使用单独的显式操作。

`Invocation` 包含 invocationId、taskId、attempt、stepId、精确 binding、已解析输入及任务工作区。`InvocationContext` 提供取消信号、进度记录、受管文件操作及外部请求状态持久化握手；只向执行端传本次需要的凭据值。

provider 实现可以是 TypeScript 直接调用、Python 计算或远端 API。业务 workflow 和引擎使用同一接口。调用期间直接错误向上抛出；本地错误包含原始类型/消息/堆栈或进程 stderr 的受保护诊断位置，用户摘要脱敏。禁止自动更换模型、伪造空结果或隐藏失败。

公共注册 API 示意：

```ts
// registerProvider/registerWorkflow 是 YouDub catalog 服务方法。
export const inject = ['catalog']
export function apply(ctx: Context) {
  ctx.effect(() => ctx.catalog.registerProvider(provider))
  ctx.effect(() => ctx.catalog.registerWorkflow(workflow))
}
```

每个 register 方法返回 disposer；删除注册只影响目录与下一次任务创建。执行中的绑定通过停机/停用约束保护。插件不 import `task-runtime` 的内部实现。

## 5. TTS 契约与模型差异

TTS v1 按完整 utterance 批量处理，可一次加载模型并生成多句；不会把每句话变成一个模型进程。

```ts
interface TtsInput {
  language: string
  segments: { id: string; text: string; speakerId?: string }[]
  voice: { mode: 'preset'; id: string } | { mode: 'source_clone' }
  references?: {
    speakerId?: string
    audio: ArtifactRef
    transcript?: string
  }[]
  options: JsonObject
}

interface TtsOutput {
  segments: {
    id: string
    audio: ArtifactRef
    sampleRate: number
    channels: number
    sampleCount: number
  }[]
}
```

音频时长由样本数/采样率确定。每个输入 ID 必须恰有一份非空可解码输出；源顺序保持。provider 返回统一约定的无损音频，供应商返回其他格式时由适配器显式转换并保留来源记录；mix 另行处理时间轴和采样率。

模型差异通过 `supportsPreset / supportsSourceClone / requiresReferenceText / languages / inputLimits` 等明确能力表达。切换 VoxCPM、IndexTTS 或 MiniMax 示例提供者时，先确认所请求的声线模式和语言可满足；相同输入输出结构不代表相同功能或效果。未接入模型的具体能力以将来的官方文档及实测为准。

参考音频选择是可注册的预处理 operation，默认流程按所选 TTS 要求生成参考片段。输入为标准 transcript、可选词时间戳和源音频，不读取 Whisper raw 结构。完整译文始终作为一次语音生成单元。原始模型响应另存为诊断产物。

## 6. 默认 workflow 的计划示例

以下是 `workflow-localize` 对 both 模式的一份示意计划，operation ID 为拟定名称。具体可选步骤随配置规划，通用引擎无需识别名称。

| step ID | operation | 输入来源 | 输出 |
| --- | --- | --- | --- |
| prepare | media.prepare/v1 | task.video | mediaInfo、sourceAudio |
| separate | audio.separate/v1 | sourceAudio | vocals、background |
| recognize | speech.transcribe/v1 | vocals | transcript、raw |
| translate | text.translate/v1 | transcript | translation |
| reference | voice.reference/v1 | transcript、vocals、TTS 要求 | references |
| synthesize | speech.synthesize/v1 | translation、references | speechAudio |
| mix | audio.mix/v1 | speechAudio、transcript、background、mediaInfo | finalAudio、dubbedTimeline、adjustedSpeech |
| align | text.align/v1 | adjustedSpeech、translation | wordAlignment |
| export | media.export/v1 | video、transcript、translation、finalAudio、时间轴 | 成品视频、音频、字幕 |

`reference` 和 `align` 原有内部处理现在成为可注册的显式 operation；不开启时不进入计划。默认 workflow 定义相关省略与替代算法，例如字符估算和模型对齐是两种显式配置分支，执行失败不自动切换。页面可以按描述分组展示，实际步骤状态仍由后端返回。

subtitles 计划为 prepare → recognize → translate → export。dubbing 计划根据声线和背景配置规划分离/参考处理，最终导出配音视频和音频。业务规则由默认 workflow 拥有，用户数据中的原始 source 时间轴与配音时间轴分开保存。

外部 workflow 验收样例采用“导入视频及成对原文/译文字幕并重新导出字幕视频”：独立包声明 video/sourceSubtitles/translatedSubtitles 三个输入槽；校验 operation 检查时间区间、顺序和一一对应关系，转成标准 transcript/translation 后复用 prepare/export，不需要 ASR/TTS。任意不匹配 SRT 直接失败。首版固定有序计划即可完成该验证，无需先实现人工审批状态或图编辑器。

## 7. 通用引擎与持久化

```ts
interface TasksService {
  create(request: CreateTask): Promise<TaskView>
  get(id: string): Promise<TaskView>
  list(query: TaskQuery): Promise<TaskPage>
  cancel(id: string, expectedAttempt: number): Promise<TaskView>
  retry(id: string, expectedAttempt: number): Promise<TaskView>
  rerun(id: string, config: JsonObject): Promise<TaskView>
  delete(id: string, expectedAttempt: number): Promise<void>
}
```

通用任务状态沿用 queued/running/waiting/cancelling/cancelled/succeeded/failed。步骤状态为 pending/running/waiting/completed/cancelled/failed，计划省略的步骤仅保留说明。每步有独立 invocationId、进度、开始结束时间、输出引用及错误，禁止用步骤下标推导已经执行成功。

单活跃策略、claim 与 conditional commit 必须原子执行。`store` 提供 `createTaskWithSnapshot / claimNext / commitStep / readTask / listTasks / writeSettings` 等完整持久化操作；claimNext 的排序/资源条件由 task-runtime 明确传入，Store 负责同一事务内核对和写入，不自行启动工作。

task-runtime 负责：领取任务、解析固定绑定、持久化步骤启动、执行/轮询、验证输出、条件提交和进入下一步。首次请求条件为 taskId+attempt+stepId+invocationId+expectedStatus。迟到消息条件不符时记录并拒绝，不能改写新 attempt。

成功条件为计划内每一步 completed 且全部 required 最终产物验证通过；条件提交成功后才标记 succeeded。引擎不能根据名为 export 的步骤或某个固定扩展名判断结束。

重试从该任务已固定计划的起点开始，attempt 增加；rerun 通过当前 workflow 重新校验并创建新 Task。外部结果未知时禁止普通 retry。已固定版本不可用时不自动替换。

存储提交连接中断时报告 `COMMIT_OUTCOME_UNKNOWN` 并暂停该任务推进；通过原 operation/invocation ID 只读核对实际记录，由明确的处理动作决定后续，禁止盲目重复提交或重复执行模型。SQLite 保持一份状态权威，首版无需追加事件数据库。

## 8. 跨进程线协议

采用 `youdub-worker/v1` NDJSON，每条消息包括 version、invocationId、按方向分别递增的 seq、type、payload。大文件只传任务工作区内的引用与元信息。路径由 Host 解析，防止第三方输出路径被当成任意下载入口。

| 方向 | type | 语义 |
| --- | --- | --- |
| Host → Worker | execute | 固定 binding、输入、工作区及本次必要凭据 |
| Worker → Host | progress | 当前步骤进度与诊断信息 |
| Worker → Host | external.prepare | 请求持久化外部 requestKey、目标与调用状态 |
| Host → Worker | external.accepted | pending 已持久化，允许真正发请求 |
| Worker → Host | external.update | 远端 operation ID、回执或 unknown 状态 |
| Host → Worker | external.recorded | 本次远端状态已持久化，允许继续推进 |
| Worker → Host | result | 完整 completed 或 waiting 结果 |
| Worker → Host | error | 明确错误及原始诊断关联 |
| Host → Worker | cancel | 停止当前本地调用，等待实际退出 |

同一步可能有多个供应商请求，每次真实外发使用独立 `externalRequestId`，上述四类 external 消息全部携带该 ID。它与本地幂等 requestKey、供应商 operation ID 分开保存。accepted 只确认同一请求的 pending，recorded 只确认同一请求的回执；每个请求单独记录状态并汇总 mayStillRun。某批成功不能覆盖另一批 unknown，seq 只用于通信顺序，不承担业务关联。

结果消息和退出状态都需检查：result 后异常退出仍报告失败；提前退出无 result 报协议错误。不能从 stderr 中猜成功结果。Worker 等待 external.accepted/recorded 期间也响应取消；Host 消失则停止继续调用供应商。外部请求可能已经发生时保留未知结果风险。

Python 的 completed result 在线协议中携带 `artifacts: Record<string, ArtifactDescriptor>` 和 outputs。worker 为本次调用内的每个文件分配唯一局部 key，输出中的文件位置使用保留标记 `{"$artifact":"audio.segment-001"}`；该单键对象只代表文件引用，禁止用于普通业务 JSON。标记可出现在顶层文件端口或 TTS 音频清单等嵌套位置。Host bridge 在结果与进程退出均成功后校验、注册描述符集合，将标记转换成 ArtifactRef，再校验标准 outputs schema 并返回 OperationResult。未知 key、越界路径或格式错误使调用失败；Python 无需签发 Host 引用，也无需新增注册消息。

TS 远端实现经同一 `InvocationContext` 注册文件并进行 pending/回执持久化；原生进程消息是该接口的传输编码。标准 Python bridge 负责协议与生命周期，模型作者只实现输入校验、计算和输出构造。

长驻 store worker 使用同一 envelope 的 requestId 关联方式，每次请求执行一个完整事务，串行返回结果。Host 不在跨进程边界持有 Python 锁或数据库 transaction 对象。退出失败、取消失败和协议错误向上报告；不自动重启进程掩盖故障。

## 9. 对外 HTTP 与 Client 契约

新增 `/api/v2` 由普通 API 插件提供，包含 catalog/workflows/tasks/settings/extensions 和 Client manifest。任务响应提供 workflow 快照、steps[]、outputs[]、allowedActions[]；首版 allowedActions 元素限定为 cancel/retry/rerun/delete。动作依据当前状态和 expectedAttempt 校验，所有状态变更只经过 tasks 服务。下载继续支持 GET/HEAD/Range。密钥值不进入响应。

v1 兼容插件只映射已有默认流程与历史记录；不能把外部任意 workflow 强行转换为七阶段。首版新 UI 使用 v2；v1 任务集合只显示可无损映射的旧任务/默认流程任务，直接读取不兼容对象时返回明确的契约不支持错误。

Client 插件通过 SDK 消费描述和状态。schema 首版只支持 object、string、number、boolean、enum、必填、范围和嵌套分组；复杂编辑器经 UI 插槽扩展。未知控件明确显示不支持，不能静默丢字段后提交。

Client 扩展带 ID、版本、兼容范围、入口 URL 和 CSS 资产；启用清单与服务器启动组合对应。官方页面走相同入口，动态加载不触发主程序重新构建。浏览器端的 Context 与服务端独立，跨侧通信始终经过可版本化 API。

## 10. Client 装配与界面注册

选择 import map + 同源平台 ESM 桥。HTML 在任何插件原生 import 前声明映射，固定共享 specifier 为 `react`、`react-dom`、`react-dom/client`、`react/jsx-runtime`、`react/jsx-dev-runtime`、`cordis`、`@youdub/sdk/client`。它们指向包含精确宿主版本的 `/plugin-platform/<version>/*.mjs`。映射缺项或版本不匹配时拒绝插件加载。

Next bootstrap 导入自身实际使用的 React/JSX/Cordis namespace，发布只读平台命名空间；平台 ESM 桥从该命名空间导出同一实例。桥准备完成后才 import 外部 ESM。公开导出集合随 SDK 版本固定，插件构建 external 必须与此集合一致。此桥需要 P0 在真实 Next 生产运行时验证，不能用另起一个 React root 的空 demo 替代。

最小公共 UI 契约：

- `root`：唯一渲染入口，由官方 shell 插件贡献；重复注册或就绪后缺失都报装配错误。Next 根节点只挂载 slots renderer。
- `shell.routes`：`id / path / component / access`；首版 path 只支持精确路径与 `:param`，冲突报错。Next 的固定 optional catch-all 将路径交给 navigation 服务。
- `shell.navigation`：`id / label / routeId / order`，不自行拼接宿主私有路由。
- `config.editors`：按 workflow/provider ID 注册；组件接收 `value / schema / diagnostics / readOnly / onChange`。标准渲染器不支持的 schema 需有匹配编辑器，否则阻止提交并说明原因。
- `task.detail.panels/actions`：接收只读 TaskView 与公开 API 操作；额外操作调用插件自身公开 API，不直接写任务状态。
- `settings.sections`：接收该插件的脱敏设置与保存接口；无权读取其他插件的凭据明文。

Client manifest 将模块标记为 public 或 authenticated。公开子树包含会话、登录页、基础渲染与诊断；登录成功后，由会话插件挂载唯一 authenticated 子 Fiber。退出或 session 失效时释放其 UI、订阅、进行中的读取和会话数据，再显示登录页。此行为属于会话生命周期，与安装后重启/刷新生效的策略独立。服务端始终执行认证，Client 清单分类不构成数据访问控制。
