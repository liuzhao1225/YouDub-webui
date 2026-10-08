# Cordis 插件版运行与扩展指南

2026-10-09 · `codex/plugin` 基于 `codex/mvp-mainline`。Host、Client 和 Python 执行桥已实现，三种真实媒体流程及本地切换已验收。本文描述当前命令与接口；测试、浏览器和切换记录见[迁移与验收记录](cordis-plugin-migration.md)。当前验证环境为 macOS arm64 / Node.js 22，远端插件下载及其他平台尚未验收。

## 1. 安装与配置

从仓库根目录执行。需要 Node.js 22（最低 22.13.0）、Python 3.12、FFmpeg/ffprobe 和 Git；模型与音频系统依赖沿用现有 Python 项目。根目录和 `apps/web` 各有一份 npm 锁文件，都需要安装。

```bash
git submodule update --init --recursive
npm ci --registry=https://registry.npmmirror.com
npm --prefix apps/web ci --registry=https://registry.npmmirror.com
python3.12 -m venv .venv
.venv/bin/python -m pip install --index-url https://mirrors.aliyun.com/pypi/simple/ -r requirements.txt
```

已有 `.venv` 时使用已有环境，无需重新创建。仅当 Aliyun 缺少所需包时，使用单一 Tsinghua 源处理缺包：`https://pypi.tuna.tsinghua.edu.cn/simple/`。模型权重、GPU 与 FFmpeg 配置可参考[原 MVP 环境说明](mvp-runtime.md)，其中旧 FastAPI 启动命令不适用于本宿主。

首次创建配置，已有 `.env` 时保留原文件：

```bash
cp .env.example .env
ln .env env.txt
test .env -ef env.txt
```

应用读取 `.env`；代理和排障工具读取同 inode 的 `env.txt`。两者及 `.venv/` 都忽略提交。复制工作树配置后，需要在新工作树重新建立硬链接。

默认组合强制访问密码。用交互输入生成 Argon2id 哈希，将输出写入 `.env` 的 `YOUDUB_AUTH_PASSWORD_HASH`，不保存明文密码：

```bash
.venv/bin/python -c "from getpass import getpass; from pwdlib import PasswordHash; print(PasswordHash.recommended().hash(getpass('YouDub password: ')))"
```

未配置有效哈希时认证插件启动失败。会话使用 HttpOnly Cookie，写请求需要会话 CSRF token；浏览器插件处理登录和 token。翻译连接在设置页配置，密钥继续通过系统 keyring 的 `YouDub` 命名空间保存。默认翻译调用显式使用至少 65,535 的最大输出 token 数，供应商拒绝时报告错误。

| 配置 | 默认值 / 用途 |
| --- | --- |
| `YOUDUB_CONFIG` | 仓库根 `youdub.config.ts`；也接受 Loader entries JSON 文件 |
| `YOUDUB_PYTHON` | 根目录 `.venv/bin/python`；官方模型和存储执行环境 |
| `YOUDUB_HOST` / `YOUDUB_PORT` | `127.0.0.1` / `8000` |
| `YOUDUB_DESKTOP_DATA_DIR` | macOS 为 `~/Library/Application Support/YouDub`；可改为隔离验证目录 |
| `NEXT_SERVER_API_BASE_URL` | Next 代理目标，默认 `http://127.0.0.1:8000`；在 Next 构建/启动命令环境设置 |
| `YOUDUB_AUTH_*` | 密码哈希、会话 TTL、Cookie 名称、Secure 和 SameSite；见 `.env.example` |
| `LOCAL_UPLOAD_MAX_BYTES` | 默认 4 GiB；具名输入还受 workflow 的 `maxBytes` 限制 |

