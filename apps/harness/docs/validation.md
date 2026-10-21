# YouDub × Harness 融合验收

2026-10-21，分支 `codex/harness-youdub-integration`。旧字幕 POC 验收见 [POC-validation.md](POC-validation.md)，不代替本分支验证。

## 当前证据

- YouDub 冻结快照 `f6f927903581b165f2bf6c840ea65b896d319524`，POC `4967caf782e96bfdf9d586406ef45733f6775323`；原始源码、Git bundle、Harness 安装 app 均已保存，详见 `../baselines/sources.json`。
- Harness 公开源码 `687f282e8625c6b8d11ff58211a90524be2e4317` 原样纳入 vendor，共 362 包、9,817 文件。独立读取官方归档，逐一核对 vendor 和开发构建目录的原始文件内容、执行位与链接，全部一致。见 [source-integrity.json](evidence/source-integrity.json)。
- 暂存到 Git 后再次核对 9,817 个文件的 blob 字节、可执行位和符号链接，全部与原始归档一致，见 [source-index-integrity.json](evidence/source-index-integrity.json)。下载节点和默认模板合并后的最终 vendor 复核仍通过，报告 `/tmp/youdub-final-download-vendor-integrity.json`。
- 官方完整 `scripts/build.ts --scope artifacts` 的 native、Host 编译/打包、Desktop 打包、Client 编译/打包和 Web 编译共 7 步全部通过。此处 bundle 指源码编译产物；本轮不生成应用包或安装包。
- 当前开发入口 `npm run dev` 直接运行仓库 Electron，窗口为 YouDub。CLI、Host、preload、Web 和官方插件均选用完整源码构建结果，开发依赖视图核对 362 个官方包的真实路径。浏览器 3087 和 Electron 均已启动。见 [source-development.json](evidence/source-development.json)、[四模型首启界面](evidence/source-development-model-selection.png)。
- 历史空 `desktop-first-run` home 完成 Python 3.12.15、私有 venv 与 base 安装；解释器不使用系统 site-packages。随后原生测试仅选择 Whisper，完成准备并进入 LLM 配置和工作台。该单模型初始化不满足用户后来明确要求的完整四模型门控，保留历史证据，不能记作完整首启通过。
- 当前首启要求原清单中的四模型和全部相关依赖就绪；移除模型子集选择，旧 Whisper-only 状态被实际门控拦截，见 [桌面完整模型门控](evidence/desktop-required-model-gate.json)。独立 Web home 的四模型准备已完成，15 个模型文件与运行时资源逐个校验通过，见 [四模型准备](evidence/four-model-first-run.json) 和 [暂停恢复](evidence/model-pause-resume.json)。桌面使用已校验的独立普通文件副本与自己的 venv，见 [桌面资源复制](evidence/desktop-private-resource-copy.json)；原生界面点击“准备全部模型”后，原准备流程安装全部缺失依赖并完成最终验证：四模型、六项资源要求均就绪，`phase=ready`、`prepared=true`，`pip check` 通过，15 个模型文件与 4 个运行时文件的大小和 SHA-256 校验通过。Python 与全部已测依赖路径位于桌面自己的运行目录，未复制 venv、建立跨目录链接或手写就绪状态，见 [桌面完整首次准备](evidence/desktop-full-first-run.json)。资源准备与完整媒体处理链分别验收。
- 通用设置应用版本 0.0.7，无代码工作视图、会话字号项和 DeepSeek API Key 开场引导；模型配置使用官方服务/组件。空配置首启无默认 DeepSeek 账号/提供商。随后按用户要求读取原 YouDub 配置作为输入，在原生页面填写火山方舟 URL/API Key，获取模型列表并保存 `doubao-seed-evolving` 与 65,535 输出上限，重开编辑器确认配置持久化。没有直接写入新应用配置文件。见 [页面配置证据](evidence/source-native-model-configuration.json) 与 [配置截图](evidence/source-native-model-configured.png)。
- 已保存密钥通过官方提供商卡片插槽显示前六位与 `***`；官方编辑器仍只写新值。原生重启、关闭设置再打开均核对成功，完整密钥未出现在可访问性文本，见 [掩码验收](evidence/source-native-key-preview.json) 和 [实际界面](evidence/source-native-key-preview.png)。
- 浏览器主色计算值 `rgb(255, 0, 51)`；原首屏大标题、输入框、动态图标逐项对照源页面。
- 插件界面使用 vendor 原 PluginManagerPage、controller、stores；显示真实内置应用版本与插件包版本，不虚构已发布的市场插件。
- 真实 zoo 视频完成 Connection 上传、FFmpeg 预处理、Whisper tiny 识别 3 段，修改 `long arms` 为 `long trunks` 后保存仍暂停；Host 重启保留 revision 2。人工确认后继续，FFmpeg 导出视频及原文/译文 SRT，下载校验通过。翻译使用明确标记的本地 HTTP fixture，仅验证官方协议和工作流，未验证外部翻译质量。见 [字幕工作流](evidence/subtitle-workflow.json)，产物在 `.cache/harness/backend-acceptance/evidence/`。这次任务发生于全源码开发启动切换前，最终开发运行复测另列。
- JavaScript、Python 和图工作流三种测试插件实际通过官方安装、执行、禁用、启用和卸载；最后 inventory 中测试插件均已移除。见 [插件生命周期](evidence/plugin-lifecycle.json)。
- 全源码开发运行再次创建真实 zoo 任务 `f3cbb9fe-2452-4c17-9572-a887d7672677`：真实 FFmpeg/Whisper 得到三段原文，第二段订正为 long trunks 保存 revision 2；原生界面编辑第一段并点击保存生成 revision 3，任务保持待确认。重启后 revision 3 和历史修订均保留，原生界面确认识别，再确认明确标记的人工测试译文，真实 FFmpeg 导出 MP4 和双 SRT。视频实际播放到 14 秒，节点音频播放到 19 秒。翻译 fixture 未调用外部 LLM。见 [人工订正](evidence/source-development-subtitle-correction.png)，下载哈希及版本记录位于 `.cache/harness/native-subtitle-acceptance/`。
- 原生图编辑器实际打开节点完整设置、触发未保存保护并继续编辑、保存模板副本、回到列表读回副本、打开运行面板；未配置翻译服务时原因保持可见。当前真实翻译配置已通过页面完成。

