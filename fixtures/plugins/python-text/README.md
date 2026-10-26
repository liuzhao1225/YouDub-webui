# Python 文本转换插件

使用 Harness bundle 注册 Python 提供商，通过 YouDub 的 `registerPythonProvider` 调用 `worker.py`，将上传的 UTF-8 文本转为大写并注册输出文件。

先在仓库根目录执行 `node fixtures/plugins/build.mjs`。在 YouDub「扩展」中添加本目录的绝对路径，确认插件已激活后运行「Python 文本转大写」。

`src/host.mjs` 复用当前 YouDub Python 运行环境，注册提供商和工作流。`worker.py` 使用 `youdub-worker/v1` 协议，标准输出只发送协议消息，诊断信息写入标准错误。

该示例无需额外 Python 依赖。旧 manifest 专属加载方式保留在 `SOURCE.json` 指向的 Git 提交中。
