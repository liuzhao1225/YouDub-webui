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

## P2–P3 退出时序、真实媒体与 CI 修复（2026-10-22）

- 发现产品退出先停止 Host、随后 Renderer 才能取消 `beforeunload`。产品入口现先等待原窗口关闭事件，保留 Electron 的原生未保存内容确认；取消时保持窗口与 Host，实际关闭后再走原 drain。四项测试覆盖取消后重试、干净窗口、实际关闭时序和错误传播，真实 Host 组合测试也通过。模型表单尚需 P4 接入原编辑状态，原生交互仍待解锁验收。
- 在 `baa60ad8` 的真实 Electron Host 上，通过页面选择 zoo 本地视频并执行包含 Demucs、Whisper、翻译、VoxCPM2、Qwen Aligner 的九节点工作流，9/9 完成，产物视频在浏览器播放到末尾；翻译请求上限 65,535。文件哈希、时长、字幕及限制见[本次媒体证据](evidence/refactor-p3-media.json)。Whisper tiny 的原识别误差仍会进入译文，质量审核未据此通过。
- 同版本 YouTube 下载节点实际失败，平台要求登录确认非机器人，未执行下游节点；失败任务保留。没有通过重试或改用本地视频将该下载任务记为成功。
- `baa60ad8` 的[开发 CI](https://github.com/liuzhao1225/YouDub-webui/actions/runs/39654481138) 在旧业务进程协议测试失败：Darwin 进程组退出间隙返回 EPERM，清理异常覆盖 worker 原错误。该旧实现仍被开发回归使用，活动 Harness worker 已使用官方 Subprocess。根据 [Apple killpg 实现](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_sig.c)，修复仅在既有退出宽限期内确认整个进程组已消失才接受此退出状态；真实权限错误继续失败，worker 与清理同时失败时保留两个原因。针对性测试 12 passed，Windows 限定用例在 macOS skipped；后续 CI 结果独立记录。
- 新隔离 profile 的首次启动已通过页面安装私有 Python 3.12.15；点击“准备全部模型”后继续安装推理依赖、FFmpeg、分句资源和四模型。当前尚未完成全部下载，首启门控保持阻止进入工作台。此项继续验收，不能据此关闭 P3。

## P3–P4 首启完成与语言读回（2026-10-22）

- `a5bbed5d` 的[源码 CI](https://github.com/liuzhao1225/YouDub-webui/actions/runs/39657014252) 全部通过，包括上一轮失败的进程协议检查。
- 隔离 home `.cache/harness/refactor-first-run-20261022` 通过界面实际下载 Whisper、Demucs、VoxCPM2、Qwen Aligner 共约 6.97 GB，并完成私有 Python、推理依赖、FFmpeg、分句资源及 Apple MPS 运算检查。2/4、3/4 时均保持首启门控；VoxCPM2 暂停和继续保留已有进度，其他下载可继续。
- 首启发现四模型下载到 100% 后的最终依赖校验阶段仍显示“下载已暂停”。`SetupScreen` 现按原资源状态显示“正在验证环境”，不再给出无效的继续下载按钮；已有资源合同保持不变。
- 新 profile 初始提供商为空。使用原 YouDub 的配置值，通过原 Harness 模型编辑器填写 URL、密钥和模型字段并保存；未通过写配置文件完成测试。停止 Host 后重新构建、启动同一 home，直接进入工作台，模型页仍显示唯一用户提供商和前六位密钥掩码。凭据文件为 0600，唯一 records 项属于浏览器连接授权，没有 DeepSeek 账号记录；未输出完整密钥。
- 首启和资源组件新增中英日文案，复用现有语言入口和官方 locale 设置。实际从设置切换日本語、刷新页面后仍为日语；资源页显示四模型、Python、FFmpeg、分句数据和 yt-dlp 均已就绪。原始后端诊断详情保留原文，诊断报告模板和部分后端说明仍需后续语言复核。截图：`/tmp/youdub-refactor-first-run-ja-resources.png`。
- 本批 39 项前端测试、web TypeScript、636 项业务语言键及 7 个框架语言空间检查通过；产品构建和来源组合检查通过。测试使用本机 Node 22，系统 Node 26 的 jsdom localStorage 行为不兼容已有测试环境。真实原生窗口、全新 checkout 和 Windows 验收仍未完成；两份飞书文档保持未改。

## P4 模型草稿保护（2026-10-22）

- 原 `settings.section` owner 新增可选的 leave guard 注册回调。SettingsPanel 的关闭、遮罩、Escape 和导航沿用原外壳并检查当前 section；ModelsSection 使用原 Modal 询问是否放弃，卡片提供原 draft、keyDraft、部分保存基线和 busy 状态的读取回调。没有创建第二份表单或全局状态。
- 保存、模型发现和删除操作进行中禁止离开；失败后保留原错误与未保存输入。原生退出/浏览器刷新通过 `beforeunload` 读取同一组状态，注册随组件销毁清理。旧测试中的直接丢弃行为已更新为显式确认，其余原断言保留。
- 新构建在独立 profile 的真实页面中验证：日语自定义提供商输入 `youdub-draft-check`，切换一般设置出现确认；继续编辑后原输入仍在；关闭设置再次出现确认，放弃后返回工作台。测试草稿没有保存为提供商，现有配置不变。截图 `/tmp/youdub-refactor-model-draft-ja.png`。
- 原模型设置与通用设置 19 个文件、471 项测试通过；框架 7 个构建 gate、产品构建、来源组合和语言检查通过。活动 fork 为 49 项登记差异，原始归档和清单未改。完整日志 `/tmp/youdub-refactor-draft-final-tests.log`、`/tmp/youdub-refactor-draft-final-build.log`。
- 重启时后台尚未完成模型文件核对，初始占位状态会显示 0/4 和待下载。首启页现对 `starting` 显示校验状态，文件核对完成后才显示模型进度；相关首启 16 项测试及 web 类型检查通过。
- 旧 3087 开发实例与本次实例共享构建目录；确认旧目录没有任务后停止旧进程，冷切换到新候选，避免构建中逐文件 HMR。这是本次验收操作，前述 HMR 生命周期问题尚未关闭。Mac 当前仍锁屏，原生退出、保存框及其他 P0/P4/P7 检查继续保持待验收。
- `0cc8a83f` 的[远端 CI](https://github.com/liuzhao1225/YouDub-webui/actions/runs/39659820813) 在 Harness 集成检查中失败：两个测试首次 `require('electron')` 均触发官方包的按需下载，worker 执行时读取到解压中的 Framework（dyld 报 `segment '__TEXT' load command content extends beyond end of file`）。当前 Electron npm 包在 `index.js` 检测路径不存在后同步启动 `install.js`，两个测试进程之间没有共享准备边界。Harness 测试的 npm `pretest` 现先执行该包自带 `install.js`，完成后再启动并行测试；安装失败直接终止，不重试、不跳过测试。后续候选 CI 单独验收。
- 上述准备顺序调整后，本机 `npm --prefix apps/harness test` 为 66 passed，包括真实 Host、私有 worker、profile/插件生命周期、模型门控及退出协议。干净 runner 的首次安装仍需以新候选 CI 为准。

## P0/P6 依赖裁剪前复核（7630c4a3）

- 以当前正向组合、CLI、Desktop、Desktop Host、Web 及共享 Web runtime 为入口，按 workspace manifest 的 dependencies、optionalDependencies、peerDependencies 递归得到 310/362 个包。该数字表示声明的安装依赖闭包，不表示 310 个插件已启动。其余 52 个包还需核对编译、生成及测试消费者，不能直接据此删除。机器分析暂存 `/tmp/youdub-refactor-declared-closure.json`。
- CLI manifest 仍有 86 个直接依赖，包括旧 Agent/Office/实验产品包；Desktop Host manifest 也保留 Office、账号、workspace 声明。已完成的启动装配解耦没有自动清理这些安装依赖。裁剪时必须一起核对 CLI 的 profile/插件命令入口、Desktop 的 runtime manifest 和包管理 anchor。
- `api/remotes/src/client/index.ts` 仍实际挂载 26 组生成的 Remote contribution；当前 YouDub 客户端和设置只声明 credentials、settings、llm、pluginManager、pluginInventory、pluginRegistryProbe。未使用的账户、Goal、Agent/Session、终端和 Office 的 Remote 接线仍需裁剪。设置与凭据同属 settings-controller contribution，不能按 namespace 数直接删除生成包。
- 同包保留 39 项 devDependencies，包含类型重导出与生成合同；Host 的 forwarded-event allowlist 仍包含旧产品事件。裁剪需要同时核对客户端实际调用、事件消费者、Typert 生成输入及类型导出；现有全量编译会继续依赖尚未退役的客户端源文件。此部分保持待做，不把正向组合或来源校验误报成完整裁剪。


## P6 首批 Remote 与旧入口裁剪（2026-10-22）

- 按实际调用将 `api/remotes` 的 Client 运行组合从 26 组 contribution 收窄到 5 组：Settings Controller、LLM、Host Plugin Inventory、Plugin Manager 和 Plugin Registry Probe。共提供当前需要的 6 个 namespace。原 Gateway/Connection、生成 schema、注册顺序及卸载逻辑继续复用。
- 账号、Agent/Session、Goal、Office、终端、聊天反馈与在线市场 Remote 不再由应用默认注册。旧 Client 源码仍参与全量编译，其 type-only 导出及 Host 事件名单暂留，完整源码和安装依赖裁剪继续待做。
- 原 built Remote 验收文件未被常规测试收集，且引用旧 `client.js` 产物、缺少现有 WebSocket 升级路由。现进入常规测试，使用当前 browser 产物及真实 HTTP/WebSocket；Goal 仅由测试显式安装，验证额外能力可通过原机制注册和撤回。验证应用六个 namespace 存在、无关 namespace 不存在、卸载后全部撤回。
- 删除无调用者的旧 `prepare-youdub-app.mjs`。该入口依赖 primary-runtime 并会组装、签名开发 App，已不属于当前源码开发路径；其历史源码保留在 Git 基线，未操作任何已有 App 或用户数据。
- 同构建模式下，`api/remotes/lib/client.js` 从 1,083,920 字节减少到 152,973 字节。这只表示该未压缩 JS 产物缩小，未推导全应用体积、启动或推理性能收益。
- 上一候选 `7630c4a3` 的[源码开发 CI](https://github.com/liuzhao1225/YouDub-webui/actions/runs/39661750639) 已全部通过，包括干净 runner 的 Electron 准备与并行测试。当前裁剪候选另行检查；两份飞书文档仍留到全部改造和验收后更新。
- 本批框架 7 个构建 gate、Remote 7 项测试、Harness 66 项集成测试及来源/组合检查通过。实际页面验证设置和模型读取；通过官方 PluginManager 安装本仓库 file-transform 样例、启用、点击其注入页面的计数按钮、停用并卸载。启用时导航出现，停用后撤回，卸载后仅保留 YouDub 内置插件。样例没有写入任何用户任务；截图 `/tmp/youdub-refactor-plugin-mounted.png`。同时通过通用设置将测试 profile 改回中文，验证 settings 写入与语言事件。


## P6 第二批：产品依赖与唯一源码运行（2026-10-22）

- 删除 Desktop Host 中已无消费者的 Office 组合、账号 session 发布及旧桌面 CLI；保留还被历史打包工具引用的 Office engine helper，未将其宣称为完全删除。Host 仅输出 index；框架 Desktop bundle 仅输出 YouDub 使用的 app preload，旧 main、欢迎页和其他 preload 不再生成。
- CLI 运行依赖从 86 项缩至 10 项；Web runtime 的实际实现依赖与历史全量 Web profile 夹具依赖分开。旧 profile 夹具仍是开发依赖，后续随原组合测试一并裁剪。
- 原 development-project helper 现在只链接产品 patch、实际 Host 外部导入及 workspace 依赖闭包，不再遍历整个 hoist 目录。运行目录从 362 个框架包缩至 80 个；不含 Office、DeepSeek 账号、ACP、实验或终端包。仍有 Agent/Session 等声明依赖待解除，源码仍编译 362 包及 325 个客户端产物。
- Desktop Host 的安装解析锚点改为 YouDub runtime project 的 manifest。浏览器开发入口也直接启动该 Host，并传入同一应用 pnpm；不再通过旧 CLI 产品依赖集合获得框架服务。
- apps/harness 移除全部 `@deepseek-ai/*` npm 发布依赖，锁文件条目 820 → 142，保留依赖版本没有变化。集成测试导入改用当前 source-build，并在 pretest 校验源码/构建；临时 profile 的正常缺包失败检查保留。原 360 份 npm tarball 全部哈希校验通过。
- 真实测试曾发现缺少 YAML/undici 等直接外部依赖，以及 profile 解析仍锚定旧 CLI。已分别按真实构建外部导入链接依赖、改用产品 manifest 后修复，未恢复全量 hoist。
- 既有隔离验证 profile 的 node_modules 元数据仍为 pnpm 10，使用应用 pnpm 11 安装扩展时报 `ERR_PNPM_UNEXPECTED_STORE`。已明确重建该测试 profile 的依赖链接，manifest 与用户 patch 哈希不变；未修改原 Harness 账号或通用 pnpm 配置。
- 本地框架七个构建步骤通过，66 项 Harness 集成通过；原 Desktop 相关用例 55 通过，1 项 Windows 路径大小写用例在 macOS 跳过。另在全新 `.cache/harness/source-build-p6-20261022` 中完成七步构建，70.62 秒；旧 Desktop main、欢迎页、账号 preload 与 Host CLI 产物不存在。此时间仅记录本次构建，不与增量构建比较。实际页面完成本地 JS 扩展安装、启用、页面计数 0→1、停用后导航消失、卸载后只剩内置 YouDub；截图 `/tmp/youdub-prune-plugin-mounted.png`。原生 UI 仍经工具确认锁屏，未记为通过。

## P3–P4 首启目录选择与密钥展示（2026-10-22）

- 首启新增语言、安装目录和原生文件夹选择入口，使用原 LanguageProvider、Harness locale 设置及已有目录选择 preload。确认前不创建媒体数据目录、不启动 Python 或模型下载。选择的目录通过官方 Settings volatile 字段保存；私有 Python、四模型、缓存和任务文件从该目录派生。检测到既有 runtime/models/tasks/database 的安装继续使用原路径，不自动搬迁。
- 环境页面需要先于 Worker 激活，以等待目录选择。真实 Host 回归捕获了未声明 `youdubWorker` 依赖的错误；环境任务现通过原 Cordis `inject` 获取 Worker 后运行原 EnvironmentSetup，未绕过依赖检查或另建进程执行器。
- 原生新 profile 已显示安装设置并通过控件切换为日语，locale 写入读回为 `ja`。Mac 已解锁。多个并行会话同时使用同一 Electron 开发程序，自动化无法稳定选择指定实例；真实文件夹框、日语退出确认仍待独占目标窗口后验收。另一会话的侧栏和程序图标修改保留，未将其界面测试模式记为环境就绪。
- 独立浏览器 profile 通过实际页面切换中文、输入已准备的 YouDub 私有目录、确认、检查四模型并进入模型配置。停止并重新启动同一 Host 后，选择的路径和中文保留，不再显示目录选择页，依赖和四模型重新检查。新 profile 没有默认账号或模型提供商。本轮复用已有验证目录中的模型文件，不声称重新下载了约 6.97 GB 资源。[安装页截图](evidence/refactor-installation-choice.png)
- API Key 独立摘要行及自建 preview 路由/组件已删除。官方 Credentials describe 增加显式选择的掩码投影，默认元数据响应保持原状；完整密钥只在 Host 解析。原编辑器以 placeholder 显示前六位加 `***`，短密钥全部遮挡，input value 为空，没有已保存密钥的展开按钮；复制、剪切、拖动输入内容均被阻止。显示出的前六位仍能被截图或读取，不能承诺显示文字本身无法获取。
- 在上述独立 profile 的真实页面填写无效测试密钥、回环测试 URL 和模型，保存后重新编辑、重启后再编辑，均显示占位 `youdub***`。测试未调用外部 LLM，不代表提供商可用性或翻译质量验收。[密钥页截图](evidence/refactor-api-key-inline-mask.png)
- 原生旧版在日语界面下仍显示中文未保存提示，取消后表单与 Host 留存。活动 fork 已补齐日语退出/编辑/诊断文案及 locale 解析，相关单元检查通过；修改后的原生提示尚未完成实际交互验收。
- 本批相关框架用例 14 文件、401 passed；首启前端/控制器 3 文件、24 passed；web 类型检查通过；修复依赖后的 Harness 集成 66 passed。中英日 646 项业务语言键及 7 个框架语言空间通过。来源检查确认原 Harness checkout、两份源码快照、YouDub 初始快照和原归档未变；活动 fork 为 87 项登记差异。共享工作区仍有其他会话编辑，完整候选 CI 另行记录。
- 上一提交 `40a0f753` 的[源码开发 CI](https://github.com/liuzhao1225/YouDub-webui/actions/runs/39713973929) 已通过。本批仍属于开发改造；没有打包、发布或合并到 main。完整源码裁剪、业务及跨平台验收未完成，两份飞书文档按约定最后统一更新。


## P6 第三批：原生账号入口与 Desktop 框架边界（2026-10-22）

- 从活动源码删除旧 Harness main、原生登录/欢迎页、Platform 账号视图及其专属开发启动器、素材和测试。Desktop 包只保留框架模块与应用 preload，产品入口继续是 `apps/harness/src/desktop-product.ts`；未修改不可变归档和初始 YouDub 快照。
- 从原 welcome transport 保留 Web 认证、关联请求校验和语言读取，改为 `desktop-settings.ts`。应用 preload 不再暴露 `dshOnboarding`/`dshPlatform`，Host IPC 拒绝已退休的 `platform-session`。首启与模型配置继续走 YouDub 页面及原 Settings/Credentials 服务。
- 删除欢迎页的 React/Vite 等六项直接开发依赖和独立 Client 编译面，锁文件未升级保留依赖。首次构建指出旧强制更新策略仍需 `deepseek-account` 的请求头与类型；该编译依赖保留并列为后续裁剪项。实际产品入口和 80 包运行目录不加载账号包。源码范围仍为 362 包，未宣称全量裁剪完成。
- 旧 main 删除后，三个直接复制的窗口/菜单代码块继续按原始归档提取的哈希校验；`native-blocks.json` 绑定原始提交和 main 文件哈希。产品构建重新生成 renderer/resources/node-bin，避免删除素材后旧产物残留。
- 在独立 staging 中完成七步框架构建，并在默认开发目录构建当前源码。最后一次七步构建 42.52 秒，属于增量运行；未据此推导性能改善。相关模块 10 个测试文件、130 项通过；真实 Desktop Host 的默认首启与显式界面测试模式 2 项通过。产物来源、原始档案及复制代码块检查通过。
- 原沙箱 preload 验收文件的 `.e2e.ts` 后缀不在常规 Vitest 收集范围；已迁入 `.spec.ts` 并加入 CI，移除旧欢迎页测试入口，要求真实构建产物存在。单独运行该用例通过。
- 首次实际 Electron 启动捕获产品组合的 `metadata is not defined`：语言桥接仍需要外层设置后端引用。已修正作用域并重建桌面主进程，重新启动同一 profile 后首屏正常。失败诊断保留在本机，未通过禁用插件绕过启动检查。
- 实际 macOS 验收：切换日语 → 原生文件夹框选择既有测试私有目录 → 回填并确认 → 检查四模型 → 进入空模型配置。退出并重新启动后，日语保持、目录步骤不重复；认证 API 读回 `installation.required=false` 且路径与页面选择一致。使用已有约 6.97 GB 模型，未重新下载、未调用外部 LLM。[目录选择证据](evidence/refactor-native-directory-ja.png)
- 日语模型编辑器输入仅含 ID 的测试草稿后，Cmd+Q 显示日语退出提示；取消后 ID 保留。随后通过原丢弃确认结束草稿、空闲退出，启动器返回 0；重启后可进入原 Logo/大标题工作台。[退出保护证据](evidence/refactor-native-quit-ja.png)、[工作台证据](evidence/refactor-native-home-ja.png)。macOS 系统文件框使用系统语言；日本语界面中的 MPS 探测详情仍有中文，继续列入语言验收。
- 另一会话的侧栏、图标和资源页面改动按用户要求保留。截图反映共享开发工作区；本批提交仅包含本任务文件与共享文件中的对应改动。上一提交 `ec186a9b` 的[干净 macOS CI](https://github.com/liuzhao1225/YouDub-webui/actions/runs/39718278958) 已全部通过。
- 仍待完成：旧更新/发行工具和其余未用包的源码闭包裁剪、完整媒体流程和历史数据回归、Windows 真实验收。两个飞书文档继续留到全部改造验收完成后统一更新；没有打包或发布。


## P6 第四批：旧 Desktop 发行链与更新耦合裁剪（2026-10-22）

- 沿 YouDub 产品主入口、官方应用 preload 和开发运行目录生成器检查静态/动态/类型引用。删除 432 个无关文件，包含旧更新协调器、账号依赖的强制更新策略、CLI 命令安装、安装器、签名/上传工具和专属素材/测试。原始归档保留。通用窗口输入保护继续由原快捷键与覆盖窗口测试验证；没有改写这部分成熟实现。
- 产品主入口和 preload 移除未使用的更新桥接、强制更新覆盖页和旧 shell 文档服务。官方通用设置本来支持缺少更新桥接，继续使用该合同。Desktop 包只提供 build/bundle 命令；没有配置更新源、制作安装包、签名或上传。
- 删除 updater、electron-builder、COS 等无消费者依赖和两个专属发行补丁；按实际导入将 app-boot、home-paths、shortcuts、atomic-write 列入运行依赖。离线更新锁文件，没有升级保留的依赖。移除 Desktop 对 deepseek-account 的编译依赖后，保留源码不再通过强制更新策略依赖账号包。
- 最新框架构建七项通过，35.70 秒为同机增量记录。产品构建通过；活动源码 9348 个文件、362 个包，仍编译 325 个 Client 产物，产品运行闭包为 80 包。包级源码与其余旧入口的裁剪尚未完成，不能把本批文件删除数当成功能覆盖率。
- 保留 Desktop 全目录测试：31 文件，302 passed；1 条 Windows 路径大小写测试按原平台条件在 macOS 跳过。首次全目录运行发现旧 MCP 默认组合断言失效；该旧产品测试随组合退休删除。YouDub 现有 profile 测试明确检查 MCP、账号、Agent 等条目不加载，并通过本批真实配置/Host 集成共 9 项回归。开发 CI 改为执行整个保留 Desktop 测试目录。
- 构建输入、沙箱 preload、三个原样窗口/菜单代码块、原始 Harness 归档及 YouDub 初始快照校验通过。产品构建和来源检查按框架构建、运行目录准备、收据记录、收据验证顺序完成。早期并行验证在新收据尚未写入时报告旧收据不匹配；保留该失败日志，依序验证后通过。
- 实际 macOS Electron 使用独立 profile 重新启动，既有日语和私有安装目录保留，环境检查后进入原 Logo/大标题工作台。打开通用设置正常，显示 YouDub 0.0.7，没有旧更新入口；通过原生菜单空闲退出，启动器返回 0。[原生设置证据](evidence/refactor-native-settings-no-updater.png)。本批没有调用外部翻译/TTS，不代表完整媒体流程验收。
- 另一会话的主题、反馈、图标及资源改动继续保留，本批提交只包含上述裁剪和必要共享文件片段。上一提交 `1bdc0980` 的[干净 macOS CI](https://github.com/liuzhao1225/YouDub-webui/actions/runs/39720813051) 已通过。其余源码、全功能及跨平台验收继续留在计划中；两份飞书文档仍按约定最后统一更新。


## P6 第五批：原 YouDub 桌面壳与根开发入口（2026-10-22）

- 引用检查确认旧 Swift/WKWebView、C#/WebView2 壳只被旧平台构建和发行脚本消费；当前 Electron 的图标仍使用 `apps/desktop/icon.svg`，因此保留该文件。删除 12 个旧壳文件、12 个专属构建/签名/安装测试与版本校验脚本，以及旧 `ci.yml`、`windows.yml`、`release.yml` 共 27 个文件。它们可从裁剪前提交 `711e40e8e69d2c6f2065f15aecc90550dcbf695d` 恢复；初始 YouDub bundle 和原 Harness 归档校验通过，`main`、`atomgit` 未修改。
- 根 `build:desktop` 改为 `build:youdub` 的别名；`start` 与 `dev` 继续进入同一 Electron 启动器。移除 `build:mac`、`build:windows`、旧安装测试和发行测试命令。根与锁文件的 Node 条件统一为框架要求的 `^22.19.0 || >=24.0.0`。官网 Pages、下载列表生成器和 3 项下载合同测试保留，并把后者加入源码开发 CI。
- 中英文 README、桌面资源说明、开发指南与发行说明统一指向当前源码开发流程。旧操作说明通过固定提交链接保留，历史平台验收记录保持原样。旧 Host/Web 根仍被部分领域测试与组件对照消费，本批没有删除这些测试依赖，也没有宣称开发入口清理全部完成。
- 实际执行根目录 `npm run build:desktop`，依序完成 Host/Client/Electron 构建、组合边界检查和 `desktop.mjs --prepare-only`。缺失旧壳不影响当前产品生成；构建保留原有 esbuild CSS side-effect 和 Node register 弃用警告，无构建失败。删除路径扫描未发现剩余活动脚本引用；根命令、engines、锁文件和复用图标校验通过。额外 YAML 检查首次误从根解析未声明的 `yaml` 包而失败，随后使用框架已锁定的 `js-yaml` 完成两份保留 workflow 解析校验。
- 从根 `npm start` 启动同一隔离 profile，原生 Electron 完成环境检查并进入日语工作台，原 Logo/大标题保留；其他会话的主题、反馈、GitHub 入口和资源改动共存。页面明确显示翻译服务未配置，本批未运行媒体/翻译任务。
- 上一批 `711e40e8` 的[干净 macOS 源码 CI](https://github.com/liuzhao1225/YouDub-webui/actions/runs/39722654418) 已通过。本批没有打包、签名、发布或合并到 main。其余源码闭包、全功能和 Windows 验收继续保留在计划中；两份飞书文档仍在全部改造与验收完成后统一更新。