- 原生页面导入原格式 9 节点工作流，上传 zoo-en.mp4 后真实完成 Demucs → Whisper → 火山方舟翻译 → VoxCPM2 → 混音 → Qwen 对齐 → 导出。调用上限 65,535，输出 MP4、WAV、双 SRT；实际播放至 11.9 秒，双 SRT 经原生保存框保存并与 HTTP 产物哈希一致。见 [完整媒体链](evidence/source-native-full-dubbing.json)、[真实翻译](evidence/source-native-real-translation.json)、[界面验收](evidence/source-native-full-dubbing-ui.json)。播放发现原低分辨率字幕长行裁切，首次产物保持原样。随后以显示换行补丁再次从原生页面运行完整 9 节点任务 `6d898822-3e81-4df2-8e38-1979a05a7efe`，全部完成；长句实际视频帧完整分成两行且没有左右裁切。下载 SRT 与烧录 display SRT 的编号、时码和去换行文字逐条一致，见 [修复后完整链](evidence/source-native-full-dubbing-cjk.json)、[字幕换行核对](evidence/source-native-cjk-subtitle-fix.json)、[成片画面](evidence/source-native-full-dubbing-cjk-frame.png)。这轮证据仅验证同一 cue 内换行，未恢复原 YouDub 分句；该补丁已按用户后续要求撤回，分句恢复的验收另列。识别准确率仍单独保留限制。

- 按用户要求直接复制生产 YouDub `utils.py` 的 `split_sentence_by_punctuation()`，原函数逐字/哈希一致；中文使用原规则，末尾不足五字保持独立。接入适配只将原函数输出映射回完整原文，Qwen `word_cues` 保持冻结源原样。两轮历史真实词时码重放从 3→4、4→5 条字幕，“这很酷”分别为 12.060–12.620 秒与 12.680–13.240 秒，全部边界来自原 Qwen 词时间。见 [原分句来源与重放](evidence/source-original-sentence-split-replay.json)。原翻译提示词四条标点规则也逐字复制并仅用于中文目标；官方适配器实际请求的规则文本 SHA-256 与来源相同，65,535 上限和段 ID 保持，见 [翻译规则来源](evidence/translation-punctuation-source.json)。

