# Cordis 插件版运行与扩展指南

> 历史阶段记录：本文中的独立 Host、Vite 启动和插件 CLI 已在 Harness 分支退役。当前开发与扩展入口见 [YouDub Desktop 开发指南](../../apps/harness/docs/DEVELOPMENT.md)；下文历史命令和验收事实保留原义。

本文记录旧独立产品的 Cordis Host、React/Vite Client 与 Python 执行桥。前端分层与参考来源见[前端实现说明](harness-frontend-migration.md)。历史媒体流程测试、浏览器和切换记录见[迁移与验收记录](cordis-plugin-migration.md)，各记录中的日期、环境与验证范围保留原义。

节点工作流和按图准备资源见[使用指南](../workflows.md)及 [2026-10-20 验收记录](../validation/workflow-nodes-2026-10-20.md)。旧版首次启动流程保留在 [2026-10-14 验收记录](../validation/first-run-setup-2026-10-14.md)。

## 1. 安装与配置

从仓库根目录执行。需要 Node.js 22（最低 22.13.0）和 Git。根目录和 `apps/web` 各有一份 npm 锁文件，都需要安装。

```bash
git submodule update --init --recursive
npm ci --registry=https://registry.npmmirror.com
npm --prefix apps/web ci --registry=https://registry.npmmirror.com
```

默认组合先启动 HTTP 与环境准备服务。它识别系统及架构，复用或安装 Python 3.12、创建虚拟环境、安装基础依赖，完成后加载工作台插件。工作流页面按图中节点检查并显式准备媒体依赖、FFmpeg/ffprobe、分句资源和模型，显示真实进度与失败原因。资源准备失败保留工作台和图编辑入口，后续准备复用已有资源。

Python、FFmpeg、NLTK 和模型优先使用上游官方来源；每个来源先做最长约 3 秒的连通性测试，官方来源不可用或实际下载遇到网络错误时，依次测试已配置的阿里镜像或 ModelScope。源测试、原始错误和来源切换均写入可展开的下载与安装日志。同一模型的来源测试短暂缓存，文件仍需通过清单大小及 SHA-256 校验。Python 解释器与 venv 均位于 YouDub 数据目录的 `runtime/` 下，依赖由该 venv 内的 uv 安装，缓存位于 `runtime/uv-cache/`；继续使用现有分组 requirements。准备界面展示实际文件字节数、速度、当前安装活动及已用时间。下载或安装后的执行/导入验证通过才标记就绪；校验错误、磁盘错误和用户取消直接停止对应操作。设备和模型选择仍保存在 workflow 配置中。

工作流资源准备将选中的模型下载到以下位置，官方 provider 扫描时只读取本地资产：

| 能力 | 默认目录（相对数据目录） | 可覆盖变量 |
| --- | --- | --- |
| Whisper | `models/whisper`，例如 `tiny.pt` | `YOUDUB_WHISPER_MODELS_DIR` |
| Demucs | `models/demucs`，`955717e8-8726e21a.th` | `YOUDUB_DEMUCS_MODELS_DIR` |
| VoxCPM2 | `models/voxcpm/VoxCPM2` | `YOUDUB_VOXCPM_MODEL_DIR` |
| Qwen 对齐 | `models/qwen3-forced-aligner/Qwen3-ForcedAligner-0.6B-hf` | `YOUDUB_FORCED_ALIGNER_MODEL_DIR` |

VoxCPM2 与 Qwen 需要完整的模型、tokenizer 和 processor 配置；设置页显示实际探测结果。“模型”分区与首次配置共用 Harness 模型供应商编辑器，保存供应商地址、协议、模型候选和凭据引用，实际执行模型固定在工作流节点绑定中。旧 `openai` 连接及 `YOUDUB_TRANSLATION_MODELS` 保留给历史任务和首次旧配置导入；新供应商由 `llm.<route>` 注册，不持续读取旧 defaults。模型候选获取不代表真实翻译调用成功，执行时要求最大输出参数至少为 65,535。

