# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

YouDub WebUI localizes a single video end-to-end: download (yt-dlp) → source separation (Demucs) → ASR (Whisper) → sentence re-segmentation → translation (OpenAI-compatible API) → reference-audio splitting → TTS (VoxCPM2) → audio merge/time-stretch → FFmpeg mux + burned subtitles. Mature path is YouTube EN→ZH; Bilibili ZH→EN and local video upload use the same pipeline.

Monorepo: FastAPI backend (`backend/`) + Next.js App Router frontend (`apps/web/`). Demucs is a **git submodule** at `submodule/demucs` loaded via `sys.path` at runtime — `git submodule update --init --recursive` is required, and a ZIP download will not work.

## Commands

Root `package.json` wraps the common ones (`dev:api`, `dev:web`, `test:backend`, `lint:web`, `build:web`), but they assume the venv is active. Explicit forms:

```bash
# Backend (Windows: .venv/Scripts/uvicorn.exe, .venv/Scripts/pytest.exe)
.venv/bin/uvicorn backend.app.main:app --reload --host 0.0.0.0 --port 8000
.venv/bin/pytest backend/tests
.venv/bin/pytest backend/tests/test_pipeline.py::test_pipeline_marks_all_stages_succeeded   # single test

# Frontend
npm --prefix apps/web run dev -- --hostname 0.0.0.0 --port 3000
npm --prefix apps/web test                          # vitest run
npm --prefix apps/web test -- src/app/page.test.tsx # single file
npm --prefix apps/web test -- -t "renders history"  # single test by name
npm --prefix apps/web run lint
npm --prefix apps/web run build
apps/web/node_modules/.bin/tsc --noEmit             # typecheck (CI runs this separately from lint)
```

CI (`.github/workflows/ci.yml`) gates on: vitest, eslint, `tsc --noEmit`, `next build`, `npm audit --omit=dev --audit-level=high`, and backend pytest.

Backend runs on Python 3.12. The frontend always talks to the backend through the same-origin `/api` rewrite in [next.config.ts](apps/web/next.config.ts); override the target with `NEXT_SERVER_API_BASE_URL`.

## Test-environment dependency boundary

`backend/requirements-test.txt` is deliberately CPU-only and light. CI **fails the build** if `torch`, `whisper`, `demucs`, `voxcpm`, `modelscope`, `librosa`, `audiostretchy`, `spacy`, or `openunmix` are importable in the test env.

This is why every heavy adapter import in [pipeline.py](backend/app/pipeline.py) is *inside* the stage handler function, not at module top level — and why adapters like [whisper_asr.py](backend/app/adapters/whisper_asr.py) and [demucs.py](backend/app/adapters/demucs.py) import their model libraries inside functions too. Keep it that way: a top-level `import torch` anywhere reachable from `backend.app.main` breaks the entire test suite. Tests either inject fakes into `sys.modules` ([test_pipeline.py](backend/tests/test_pipeline.py), [test_whisper_asr.py](backend/tests/test_whisper_asr.py)) or patch the adapter's own loader ([test_voxcpm.py](backend/tests/test_voxcpm.py), [test_demucs_adapter.py](backend/tests/test_demucs_adapter.py)).

## Pipeline architecture

Stages are declared once in [stages.py](backend/app/stages.py) and drive everything else. `PipelineRunner.run()` walks `STAGES` in order; a stage already marked `succeeded` is skipped and its artifacts are re-derived from disk by `_restore_cached_stage` (this is how resume, per-stage redo, and manual step-through all reuse work).

**Adding or renaming a stage touches five places:**
1. `STAGES` in [stages.py](backend/app/stages.py)
2. `_stage_handlers` + a `_<stage>` method in [pipeline.py](backend/app/pipeline.py)
3. `_restore_cached_stage` in [pipeline.py](backend/app/pipeline.py) — cached-artifact paths
4. `STAGE_OWN_ARTIFACTS` in [stage_reset.py](backend/app/stage_reset.py) — what gets deleted on redo
5. The hardcoded `ORDER BY CASE name` in `database.get_task` ([database.py](backend/app/database.py))

Plus `stages` labels in [i18n.tsx](apps/web/src/lib/i18n.tsx) for the UI.

### Session directory layout

Every task owns a session dir under `WORKFOLDER` (`<uploader>/<title>__<video_id>` for URLs, `_uploads/<task_id>/` for uploads). Artifact paths are a hard contract between `pipeline.py`, `stage_reset.py`, and the adapters:

