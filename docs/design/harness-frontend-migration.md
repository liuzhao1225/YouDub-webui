# 前端实现：React/Vite、运行逻辑与页面绑定

本次迁移在保留 YouDub 视觉设计、工作流交互和插件协议的基础上，参考 deepseek-harness 的前端分层。参考源码固定为 [`99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`](https://github.com/deepseek-ai/deepseek-harness/tree/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca)。实现按 YouDub 当前能力适配，具体边界如下。

## 参考与适配

| 关注点 | deepseek-harness 参考 | YouDub 实现 |
| --- | --- | --- |
| Web 入口 | [Vite 应用包](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/apps/web/package.json)、[外壳启动](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/client/web/src/boot.tsx) | React 19 + Vite 8；入口挂载准备流程和插件引导，页面由 Cordis Client 插件注册 |
| 独立状态引擎 | [runtime 快照 store](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/client/runtime/src/client/contract/store.ts) | 无 React 依赖的控制器管理查询、资源准备、更新检查与引导状态，使用 Zustand vanilla 保存快照 |
| React 订阅边界 | [web-react 快照绑定](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/client/web-react/src/bind.ts) | `web-react.tsx` 使用 `useSyncExternalStore` 连接 observable；`bindComponent` 在注册时捕获所需能力并注入 props |
| 动态插件与共享平台 | [共享平台入口](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/client/web/src/platform.ts)、[外壳边界](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/client/web/README.md) | 保留 YouDub 的 manifest + 原生 ESM 加载，import map 共享 React、Cordis 和 Client SDK，内置页面不静态打入入口 |
| 静态页面托管 | [Web 应用构建声明](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/apps/web/package.json) | Vite 输出静态文件，由 Cordis Host 的 `web` 插件同源提供页面和 API；桌面端复用该入口 |

保留现有 Tailwind CSS、Base UI、React Flow、图标、品牌色、排版、响应式布局与主题。工作流 URL、图文档、节点结果编辑和逐节点人工确认沿用现有契约。

版本与插件协议按 YouDub 的兼容要求选择：上游参考版本使用 React 18/Vite 6，YouDub 使用 React 19/Vite 8。上游的 `window.__DSH_BOOT__`、自定义模块传输、完整 store 中间件和聊天产品组件未引入；YouDub 继续使用 `/api/v2/client-manifest`、现有 Cordis 插件与 ESM 资源协议。

## 代码职责

```text
apps/web/src/main.tsx              Vite 页面入口和准备流程
apps/web/src/plugin/bootstrap.tsx  平台模块发布、Client 生命周期和根挂载
apps/web/src/plugin/loader.ts      manifest、ESM 加载、Cordis 激活与卸载
apps/web/src/plugin/runtime/       查询、资源准备、更新状态与行为
apps/web/src/runtime/onboarding.ts 基础环境和翻译引导状态
apps/web/src/plugin/web-react.tsx  observable 订阅与组件能力绑定
apps/web/src/plugin/builtin/       工作台、任务、工作流和设置等页面插件
packages/builtin/src/web.ts        Host 静态资源与 SPA 页面服务
```

runtime 对外提供 `subscribe`、`getSnapshot` 和明确的动作方法。请求、轮询与取消由对应资源管理，失败写入可观察状态，页面负责展示原因和恢复入口。React 绑定保持资源实例与订阅稳定，卸载后释放不再使用的请求和定时器。

内置页面通过 props 接收 `request`、`navigate`、`useQuery`、`useSlot` 等能力。Cordis `ctx` 的读取发生在插件装配和框架绑定处。组件内仍可保留输入框、展开面板等局部显示状态；上述查询与控制器的异步生命周期由 runtime 负责。

公共 `@youdub/sdk/client` 继续使用 SDK `1.1.0`。已有第三方插件使用的 `useClient`、`useObservable`、`useSlot`、`Link` 等入口保留；新内置实现通过 `bindComponent` 注入显式能力。动态模块仍共享同一份 React 与 SDK 身份。

## 开发与生产启动

安装和本地配置见 [README](../../README.md#快速开始)。启动前确认所用端口空闲。开发时在仓库根目录执行：

```bash
npm run build:plugins
npm start
```

另一终端运行 Vite：

```bash
npm --prefix apps/web run dev -- --host 127.0.0.1 --port 3000
```

Vite 将 `/api` 代理到 `http://127.0.0.1:8000`。需要其他 Host 地址时设置 `YOUDUB_API_URL`；该变量用于开发和 Vite 预览。

生产运行先停止开发服务，然后执行：

```bash
npm run build:web
npm --prefix apps/web start
```

生产启动脚本设置 `YOUDUB_WEB_ROOT` 指向 `apps/web/dist`，启动一个 Cordis Host，默认监听 `127.0.0.1:3000`。通过环境变量 `YOUDUB_HOST`、`YOUDUB_PORT` 调整监听地址；启动脚本不接收 Vite 或原 Next CLI 参数。`NEXT_SERVER_API_BASE_URL` 已移除。生产页面请求相对 `/api` 地址，不在构建时固定后端地址。

`web` 与 `setup` 同级挂载，基础环境尚未就绪时也能访问准备页面。页面深链接返回 SPA 入口，缺失静态资源、未知 API 保留 404。桌面启动器使用相同静态构建与 Host，在本机动态端口提供服务。

## 验证范围

本说明描述实现与验收边界，不代替测试结果。迁移验收需要覆盖：

- 根目录类型检查、Host 测试、前端单元测试、ESLint 和 Vite 生产构建。
- 静态资源 GET/HEAD/Range、页面深链接、API 路由和资源 404；准备阶段页面可访问。
- 工作台、任务库、工作流编辑与节点页面、任务结果、设置和准备页的实际浏览器操作。
- 原有视觉布局、主题和窄屏表现；浏览无修改时不出现离开确认。
- 独立第三方 Client 插件加载、React Hooks、页面注册和卸载。
- 节点独立人工确认、订正后下游继续、分叉与汇合的原有运行行为。
- macOS 与 Windows 打包使用 `apps/web/dist` 和单 Host 启动；构建检查与实际安装运行分别记录。

历史记录仍按其原版本和环境解释，不能用来证明本次迁移已验收或已发布。
