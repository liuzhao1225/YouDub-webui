# YouDub Desktop 改造调研记录

日期：2026-10-22。分支 `codex/harness-youdub-integration`。目标与完整验收项见[计划](YOUDUB-DESKTOP-REFACTOR-PLAN.md)。本文记录已查到的证据和仍需验证的事项。

## 来源与可恢复基线

- 改造前产品提交：`4b9dc0a7168135f191dd4050a6d1d9a32d9e14b9`，新增非发行标签 `youdub-desktop-refactor-base-20261022`。
- 计划提交：`07d5d264468326d1d76eff1ae81dcef394525fe5`。
- Harness 原始公开源码：`687f282e8625c6b8d11ff58211a90524be2e4317`。选入 362 包、9,817 文件，原树 SHA-256 `3ea8bedf096c4fff74379dce01d95b48b27b2a05f9c0ae7431f3e9ba6fa80c85`。
- `verify.mjs --scope sources` 通过：10 项归档摘要、两份 Harness Git bundle/树、原 Harness checkout、YouDub 初始快照与 bundle。原源码工作区无改动。
- `vendor.mjs --verify-archive` 通过：校验原 tar.gz 后在独立临时目录解开，9,817 个选入文件的字节、执行位、链接均匹配原始清单。临时目录检查后释放，归档未改。
- 固定清单 [source-manifest.json](../../../vendor/deepseek-harness/source-manifest.json) 文件哈希为 `b9c6cf9bd5f0b69affcdf2ffc6bb45f63309efb6abdfd552031093f2dee6d42c`；活动差异保存在 [fork.json](../../../vendor/deepseek-harness/fork.json)。首批业务差异限定于 `ui-settings-models`，另从同一归档原样补入两份 Vitest 配置。

## 前期调查进展

| 项 | 当前发现与第一批修改依据 | 未完成部分 |
| --- | --- | --- |
| R1 依赖闭包 | 模型设置仅在 DeepSeek 账号分支读取 `remote.session.modelCatalog`；其余模型 CRUD 使用 LLM/Settings/Credentials。桌面退出检查直接要求 agents/jobs | 逐项解除后核对新运行 inventory 和生成类型；不据静态发现批量删包 |
| R2 运行与构建范围 | 改造前 profile 使用 base/web-app/YouDub 三层、117 个禁用覆盖；当前建立 33 条正向装配。框架构建仍覆盖 362 包、325 个客户端产物 | 结合当前消费者裁剪源码和编译依赖，启动条目减少不等于包体已经缩减 |
| R3 恢复/来源 | 归档恢复和初始状态检查通过，已建立产品改造前标签；原 Desktop 内嵌提交与公开 tag 的差异继续保留 | 首次行为改动后验证差异账本和产物来源 |
| R4 运行资源 | 已定位 Node 的消费者为 Host、pnpm 和 yt-dlp；活动开发入口改用仓库 Electron 的 Node 模式和锁定 pnpm，Host 解除 Office | 全新工作区和跨平台复现；P6 删除旧开发 App 脚本及无关依赖 |
| R5 功能覆盖 | 冻结清单重新核对：58 路由、11 媒体操作、11 worker 操作、9 页面、50 组件文件；已有[功能账本](FUSION-COVERAGE.md) | 本次候选完整流程、B 站、音色等真实输入验收 |
| R6 界面 | 同一个 Electron Host 的浏览器入口可读，当前日语首屏保留 Logo/大标题，设置显示产品版本 0.0.7，模型页仅显示用户已配置提供商 | Mac 锁屏，原生窗口、保存框、画布与动效需解锁实测；截图只证明静态状态 |
| R7 数据/配置 | 启动器默认使用本工作区 `.cache/harness/desktop`，媒体、模型和缓存放在 YouDub 数据目录；已有凭据未改 | 环境回退、稳定 ID、迁移副本的完整复核 |
| R8 生命周期 | 领域人工等待与 Jobs 的运行状态职责不同；退出依赖 agents/jobs 会阻碍删除 Agent | 排队、远端等待、资源准备、未保存草稿的真实退出保护 |
| R9 扩展合同 | 现有三个 JS/Client/Python fixture 与官方 profile 安装回归可复用 | 新组合下安装、启用、执行、停用、卸载以及缺服务失败验收 |
| R10 CI/平台 | 旧 CI 会调用 Swift/C# 桌面打包；新增独立融合分支源码检查，不调用这些 workflow 或发行脚本 | 远端 CI、Windows 源码与实机验收；保留模块许可证裁剪核对 |

## 本批来源与构建实现

`framework-source.mjs` 检查原始清单哈希与精确 fork 差异；每项修改都须含原/新文件摘要及原因。原件校验继续独立进行。框架与 Desktop 构建使用当前 fork 输入，收据分别记录上游基准、fork 树哈希和产品提交。