- 原分句恢复后的第三轮原生任务 `01bbba6b-c230-436f-b0e0-ad7fe7890fc7` 全部9节点成功，3个原翻译/配音单元得到6条独立SRT字幕，原Qwen词时间重放与最终输出逐条一致。实际外部请求包含逐字复制的四条标点规则；MP4 742507B、WAV3635180B、原文SRT281B、译文SRT371B，摘要、Range与音轨来源检查通过。原生播放器实际播放到17秒；8.5秒长片段与11.5秒短尾片段的真实视频帧分别显示完整字幕，无左右裁切。没有生成display换行文件，见 [完整媒体产物](evidence/source-native-full-dubbing-sentences.json)、[分句与成片验收](evidence/source-native-sentence-split.json)、[实际翻译请求](evidence/source-native-real-translation-sentences.json)。

- 在原生运行面板输入 YouTube zoo 链接和本机 HTTP 代理端口 7897，沿用原 `youdub.download` 节点连接完整媒体链。真实任务 `874d381f-4750-459a-aa07-ebb1c435715a` 全部 10 节点成功；原下载文件 533931 B，最终 MP4 745386 B、WAV 3635180 B、原文 SRT 285 B、译文 SRT 340 B。下载节点配置、固定执行绑定和原生输入均读回 7897，5 条译文字幕及 56 个 Qwen 词时码留存，真实请求仍为 65,535 上限。最终重启后原生播放器实际播放到 14 秒，2 秒长句和 12.1 秒短句的成片帧均完整。见 [下载节点与代理](evidence/source-native-youtube-download-node.json)、[完整媒体链](evidence/source-native-youtube-download.json)、[页面输入](evidence/source-native-youtube-proxy-input.png)、[原生播放](evidence/source-native-youtube-download-ui.png)。B 站仅有原下载实现及代理合同回归，本轮未作公网实测。

- 默认“字幕翻译”和“字幕翻译（人工审核）”合并为一个字幕翻译模板；保留字幕翻译、视频配音、字幕＋配音三种业务流程。原生列表读回三个默认模板，识别和翻译节点可分别取消“自动下一步”，页面显示完成后暂停等待确认；临时编辑通过撤销恢复，没有创建额外模板。两个原用户工作流保留，前一完整任务的 graphSnapshot、plan、nodeRuntimeInputs 与 outputs 均与运行前记录一致。见 [默认模板合并](evidence/source-native-merged-workflows.json)、[旧任务读回](evidence/source-native-youtube-download-node.json)。

## 自动检查

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| Harness 原生边界、四模型门控、密钥摘要、profile、文件响应及复制的翻译规则回归 | 52 通过，0 失败 | `/tmp/youdub-download-harness-tests.log` |
| 原领域后端回归 | 169 通过，1 项 Windows 跳过 | `/tmp/youdub-backend-domain-regression.log` |
| Python 媒体回归 | 226 通过；本轮原分句、导出及对齐专项 71 通过 | `/tmp/youdub-media-python-regression.log`、`/tmp/youdub-original-sentence-regression.log` |
| 下载节点 Python / 图合同 | 29 / 8 通过 | [代理合同](evidence/download-node-proxy-contract.json) |
| 下载配置前端 / 旧配置入口 | 51 / 1 通过 | `/tmp/youdub-download-proxy-frontend-tests.log`、`/tmp/youdub-download-proxy-localize-tests.log` |
| 合并模板 / 旧默认模板迁移 | 15 通过 | `/tmp/youdub-merged-workflow-tests.log` |
| Web/根 TypeScript | 通过 | `/tmp/youdub-download-proxy-web-tsc.log`、`/tmp/youdub-download-proxy-root-tsc.log` |
| SetupGate/Controller/TranslationSetup | 26 通过 | 前端记录 |
| 原前端全量回归 | 1 项源快照已有失败 | `graph-studio-draft.test.tsx:121` 期望检查次数 3、实际 2；冻结源同依赖下复现，保留源缓存语义 |
| 最终源码产品编译与组合边界 | 通过 | `/tmp/youdub-final-download-product-build.log`、`/tmp/youdub-final-download-composition.log` |
| 最终产物来源 | 通过 | `/tmp/youdub-final-download-build-integrity.json`；362 个官方包来自源码构建，325 个客户端构建文件、2 个原版 preload |
| 初始源码与原安装应用 | 全部保持原样 | `/tmp/youdub-final-source-baselines.json`、`/tmp/youdub-final-original-desktop.json` |

## 已修问题

