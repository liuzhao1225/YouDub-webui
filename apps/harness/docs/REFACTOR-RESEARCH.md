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


本批提交 `f43fdf84` 的[干净 macOS 源码 CI](https://github.com/liuzhao1225/YouDub-webui/actions/runs/39723763577) 已通过，包括保留的框架设置/桌面生命周期、领域/界面/多语言、Harness 集成与 Python 媒体合同。

## P0/P6 下一批裁剪前的引用复核（f43fdf84）

[引用清单](evidence/refactor-framework-dependency-audit-20261022.json)基于当前 80 个运行包，加上 Desktop 构建包共 81 个根，从实际源码 import/export、类型导入和已声明 dependencies 追踪。362 个源码包中，144 个进入运行/类型闭包；把这些包内测试和辅助脚本的静态导入计入后扩大到 228 个，另外 134 个暂列候选，尚未删除。

这份静态清单不构成删除许可：`PROFILE_TEMPLATES`、`DEFAULT_PROFILE_BUNDLES`、`OPTIONAL_BUNDLES` 仍以字符串引用旧 ACP/headless/SDK 和实验 bundle，原生 addon 也存在平台动态选择。下一批先核对这些产品配置、根构建脚本、devDependencies、TypeScript references，以及旧产品测试对 Agent/聊天/终端的间接依赖，再删除源码和同步编译范围。当前 Electron 已通过产品显式 bundle 启动；测试里的旧默认组合不能作为保留全部旧产品模块的依据。


## P6 第六批：profile 启动库与旧 CLI 产品组合（2026-10-22）

- `apps/cli` 保留原 `profile-boot` 和 `process-shutdown` 实现及其回归；删除独立 `dsh` 命令、参数处理、CLI 配置导出，以及专属于 ACP/headless/SDK/Web 产品的场景。包改为私有启动库，编译入口只生成 `profile-boot.js`。YouDub 继续通过 Desktop Host 启动显式的产品 bundle。
- 清空默认 profile 模板、默认/可选 Harness 产品 bundle 与 Claude Code/Codex 目录。保留 profile 读取、插件安装、patch、Loader 和退出生命周期。已保存的 bundle 选择原样保留，缺失 profile 显式失败；不自动生成旧产品配置。
- 官方目录生成器继续复用，允许产品提供空目录；目录和安装器测试改用测试专属插件。真实安装测试使用包自身声明的 pnpm 11.28.5，避免依赖已删除的 Desktop 工具目录或机器的全局 pnpm 版本。保留依赖版本未升级。
- 删除根 CLI/Web 开发入口、相应帮助生成器及其测试，清理 18 个指向已退休 Desktop 打包/上传脚本的根命令；入口与产品使用检查改为实际 Desktop Host 根。原始 Harness 归档校验通过，初始 YouDub 清单不变。
- 新 staging 完成七步源码构建；构建输出中没有旧 CLI `bin.js`。首次回归的 20 项失败及第二轮的 3 项失败保留在本地日志；修正测试夹具命名、原产品断言、pnpm 路径与自定义命令优先级后，安装器 96 项回归通过。完整候选回归与实际 Electron 读回结果在下方补记。
- 静态运行/类型闭包仍为 144 个包，计入包内测试后由 228 降至 221；源码仍有 362 个包和 325 个客户端构建产物。本批没有宣称完成源码裁剪。旧 Python SDK、Office/Agent 场景、根旧 Host/Web 入口和剩余构建范围继续列入 P6，不能用本批结果替代全功能验收。

候选框架回归：68 个文件通过，6,347 项通过，2 项按平台条件跳过。原应用入口与目录生成检查通过。完整 `verify-product-use` 仍报告 257 条未归属运行使用的模块：该检查还未接入仓库外层的 YouDub 产品 patch，同时确有待裁剪的旧产品模块；此失败保留，P6 后续需接入实际产品组合并逐项核对，不能把测试夹具通过等同于全仓使用闭包通过。

当前产品构建、composition 与构建来源收据通过。共享工作区集成 72 项通过，包含另一会话新增的资源测试；该测试最初因 Node 原生 TypeScript 剥离不支持参数属性失败，现复用已有 onboarding 测试的 `tsx` 注册方式加载，资源业务源码未因此改写。此新增测试及其他会话的界面/资源管理变更保留在工作区，不纳入本批框架提交。

同一私有 profile 的实际 Electron 重启后仍为日语，进入原版 Logo/大标题首屏；[桌面首屏](evidence/refactor-profile-prune-home.png)、[扩展页](evidence/refactor-profile-prune-plugins.png)已留证。扩展页仅显示 YouDub 内置功能，模型页没有默认账号或提供商，通用设置显示 YouDub 0.0.7。该验证 profile 未配置翻译服务，界面明确阻止开始工作流；本批未进行外部 LLM 调用，不计为完整媒体流程验收。

本批提交 `84504e04` 的[干净 macOS 源码 CI](https://github.com/liuzhao1225/YouDub-webui/actions/runs/39728001077) 已全部通过，覆盖源码构建、官方设置与桌面生命周期、profile/插件生命周期、领域/界面/语言及媒体合同。实际 Electron 正常退出（进程返回 0）后再次启动，同一 profile 恢复日语工作台。未打包、发布或合并到 main。

### 下一批使用检查调研（基于 84504e04）

临时复用原 `verifyProductUse` 实现，加入 `apps/harness/cordis.patch.yml` 及 Host、Client、Desktop 产品源码入口后，识别出 70 个直接运行包、595 个源码模块。检查仍有 212 条结果：207 个包未发现运行使用，另有 5 条要求已退休 ACP/headless/SDK/Web profile 的旧规则。此试验没有改动活动源码或检查规则；剩余结果不能视为删除许可。下一批需要把显式产品配置正式接入检查器，替换旧产品 profile 假设，再结合类型、测试和平台动态依赖核对。

保守的源码/声明依赖闭包仍为 144 个包，计入包内测试后为 221；另外 141 个候选中，有 59 个仍被保留包的 devDependencies 引用，其中 53 个来自 `packages/bundle/web-app`。该包同时承载通用 Web 运行服务和旧聊天产品 patch/presets；应保留前者，逐项拆除后者及其专属测试依赖。其余 root scripts、TypeScript references、旧 Python SDK 和根 Host/Web 入口继续留在 P6。

## P6 第七批：以实际 YouDub 组合驱动框架检查（2026-10-22）

- 原产品使用分析器新增显式 `--patch` 与 `--entry` 参数，根命令 `npm run check:framework-use` 读取 YouDub 的实际配置与 Host、Client、Desktop 入口。仍复用原 AST 归属、配置合成、禁用项和源码遍历；移除强制存在 ACP/headless/SDK/Web profile 的旧产品规则。缺文件与无法解析的配置继续明确失败。
- 框架全客户端测试通过 `DSH_TEST_PRODUCT_BUNDLE` 读取已准备的 YouDub bundle，不再隐式加载 `dsh-base` 和旧 `dsh-web-app` 组合。通用 bundle 读取、依赖闭包、并行客户端、连接错误、重载、卸载及清理测试保留；旧账号/聊天场景按产品范围替换为设置、语言和测试专属侧栏的验证。业务 UI 继续由产品集成测试覆盖。
- 修正实际组合暴露的两条旧启动顺序依赖：布局不再等待 Session，通用设置不再等待旧聊天侧栏。设置侧栏槽仍由产品拥有，测试明确提供槽声明并验证销毁和恢复。类型层仍需要的旧侧栏合同暂时保留，后续随合同归属一起整理。
- 锁文件只删除四条工作区链接，没有升级保留依赖。原始 Harness 归档、初始 YouDub 快照和其他会话的侧栏/资源管理变更不在本批修改范围。
- 第一轮全测试工具回归暴露四处旧产品假设，修正后通过 12 个文件、125 项测试，另有 1 项既有预期失败。源码构建随后发现 Node 测试工具误用浏览器限定的环境类型，已改用 `node:process` 并让测试包仅启用 Node 环境声明；产品浏览器声明不变。

最终源码构建七个步骤通过，产品构建、实际组合与源码来源收据通过。设置、桌面生命周期、布局及完整客户端测试工具共 86 个文件通过，1,179 项通过、1 项既有预期失败、1 项按平台条件跳过；共享工作区产品集成 72 项通过。正式产品使用检查仍返回 207 个未发现运行使用的包，保留失败状态继续核对类型、测试和动态依赖；不能据此直接删除。该批开发版已启动，Mac 锁屏阻止了新的原生界面读回，已请求解锁；上一批截图不计入本批验收。

提交 `9765291f` 对应的本地 profile、插件生命周期及分析器回归补记：37 个文件、6,047 项通过，1 项按平台条件跳过。两组框架回归合计 123 个文件、7,226 项通过，2 项平台跳过、1 项既有预期失败。该数字不包含 72 项产品集成，也不代表完整媒体流程通过。

下一批的只读 AST 调研：`web-app` 的 3 个服务源码与 4 个通用测试仍需要静态文件挂载、连接令牌、公开 URL、浏览器交接和启动参数处理；135 条开发依赖中有 131 条未被这 7 个文件直接引用，多数服务于旧聊天/Agent/Office 组合。裁剪前须同时处理其 `dsh.bundle.patch`、4 个 agent preset、4 个专属场景及文档转换夹具，核对 `verify-runtime-closure`、`verify-default-product-isolation` 和 agent-preset 测试的旧路径，不能只删依赖声明。`surfaceContext`/`DSH_WEB_URL` 是仍残留的 Agent shell 接线，YouDub 配置已关闭，适合随旧组合一起移除。测试工具已脱离该旧组合，可继续复用其服务回归。

该下一批调研也实际运行了两个旧根检查器：`verify-default-product-isolation` 在空 `PROFILE_TEMPLATES` 上直接失败；`verify-runtime-closure --manifest apps/desktop-host/package.json` 仍强制装入旧 Agent preset，并输出误指 Python SDK 的标题。这两项尚未适配当前产品，失败日志已保留；需与旧 Web 配置删除一起修正检查入口和测试，不能把当前源码构建/选定回归通过解释为全仓架构检查已通过。

`9765291f` 的[干净 CI](https://github.com/liuzhao1225/YouDub-webui/actions/runs/39732051353) 在源码构建后失败：客户端测试要求的 `dist/desktop/runtime-project/youdub-plugin/package.json` 由桌面启动生成，构建本身不生成；本地之前启动过桌面，因而遗漏了这个前置条件。修正新增 `test/prepare-framework-client.mjs`，直接调用现有 `prepareSourceDevelopment` 和 Harness `prepareDevelopmentProject`，在独立 `.cache/harness/framework-client-project` 准备同一产品组合；CI 在框架测试前显式调用一次。预加载器只读取该测试项目，缺失时继续报错；无需启动窗口、修改用户 profile 或回退到旧 Harness bundle。

新的独立测试项目首次准备后，同一组 86 个文件、1,179 项回归通过，既有预期失败和平台跳过各 1 项。原生运行项目与用户 profile 未被测试准备过程重建；本地测试无需先启动桌面。干净 CI 待新候选完成后补记。

## P6 第八批准备：产品隔离检查入口（2026-10-22）

原 `verify-default-product-isolation` 已加入显式应用配置和源码入口，根命令为 `npm run check:framework-isolation`。允许框架的 profile 声明为空，仍拒绝缺失声明、动态定义和非空但不完整的声明；预设随被选中的 bundle 读取，未选中的旧 Python SDK 不再自动成为产品安装根。实验包别名、传递依赖、运行导入、配置和缺失文件检查继续保留。应用源码位于框架包目录外时，也会检查其直接框架引用。

新增和保留的 168 项回归通过。源码构建七个步骤、产品构建、组合检查和来源收据通过；实际隔离检查通过，覆盖 230 个包、1,920 个源码文件、6 个配置及 33 个组合插件。该检查确认实验模块隔离，使用闭包检查仍有 207 个候选待核对。旧 Web 组合、旧 SDK 与构建范围仍待清理，本批没有删除它们。

干净客户端准备修正 `1b71947f` 的 [CI 全部通过](https://github.com/liuzhao1225/YouDub-webui/actions/runs/39733412573)。第八批提交 `0db73d72` 的 [CI 也全部通过](https://github.com/liuzhao1225/YouDub-webui/actions/runs/39734913128)，包含源码构建、框架与 profile 回归、领域、界面、语言、产品集成和媒体基础检查。

## P6 第九批：保留通用 Web 服务，移除旧产品组合（2026-10-22）

- 保留 `packages/bundle/web-app` 的静态资源、WebServer、Connection、启动就绪、公开 URL、浏览器交接和清理实现。移除旧聊天/Agent/Office 组合 patch、4 个 Agent preset，以及只验证这些退休功能的场景与文档转换夹具。通用服务的 4 个测试文件继续运行。
- 删除已关闭的 Agent shell 接线 `surfaceContext` / `DSH_WEB_URL`，产品不再传入该选项。包的开发依赖从 135 条降为 3 条，保留 11 条运行依赖；锁文件删除 396 行，没有升级保留依赖。
- 运行依赖检查改为读取实际准备的 YouDub runtime manifest，认可其固定版本依赖。旧 SDK preset 检查保留为显式选项及对应测试，不再默认混入当前产品。根命令 `npm run check:framework-runtime` 与 CI 使用同一产品准备过程。
- 原始归档、初始 YouDub 快照和其他会话的资源/界面修改保留。源码改动登记在 fork ledger；在全新生成目录完成七个源码构建步骤后，才将该生成目录提升为当前开发产物。

实际运行项目闭包从 80 个框架包降为 75 个。实验模块隔离检查覆盖从 230 个包、1,920 个源文件、6 个配置，降为 89 个包、710 个源文件、1 个配置；组合仍有 33 个插件。源码使用检查继续明确失败，保留 207 个候选待审查；全源码编译仍包含 362 个包、325 个客户端产物，不能据此宣称整体裁剪完成。

本批框架/profile/插件/Web 服务和检查器回归共 43 个文件、6,271 项通过，1 项平台跳过。首次产品集成暴露 profile 测试夹具仍把旧 Web 服务当作产品 bundle 复制；夹具改为使用当前 YouDub bundle，并保留旧前缀迁移、用户配置与插件移除验证。修正后 7 项 profile 测试、完整 72 项产品集成通过。双语文档配对、产品构建、实际组合、运行依赖、隔离与来源收据检查通过。

开发版已用新产物启动，Host 宣告本机监听且启动日志无错误；Mac 锁屏仍阻止本批原生界面读回。进程启动不计作原生验收，完整真实媒体与跨平台验收仍保持待完成。

第九批提交 `0fcb8584` 的[干净 macOS CI 全部通过](https://github.com/liuzhao1225/YouDub-webui/actions/runs/39736911885)，包含实际运行依赖闭包与本批保留的 Web 服务测试。

## P6 第十批：共享侧栏插槽类型脱离聊天侧栏（2026-10-22）

通用设置与插件管理原先为取得 `sidebar.settings`、`sidebar.toggle.badge` 和 `sidebar.panellist` 类型，引用旧聊天侧栏。三个共享插槽的类型现由既有布局包拥有，具体应用侧栏继续通过原注册机制声明并渲染它们；运行时授权与插槽生命周期不变。删除两条开发/TypeScript 引用及插件管理的旧侧栏启动顺序依赖，保留现有设置与插件组件和原侧栏测试。

使用原生成器刷新插槽目录，也纳入此前设置离开保护和移除默认引导的已登记合同变更。三组双语 README 同步更新；配对检查发现几条指向未复制上游文档的旧链接，已换成现有组件文档或删除无效引用，未补造外部说明。

源码构建七个步骤通过，139 个文件的设置、布局、侧栏、插件管理、客户端测试工具和目录生成器回归通过：1,697 项通过，1 项既有预期失败。产品集成 72 项通过；产品构建、组合、来源收据、75 包运行闭包和 89 包实验隔离检查通过。CI 已纳入本批触及的原测试。保守静态运行与类型闭包从 143 降为 142 个包，计入包内测试仍为 221；该分析用于下一步依赖审查，不代表测试专用包应立即删除。Mac 仍锁屏，本批没有新增原生交互验收。

## P6 第十一批：移除旧浏览器 Worker 预览构建（2026-10-22）

Electron 使用的 `apps/web/src/main.ts` 与原 Web 客户端运行时继续保留。移除额外的 Worker preview 入口、HTML 注入器、preview 构建/服务命令及专属验收场景；预览并非 YouDub 支持的部署方式，其 packer/runtime 源码仍待下一批清理。独立启动提示改为仓库根的 `npm start`。Web 资源分块、字体许可、唯一 React 实例、公开构建变量及实验依赖隔离实现保留。

锁文件通过现有 pnpm 离线刷新，只删除 156 行，无依赖升级。构建七个步骤通过，客户端产物从 325 降为 320；检查实际 Web 输出，保留 `index.html`，没有 `preview.html`、preview 目录或旧 bootstrap 入口。保守静态运行与类型闭包为 141 个包，计入包内测试为 218。两个 Worker 包均未被该闭包引用，仍需处理脚本和测试清单后才能删除。

Web 输入隔离、浏览器第三方依赖与产品隔离共 225 项回归通过。额外执行构建环境原测试时，发现它仍读取已退休的上游发布 workflow；改为由现有产品测试预加载器提供实际 YouDub 开发 CI 路径，缺配置仍失败，保留环境与产物收据断言。修正后该文件 8 项通过，产品集成 72 项通过。产品构建、组合、75 包运行闭包、隔离与来源收据通过。

开发版已重新启动，私有 profile 的 Host 在系统分配的本机端口监听，启动日志无错误。当前 Mac 锁屏继续阻止原生交互，本轮不把启动日志作为界面通过证据。

第十批 `358c082c` 的 [CI 失败](https://github.com/liuzhao1225/YouDub-webui/actions/runs/39738449265)：Vitest 将 `packages/client/ui-sidebar` 按子串匹配，同时选入未修改的文档预览等同名前缀模块；PDF 许可归档测试在干净 runner 中执行全局 `pnpm`，报 `spawnSync pnpm ENOENT`。文档预览模块未引用本批迁移的类型，已将 CI 筛选精确到 `packages/client/ui-sidebar/`。原侧栏测试全部保留，完整目标测试组重新通过 101 个文件、1,521 项，既有预期失败和平台跳过各 1 项。该修正及第十一批仍须在新 CI 候选验证。

修正与第十一批已包含在 `c9f58a91`，其[干净 macOS CI 全部通过](https://github.com/liuzhao1225/YouDub-webui/actions/runs/39740210645)。

## P6 第十二批：删除退役浏览器 Worker 源码（2026-10-22）

第十一批移除唯一产品入口后，保守运行/类型与包内测试闭包均不再包含 `webworker-runtime` 和 `webworker-packer`。剩余引用全部来自构建、发布和测试清单；本批删除两包的 174 个文件，同步清理 TypeScript references、别名、平台排除、覆盖率豁免、应用入口与历史会话夹具清单。原源码归档和初始 YouDub 快照校验通过，保留其恢复入口。

锁文件由现有 pnpm 离线刷新，移除两包和仅被它们使用的依赖；保留依赖没有升级，剩余的 `@noble/hashes@2.4.0` 恢复为可选依赖。全新生成目录的七个源码构建步骤通过，源码包由 362 个降至 360 个，客户端产物由 320 个降至 319 个；提升为开发目录后重新构建及产品构建通过。运行闭包仍为 75 包，实验隔离仍为 89 包、710 个源文件、1 个配置、33 个 Web 插件；来源收据和 72 项产品集成通过。

扩展执行九个原测试文件：480 项通过、19 项失败，另一个历史会话语料文件在加载阶段失败。用删除前的第十一批生成目录复测四个失败文件，失败名称逐项一致：17 项缺少未复制的上游文档/规范或旧 README 结构；1 项仍要求旧 CLI 公开发布；1 项仍要求旧官方发布目录；历史语料依赖未复制的顶层 `snapshots/`。这些失败保持可见，留在剩余 P6 的旧发布/文档/语料归属整理中；没有降低断言或增加跳过来得到通过。本批直接修改的入口、顶层 await、覆盖率分区、构建门禁和夹具布局五个文件共 303 项通过，已将新增检查范围加入开发 CI。

解锁后的旧开发窗口曾报告 `renderSlot('root') before any 'root' registration`，刷新又报告旧 revision 模块加载失败；已保存原始崩溃日志。当前新构建重新启动后首屏与设置可见，设置显示产品版本 `0.0.7`。原生表单已保存非真实凭据，重新编辑只显示 `ydtest***` 占位；右键 Copy、Cut、Select All 均禁用，无独立已保存密钥行。中日语言切换与日语模型页通过。该读回只覆盖当前界面与测试凭据，真实媒体、完整生命周期和跨平台验收继续保留。

并行开发窗口多次打断通用 Electron 实例的自动化，因此使用已安装 Electron 的独立开发副本 `com.youdub.framework-validation` 绑定本轮窗口；继续加载同一源码构建和私有测试 profile，未执行打包或发行。该实例中原生语言切换写入 `locale.preference: ja`，原生退出返回 0，再启动后日语首屏与设置保持；测试提供商和掩码也跨重启保留。编辑测试密钥后原生退出显示日语未保存提示，取消后草稿仍在；随后经确认丢弃草稿，并删除本轮创建的测试提供商及非真实密钥。旧窗口错误在该独立实例中未复现，未据此推断旧错误的根因。验收图片位于本机 `/tmp/youdub-p12-isolated-japanese-key.png` 与 `/tmp/youdub-p12-japanese-home.png`。

本批提交 `1ac1c1bc` 的[干净 macOS CI](https://github.com/liuzhao1225/YouDub-webui/actions/runs/39743707732) 已通过，包含来源检查、源码构建、框架与业务回归。首次查询因 TLS 超时中断，重新查询确认成功，未重新构建候选。

## P4/P7：内置工作流多语言与原生文件往返（2026-10-22）

原生日语验收发现工作流列表已经翻译，但编辑器标题和边界端口仍显示内置 JSON 的中文。复用现有字典与工作流工具函数，统一列表、编辑器、画布、输入输出面板、连线来源和运行表单的默认名称。只识别内置模板 ID 及其原始默认名称；自定义名称和用户保存的工作流保持原文。保存内置副本时写入当前显示名称，原模板不变。

四个受影响组件测试文件共 59 项通过，包含日语显示、语言切换、自定义名称保持与保存副本；TypeScript、三语言字典和 Electron 开发构建通过。本机 Node 26 的原生 Web Storage 造成现有 jsdom 测试访问 `localStorage` 失败，切换到产品自带的 Node 24.21.0 后全部通过，未修改业务逻辑或放宽断言。

在独立 Electron 验收窗口通过设置选择日语，打开「字幕＋吹き替え」，核对画布与输入输出面板，然后保存副本。macOS 原生保存框默认文件名为 `字幕＋吹き替え · コピー.workflow.json`；保存到 `/tmp/youdub-native-japanese-workflow-20261022.workflow.json` 后读取实际文件，确认 8 个节点及「動画 / 吹き替え動画 / 吹き替え音声 / 原文字幕 / 翻訳字幕」。正常退出返回 0，重启后日语与副本仍保留；通过原生打开框导入同一文件，名称与输出保持一致。截图：`/tmp/youdub-workflow-japanese-labels.png`、`/tmp/youdub-native-workflow-roundtrip.png`。本项覆盖工作流定义的文件往返；完整媒体运行和跨平台验证仍待完成。

## P6 第十三批：移除旧 SSH 远程执行模块（2026-10-22）

从实际 Desktop 运行清单重新追踪语法层 imports、类型导入、相对路径、动态导入和包内测试，SSH 连接、远程文件、远程沙箱、远程子进程、SSH helper runtime 五包均不在运行/类型及保留测试闭包中，也没有其他包的导入边。本批删除该组及专属构建、验收、发行工具的 83 个文件；同步删除编译、类型等价、文档、包策略和旧 SSH 发行测试清单。通用 worker 启动和运行闭包测试保留，夹具改用通用私有 worker 路径。

锁文件只删除五个 importer；其他 importer、外部包版本和依赖快照逐项未变。全新目录七项源码构建通过，随后开发目录构建与产品构建通过。活动源码为 355 包、8,909 个文件，源码 SHA-256 为 `f4bfb754cc98368a0550670fc22928df27f2c6c466bd36382e7e52a420a67808`，客户端产物仍为 319 个。

旧工作区约束仍要求已收敛为内部 profile runner 的 CLI 包公开发布；修正其发布归属后保持 `private: true`、声明文件清单和实验依赖隔离检查。发布属性与依赖边界分别判断，保留原有禁止实验依赖的断言。相关七文件 269 项测试全部通过，内部启动器和通用 worker 启动回归加入开发 CI。

实际 Host 集成 72 项通过；运行闭包为 75 包，产品隔离为 89 包、710 个运行源文件、1 个配置和 33 个 Web 插件。重新准备运行目录并记录本次来源收据后，基线检查通过；原始源码归档 SHA-256 仍为 `3ea8bedf096c4fff74379dce01d95b48b27b2a05f9c0ae7431f3e9ba6fa80c85`。日志位于本机 `/tmp/youdub-ssh-prune-*.log`；未执行应用打包或发布。剩余旧 SDK、Agent 与构建工具继续按消费者审计，不根据目录名称批量删除。

提交 `96028d9e` 的[开发 CI](https://github.com/liuzhao1225/YouDub-webui/actions/runs/39750830763) 首次运行已通过全部源码构建、框架、领域、前端和媒体合同检查，最后的构建证据上传因 GitHub 存储域名 `ENOTFOUND` 失败。显式重跑同一提交后，后续提交 `d2f630b4` 触发分支并发策略，重跑被取消；不能将该 run 记为完整成功。后续 CI 需重新确认构建证据上传。

后续提交 `d2f630b4` 的[干净 macOS CI](https://github.com/liuzhao1225/YouDub-webui/actions/runs/39755195918) 已全部通过，包括最终的构建证据上传。该提交包含第十三批裁剪和此前工作流多语言修复；下文的设置跳转修复尚需其后提交的独立 CI 结果。

## P4/P7：原生 zoo 实验、审核持久化和设置跳转（2026-10-22）

在独立 Electron 窗口中，通过模型表单输入原 YouDub 的火山方舟地址、已有凭据、模型与 65,535 输出上限。没有直接写入测试 profile 的配置文件，也没有复制旧应用账号数据。经 macOS 原生文件框选择 zoo 视频，运行内置「字幕＋配音」八节点流程；Demucs、Whisper、翻译、VoxCPM2、混音和导出全部完成。运行时原生退出弹窗提示任务将中断，取消后窗口及任务继续运行。播放器实际走到 `0:18 / 0:18`；通过原生保存框导出译文 SRT，与任务产物字节完全一致。[本次实验记录](evidence/refactor-native-zoo-review.json)

自动结果仍保留 tiny 识别错误，例如把 `trunks` 识别为 `arms`，未将流程成功解释为字幕或配音质量合格。该默认图没有 Qwen 节点。随后在原生画布编辑流程副本，关闭识别、翻译的自动下一步，并添加 Qwen Forced Aligner、连接四个输入及导出节点的词级时间轴；画布校验通过。沿用原素材重跑时，识别结果进入人工确认，下游审核未被复用结果绕过。待审核状态下正常退出返回 0；重启后同一 Host 的认证 API 读回仍为 `paused`，识别为 `awaiting_review`。Mac 随后再次锁屏，原生恢复、人工修订确认、Qwen 实际执行及最终音画质量保持待验收。

实际操作发现首页「配置服务连接」打开了通用设置。YouDub 导航现在将模型分区交给原设置入口；Harness 的 `openSettings(sectionId?)` 复用原 shell store 的 `openSection`，普通侧栏入口仍打开默认分区。对应分区显示、焦点、关闭后默认入口与目录生成回归 54 项通过，双语文档配对通过；七步框架构建、产品构建、73 项共享工作区 Host 集成、组合及来源校验通过。原生跳转读回因锁屏尚未完成。活动源码 SHA-256 为 `0c370dea6592783e4c2664c990d15e203f36ffc787758ebe9ab03bce322005ab`，355 包、8,909 文件、319 个客户端产物；原始归档未变。

本轮原生截图：`/tmp/youdub-native-zoo-auto-completed.png`、`/tmp/youdub-native-zoo-awaiting-review.png`。操作日志和构建检查位于 `/tmp/youdub-settings-route-*.log`。共享工作区中的其他资源管理改动继续保留；飞书文档仍在全部改造与验收后更新。

## P6 后续 SDK 批次的消费者审查（2026-10-22，尚未删除）

在 `98f417a7` 重新运行语法层依赖追踪：355 个活动包，79 个根，运行与类型闭包 141 包，计入包内测试 218 包，闭包外 137 包。`sdk-app`、`sdk-minimal`、`sdk/client`、`sdk/protocol`、`sdk/server` 与 `subagent-claude-code`、`subagent-codex`、`subagent-dsh-sdk` 共八包均不在保留闭包中；合为一个候选集合后，没有集合外包的运行、类型或测试导入。静态结论只用于确定下一批边界，尚未执行该批删除。追踪记录为本机 `/tmp/youdub-current-package-closure.json`。

| 后续对象 | 当前消费者与处理边界 |
| --- | --- |
| Harness TypeScript/Python SDK、三种外部 Agent 集成 | 118 个包内文件及 Python SDK 专属目录；需要同时移除编译、工作区、入口、包策略、默认插件目录和专属发行清单。仓库自己的 `packages/sdk`、Python 媒体后端与私有解释器继续保留 |
| SDK 单文件构建、资源暂存、smoke 与快照 | 专属工具随 SDK 退出；先区分共享的 primary-runtime wheel/hash 检查与 SDK 平台清单测试，保留通用断言 |
| `verify-runtime-closure` | 当前产品 CI 显式传入 manifest，通用传递依赖及 required/optional peer 检查继续使用。Python SDK 默认 manifest 与旧 preset 模式需要随 SDK 删除一起解除，不能删掉产品仍在用的检查器 |
| 第三方声明生成 | 移除 Claude Agent SDK 专属发行说明及 Python SDK 的 pyproject 收集路径；保留现有 LLM 提供商使用的 Anthropic SDK，以及仍有消费者的 bundled-Python 声明、npm 许可检查与原版权信息 |
| 旧公开 CLI 依赖目录 | `scripts/dependency-catalog` 属于历史发布目录，并非当前运行依赖；与对应生成脚本、测试及 rescope 排除条目一起核对。原始归档已经保留其历史字节 |
| 插件管理、安装测试与示例名称 | 产品只投影 YouDub 和用户安装包；原管理组件仍含旧 SDK/Agent 分类。删除相应分类时保持安装、启用、错误、核心保护与卸载行为测试，合成夹具可改用仍存在的通用包名 |

下一批退出条件仍包括完整源码构建、实际产品运行闭包、来源差异账本、保留测试与开发 CI。不能用本表将 SDK 清理或整体 P6 标为完成。

## P7：原生校对恢复与独立验收窗口（2026-10-22）

解锁后保存原文订正出现 `PLUGIN_VERSION_UNAVAILABLE`，原始失败保持记录。旧任务固定的七组 Python 执行指纹与 `96028d9e` 源码一致，当前 Host 与当前源码一致；执行指纹涉及的文件中，`d2f630b4` 只修改了 `backend/app/accelerators.py` 的安装源 URL。经审查在既有 `builtin-compatibility.json` 登记这两个确定版本的兼容关系，未来源码变化仍使本次映射失效，未放宽任务版本检查。相关五项既有回归、产品构建及来源检查通过。重启后，同一原生任务成功保存识别订正版本 2 并确认，依赖该结果的翻译、参考音频、配音、混音、对齐与导出结果失效并重新执行。

用户要求另开窗口避免同时操作：建立独立 `com.youdub.review-validation` 开发实例，配置、私有安装目录和 Chromium 数据均使用 `.cache/harness/native-review-isolated-20261022` 副本；任务库通过 SQLite 在线备份取得一致快照。独立实例中译文订正已保存为版本 3 并确认；原窗口读回仍为修订号 14、译文等待确认，证明数据隔离。该副本随后完成九节点流程：VoxCPM2、混音、Qwen3-ForcedAligner-0.6B-hf 与最终导出均实际执行；Qwen 原始结果含 3 个音频片段，输出 6 条字幕，时间范围与顺序检查通过。播放器走到 18.9 秒，macOS 保存框导出的 `/tmp/youdub-native-zoo-reviewed-20261022.srt` 与任务产物逐字节一致。正常退出返回 0，重启后原生页面显示 9/9 完成及四个文件；截图 `/tmp/youdub-isolated-review-after-restart.png`。该结果是已暂停任务副本的接续，准备媒体与分离结果被复用。音频试听和音画同步质量仍未验收。

「连接设置」已在原生窗口直接打开模型分区，关闭后普通设置按钮仍打开通用分区；截图 `/tmp/youdub-isolated-settings-model-route.png`。设置修复对应 `fa0e76ee` 的[干净 macOS CI](https://github.com/liuzhao1225/YouDub-webui/actions/runs/39758629485) 已全部通过。

## P6 第 14 批：SDK 与外部 Agent 裁剪（2026-10-22）

在 `04cbf740` 重查后执行上述八包的删除，共移除 228 个活动源码文件；355 包收敛为 347 包、8,681 文件。TypeScript/Python embedding SDK、三种外部 subagent、专属单文件构建与发行工具、SDK 快照以及旧 npm 发布目录退出活动树；原始源码归档的 SHA-256 仍为 `3ea8bedf096c4fff74379dce01d95b48b27b2a05f9c0ae7431f3e9ba6fa80c85`。YouDub 自身的 `packages/sdk`、Python 媒体业务与私有环境保持原有归属。

同步移除了管理组件的旧分类、工作区与编译条目、专属许可证例外及说明。`verify-runtime-closure` 现在要求显式指定 manifest，继续验证必需 workspace peer 和传递依赖；产品 CI 已显式传入实际运行项目。通用插件管理、安装、许可证拒绝、会话夹具检查和 bundled-Python 声明继续保留。语法层追踪的 79 个根、141 包运行/类型闭包、218 包含测试闭包均未扩大，没有指向被删包的保留包导入。

为避免影响用户正在操作的窗口，源码构建使用 `.cache/harness/source-build-sdk-prune-20261022`。七项框架构建全部通过，319 个客户端产物保留；15 个定向测试文件共 932 项通过。首次定向回归发现测试夹具使用了错误的保留包名、通用门禁期望漏项及已退役载体的版本断言，修正后完整重跑通过；原失败日志保留。活动源码 SHA-256：`b8f6a54d1542c37898bb3d3286ddca2dc8b315d2ba998798c786d8f11e937bce`。

独立 `com.youdub.review-validation` 使用本批框架、原已验证业务 bundle，实际打开原版首页、扩展、通用/模型设置和 zoo 任务。Host 的 75 个 workspace 包运行闭包成立，78 个源码包链接均指向新构建。原任务仍为修订 38、9/9 完成及四个产物；macOS 保存框再次导出的 353 字节 SRT 与前次结果一致，SHA-256 为 `d2c1581332142a7b518e622260b1a863962fc1635bf8168a711b5277a9455c78`。本批没有重新执行媒体链或进行试听，不据此扩大质量验收结论。

[结构化证据](evidence/refactor-sdk-prune.json) 记录构建、测试、运行来源和本机截图。前一批安装源兼容与原生九节点记录随 `04cbf740` 的[macOS CI](https://github.com/liuzhao1225/YouDub-webui/actions/runs/39763710459) 已通过；本批分支 CI 尚待提交后验证。整体 P6 及 P0–P7 剩余矩阵继续开放，两份飞书文档仍按用户要求在全部完成后更新。
