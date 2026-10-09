<p align="center">
  <img src="apps/web/public/youdub-logo.svg" alt="YouDub" width="520" />
</p>

# YouDub WebUI

An open-source video localization workspace: import a video, transcribe and translate its speech, clone each sentence from its source audio, and produce subtitles and dubbed video.

[中文](README.md) · [Runtime and extension guide](docs/design/cordis-plugin-runtime.md) · [Plugin contracts](docs/design/cordis-plugin-contracts.md) · [Careers](#careers) · QQ group: **618246010**

## Features

| Output mode | Result |
| --- | --- |
| Original audio + subtitles | Preserve the original audio and burn target-language subtitles into the video |
| Dubbing | Generate target-language speech, optionally retaining separated background audio |
| Subtitles + dubbing | Produce a dubbed video with subtitles and optional forced alignment |

- **Sentence-level voice cloning.** Each translated sentence uses the corresponding source sentence's audio as its reference, preserving a one-to-one mapping.
- **English sentence boundaries.** After Whisper recognition, NLTK Punkt forms complete sentences and word timestamps locate their source audio. Raw recognition results are retained.
- **Subtitle display.** Split display cues at commas, Chinese enumeration commas and dashes, merge very short cues, and hide trailing separator punctuation.
- **Task management.** View covers, step progress, errors and artifacts; cancel, retry, rerun, play or download results. The API also supports rerunning from a selected step.

The workspace contains basic choices such as video, languages and output mode. Settings holds model, device, voice, subtitle alignment and background-audio defaults, along with service connections.

## Everything is a plugin

YouDub uses **Cordis** to compose its services. The task engine, default workflow, model providers, HTTP/API, authentication and client pages are all plugins. See the [default composition](youdub.config.ts).

```text
Client page plugins → API / authentication plugins → Task engine plugin
                                                           ↓
                                                     Workflow plugin
                                                           ↓
                                                     Provider plugin
                                                           ↓
                                              Python process / remote service
```

A workflow declares its steps, inputs and outputs. Providers implement operations, and files pass through ArtifactRef references. Python handles media processing and model inference through managed processes and a stdio protocol for each operation. Packages written entirely in Python can also provide operations.

To replace ASR, translation or TTS, supply a plugin that implements the relevant contracts. New processing flows can register their own workflows. See the [architecture](docs/design/cordis-plugin-architecture.md) and [plugin contracts](docs/design/cordis-plugin-contracts.md).

## Quick Start

The commands below target macOS / Linux shells. Current real-model, API and browser validation was performed on **macOS arm64 using CPU**. Windows/Linux machines and CUDA have not been validated in this round; the current configuration does not expose MPS.

### 1. Install dependencies

Install Node.js 22 (at least 22.13.0), Python 3.12, Git, FFmpeg and ffprobe. FFmpeg must support libass/subtitles, and the `ffmpeg` executable must be available on PATH.

```bash
git clone --branch codex/mvp-mainline --recurse-submodules https://github.com/liuzhao1225/YouDub-webui.git
cd YouDub-webui
npm ci --registry=https://registry.npmmirror.com
npm --prefix apps/web ci --registry=https://registry.npmmirror.com
python3.12 -m venv .venv
.venv/bin/python -m pip install --index-url https://mirrors.aliyun.com/pypi/simple/ -r requirements.txt
.venv/bin/python -m nltk.downloader -e punkt_tab
```

For an existing checkout, run `git submodule update --init --recursive` to initialize the Demucs submodule. Reuse an existing `.venv`. If a required package is missing from Aliyun, install that package using only the [Tsinghua mirror](https://pypi.tuna.tsinghua.edu.cn/simple/).

### 2. Set an access password

Create the configuration on first use. Preserve an existing `.env`:

```bash
cp .env.example .env
ln .env env.txt
test .env -ef env.txt
.venv/bin/python -c "from getpass import getpass; from pwdlib import PasswordHash; print(PasswordHash.recommended().hash(getpass('YouDub password: ')))"
```

Copy the generated Argon2id hash into `YOUDUB_AUTH_PASSWORD_HASH` in `.env`. Log in with the password you entered. There is no default password; the Host refuses to start without a valid hash. The application loads `.env`; agent tools read `env.txt`, a hard link to the same file. Both are excluded from Git.

### 3. Prepare models

Download model assets separately. Settings only checks local files. The default data directory is `~/Library/Application Support/YouDub` on macOS, `~/.local/share/youdub` on Linux, and `%LOCALAPPDATA%/YouDub` on Windows. Override it with `YOUDUB_DESKTOP_DATA_DIR`.

| Capability | Default provider | Model path, relative to the data directory |
| --- | --- | --- |
| Speech recognition | Whisper | `models/whisper/`, for example `tiny.pt`; also requires the `punkt_tab` data installed above |
| Translation | OpenAI-compatible API | Configure the connection, key and model in Settings |
| Speech generation | VoxCPM2 | `models/voxcpm/VoxCPM2/` |
| Vocal separation | Demucs htdemucs | `models/demucs/955717e8-8726e21a.th` |
| Subtitle alignment (optional) | Qwen3 Forced Aligner | `models/qwen3-forced-aligner/Qwen3-ForcedAligner-0.6B-hf/` |

VoxCPM2 and Qwen require complete model assets and tokenizer/processor configuration. See the [runtime guide](docs/design/cordis-plugin-runtime.md#1-安装与配置) for custom paths and requirements. To start with original audio plus subtitles, prepare Whisper and a translation connection. Sentence-level source voice cloning also requires VoxCPM2 and Demucs.

Translation keys are stored in the system keyring. Configure custom translation model candidates through `YOUDUB_TRANSLATION_MODELS` in `.env`, then select a model in Settings. Default translation requests set a maximum output-token limit of at least **65,535**. The connected service and model must accept that parameter; incompatibility produces an explicit error.

### 4. Start the application

Confirm that ports 8000 and 3000 are unused, then run these commands from the repository root:

```bash
npm run build:plugins
npm start
```

Open another terminal in the same directory and start the frontend:

```bash
npm --prefix apps/web run dev -- --hostname 127.0.0.1 --port 3000
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000), log in, then:

1. In Settings, configure the translation connection, check required model readiness, and save processing defaults.
2. In the workspace, import a video, select languages and an output mode, and create a task.
3. In the task library, follow progress and play or download the result.

To run a built frontend, replace the development frontend command with the following. Keep the Host running separately:

```bash
npm run build:web
npm --prefix apps/web start -- --hostname 127.0.0.1 --port 3000
```

## Installing and Developing Plugins

Finish or cancel active tasks and stop the Host before managing plugins:

```bash
npm run plugins -- list
npm run plugins -- install --source ./fixtures/plugins/file-transform
npm run plugins -- disable --id example.file-transform
npm run plugins -- enable --id example.file-transform
```

GitHub repositories and exact npm package versions are also supported. Replace the repository, commit and package placeholders below:

```bash
npm run plugins -- install --source https://github.com/OWNER/REPO --ref FULL_COMMIT_SHA
npm run plugins -- install --source npm:PACKAGE_NAME@1.0.0
```

Installed plugins are enabled by default and take effect after restarting the Host. Refresh the browser to load extensions with precompiled Client entries. Installation scripts and Host code run with local machine permissions, so install plugins from trusted sources. Separate Python environments isolate dependencies.

Start with these small examples:

- [Host / workflow / Client plugin](fixtures/plugins/file-transform/README.md): registers a workflow, page and navigation entry.
- [Python-only provider](fixtures/plugins/python-text/README.md): declares operations in a manifest and uses the stdio input/output protocol.

See the [plugin contracts](docs/design/cordis-plugin-contracts.md) for package structure, artifacts, credentials and cancellation, and the [runtime guide](docs/design/cordis-plugin-runtime.md#3-安装启停和重启) for installation, enable/disable and removal. The SDK is provided in this repository and has not been published as a public npm package.

## Current Scope

- The default workflow accepts local `mp4`, `mov`, `mkv` and `webm` videos. Default limits are 4 GiB, 10 minutes, 1920 pixels for each dimension, and 60 fps.
- The language catalog contains English, Chinese and Japanese; support depends on the provider. Optional Qwen alignment supports English and Chinese.
- The MVP runs on one machine with one active task at a time. Plugin changes apply after restart. A DAG editor, hot replacement, plugin marketplace and distributed workers are outside the current scope.
- Local workflow, Client and Python plugins have been validated. Installation from remote GitHub/npm sources has not yet been validated.
- Current product APIs use `/api/v2`. The old FastAPI/v1 HTTP entry points and default URL-download workflow have been removed.

Read the [runtime guide](docs/design/cordis-plugin-runtime.md#1-安装与配置) before upgrading an older installation or migrating data. Real-task validation and unverified areas are recorded in the [migration report](docs/design/cordis-plugin-migration.md), [sentence segmentation results](docs/validation/asr-punkt-sentences-2026-10-09.json) and [subtitle display results](docs/validation/subtitle-display-2026-10-09.json).

## Development and Tests

```bash
npm run typecheck
npm test
npm run test:backend
npm --prefix apps/web test
npm run lint:web
npm run build:web
```

```text
youdub.config.ts    Default Cordis plugin composition
apps/host/         Host bootstrap and plugin management CLI
packages/sdk/      Public service, workflow and operation contracts
packages/builtin/  Services, generic task engine, workflows and model bridge
backend/workers/   Python computation and SQLite transaction bridge
backend/app/       Models, media, credentials and historical data formats
apps/web/          Next bootstrap, Client SDK and page plugins
fixtures/plugins/  Standalone Host/Client/Python examples
submodule/demucs/   Demucs source submodule
```

Issues and pull requests are welcome for installation improvements, model adapters, subtitles and audio/video alignment, or independent source and workflow plugins. Historical designs remain in `docs/`; this README and the Cordis runtime guide describe the current entry points.

## Demo

These English-to-Chinese samples were generated by earlier YouDub versions and demonstrate subtitles, dubbing and background-audio preservation. Source links identify the original videos; the current workspace imports local files.

### 1. Jensen Huang on Nvidia's Competition

[YouTube source](https://www.youtube.com/shorts/TbotsRXyRME) · YouTube Shorts · English -> Chinese

<table>
<tr><th>Original English</th><th>Chinese dubbed</th></tr>
<tr>
<td>

https://github.com/user-attachments/assets/befd11ca-e720-4faa-b4e0-d89bfe73df87

</td>
<td>

https://github.com/user-attachments/assets/bf01f912-eec8-4e0d-8698-0f69283a73e7

</td>
</tr>
</table>

### 2. How much YT paid me for 129 million shorts views

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

## Careers

银河智学, an AI education company, is hiring a full-stack engineer and a senior Go backend architect in Zhongguancun, Haidian, Beijing. See the [Chinese recruitment details](README.md#人才招聘) for roles, compensation and the poster. Company website: [xiaoluxue.com](https://xiaoluxue.com/). Apply at [liuzhao@xiaoluxue.com](mailto:liuzhao@xiaoluxue.com).

## Community

QQ group: `618246010`

<p align="center">
  <img src="apps/web/public/qq-group-618246010.jpg" alt="YouDub QQ group QR code" width="220" />
</p>

## License

This project is licensed under Apache License 2.0. See [LICENSE](LICENSE).

China mirror: [AtomGit](https://atomgit.com/liuzhao1225/YouDub-webui), synchronized one way from the [primary GitHub repository](https://github.com/liuzhao1225/YouDub-webui). Releases, issues and pull requests are maintained on GitHub.

Creator: [Zhao Liu](https://liuzhao1225.github.io/en/) · [GitHub](https://github.com/liuzhao1225) · [Bilibili 黑纹白斑马](https://space.bilibili.com/1263732318)

[Star History](https://www.star-history.com/?repos=liuzhao1225%2FYouDub-webui&type=date&legend=top-left)
