# YouDub 的 Harness 子集

来源为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的公开 tag `dsh-v0.2.1-rc.2`，提交 `687f282e8625c6b8d11ff58211a90524be2e4317`。机器可读信息见 [upstream.json](upstream.json)，许可证见 [source/LICENSE](source/LICENSE)，声明见 [source/THIRD_PARTY_NOTICES.md](source/THIRD_PARTY_NOTICES.md)。

这里只维护 YouDub 使用的源码、共享组件、构建工具和相关测试。完整上游仓库、逐文件上游快照和差异清单不随产品同步；本地生成目录和迁移截图不进入 Git。变更历史由 Git 记录。

当前保留 70 个源码包：62 个链接到桌面运行项目；另有 6 个共享前端包直接编入 Web/业务 bundle、1 个桌面源码包提供窗口与 preload、1 个 Typert 生成器负责构建。准确包表与使用方式见 [保留范围](../../apps/harness/docs/FRAMEWORK-SCOPE.md)。

构建：从仓库根运行 `npm run build:framework`。源码复制到忽略的 `.cache/harness/source-build`，依赖安装和产物生成均在该目录。构建收据只记录当前输入，防止运行陈旧产物，不再要求保存全部上游原件或更新重复的文件哈希账本。

保留框架的窗口、布局、主题、组件、Loader、插件管理、鉴权、设置和模型服务；YouDub 自己提供媒体、任务与工作流。聊天、会话浏览、Agent 执行循环、目标、计划、定时任务、终端面板、内嵌浏览器、文档预览、插件市场和历史会话迁移已移除。上游发布、文档、覆盖率及全仓规则检查也已移除。

新增代码优先复用保留的组件和服务。引入新依赖时说明当前产品用途，并一起更新包声明和实际产品验收。
