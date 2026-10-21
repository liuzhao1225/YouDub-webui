# YouDub on DeepSeek Harness：字幕最小验证

直接运行官方 `@deepseek-ai/dsh@0.2.1-rc.2`。YouDub 作为双端插件提供原版首屏和字幕工作流：导入视频 → Whisper 识别 → 人工修改、保存和确认 → 下载 SRT。上游核心代码修改为 **0**。

![原版首屏](docs/evidence/home-dark.png)

## 组成

| 边界 | 实现 |
| --- | --- |
| 启动、插件装配、配置 | 官方 dsh CLI、profile、bundle、Cordis Loader |
| 页面、模块加载和渲染 | 官方 `dsh-web-app`、`dsh-web-frontend`、`dsh-client-modules`、`dsh-client-ui-renderer` |
| 请求鉴权 | 官方 `dsh-client-connection` 的 owner Fetch 路由 |
| YouDub 界面 | `src/client.jsx` 注册官方 `root` 插槽 |
| 原版视觉 | 直接引用现有 `BrandMark`；构建时从 `apps/web/src/app/globals.css` 提取主题变量及动画；首屏布局参照原版 Studio 与官网工作台截图 |
| 子进程管理 | 构建现有 `packages/builtin/src/process.ts`，仅在构建时将 `cordis` 指向 Harness 的 Cordis 包 |
| 识别 | 现有 `backend.workers.operation` 的 `media.prepare/v1`、`speech.transcribe/v1` |
| 导出 | `export_subtitles.py` 调用现有 `Transcript` 合同与 `_write_srt` |
| 状态 | `src/workflow.mjs` 的单条字幕流程、持久化人工确认检查点 |

[官方架构文档的 Desktop 部分](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/architecture.md#desktop-application)说明 Desktop Host 复用 Web 应用和前端资源。本验证直接使用这些发布包及其插件协议。当前验收载体为本机浏览器；尚未构建、验证 Electron 桌面壳、IPC 或安装包。

## 环境与启动

使用 Node.js 22.19+。识别需要现有 YouDub Python 环境、FFmpeg/FFprobe、Whisper `tiny.pt` 和 NLTK `punkt_tab` 资源。本次复用本机已安装的 YouDub 环境，没有新建一套资源下载或安装管理器。

如需创建 Python 环境，在仓库根目录执行：

```sh
python3 -m venv .venv
.venv/bin/pip install --index-url https://mirrors.aliyun.com/pypi/simple/ \
  -r backend/requirements/base.txt \
  -r backend/requirements/media.txt \
  -r backend/requirements/whisper.txt
```

模型与 NLTK 文件可复用现有 YouDub 安装的资源。`modelsDir` 指向包含 `tiny.pt` 的目录；FFmpeg/FFprobe 位于启动环境的 PATH。英语句子切分使用 NLTK 默认资源路径，也可以通过 Harness 的环境加载设置 `NLTK_DATA`。

从仓库根目录：

```sh
cd apps/harness
npm ci --registry=https://registry.npmmirror.com
npm run build
npm start -- --dump-config
```

第一次命令会初始化独立 profile，默认 Harness home 为仓库内 `.cache/harness/dsh`，避免影响已有 Harness 安装。可使用官方 `DSH_HOME` 指定其他位置。初始化保留已有 profile 和配置。

编辑 `$DSH_HOME/profiles/youdub/cordis.patch.yml`，按 [profile.example.yml](profile.example.yml) 填入 Python、模型目录；数据目录保留 `dshHomePath('youdub')` 即可。默认端口 3086，也通过 `webserver` 行配置。

```sh
# 确认所配置的端口未被占用；有监听进程时先处理端口冲突。
lsof -nP -iTCP:3086 -sTCP:LISTEN
npm start
```

打开终端打印的带 token 地址。Harness 会换取认证 cookie 并从地址栏移除 token。每次宿主重启后，使用新打印的地址。

### 配置完全沿用 Harness

配置优先级：bundle 默认值 → profile 的 `cordis.patch.yml` → Harness home 的 `cordis.patch.yml` → CLI `--patch`。一次配置覆盖会替换该行的完整 `config`，不是逐字段合并。

```sh
npm start -- --dump-config
npm start -- --dump-config-schema
npm start -- --patch /absolute/path/to/override.yml
```

YouDub 的 `python`、`modelsDir`、`dataDir` 由官方 Schemastery schema 校验，可以出现在 Harness 配置导出中。当前精简 profile 未加载 HMR，修改配置后重启。

普通环境变量使用 Harness 原生的继承环境、调用目录 `.env`、Harness home `.env` 规则。运行目录固定为 `apps/harness`，不读取旧应用根目录的 `.env`。启动器没有新增 `YOUDUB_HARNESS_*` 配置入口。Python 适配层仅将已解析的插件配置传给现有 worker 所需的变量。

已挂载官方 credentials 服务；本次只使用本地识别，没有调用外部 LLM 或写入密钥。后续服务凭证应使用 Harness credentials，不另建 YouDub 密钥文件。

## 操作与持久化

1. 在原版首屏选择或拖入视频，选择识别语言，点击“开始处理”。
2. 识别后停在“待人工确认”。此时识别进程已退出，可处理另一个视频。
3. 修改字幕并“保存修改”。未保存的修改会阻止确认、导出和页面切换。
4. 点击“确认字幕”，再点击“导出 SRT”。再次修改并保存会撤销确认。

数据保存在 `$DSH_HOME/youdub/tasks/<taskId>/`：

- `source.video`：原始视频。
- `recognize/asr_raw.json`、`asr.original.json`：未被人工订正覆盖的识别原始结果。
- `task.json`：当前字幕、版本和人工确认状态。
- `transcript.confirmed.json`、`subtitles.srt`：确认后导出的产物。

校对检查点在刷新和宿主重启后保留。执行中断会在重启时显示 `HOST_INTERRUPTED`，不会自动重跑或自动确认。失败显示原始原因；本验证通过重新导入建立新任务，不提供自动重试。任务版本校验阻止旧页面覆盖新修改。

## 验证与范围

```sh
npm test
```

六项状态测试与两次真实视频验证的结果见 [验收记录](docs/validation.md)。[下载的实际 SRT](docs/evidence/zoo-en.srt) 保留人工订正，且与 Host 产物字节一致。

当前范围：本地视频、Whisper tiny/CPU、原语言字幕、固定识别时间轴、修改文本、人工确认、SRT 下载；单个识别执行位。文件上限 512 MB。未迁移翻译、配音、完整工作流编辑器、安装更新与语言切换。字幕条目的拆分/合并和时间轴编辑也不在本次范围。

`rc.2` 的官方 UI renderer 在渲染根组件时要求 `session-maybe` 作用域。本插件通过公开 `slots.installScope` 提供明确的无会话适配器；没有加载聊天 Session，也没有修改 renderer。未来升级需复验这个接口。

所有新增实现和证据集中于 `apps/harness`。不修改原 YouDub 的 Host、前端入口、worker 或上游 npm 包；`dist`、依赖、模型、凭证和运行数据均不入 Git。