Whisper provider 还需要 `nltk==3.10.3` 和预训练 `punkt_tab` 数据。准备含 Whisper 的工作流时会下载到应用数据目录的 `nltk_data/`，已有 NLTK 资源可复用；自定义目录使用 `NLTK_DATA`。推理时只检查本地包和四个英文参数文件；缺失时明确报告 `MODEL_NOT_READY`。

英文识别在 ASR 后处理内用预训练 Punkt 合并跨段句子、拆分段内多句，再按首末词时间戳确定每句原声范围。原始 ASR JSON 保持不变，中文、日文保留原有分段。分句后的 ID 贯穿翻译、逐句参考音频和 TTS；缺少英文词时间戳或句界无法映射到词边界时明确失败。无新增 workflow 步骤。

字幕导出按逗号、顿号、中文破折号等分隔显示片段，沿用短片段合并规则；SRT 和烧录字幕隐藏片段末尾的分隔标点，保留内部标点、括号与书名号。这个显示处理不改写原文、译文、TTS 输入或对齐原始结果。

首次创建配置，已有 `.env` 时保留原文件：

```bash
cp .env.example .env
ln .env env.txt
test .env -ef env.txt
```

应用读取 `.env`；代理和排障工具读取同 inode 的 `env.txt`。两者及 `.venv/` 都忽略提交。复制工作树配置后，需要在新工作树重新建立硬链接。

默认组合无需访问密码，打开工作台即可使用。浏览器自动建立 HttpOnly Cookie 会话，写请求仍校验 CSRF token 和请求来源；原有 `YOUDUB_AUTH_PASSWORD_HASH` 不再使用。翻译连接在设置页配置，密钥继续通过系统 keyring 的 `YouDub` 命名空间保存。默认翻译调用显式使用至少 65,535 的最大输出 token 数，供应商拒绝时报告错误。

| 配置 | 默认值 / 用途 |
| --- | --- |
| `YOUDUB_CONFIG` | 仓库根 `youdub.config.ts`；也接受 Loader entries JSON 文件 |
| `YOUDUB_PYTHON` | 根目录 `.venv/bin/python`，Windows 为 `.venv/Scripts/python.exe`；官方模型和存储执行环境 |
| `YOUDUB_HOST` / `YOUDUB_PORT` | `127.0.0.1` / `8000`；`npm --prefix apps/web start` 默认端口为 `3000` |
| `YOUDUB_DESKTOP_DATA_DIR` | macOS 为 `~/Library/Application Support/YouDub`；可改为隔离验证目录 |
| `YOUDUB_API_URL` | Vite 开发/预览代理目标，默认 `http://127.0.0.1:8000`；生产同源服务无需配置 |
| `YOUDUB_WEB_ROOT` | 可选静态构建目录；生产前端启动脚本与桌面启动器设置为 `apps/web/dist` 的绝对路径 |
| `YOUDUB_AUTH_*` | 会话 TTL、Cookie 名称、Secure 和 SameSite；见 `.env.example` |
| `LOCAL_UPLOAD_MAX_BYTES` | 默认 4 GiB；具名输入还受 workflow 的 `maxBytes` 限制 |

新宿主启动会迁移数据目录的 `desktop.sqlite` 到 schema v3，新增工作流文档、节点结果版本与人工确认记录，保留 v2 任务。旧 v1 活动任务必须先完成或明确停止；先在数据副本预演，不能让新旧调度器同时操作同一数据目录。仓库 `data/youdub.sqlite` 只在首次迁移复制旧登录会话时只读打开；旧 URL 下载任务不进入新任务列表，也没有运行入口。数据库文件保留原位。

## 2. 构建与启动

先确认端口空闲，再启动。以下检查若列出监听进程，先识别它并处理占用：

```bash
lsof -nP -iTCP:8000 -sTCP:LISTEN
lsof -nP -iTCP:3000 -sTCP:LISTEN
npm run build:plugins
```

终端一，从仓库根目录启动 Cordis Host：

```bash
npm start
```

终端二启动开发前端：

```bash
npm --prefix apps/web run dev -- --host 127.0.0.1 --port 3000
```

开发前端的 `predev` 会构建官方 Client 插件。Vite 将 `/api` 代理到 Host；Host 使用非默认端口时，在启动 Vite 前设置 `YOUDUB_API_URL`。