- 旧 Host 边界测试曾假定 Whisper-only 标记可直接进入 ready；四模型硬门控后该断言失败。测试现验证旧标记停在 models、缺失资源可见且业务路由保持 503；没有降低生产门控。随后本候选 52 项回归全部通过，首次失败日志 `/tmp/youdub-key-preview-harness-tests.log` 保留。
- 官方 Subprocess 要求 cwd，适配器为原 FFprobe 省略 cwd 的调用显式沿用原 Node 工作目录语义。
- 默认 Python 从依赖 cwd 改为 YouDub 私有路径；一次 YAML 表达式冒号解析错误已改为块表达式，官方配置导出通过。产品启动前直接用官方 parser 检查必需 bundle，失败停止并保留原诊断。
- 开发构建同时重写 Host 产物曾触发官方热重载，临时 404 保留可见错误；停止并发构建后语言切换正常，没有用自动重试掩盖错误。
- 官方插件安装会在 profile 追加 bundle；产品启动原先只接受恰好三个 bundle，阻断重启。现保留三个必需 bundle 的顺序校验，并允许官方追加扩展；7 项真实官方 parser 检查验证额外 bundle、依赖、用户 patch 不被覆盖。测试各用独立临时 profile，不再与活动启动目录竞争。
- 源码切换后，旧 pnpm lock 会在官方卸载操作中把 SDK 恢复到早期目录。产品 profile 现通过官方 `runPluginCommand` 同步发生变化的 link 依赖锁；实际 pnpm add/remove 回归以及真实官方两次安装均核对 SDK 继续指向源码运行时。同步失败保留原错误并停止启动。
- 原生保存框默认名曾为 `file`。YouDub 文件端点补回真实文件名的 `Content-Disposition`，保持 inline 预览、Range 和显式 attachment 下载；最终 Host 的 MP4/双 SRT HEAD 均读回正确文件名，自动合同覆盖中文与空格。解锁后已通过原生保存框保存 `reviewed.txt`，实际 67 B、SHA-256 `f9e6d0aed73453d255c5982e8671a3c30c566345d341a2dd38a105bb04951ade`。

## 仍在验收的边界

模型清单为 Whisper tiny、VoxCPM2、Demucs htdemucs、Qwen3 Aligner 0.6B，当前首次初始化四项全部必需。历史单模型截图仅表示旧验收状态。

Mac 解锁后，外部文本插件页面计数按钮从 0 变为 1；原生自定义校对界面编辑并保存 revision 2 后仍待确认，确认后导出 83 B 文本。两个测试插件均通过官方卸载，原生导航随之移除，SDK 与 lock 继续指向源码运行时。见 [插件原生验收](evidence/source-native-client-plugins.json)、[校对界面](evidence/source-native-plugin-review.png)。

2026-10-22 的活动 fork 已将 Node/pnpm 切换为仓库 Electron 的 Node 模式和锁定 pnpm，启动无需 `primary-runtime` 与 `office-skills` 副本。同一真实 Host 的浏览器页面已读回首页、历史任务与用户模型配置；原生 Mac 当前锁屏，本次窗口与完整媒体链验收仍待完成。旧 Office 源码和构建依赖仍待裁剪。详细证据见[本次改造调研](REFACTOR-RESEARCH.md)，路径见 [README](../README.md#启动与首次环境准备)。

`submodule/demucs` 已按原 Git 子模块流程初始化，固定提交为 `e976d93ecc3865e5757426930257e200846a520a`。完整实验统一使用 Demucs → Whisper → 翻译 → TTS → 混音与字幕导出，真实执行结果见上方完整媒体链证据，媒体准备与处理执行分别记录。

按用户当前范围，只验证源码开发运行；打包、签名、公证和分发不属于本轮工作。未进行 Windows 实机或公开发布验收。外部真实 LLM 与四模型已完成这次输入的处理链；本地输入的 Whisper tiny 把 trunks 识别为 arms；新下载的 YouTube 输入识别为 fronts，翻译分别沿用这些识别错误。模型质量与人工订正需求保留，不能声称任意输入的质量通过。

Windows 标题栏存在源码可确认的重复占位，尚未修复或实机验收：官方 `vendor/deepseek-harness/source/packages/client/ui-layout/src/client/AppFrame.module.css:26` 已给 `.frame` 添加 `padding-top: var(--dsh-windows-titlebar-height)`，同文件第 93 行又将 `--dsh-frame-top-clearance` 设为该高度；YouDub `apps/harness/src/style.css:26` 的 `.yd-main-chrome` 继续使用这一变量增加高度。macOS 官方框架仅定义 48px 安全区，产品占位一次。本轮仅收紧 Mac 任务详情页内容布局，未改上述 Windows 路径或 Harness 源码。