新宿主启动会迁移数据目录的 `desktop.sqlite` 到 schema v2。旧 v1 活动任务必须先完成或明确停止；先在数据副本预演，不能让新旧调度器同时操作同一数据目录。`data/youdub.sqlite` 保持只读来源，具体历史边界见[迁移记录](cordis-plugin-migration.md#5-数据和凭据迁移)。

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
npm --prefix apps/web run dev -- --hostname 127.0.0.1 --port 3000
```

开发前端的 `predev` 会构建官方 Client 插件。生产前端使用：

```bash
npm run build:web
npm --prefix apps/web start -- --hostname 127.0.0.1 --port 3000
```

`build:web` 的 `prebuild` 同样执行插件构建。`build:plugins` 生成 `apps/web/plugin-dist/manifest.json` 和官方 ESM，Host 在启动时读取清单；首次启动 Host 前该文件必须存在。浏览器打开 `http://127.0.0.1:3000`。`/api/health` 只证明宿主就绪，模型是否具备条件查看 Runtime；真实推理仍需实际任务验收。

`npm run dev:api` 与 `npm start` 均运行 Cordis Host。`npm run dev:legacy` 才运行旧 FastAPI，仅保留作旧实现诊断；不要与新宿主同时使用相同数据和端口，也不要把它与新插件 UI 配成生产组合。

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

Client 采用原生 ESM；`react`、`react-dom`、`react-dom/client`、`react/jsx-runtime`、`react/jsx-dev-runtime`、`cordis`、`@youdub/sdk/client` 标记为 external，通过宿主 import map 解析。其余代码打入入口，CSS 用 `client.css` 声明。当前外部资产服务仅公开声明的入口和 CSS，不要生成未声明的额外共享 chunk。安装预编译 Client 后重启 Host、刷新页面，无需重建 Next。示例新增 `/extensions/text`、导航、React Hooks 计数器和任务面板。

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

上段是 `youdub` 内部字段；`requirements` 无依赖时省略。当前 entry 是包内 Python 脚本路径。安装器使用 PATH 中的 `python3` 创建独立 `.venv`，安装前应确认该解释器满足插件依赖；官方计算环境另由 `YOUDUB_PYTHON` 指定。启动时由普通 `python-provider` 插件转换成 provider 注册；同一包的 `host` 和 `python` 入口互斥。需要自定义 workflow 时使用 Host 入口，并自行调用公开 `process` 服务。

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

[默认组合](../../youdub.config.ts)装配普通 Cordis 插件：`process`、`files`、`store`、`secrets`、`settings`、`catalog`、`tasks`、`http`、`auth`、`api`、扩展装配和模型/workflow。bootstrap 只建立 Context、加载选定组合、检查生命周期和退出；空组合不创建产品数据库、HTTP 或任务循环。

服务用 `Service` 提供、`inject` 声明依赖，目录和 UI 注册的 disposer 交给 `ctx.effect`。没有默认 workflow 或模型特判藏在 bootstrap。`tasks` 将单任务调度和通用引擎合为一个可替换插件；实现 [TasksService](../../packages/sdk/src/index.ts) 即可替换，API 和 workflow 消费公共契约。workflow 通过 `catalog.registerWorkflow` 返回固定有序步骤计划，provider 通过 `catalog.registerProvider` 实现 operation，默认与第三方走同一条路径。

operation 的 `inputSchema` 校验输入。每个 JSON 输出端口必须提供 `schema`（JSON Schema），并在计划中保留 provider 声明的相同 schema；只写 `schemaId` 不足以通过计划校验。workflow 不得删除或降级 provider 的必需输出。文件由 `files` 校验与签发 ArtifactRef，引擎检查本次调用归属、schema 和提交时文件；计划的最终 outputs 单独决定下载项。具体媒体结构以[媒体契约](../../packages/builtin/src/media-contracts.ts)和 [Host SDK](../../packages/sdk/src/index.ts)为准。

Client 插件可向 `settings.sections` 注册设置区域。组件收到本区域的公开 JSON 配置，通过 `save(patch)` 在区域 id 的命名空间内浅合并保存；对应 v2 接口返回 `plugins[id]`。密钥交给 `secrets`，不写入公开插件配置。接口格式见[Client 契约](cordis-plugin-contracts.md#10-client-装配与界面注册)。

## 7. 开发检查与当前边界

```bash
npm run typecheck
npm test
npm run test:backend
npm run lint:web
npm run build:web
```

本轮通过真实字幕、配音和字幕加配音任务、独立 Python 提供者、外部 workflow/Client 页面、原数据迁移与本地页面验收；逐项证据及未验证范围见迁移记录。首版采用单机单活跃任务，扩展启停在重启后生效；DAG 编辑器、热替换、插件市场、权限沙箱和分布式 worker 不在 MVP 范围内。