staging 同步删除退役的源码输入，复制时不跟随目的端已有链接，并逐项检查字节/模式。`--verify-only` 不写收据。删除模块对应的编译产物仍由 P6 的全新目录裁剪验收兜清，不用输入同步推导产物已经裁净。

新 [源码 CI](../../../.github/workflows/harness-development.yml) 只针对融合分支，执行源码构建、领域/界面/Harness/Python 测试和语言检查，只上传构建证据。当前配置 macOS；Windows 仍在计划中，不能由该 job 代替。

## 已执行验证

| 检查 | 结果与范围 |
| --- | --- |
| 改造前 `npm --prefix apps/harness test` | 57 passed，0 failed，0 skipped；系统 Node 26.7.0。没有执行完整真实媒体链 |
| 来源规则针对性测试 | 4 passed：未经登记的增删改、原清单重写、缺原因、旧 staging、链接与执行位 |
| 本批 `npm --prefix apps/harness test` | 61 passed，0 failed，0 skipped；包括新增四项来源用例和 profile 使用开发依赖 pnpm 的回归 |
| 现有框架 `--verify-only` | 通过；检查时活动业务源码尚未改，未重写原有收据 |
| 全新 `.cache/harness/refactor-build-check` 构建 | pnpm 冻结安装 10.9 秒；原框架 7 个构建 gate 共 73.97 秒，全部通过；325 客户端产物。属于框架构建计时，未计入首轮复制与校验，不代表桌面冷启动性能 |
| 同 Host 页面观察 | `127.0.0.1:50031` 首屏、通用设置、模型页可用；只读观察，未改用户语言、凭据或任务 |
| 产品与来源检查 | `npm run build:youdub`、`check:composition`、Desktop 来源收据记录通过。仍为 42 Host/269 Client 活动模块；来源规则调整没有裁剪产品功能 |
| CI 文件与文档 | YAML 解析、融合分支触发、无旧发行命令、文档本地链接检查通过；首次远端执行的失败与修正见下文 |

全新构建暴露依赖安装生成 `lefthook.yml` 示例文件的问题：Lefthook 的安装脚本需要 `CI=true` 才会跳过，单设 `LEFTHOOK=0` 不足。构建安装阶段已显式设 `CI=true`，清理本次生成的纯注释示例文件；重跑冻结安装通过，文件没有再次生成。随后核对内容与精确创建/修改时间，仅清理本次安装生成的 `prepare-commit-msg` hook。其他 hooks 和仓库 hooks 配置未改。

## 模型设置解耦与 CI 首轮结果

