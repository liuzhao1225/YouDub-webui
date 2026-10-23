<p align="center">
  <img src="site/assets/youdub-logo.svg" alt="YouDub" width="520" />
</p>

# YouDub Desktop

> YouDub uses the DeepSeek Harness backend and frontend framework with Electron, retaining its video workflows and business UI. Start with the [developer documentation](apps/harness/docs/README.md), [architecture](apps/harness/docs/ARCHITECTURE.md), and [local development guide](apps/harness/docs/DEVELOPMENT.md) (in Chinese).

An open-source video localization workspace: import a video, transcribe and translate its speech, clone each sentence from its source audio, and produce subtitles and dubbed video.

[中文](README.md) · [Website and demos](https://liuzhao1225.github.io/YouDub-webui/) · [Download latest](https://github.com/liuzhao1225/YouDub-webui/releases/latest) · [Installation and upgrade](docs/upgrade.md) · [Community](#community)

## Demo

The default demo is the Jensen Huang interview generated on 2026-10-09: sentence-level voice cloning, Chinese subtitles and preserved background audio, approximately 59 seconds long. Source links identify the original videos; the workspace accepts video links and local files.

### 1. Jensen Huang interview · Latest result

[YouTube source](https://www.youtube.com/shorts/TbotsRXyRME) · YouTube Shorts · English -> Chinese

<table>
<tr><th>Original English</th><th>Chinese dubbed</th></tr>
<tr>
<td>

https://github.com/user-attachments/assets/befd11ca-e720-4faa-b4e0-d89bfe73df87

</td>
<td>

https://github.com/user-attachments/assets/60d5dbb0-f346-4c14-adad-2d0c481ac4fb

</td>
</tr>
</table>

### 2. Earlier sample: How much YT paid me for 129 million shorts views

[YouTube source](https://www.youtube.com/watch?v=ii9Kh4XkA5g) · Long-form landscape video · English -> Chinese · The embedded clip shows the first 40 seconds; the full version is available in the [`demo-assets`](https://github.com/liuzhao1225/YouDub-webui/releases/tag/demo-assets) release

<table>
<tr><th>Original English</th><th>Chinese dubbed</th></tr>
<tr>
<td>

https://github.com/user-attachments/assets/bd02936f-cf3c-4e4b-85b5-0410d38f69f5

</td>
<td>

https://github.com/user-attachments/assets/158de60a-7de4-4ddf-b3d8-478d0423aee6

</td>
</tr>
</table>

### 3. Me at the zoo

[YouTube source](https://www.youtube.com/watch?v=jNQXAC9IVRw) · English → Chinese · 19 seconds

[Switch between English and Chinese on the website](https://liuzhao1225.github.io/YouDub-webui/?demo=zoo#demo). Desktop packages include all three examples for offline playback through “View built-in examples” on the workspace or setup screen.

## Features

| Output mode | Result |
| --- | --- |
| Original audio + subtitles | Preserve the original audio and burn target-language subtitles into the video |
| Dubbing | Generate target-language speech, optionally retaining separated background audio |
| Subtitles + dubbing | Produce a dubbed video with subtitles and optional forced alignment |

- **Sentence-level voice cloning.** Each translated sentence uses the corresponding source sentence's audio as its reference, preserving a one-to-one mapping.
- **Subtitle display.** Split display cues at commas, Chinese enumeration commas and dashes, merge very short cues, and hide trailing separator punctuation.
- **Task management.** View covers, step progress, errors and artifacts; cancel, retry, rerun, play or download results.

The workspace lets you choose a video and workflow, then adjust the quick settings declared by its nodes. Languages, models, devices, voices and subtitle options belong to workflow nodes. Settings manages model providers, the local environment and model installation.

## Interface Preview

The workspace: import a video and choose languages and output mode. Screenshots show the current Chinese interface.

![YouDub workspace with video import, source and target languages, and output choices](docs/images/workbench.jpg)

<details>
<summary>View the task library and task details</summary>

Task library: video covers, processing status and previous tasks.

![YouDub task library showing video covers and completed tasks](docs/images/task-library.jpg)

Task details: preview the video, inspect processing steps, and download dubbed audio and subtitles.

![YouDub task details with Chinese subtitles, eight completed steps and generated files](docs/images/task-detail.jpg)

</details>

## Download and Use

[Windows EXE installer](https://github.com/liuzhao1225/YouDub-webui/releases/latest/download/YouDub-windows-x64-Setup.exe) · [macOS DMG](https://github.com/liuzhao1225/YouDub-webui/releases/latest/download/YouDub-macOS-arm64.dmg) · [Release notes and portable package](https://github.com/liuzhao1225/YouDub-webui/releases/latest)

First startup prepares the base runtime. Models and inference dependencies are prepared for the selected workflow. See the [installation guide](docs/upgrade.md) for requirements and upgrade instructions.

1. Add a provider, API key and translation model during first setup or in Settings → Models.
2. Import a video in the workspace, choose a workflow and adjust its node options, then prepare the required resources and create a task.
3. In the task library, follow progress and play or download the result.

## Community

QQ group: `618246010`

<p align="center">
  <img src="apps/web/public/qq-group-618246010.jpg" alt="YouDub QQ group QR code" width="220" />
</p>

## Run YouDub Desktop from source

Use Node.js `^22.19.0 || >=24.0.0`, npm, Git and your platform's build tools. Initialize submodules when cloning, then run these commands from the repository root:

```bash
npm ci --registry=https://registry.npmmirror.com
npm --prefix apps/web ci --registry=https://registry.npmmirror.com
npm --prefix apps/harness ci --registry=https://registry.npmmirror.com
npm run build:framework
npm run build:youdub
npm start
```

`npm run package:desktop -- --dir` creates the standalone Electron app. See [release packaging](docs/releasing.md) for signing, notarization and installers.

On first launch, select the interface language and data directory, prepare runtime resources and configure a translation model through the UI. The application uses its own Python environment, models and configuration. Translation models must accept at least **65,535** output tokens; incompatible endpoints report an error. Base environment readiness and workflow resource readiness are shown separately.

The previous runtime, Swift/C# shells and release process remain available in the [pre-refactor instructions](https://github.com/liuzhao1225/YouDub-webui/blob/711e40e8e69d2c6f2065f15aecc90550dcbf695d/README.en.md#running-the-main-branch-from-source). Harness provenance and the retained subset are documented in the [source notes](vendor/deepseek-harness/README.md).

## Everything is a plugin

YouDub Desktop composes its backend and frontend with Harness's Cordis runtime. Electron windows, Host lifecycle, Connection, model configuration, LLM, Subprocess, Jobs and plugin management reuse Harness. YouDub tasks, workflows, subtitles, dubbing, resources and business pages run as plugins. The [product composition](apps/harness/cordis.patch.yml) defines the active services and pages.

```text
YouDub Electron → Harness Desktop Host ← Official Connection ← YouDub pages
                         ↓
                 YouDub workflow and task plugins
                         ↓
             Harness LLM / Subprocess / Jobs
                         ↓
              Translation / Python media processing
```

The frontend uses Harness Renderer, Slots, Layout, Store, themes, locales and shared controls with YouDub's business components, React Flow canvas and animated home screen. See the [architecture](apps/harness/docs/ARCHITECTURE.md), [frontend guide](apps/harness/docs/FRONTEND-DEVELOPMENT.md), and [backend and workflow guide](apps/harness/docs/BACKEND-DEVELOPMENT.md) for implementation boundaries and source mappings.

## Installing and developing plugins

Manage plugins in the application's Extensions page. Harness PluginManager handles installation, enabling, disabling and removal. Nodes, providers and pages follow YouDub's business contracts. Host/Client/Python examples are described in the [backend and extensions guide](apps/harness/docs/BACKEND-DEVELOPMENT.md). A public YouDub plugin marketplace is not currently available.

## Current Scope

- **English sentence boundaries.** After Whisper recognition, NLTK Punkt forms complete sentences and word timestamps locate their source audio. Raw recognition results are retained.
- The default workflow accepts local `mp4`, `mov`, `mkv` and `webm` videos. Default limits are 4 GiB, 10 minutes, 1920 pixels for each dimension, and 60 fps.
- The language catalog contains English, Chinese and Japanese; support depends on the provider. Optional Qwen alignment supports English and Chinese.
- Node workflows support branches, joins and manual corrections, with one execution slot. Waiting for manual confirmation releases that slot. Plugin changes apply after restart. Hot replacement, a plugin marketplace, cycles and distributed workers remain outside the current scope.
- Local workflow, Client and Python plugins have been validated. Installation from remote GitHub/npm sources has not yet been validated.
- Current product APIs use `/api/v2` and support rerunning from a selected step. The old FastAPI/v1 HTTP entry points have been removed. Video URL downloads use `media.download/v1` and support single-video YouTube, Shorts, Bilibili and b23.tv links through yt-dlp, Node.js and FFmpeg, with the same duration and file-size limits.

Read the [runtime guide](docs/design/cordis-plugin-runtime.md#1-安装与配置) before upgrading an older installation or migrating data. Real-task validation and unverified areas are recorded in the [migration report](https://github.com/liuzhao1225/YouDub-webui/blob/c92b670f079428eed40ca6ab7bdfd69e3328fef4/docs/design/cordis-plugin-migration.md), [sentence segmentation results](docs/validation/asr-punkt-sentences-2026-10-09.json) and [subtitle display results](docs/validation/subtitle-display-2026-10-09.json).

## Development and Tests

```bash
npm run typecheck
npm test
npm run test:backend
npm --prefix apps/web test
npm run lint:web
npm run build:youdub
npm --prefix apps/harness test
```

```text
apps/harness/      Electron entry, Host/Client plugins and development tools
vendor/deepseek-harness/source/  Active Harness framework fork
packages/builtin/test/helpers/  Domain test fixtures; the product boots through Harness Host
packages/sdk/      Public service, workflow and operation contracts
packages/builtin/  Services, generic task engine, workflows and model bridge
backend/workers/   Python computation and SQLite transaction bridge
backend/app/       Models, media, credentials and historical data formats
apps/web/          Reused business components, client logic and React bindings
fixtures/plugins/  Standalone Host/Client/Python examples
submodule/demucs/   Demucs source submodule
```

Issues and pull requests are welcome for installation improvements, model adapters, subtitles and audio/video alignment, or independent source and workflow plugins. Historical designs remain in `docs/`; this README and the [Desktop development guide](apps/harness/docs/DEVELOPMENT.md) describe the current entry points.

## License

This project is licensed under Apache License 2.0. See [LICENSE](LICENSE).

China mirror: [AtomGit](https://atomgit.com/liuzhao1225/YouDub-webui), synchronized one way from the [primary GitHub repository](https://github.com/liuzhao1225/YouDub-webui). Releases, issues and pull requests are maintained on GitHub.

Creator: [Zhao Liu](https://liuzhao1225.github.io/en/) · [GitHub](https://github.com/liuzhao1225) · [Bilibili 黑纹白斑马](https://space.bilibili.com/1263732318)

[Star History](https://www.star-history.com/?repos=liuzhao1225%2FYouDub-webui&type=date&legend=top-left)
