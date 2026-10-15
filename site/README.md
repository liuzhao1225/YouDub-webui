# YouDub GitHub Pages

官网：https://liuzhao1225.github.io/YouDub-webui/

纯 HTML、CSS 和浏览器 JavaScript，无需安装依赖。修改 `site/` 后合入 `main`，`.github/workflows/pages.yml` 自动发布该目录。GitHub Pages 的发布方式设为 GitHub Actions。所有下载按钮指向 GitHub `/releases/latest`，不固定版本号。

本地预览（先确认端口空闲）：

```sh
.venv/bin/python -m http.server 18420 --bind 127.0.0.1 --directory site
```

## 演示播放器

选中的示例会完整下载中英文 MP4，然后使用 Blob URL 播放。准备完成前禁用播放和语言按钮并显示加载状态。两个视频同时解码、共享播放/暂停/进度和音量；只让选中的轨道发声。语言 Tab 只切换可见视频和静音状态，不重建视频、不改 `src`、不跳转进度。另一示例按需加载，再次选择时保留进度。

切换、seek、播放失败会显示原始错误并停止播放。网络加载受实际连接速度影响；完整预加载用于保证准备完成后的切换不依赖再次下载。验证时覆盖播放中连续切换、暂停切换、拖动后切换、静音/音量、结尾重播、示例切换、窄屏和键盘操作。

## 素材来源

- `youdub-logo.svg`、`youdub-icon.svg`：复用 `apps/web/public/`。
- `workbench.jpg`：复用 `docs/images/workbench.jpg`。
- `jensen-en.mp4`：README 黄仁勋原片；[原始附件](https://github.com/user-attachments/assets/befd11ca-e720-4faa-b4e0-d89bfe73df87)。原片为 AV1 / Opus，官网转为 H.264 / AAC 以兼容浏览器，保持原有画面、时间线与声音。
- `jensen-zh.mp4`：README 2026-10-09 中文成片；[原始附件](https://github.com/user-attachments/assets/60d5dbb0-f346-4c14-adad-2d0c481ac4fb)。
- `creator-en.mp4` / `creator-zh.mp4`：README 历史样例的 40 秒切片；[原片附件](https://github.com/user-attachments/assets/bd02936f-cf3c-4e4b-85b5-0410d38f69f5)、[配音附件](https://github.com/user-attachments/assets/158de60a-7de4-4ddf-b3d8-478d0423aee6)。
- 两张 `*-poster.jpg`：从对应已有原片的第 1 秒提取，没有重新生成素材。

播放器使用项目站点相对路径，部署到 `/YouDub-webui/` 子目录时无需改配置。媒体随静态站点发布，避免依赖附件链接的重定向和临时签名。