- 原始模型模块基线：12 个文件、386 项测试通过。直接沿用原测试配置、组件和测试实现，没有另写模型设置页面。
- 当前修改移除 `remote.session` 强制注入、账号目录读取、账号行特殊显示/排序，以及 DeepSeek onboarding 的 Host 初始化和 Client 注册。YouDub 自己的首启、已有 LLM/Settings/Credentials 接口和提供商编辑器保持原有职责。
- 调整后的模块测试：12 个文件、382 项通过。退役专属引导与账号状态的断言同步移除；无 session 服务的加载、保存、注册与销毁已验证。其余编辑、凭据、冲突、错误和动态刷新测试继续执行。此结果尚不代替实际新 Host 的桌面验收。
- 活动 fork 差异校验通过，原始清单未改；独立目录的 7 个框架构建 gate 全部通过。
- [首次源码 CI](https://github.com/liuzhao1225/YouDub-webui/actions/runs/39644126912) 已完成来源、框架/产品构建、领域/前端/语言和 Harness 测试；Python 为 501 passed、24 failed。21 项失败涉及缺少 NLTK `punkt_tab`，3 项涉及字幕烧录的 FFmpeg 调用。完整链尚未通过。
- CI 显式下载分句数据到工作区私有 `.cache/nltk_data`，并使用包含 `libass` 的 [Homebrew ffmpeg-full](https://formulae.brew.sh/formula/ffmpeg-full)，其目录显式加入该 job 的 PATH。原上游模型模块测试一并接入 CI。[第二轮干净 macOS runner](https://github.com/liuzhao1225/YouDub-webui/actions/runs/39646789113) 的全部步骤已通过，对应提交 `1960d82f`。
- 失败涉及的四组本地媒体测试为 141 passed；本机已有资源，不以此替代干净 CI 或首次安装验收。
- 当前 fork 默认目录重建 7 gate 全部通过；产品构建、61 项 Harness 集成测试、组合检查和中英日语言检查通过。
- 同一 Desktop Host 的浏览器入口已重新打开模型设置，现有自定义提供商及原编辑器正常展示，无账号行和专属引导；未保存设置、未改凭据。返回首屏后原 Logo、大标题及历史任务仍可见。
- 构建期间活动 Host 的 HMR 曾报 `renderSlot('root') before any 'root' registration` 和 `renderSlot('youdub.setup.models') from a disposed registration`；构建完成后重新加载可正常展示。此处只确认冷加载页面可用，HMR 生命周期缺陷仍列入 P4，不能视作已修复。后续框架候选先在独立目录构建再停止旧实例切换，避免运行中逐文件改写已挂载框架。

框架构建收据见 [全新构建记录](evidence/refactor-framework-clean-build.json)。完整临时日志为 `/tmp/youdub-refactor-framework-build.log`。原生交互、完整流程、启动性能、最终体积与 Windows 均保持待验收。

## 正向装配与退出保护

`cordis.patch.yml` 直接保存从原 base/web bundle 组合复制出的 33 条入口。表达式使用原 `entryListSchema` 序列化并读回比较，保留稳定 entry id、配置语义与用户覆盖方式。Web runtime 的 Agent shell 环境发布关闭。

| 保留内容 | 当前消费者 |
| --- | --- |
| PluginManager、HMR、Timer、ConfigEditor、Settings | 配置更新、第三方扩展与原 Loader 生命周期 |
| LLM、Pi-AI 提供商、Credentials、Authorization | 原模型配置界面、用户提供商和翻译调用 |
| Typert、Gateway、RemoteAccess、SettingsController、PluginInventory | 官方配置/插件 Remote 与访问控制 |
| Jobs、Subprocess | YouDub 环境准备、下载、Python worker 与退出保护 |
| WebStartup、WebServer、WebRuntime、Connection、Modules、Client HMR、API Remotes | 官方 Host/Renderer 通信、认证、静态资源与前端加载 |
| Theme、Locale、Shortcuts、Layout、Renderer、Settings/General/Models | 原框架通用控件、布局、设置、语言与主题 |
| YouDub 业务插件 | 原任务、工作流、模型资源、文件和业务页面 |

启动清单移除 Agent/Session、会话持久化与投影、附件/聊天上传、Workspace、命令、聊天文件沙箱、Session/Job Controller 与无人消费的通用 storage 条目。YouDub 上传继续使用自己的原业务协议，经官方 Connection 准入后处理；该路径没有使用聊天附件上传。文件授权、Electron sandbox/contextIsolation、IPC 来源校验与 Connection 认证保留。源码包尚未物理删除，P6 再核对依赖闭包。

Profile 只迁移已知的 `dsh-base`、`dsh-web-app`、YouDub 三项前缀；使用官方 `writeProfileBundles` 保留后续扩展顺序和 manifest 其他字段。用户 `cordis.patch.yml` 不改写。官方 DesktopProjectManager 的默认及恢复清单改为保留 YouDub，恢复操作继续沿用原锁与备份处理。七项 profile 测试覆盖迁移幂等、配置与第三方依赖保留、错误组合拒绝和旧 pnpm lock 修正后的卸载。

Desktop Host 不再安装 Office 或发布 DeepSeek 平台账号 session。退出/重启仍走原 IPC、请求准入和 drain；实际忙碌状态由 `desktop/active-tasks` 事件读取 YouDub 持久任务与原 Jobs。排队、运行、远端等待、取消中、未确定结束的外部请求，以及环境准备过程会阻止直接退出；已保存的人工暂停可以在重启后继续。错误会返回原原因，缺少检查服务不会被当作空闲。前端未保存草稿的原生退出保护仍待完成。

验证记录：

- Desktop 原 profile 管理/退出/更新控制测试：52 passed、1 个原有平台限定 skipped；保留请求锁定、排空、销毁与恢复断言。
- 产品任务状态和首启测试：15 passed；包括外部请求、分页及存储错误传播。
- 新增真实 Desktop Host 进程测试直接经 Loader 启动临时 profile，不提供账号、Agent 或 Office 运行时。未认证 API 为 401；启动令牌经原 303/cookie 流程交换后可读首启；四个模型均出现、未下载不能 ready；退出及更新检查经 IPC 成功，Host 可清理退出。该测试不代表模型推理或原生 UI 验收。
- 实际新 Host 启动后，浏览器发现 `session-maybe` 根包装导致白屏，同时布局标题还读取 Session。已在原 Renderer 内支持 root-only 产品，显式会话 outlet/factory 继续要求 adapter；原 AppFrame 标题改为产品名。原布局、渲染器与装配读取测试合计 270 passed。
- 回归中原 `reconnect` 套件在修改前也无法解析链接 bundle 自身的 Host 条目。原测试读取器补充包自身 manifest 解析，继续按原顺序解析依赖；原重连测试现通过。该修正仅属于测试支持包。
- 实际旧 profile 的覆盖条目只有 YouDub、Theme、Locale 与 LLM；三层前缀迁移后仍保留这些配置。原生界面、资源准备和完整业务链继续按计划验收。

## P2 页面复核与本地检查（2026-10-22）

- 新组合冷启动发现 `SettingsRoot` 仍用聊天 Session 的 blank 状态触发通用引导，导致设置入口消失。现由 YouDub 首启流程持有就绪状态；原设置外壳保留显式 `openOnboarding(id)`、设置面板、连接恢复和更新状态，不再读取 Session。原设置模块 84 项测试通过。
- `TranslationSetup` 在 ready 时仍渲染模型 outlet，完成回调释放 root 注册后会触发 disposed-registration 错误。适配组件在 ready 时停止渲染该 outlet，再由原 effect 完成切换；实际冷启动和重新加载均回到工作台，当前 origin 的控制台无 error。运行中逐文件重构导致的独立 HMR 问题仍未据此关闭。
- 当前活动 fork：7 个原构建 gate 全部通过（29.73 秒）；框架相关 43 文件、788 passed、1 个原有平台限定 skipped；YouDub Harness 集成 62 passed；组合与中英日语言检查通过。此轮本地日志为 `/tmp/youdub-refactor-p2-upstream-tests.log`、`/tmp/youdub-refactor-p2-integration.log`。
- 同一 Electron Host 的浏览器入口 `127.0.0.1:60233`：首页及大标题、日语通用设置、用户提供商原编辑器与 URL/模型字段正常读回；取消编辑未保存配置。旧 zoo 下载任务详情显示原视频/音频/字幕文件和十节点历史图；扩展页显示 YouDub 内置功能及安装入口。没有重新运行该历史任务，不把旧产物计入本次完整流程通过。
- 当前原生 Mac 仍锁屏；实际窗口、保存、退出与未保存表单保护保持待验收。首启过程中语言仍有中日混合，列入 P4。P2 尚未整体完成。

## P3 开发运行资源独立化（2026-10-22）

- 已核实 Node 的实际消费者：Desktop/浏览器 Host、profile 与扩展包管理、Python 下载 worker 调用的 yt-dlp JavaScript runtime；媒体业务没有 Office 消费者。
- 直接复用原 `desktopNodeEnvironment` 和 `scripts/node-bin`，由本应用 `electron` 提供 Node，包管理入口为锁文件指定的 `apps/harness/node_modules/pnpm/bin/pnpm.mjs`。`desktop.mjs`、`launch.mjs`、产品入口与真实 Host 测试移除 primary-runtime 参数；旧 `prepare-youdub-app.mjs` 不在开发启动链，留待 P6 删除。
- Node wrapper 只加入包管理子进程的 PATH；媒体 worker 使用绝对 Electron 可执行路径并保留 `ELECTRON_RUN_AS_NODE=1`。原 Subprocess 会剥离 `DSH_*`，因此不能把依赖该变量的 wrapper 当作媒体 Node。真实 Python 子进程已执行本应用 Electron 的 Node 模式，确认 executable/version；媒体、模型、NLTK、pip、HF、Torch、ModelScope 路径均在 YouDub 私有数据目录。
- 原 HostProcess/Node 环境测试 23 passed；框架 7 gate 全部通过（31.23 秒），产品构建、组合与精确 fork 来源检查通过。真实 Host、profile、worker 与首启针对性测试 28 passed，覆盖原 401→303/cookie 认证、四模型未齐禁止 ready、退出 IPC 与关闭清理。临时日志：`/tmp/youdub-refactor-p3-host-process-tests.log`、`/tmp/youdub-refactor-p3-framework-build.log`、`/tmp/youdub-refactor-p3-integration.log`。
- `desktop.mjs --prepare-only` 成功；停止旧主进程/Host 后重建并启动现有 profile。同 Host 浏览器入口 `127.0.0.1:63837` 已读回原首页、历史 zoo 任务、日语设置、产品版本 0.0.7、用户配置提供商和密钥掩码；没有新增默认账号或模型。页面当前 origin error 日志为空，首页截图 `/tmp/youdub-refactor-p3-home.png`。这次没有重新调用翻译或运行完整媒体链。
- P2 checkpoint `569c3e3c` 的[源码 CI](https://github.com/liuzhao1225/YouDub-webui/actions/runs/39652654855) 已全部通过；本节 P3 修改仍需自己的 CI。原始来源清单未改，当前 fork 为 42 项记录差异。
- 原生 Mac 仍锁屏。P3 整体仍待新工作区首启、页面配置写入/重启和实际下载节点验证；P2 仍待前端草稿退出保护，P4/P6/P7 保持未完成。两份飞书文档按用户要求在全部改造和验收结束后更新。
