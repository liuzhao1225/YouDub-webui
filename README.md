
# YouDub-webui: 优质视频中文化工具
## 目录
- [YouDub-webui: 优质视频中文化工具](#youdub-webui-优质视频中文化工具)
  - [目录](#目录)
  - [简介](#简介)
  - [主要特点](#主要特点)
  - [安装与使用指南](#安装与使用指南)
  - [使用步骤](#使用步骤)
  - [技术细节](#技术细节)
    - [AI 语音识别](#ai-语音识别)
    - [大型语言模型翻译](#大型语言模型翻译)
    - [AI 声音克隆](#ai-声音克隆)
    - [视频处理](#视频处理)
  - [贡献指南](#贡献指南)
  - [许可协议](#许可协议)
  - [支持与联系方式](#支持与联系方式)

## 简介
`YouDub-webui` 是 [`YouDub`](https://github.com/liuzhao1225/YouDub) 的网页交互版本。这个工具通过其网页界面简化了操作流程，使用户能够更方便地访问和使用 [`YouDub`](https://github.com/liuzhao1225/YouDub) 的强大功能。。[`YouDub`](https://github.com/liuzhao1225/YouDub) 是一个创新的开源工具，专注于将 YouTube 等平台的优质视频翻译和配音为中文版本。此工具融合了先进的 AI 技术，包括语音识别、大型语言模型翻译以及 AI 声音克隆技术，为中文用户提供具有原始 YouTuber 音色的中文配音视频。更多示例和信息，欢迎访问我的[bilibili视频主页](https://space.bilibili.com/1263732318)。你也可以加入我们的微信群，扫描下方的[二维码](#支持与联系方式)即可。

## 主要特点
- **视频下载**: 通过视频链接下载 YouTube 视频。
- **AI 语音识别**：有效转换视频中的语音为文字。
- **大型语言模型翻译**：快速且精准地将文本翻译成中文。
- **AI 声音克隆**：生成与原视频配音相似的中文语音。
- **视频处理**：集成的功能实现音视频的同步处理。

## 安装与使用指南
1. **克隆仓库**：
   ```bash
   git clone https://github.com/liuzhao1225/YouDub-webui.git
   ```
2. **安装依赖**：
   1. **自动安装**
   
        进入 `YouDub` 目录并运行 `run_windows.bat`。
        这个脚本会自动在当前目录下创建 `venv` 虚拟环境，并安装所需依赖。这个脚本会自动安装 CUDA 12.1 版本的 PyTorch。

   2. **手动安装**
   
        进入 `YouDub` 目录并安装所需依赖：
        ```bash
        cd YouDub
        pip install -r requirements.txt
        ```
        由于 `TTS` 的依赖限定的比较傻逼，所以将 `TTS`移出了 `requirements.txt`，需要手动安装。安装 `TTS` 依赖的步骤如下：
        ```bash
        pip install TTS
        ```

        默认安装为 CPU 版本的 PyTorch 如果你需要手动安装特定 CUDA 版本的 PyTorch，可以参考以下步骤：
        首先，根据你的环境和 PyTorch 的版本，从 [PyTorch 官方网站](https://pytorch.org/) 获取适用的安装命令。例如，如果你的 CUDA 版本是 11.8，你可以使用如下命令安装 PyTorch：
        ```bash
        pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
        ```
3. **环境设置**

      在运行程序之前，需要进行以下环境设置：

      **环境变量配置**：将 `.env.example` 文件改名为 `.env`，并填入相应的环境变量。以下是需要配置的环境变量：

      - `OPENAI_API_KEY`: OpenAI API 的密钥，一般格式为 `sk-xxx`。
      - `MODEL_NAME`: 使用的模型名称，如 'gpt-4' 或 'gpt-3.5-turbo'。对于翻译任务，使用 'gpt-3.5-turbo'足够了。'gpt-4'太贵了，一天干了我一百多刀。
      - `OPENAI_API_BASE`: 如果你使用的是 OpenAI 官方的 API，可以将此项留空。如果你有自己部署的支持 OpenAI API 的大模型，可以填入相应的 OpenAI API 访问的 base_url。
      - `HF_TOKEN`: 如果使用 speaker diarization 功能，需要提供你的 Hugging Face token，并同意 [pyannote's speaker diarization agreement](https://huggingface.co/pyannote/speaker-diarization-3.1)。`HF_TOKEN` 可以在 [Hugging Face 设置](https://huggingface.co/settings/tokens) 中获取。
      - `HF_ENDPOINT`: 如果在从 `huggingface` 下载模型时报错，你可以在 `.env` 文件中添加：
  
        ```
        HF_ENDPOINT=https://hf-mirror.com
        ```

      - `APPID` 和 `ACCESS_TOKEN`: 如果使用火山引擎的 TTS，需要提供火山引擎的 APPID 和 ACCESS_TOKEN，此项可能需要付费。
  

      **TTS 设置**：如果不希望使用付费的火山引擎 TTS，可以在 `main.py` 中将 `from youdub.tts_bytedance import TTS_Clone` 改为 `from youdub.tts_paddle import TTS_Clone`，但这可能会影响生成效果。

4. **运行程序**：
   1. **自动运行**

        进入 `YouDub` 目录并运行 `run_windows.bat`。

    2. **手动运行**
        使用以下命令启动主程序：

        ```
        python app.py
        ```

   如果在从 `huggingface` 下载模型时报错，你可以在 `.env` 文件中添加：

   ```
   HF_ENDPOINT=https://hf-mirror.com
   ```

## 使用步骤
1. **下载视频**：在 `YouDub` 网页中输入 YouTube 视频链接，点击 `Download` 按钮下载视频。下载完成后，会在 `YouDub` 目录下生成一个 `videos` 文件夹，其中包含下载的视频文件。
  
## 技术细节

### AI 语音识别
目前，我们的 AI 语音识别功能是基于 [WhisperX](https://github.com/m-bain/whisperX) 实现的。Whisper 是 OpenAI 开发的一款强大的语音识别系统，能够精确地将语音转换为文本。考虑到未来的效率和性能提升，我们计划评估并可能迁移到 [WhisperX](https://github.com/m-bain/whisperX)，这是一个更高效的语音识别系统，旨在进一步提高处理速度和准确度。

### 大型语言模型翻译
我们的翻译功能支持使用 OpenAI API 提供的各种模型，包括官方的 GPT 模型。此外，我们也在探索使用类似 [api-for-open-llm](https://github.com/xusenlinzy/api-for-open-llm) 这样的项目，以便更灵活地整合和利用不同的大型语言模型进行翻译工作。

### AI 声音克隆
声音克隆方面，我们目前使用的是 [Paddle Speech](https://github.com/PaddlePaddle/PaddleSpeech)。虽然 Paddle Speech 提供了高质量的语音合成能力，但目前尚无法在同一句话中同时生成中文和英文。在此之前，我们也考虑过使用 [Coqui AI TTS](https://github.com/coqui-ai/TTS)，它能够进行高效的声音克隆，但同样面临一些限制。

### 视频处理
我们的视频处理功能强调音视频的同步处理，例如确保音频与视频画面的完美对齐，以及生成准确的字幕，从而为用户提供一个无缝的观看体验。

## 贡献指南
欢迎对 `YouDub` 进行贡献。您可以通过 GitHub Issue 或 Pull Request 提交改进建议或报告问题。

## 许可协议
`YouDub` 遵循 Apache License 2.0。使用本工具时，请确保遵守相关的法律和规定，包括版权法、数据保护法和隐私法。未经原始内容创作者和/或版权所有者许可，请勿使用此工具。

## 支持与联系方式
如需帮助或有任何疑问，请通过 [GitHub Issues](https://github.com/liuzhao1225/YouDub/issues) 联系我们。你也可以加入我们的微信群，扫描下方的二维码即可：

![WeChat Group](docs/1e5bad6485828197234ab8722f3f646.jpg)