生产运行使用一个 Host 同源提供页面和 API。先停止上述两个开发服务，再执行：

```bash
npm run build:web
npm --prefix apps/web start
```

`build:web` 的 `prebuild` 同样执行插件构建，Vite 产物位于 `apps/web/dist`。生产启动脚本设置静态目录和默认端口 `3000`，然后启动 Cordis Host；监听地址通过 `YOUDUB_HOST`、`YOUDUB_PORT` 环境变量配置，命令不接收原 Next 的 `--hostname`/`--port` 参数。`NEXT_SERVER_API_BASE_URL` 已移除，生产构建不固定 API 代理地址。

静态 Web 插件与环境准备插件并列挂载，Python 尚未准备时仍能显示准备页；桌面安装包使用同一套静态构建与 Host，监听本机动态端口。页面深链接由 Host 返回 SPA 入口，缺失资源和 API 路径保留 404。

`build:plugins` 生成 `apps/web/plugin-dist/manifest.json` 和官方 ESM，Host 在启动时读取清单；首次启动 Host 前该文件必须存在。浏览器打开 `http://127.0.0.1:3000`。`/api/health` 只证明宿主就绪，模型是否具备条件查看 Runtime；真实推理仍需实际任务验收。

`npm run dev:api` 与 `npm start` 均运行 Cordis Host。旧 FastAPI、旧调度器和 `dev:legacy` 已移除；HTTP 统一使用 `/api/v2`。

主页保留视频链接、拖拽上传、工作流选择和节点声明的快捷设置。语言、模型、设备、声音、字幕和背景音参数归工作流节点；保存工作流可复用这些设置。全局设置分为通用、模型、环境与模型、扩展、关于与更新。齿轮入口位于桌面侧栏底部、移动端顶栏；点击后以分类弹窗覆盖当前页面，保留原位置与草稿。分类切换不新增浏览器历史，关闭、Escape 或遮罩回到来源页面；直接打开 `/settings[/section]` 时关闭回工作台。`/settings/models` 提供模型供应商管理，旧 `/settings/connections` replace 到该路径。窄屏使用全屏弹窗与左侧图标栏。旧处理 defaults 迁移成“原默认处理配置”工作流，官方模板不再持续读取它。旧任务重跑保留完整配置编辑，允许调整已失效的模型选择。

## 3. 安装、启停和重启

先完成或取消活动任务。推荐退出 Host 后用 CLI 管理，再启动 Host 并刷新浏览器。CLI 只装配管理所需服务，不监听 HTTP、不启动任务循环；它读取相同 `.env`，可用 `--data-dir` 指定同一数据目录。

```bash
npm run plugins -- list
npm run plugins -- install --source ./fixtures/plugins/file-transform
npm run plugins -- disable --id example.file-transform
npm run plugins -- enable --id example.file-transform
```

远端来源的命令格式如下，`OWNER/REPO`、`FULL_COMMIT_SHA` 和包名是占位值：

```bash
npm run plugins -- install --source https://github.com/OWNER/REPO --ref FULL_COMMIT_SHA
npm run plugins -- install --source npm:PACKAGE_NAME@1.0.0
```

Git ref 解析为固定 commit 后 detached checkout；npm 必须指定精确版本。安装后记录版本、来源、commit 与包文件完整性，后续启动重新校验已启用包。源代码被修改时拒绝激活。当前文档不将远端命令示例视为 GitHub/npm 真实安装验收。

安装和启用只更新下一次启动组合。`installed`、`enabled`、`active` 分别表示安装完成、配置选中、当前已激活；CLI 不声称了解另一个运行实例的 active 状态。卸载通过设置页或扩展 API，先禁用、重启，再删除。替换相同插件 ID 也遵循该过程；当前没有热升级或多版本并存选择。

安装失败保留该次 `install-*/install.log`、`failure.json` 和部分文件，返回原始原因；不会把残留标记成 installed。插件安装脚本及 Host 代码以本机权限运行，独立 `.venv` 仅隔离 Python 依赖。

## 4. 最小插件包

完整示例见[文件转换插件](../../fixtures/plugins/file-transform/README.md)和[纯 Python 提供者](../../fixtures/plugins/python-text/README.md)。一个包可注册多个 workflow/provider。最小 Host/Client 包：

