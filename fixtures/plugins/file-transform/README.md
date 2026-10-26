# 文本转换插件

使用 Harness 的 `dsh.bundle`、官方组件与 YouDub 业务服务，将上传的 UTF-8 文本转为大写，并提供侧栏入口和任务详情面板。

先在仓库根目录执行 `node fixtures/plugins/build.mjs`。在 YouDub「扩展」中添加本目录的绝对路径，确认插件已激活后选择「文本转大写」、上传文本并下载结果。

- `src/host.mjs`：通过 `youdubContext` 注册业务插件。
- `src/domain.mjs`：工作流、提供商和真实文件转换。
- `src/client.jsx`：通过官方 Slots 注册页面、导航和详情面板。

源码与插件安装回归共用这一份示例。旧加载器版本保留在 `SOURCE.json` 指向的 Git 提交中。
