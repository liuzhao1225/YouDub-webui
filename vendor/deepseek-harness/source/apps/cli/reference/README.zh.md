# Profile 启动器参考

[English](README.md) | 中文

此私有包提供 YouDub Desktop Host 使用的 profile 启动器。产品入口为 YouDub 仓库根目录的 `npm start`。原公开 `dsh` 启动命令及随附的 Agent、Web、headless、SDK 和 ACP profile 已从此 fork 退役。

## Profile 启动

[`runProfile`](../src/profile-boot.ts) 接收应用已解析的 profile、安装锚点、冻结的启动环境、叠加配置路径、应用参数和包管理器上下文。YouDub 在调用启动器前准备自己的私有 profile。传入 `resolvedProfile` 后跳过按名称初始化 profile 的流程。

启动器创建空的根配置和运行时包解析映射，再将 profile 的组合包层及配置补丁交给 [app-boot](../../../packages/boot/app-boot/README.zh.md)。它在挂载配置树前提供 `profileContext`、启动环境、插件包解析和应用参数。启动完成且根节点活跃、Loader 服务可用后，才提交应用就绪状态。

## 环境与失败

启动器在挂载插件前，根据传入的启动环境快照安装出站代理处理。启动失败时释放应用树和代理资源，并重新抛出原始错误。清理同时失败时，聚合错误保留两种失败。面向用户的启动报告由桌面应用负责。

## 进程退出

[退出控制器](../src/process-shutdown.ts) 为应用清理提供五秒时间。正常完成时记录请求的退出码。第一次信号启动清理，第二次信号强制退出。`SIGTERM` 的退出码为 0，`SIGINT` 为 130。本包保留的测试覆盖 profile 启动、失败清理和进程退出。

## 插件管理

YouDub 的扩展界面使用保留的 [PluginManager](../../../packages/boot/plugin-manager/README.zh.md) 和 app-boot 服务，并传入自己的 profile 与包管理运行时。本包不再暴露公开的插件安装命令。原启动器及其参考文档保存在不可变的上游源码归档和 Git 历史中。