```json
{
  "name": "youdub-example",
  "version": "1.0.0",
  "type": "module",
  "peerDependencies": { "cordis": "4.0.0-rc.10", "@youdub/sdk": "^1.0.0" },
  "youdub": {
    "id": "example.transform",
    "sdkVersion": "^1.0.0",
    "host": "dist/host.js",
    "client": { "entry": "dist/client.js", "access": "authenticated", "css": [] }
  }
}
```

`youdub.host` 和 `youdub.client.entry` 指向已编译资产。可选 `youdub.build: "npm"` 要求包提供 `npm run build`。Cordis 和 SDK 使用宿主提供的模块身份，不放入普通 `dependencies`。`sdkVersion` 指公共协议兼容范围；当前工作区 SDK 包是本地实现，并未据此宣布 npm 发布。

Client 采用原生 ESM；`react`、`react-dom`、`react-dom/client`、`react/jsx-runtime`、`react/jsx-dev-runtime`、`cordis`、`@youdub/sdk/client` 标记为 external，通过宿主 import map 解析。其余代码打入入口，CSS 用 `client.css` 声明。当前外部资产服务仅公开声明的入口和 CSS，不要生成未声明的额外共享 chunk。安装预编译 Client 后重启 Host、刷新页面，无需重建 Vite 外壳。示例新增 `/extensions/text`、导航、React Hooks 计数器和任务面板。

内置页面通过 `bindComponent` 在插件注册时注入查询、导航、会话和插槽能力，组件通过显式 props 使用这些能力。查询、资源准备与更新检查的状态放在无 React 依赖的 runtime，React 订阅集中于 `web-react`。公共 Client SDK 仍为 `1.1.0`，保留已有第三方插件使用的 `useClient`、`useSlot`、`Link` 等入口；本次分层不要求插件改写。

## 5. Python 作者入口与 stdio 协议

纯 Python 包不必编写 Host TypeScript。将 `youdub.host` 换为：

```json
{
  "python": {
    "entry": "worker.py",
    "requirements": "requirements.txt",
    "provider": {
      "id": "example.transform",
      "label": "文本转换",
      "execution": "local",
      "operations": [{
        "id": "example.transform/v1",
        "inputSchema": { "type": "object", "required": ["document"] },
        "outputs": [{ "name": "document", "kind": "artifact", "schemaId": "file/v1", "required": true }]
      }]
    }
  }
}
```

上段是 `youdub` 内部字段；`requirements` 无依赖时省略。entry 是包内 Python 脚本路径。安装器优先使用 Host 配置的 Python 或 `YOUDUB_PYTHON` 创建插件自己的 `.venv`；独立 CLI 未指定时才使用 PATH 中的 `python3`（Windows 为 `python`）。安装前确认该解释器满足插件依赖。启动时由普通 `python-provider` 插件转换成 provider 注册；同一包的 `host` 和 `python` 入口互斥。需要自定义 workflow 时使用 Host 入口，并自行调用公开 `process` 服务。

需要人工订正的纯 Python provider 可显式声明 `python.corrections: "schema"`，按输出 JSON Schema 校验订正；输出端口和文件归属仍由任务服务检查。复杂领域规则由 Host provider 的 `validateCorrection` 实现。内置媒体 provider 显式使用媒体校验，通用 Python adapter 不隐式套用媒体规则。

provider 可通过 `resources: { dependencyGroups, model?: { id, downloadId } }` 选择宿主已知的依赖组和模型资源；未声明的插件继续按自身安装指导准备。依赖组、模块名、兼容范围和内置 provider 资源映射统一来自 `backend/requirements/resources.json`。各组的 `.txt` 是安装需求，兼容范围单独声明；资源契约不接受任意下载地址或安装命令。

每次 operation 启动一个受管进程。stdin/stdout 使用逐行 JSON，stdout 仅输出协议，日志与 traceback 写 stderr。首条输入：

```json
{"version":"youdub-worker/v1","invocationId":"UUID","seq":1,"type":"execute","payload":{"operation":"example.transform/v1","inputs":{"document":{"path":"HOST_RESOLVED_PATH"}},"workDir":"INVOCATION_DIRECTORY"}}
```

