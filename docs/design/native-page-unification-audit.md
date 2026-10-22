# 原生桌面 UI 验收记录

验收日期：2026-10-22 至 2026-10-23。页面编号沿用[页面清单](./page-map.md)。本次使用独立的 macOS Electron 客户端及用户目录，实际点击导航、控件和媒体播放器；保留原客户端及其中未保存的订正。截图位于 `output/validation/native-page-audit-20261022/`。

## 已检查的页面

| 页面 | 原生检查范围 | 截图文件 |
| --- | --- | --- |
| P01 工作台 | 链接、上传区域、参数、最近任务、资源提示 | 01-home.png |
| P02 任务库 | 列表和进入任务 | 02-tasks.png |
| P03 任务详情 | 生成文件、执行图、视频播放/暂停及时间推进 | 05-task-detail.png |
| P04 步骤详情 | 语音识别结果、输入、配置、日志、配音结果；音频定位 | 21-recognition-fixed-dark.png、22-config-fixed-dark.png、31-speech-results.png、38-clean-build-seek-second.png |
| P05 工作流库 | 模板、自定义工作流入口 | 11-workflows.png |
| P06 新建工作流 | 空白画布、添加节点 | 12-workflow-new.png、26-node-picker-fixed.png |
| P07 工作流编辑器 | 画布、输入/输出、添加节点、运行参数 | 25-workflow-io-fixed.png、32-workflow-run.png |
| P08 节点完整设置 | 识别节点设置与返回画布 | 27-node-configuration.png |
| P09 资源 | 环境/模型状态、展开诊断日志 | 04-resources.png、23-resources-diagnostics.png |
| P10 内置示例 | 列表、示例详情、深色主题 | 18-examples.png、20-example-zoo-dark.png |
| P11 扩展 | 插件列表、内置功能详情、添加插件弹窗 | 13-extensions.png、14-plugin-detail.png、33-add-plugin.png |
| 设置 | 通用、模型列表、添加服务商表单 | 15-settings.png、16-model-settings.png、17-add-provider.png |
| O01 安装设置 | 语言、安装目录及提交准备 | 35-installation-spacing-fixed.png |
| O02 环境与模型准备 | 真实 Python/uv 安装、进度、展开日志、模型选择 | 36-first-run-preparation.png、37-first-run-model-selection.png |

新增工作流和服务商表单仅检查交互布局，未保存配置；添加插件弹窗未执行安装。主页面使用测试跳过配置入口；首次安装流程另用独立目录，实际完成 Python 3.12.15 和 uv 0.13.0 的安装及基础依赖准备。

## 本轮修复及验证

- [共享页面布局](../../apps/web/src/components/page-layout.tsx)改用 `@container/page`。原 CSS Module 的容器名称被哈希，导致带 `/page` 的容器查询失效，识别结果与配置区域未按可用宽度排版。原生窗口已验证横向布局。
- [页面标题样式](../../apps/web/src/components/page-layout.module.css)统一标题、返回按钮和状态的垂直居中；使用共享布局，未对单页增加偏移补丁。
- [Harness 样式入口](../../apps/harness/src/style.css)补齐 `dl`、`dd`、`fieldset`、`legend` 的基础重置，修复工作流输入/输出区域的浏览器默认边框与缩进。
- [节点选择器](../../apps/web/src/plugin/builtin/workflows.tsx)统一项目间距与按钮内边距；[首次安装表单](../../apps/web/src/components/setup-installation.tsx)的标签改为块级，恢复标签与选择框的垂直间距。
- [识别结果](../../apps/web/src/plugin/builtin/workflow-task.tsx)的定位按钮改为“跳到此句”，同时保留带句子序号的可访问名称。
- [桌面请求转发](../../vendor/deepseek-harness/source/apps/desktop/src/web-document.ts)保留未压缩媒体响应的 `Content-Length`。此前无条件删除该头，导致原生播放器定位异常；压缩响应经 Node 解压后仍移除失效长度。Range 请求、206 状态和范围响应信息保持传递。

音频定位在原生客户端验证：第二句定位到 **4.7 秒**，第三句到 **16.7 秒**，回跳第一句到 **1.1 秒**。临时诊断记录了实际 `seeked` 时间；截图分别为 28、29、30。移除诊断代码后重新构建、启动，第二句再次定位成功，见[最终构建截图](../../output/validation/native-page-audit-20261022/38-clean-build-seek-second.png)。播放器可视时间按整秒显示为 0:04。

验证结果：Web TypeScript 检查通过；工作流任务测试 19 项通过；桌面请求转发测试 8 项通过；Harness 源码构建 7 个 gate 通过；`git diff --check` 通过。测试使用 Node 22；Node 26 自带 localStorage 与现有测试环境冲突，首次运行的失败未计为通过。

## 尚未验收的视图

1. 历史翻译节点缺少当前运行环境中的对应节点插件/服务（任务使用 `llm.youdub-ark`），页面仅能显示原始结果。本轮未验证完整翻译校对编辑器；截图 10 仅证明该阻塞状态。
2. O03 首次翻译服务配置须在环境和模型全部就绪后进入。独立首次安装目录停留在 4 个模型、约 6.97 GB 的模型准备阶段，未完成模型下载与推理校验，因此 O03 未验收。

本记录覆盖本地原生界面及上述交互，不构成发布包、线上发布或完整新任务处理链路的验收。以上两项保留待验收状态。

## 2026-10-23 页头与拖动复查

任务详情、步骤详情和工作流编辑器改为共享 `PageHeader`：返回、标题、状态同排，操作置于右侧；工作流名称通过铅笔按钮编辑。原生截图 `44-task-header.png`、`45-workflow-header.png` 记录宽窗口结果，窄窗口下名称编辑及 Escape 取消已检查。

原生画布平移、节点拖动触发撤销、撤销还原已检查。页头已声明 Harness 窗口拖动区域，实际计算样式为 `drag`，按钮和输入框沿用 `no-drag`。但原生自动化拖动新页头及原有侧栏拖动区域都未观测到窗口位移；窗口拖动行为仍待确认，不能据样式声明判定通过。临时诊断代码已移除。

相关工作流编辑器、步骤详情、任务详情测试共 39 项通过。

## 输入与输出配置拆分

已将合并的输入/输出面板拆分为独立面板，移除原生 fieldset 外框和重复分组标题，端口项改用简单分隔线。禁用状态直接传入共享控件；输入与输出边界节点增加对应“完整设置”入口。编辑器测试覆盖两类配置互斥显示、切换后保留编辑及本地化副本保存。

本轮原生界面复查被系统锁屏阻断；尚未通过原生视觉验收。新客户端 bundle 已放入独立验收目录，待解锁后重启验证。
