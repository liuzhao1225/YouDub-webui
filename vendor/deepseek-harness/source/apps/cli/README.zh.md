# YouDub Desktop 的 profile 运行器

本包作为私有框架库保留 `runProfile` 和进程退出管理。Desktop Host 解析应用自己的 profile 后传给运行器，由原实现组合配置、启动 Cordis 服务、应用启动环境，并在失败或退出时释放资源。

本分支已移除公开的 `dsh` 命令及 Agent、ACP、SDK、headless、旧 Web 产品的专属场景。YouDub 显式初始化 profile 和 bundle 列表，框架不再隐式选择 Harness 产品模板。

产品从仓库根目录 `npm start` 启动。本包测试覆盖实际使用的 profile 启动、失败清理与进程退出。插件安装和配置继续由 Harness PluginManager、app-boot 服务管理。原始实现可从不可变源码归档和 Git 历史恢复，保留源码沿用上游包名与许可证。