实际 payload 还含 taskId、attempt、stepId、binding、options、config 和本次凭据。读取 Host 已解析的输入路径，在 `workDir` 内生成文件；结果中的路径相对该工作区：

```json
{"version":"youdub-worker/v1","invocationId":"UUID","seq":1,"type":"result","payload":{"state":"completed","outputs":{"document":{"$artifact":"out"}},"artifacts":{"out":{"path":"result.txt","mimeType":"text/plain","schemaId":"file/v1"}}}}
```

每个方向分别递增 seq，消息关联同一 invocationId。`$artifact` 可嵌套；Host 在 result 与退出码均成功后注册文件并转换引用。错误发送 `type: "error"`，保留 code/message/type 并非零退出。取消后 Host 等待受管进程组实际退出，不能继续后台计算。远端请求必须经过 `external.prepare` → `external.accepted` 后发送，再用 `external.update` → `external.recorded` 保存回执；结果未知保留 `mayStillRun`。详细类型见[进程契约](cordis-plugin-contracts.md#8-跨进程线协议)。

标准 Python 包桥当前实现单次 `execute`。需要远端 `poll` 的提供者使用 Host 插件实现相应 SDK 方法，不能仅返回 waiting 却没有 poll。

## 6. 服务、流程和结果契约

[默认组合](https://github.com/liuzhao1225/YouDub-webui/blob/230bce531a6581b4b3c6d4969df83d9b43c817e7/youdub.config.ts)装配普通 Cordis 插件：`process`、`files`、`store`、`secrets`、`settings`、`catalog`、`tasks`、`http`、`auth`、`api`、扩展装配和模型/workflow。bootstrap 只建立 Context、加载选定组合、检查生命周期和退出；空组合不创建产品数据库、HTTP 或任务循环。

服务用 `Service` 提供、`inject` 声明依赖，目录和 UI 注册的 disposer 交给 `ctx.effect`。没有默认 workflow 或模型特判藏在 bootstrap。`tasks` 将单任务调度和通用引擎合为一个可替换插件；实现 [TasksService](../../packages/sdk/src/index.ts) 即可替换，API 和 workflow 消费公共契约。workflow 通过 `catalog.registerWorkflow` 返回固定有序步骤计划，provider 通过 `catalog.registerProvider` 实现 operation，默认与第三方走同一条路径。

operation 的 `inputSchema` 校验输入。每个 JSON 输出端口必须提供 `schema`（JSON Schema），并在计划中保留 provider 声明的相同 schema；只写 `schemaId` 不足以通过计划校验。workflow 不得删除或降级 provider 的必需输出。文件由 `files` 校验与签发 ArtifactRef，引擎检查本次调用归属、schema 和提交时文件；计划的最终 outputs 单独决定下载项。具体媒体结构以[媒体契约](../../packages/builtin/src/media-contracts.ts)和 [Host SDK](../../packages/sdk/src/index.ts)为准。

Client 插件可向 `settings.sections` 注册设置区域。组件收到本区域的公开 JSON 配置，通过 `save(patch)` 在区域 id 的命名空间内浅合并保存；对应 v2 接口返回 `plugins[id]`。密钥交给 `secrets`，不写入公开插件配置。接口格式见[Client 契约](cordis-plugin-contracts.md#10-client-装配与界面注册)。

## 7. 开发检查与当前边界

```bash
npm run typecheck
npm test
npm run test:backend
npm --prefix apps/web test
npm run lint:web
npm run build:web
```

历史真实字幕、配音、字幕加配音任务、独立 Python 提供者、外部 workflow/Client 页面与数据迁移的证据见[迁移记录](cordis-plugin-migration.md)。当前节点工作流支持分叉、汇合与逐节点人工确认，按单执行槽运行，等待确认的节点释放执行槽。扩展启停在重启后生效；热替换、插件市场、权限沙箱、循环和分布式 worker 尚未实现。前端迁移的验证范围见[实现说明](harness-frontend-migration.md#验证范围)，历史验收不代表本次迁移已通过。