```
media/     video_source.mp4, audio_vocals.wav, audio_bgm.wav, video_final.mp4
metadata/  ytdlp_info.json, asr.json, asr_fixed.json, translation.<lang>.json,
           translation_preprocess.json, timings.json, subtitles.<lang>.srt, local_info.json
segments/  vocals/, tts/, stretched/
tmp/       audio_dubbing.wav, audio_mixed.m4a
```

### Source dispatch

[sources.py](backend/app/sources.py) maps a URL to a `SourceConfig` (proxy on/off, cookie file, ASR language, target language). The *URL itself* determines the language pair — there is no separate language setting. Local uploads use a pseudo-URL `local://upload/<task_id>?direction=en-zh|zh-en&filename=...`, parsed in [youtube.py](backend/app/youtube.py). Remote URLs are strictly validated and canonicalized (`validate_video_url`) before any download; task IDs for URL tasks *are* the video ID, which is how duplicate submissions dedupe.

Uploading a translated `.srt` alongside a local video makes the `asr`/`asr_fix`/`translate` stages synthesize their normal JSON artifacts from the SRT instead of calling Whisper/OpenAI ([local_subtitles.py](backend/app/adapters/local_subtitles.py)).

### Worker

[worker.py](backend/app/worker.py) is a single daemon thread with a FIFO queue — one task at a time, in-process, started from the FastAPI lifespan. Nothing survives a restart: `fail_stale_active_tasks()` marks any `queued`/`running` task as failed on boot, and queued tasks are re-enqueued. `execution_mode="manual"` pauses the runner after each stage; the UI resumes it via `POST /api/tasks/{id}/continue`.

## Security-sensitive conventions

- **Auth**: `AuthMiddleware` ([auth.py](backend/app/auth.py)) guards every `/api/*` path except `GET /api/health` and `POST /api/auth/login`. HttpOnly session cookie scoped to `/api`, plus an `X-CSRF-Token` header derived from the session token on unsafe methods, plus an origin check. The backend refuses to start without a valid Argon2id `YOUDUB_AUTH_PASSWORD_HASH`. New endpoints are protected automatically by path — don't add per-route auth.
- **File writes**: anything written under `data/` or `WORKFOLDER` (logs, cookies, uploads, SQLite) must go through [runtime_security.py](backend/app/runtime_security.py) helpers (`atomic_write_private_text`, `open_private_append_text`, `open_private_binary_exclusive`, `remove_private_file`). `ensure_runtime_dirs()` applies a fail-closed permission migration on POSIX; a plain `open(..., "w")` bypasses it.
- Secrets are never returned to the client: API keys are masked, cookie contents are returned as `""` with metadata only.
- `CORS_ALLOW_ORIGINS` explicitly rejects `*`.

## Frontend notes

Only three routes: `/` (create + task history), `/tasks/[id]` (stage detail, logs, video), `/login`.

- [api.ts](apps/web/src/lib/api.ts) is the single fetch layer. It holds the CSRF token in module state (set by `getAuthSession`/`login`) and dispatches a `youdub:auth-unauthorized` window event on 401, which [auth.tsx](apps/web/src/lib/auth.tsx) listens for to bounce to login.
- Polling uses [use-serial-polling.ts](apps/web/src/lib/use-serial-polling.ts) — serialized, abortable, generation-counted. Late responses from a superseded poll must be dropped via `isCurrent()`; several past bugs came from ignoring this.
- [upload-contract.json](apps/web/src/lib/upload-contract.json) is the shared allowed-video-extension list. `test_frontend_video_accept_contract_matches_backend_allowlist` in [test_settings_and_api.py](backend/tests/test_settings_and_api.py) asserts it equals `main.ALLOWED_VIDEO_SUFFIXES` — change both together.
- UI strings live in [i18n.tsx](apps/web/src/lib/i18n.tsx) (en/zh), not inline. shadcn/ui components in `src/components/ui/` are generated — prefer regenerating over hand-editing.

## Devices

[devices.py](backend/app/devices.py) resolves `DEVICE` (plus `DEMUCS_DEVICE`/`WHISPER_DEVICE` overrides) per component and is validated before a task is accepted (`_ensure_runtime_ready` → 409). Two quirks encoded there: Whisper falls back to CPU on MPS (word-timestamp DTW needs float64), and VoxCPM reports `library-auto` because the upstream package picks its own device.

## Docs

[README.md](README.md) (Chinese) and [README.en.md](README.en.md) are user-facing setup docs and are kept in sync. Commit messages in this repo are written in Chinese.
