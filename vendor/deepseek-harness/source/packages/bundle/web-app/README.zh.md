# @deepseek-ai/dsh-web-app

[English](README.md) | 中文

YouDub Desktop 使用的 Web 运行服务。插件组合由应用定义；本包提供 Web 服务与启动参数解析。

## 运行服务

主入口通过 `dsh-host-frontend-static` 挂载编译后的前端，提供对外 URL，并在 Loader 就绪后输出带认证信息的地址、按配置交接给浏览器。`webApp` 服务提供 `getAdvertisedUrl()`。

`webServer` 负责监听与路由，`connection` 提供进程令牌。远程访问、信任与认证继续由原有服务负责。

## 配置

- `openBrowser`：启用浏览器交接；通过 SSH 启动时不打开浏览器。
- `printUrl`：启动就绪后输出带认证信息的地址。
- `publicUrl`：指定对外 HTTP(S) 根地址，并规范为尾部带斜杠的形式。该配置不改变路由或信任规则。

`./startup` 入口通过原命令行服务解析 Web 启动参数。YouDub 在自己的配置中选择这两个插件。

## 测试

保留的测试覆盖启动参数、公开 URL 校验、静态文件服务、监听暴露提示、Loader 就绪、SSH 启动判断和浏览器子进程清理。在准备好的框架工作区运行 `vitest run packages/bundle/web-app`。
