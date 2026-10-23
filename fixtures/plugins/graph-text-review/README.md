# 外部节点插件：文本合并与人工校对

这个插件只依赖 YouDub 公开的 Host SDK、Client SDK 和共享 React，不导入内置插件源码，也不需要模型或 Python 推理包。

图中两个「文本内容」节点分别输出 JSON。「合并与校对」有两个 JSON 输入和两个 JSON 输出；运行后暂停，进入插件自己的页面订正文本。「导出文本」消费校对文本和来源数量，产出可下载的 `reviewed.txt`。

## 安装与使用

在工作台「扩展」安装此目录，重启 YouDub。工作流库会显示「文本合并与人工校对」，来源为插件。打开后可修改文本内容、拖动节点、查看连线，并点击运行。

进入「合并与校对」的专属页面，在「校对文本」中修改内容。宿主提供「保存订正」和「保存并继续」，维护结果版本、未保存修改和冲突处理。插件的 `validateCorrection` 拒绝空白文本；保存失败时保留草稿。

## 可重复验收

启动一个独立本地 Host，设置 `YOUDUB_DESKTOP_DATA_DIR` 到验证数据目录。脚本默认连接 `http://127.0.0.1:8012`，可以通过 `YOUDUB_VERIFY_BASE` 修改。使用 Node 22 执行：

```sh
node fixtures/plugins/graph-text-review/verify.mjs --install
# 重启同一 Host，使安装的 Host 与 Client 模块生效。
node fixtures/plugins/graph-text-review/verify.mjs
```

验证包含：安装后的插件模板和三种节点可枚举、Client 资源可加载、多端口输入正确、无模型依赖、暂停阻止导出、空白订正返回原始错误且不增加版本、保存订正后仍暂停、原始结果和订正版本同时保留、批准后生成实际文本文件。

证据默认写入 `output/validation/graph-text-review/`。`YOUDUB_VERIFY_OUTPUT` 可指定其他目录。脚本不会保存会话 Cookie 或 CSRF Token。

追加 `--pause` 可以创建停在校对节点的任务，随后用浏览器完成专属页验收：

```sh
node fixtures/plugins/graph-text-review/verify.mjs --pause
```

## 插件契约

- `operations[].node` 声明节点类型、输入端口、配置和详情页 ID；`operations[].outputs` 声明输出类型及 JSON Schema。
- `describe().graphTemplate` 将只读模板放入工作流库。图使用共享编译器，任务中的 provider 版本和安装完整性仍由宿主绑定。
- `workflow.node.details` 接收 `detail`、选中版本的 `outputs`、当前 `draft`、`readOnly` 和 `onDraftChange`。回调传入完整的待保存输出 patch，例如 `{ ...draft, text: { text: value } }`。
- 插件声明可订正的输出端口，并在 `validateCorrection` 中校验业务规则，返回完整输出。文件注册、批准和下游调度由宿主负责。
- `@youdub/sdk/client` 的 `useClient()` 使用宿主公开的导航服务。客户端不直接访问本地文件或操作任务存储。
