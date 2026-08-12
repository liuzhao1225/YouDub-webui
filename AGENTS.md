# Repository Guidelines

YouDub WebUI is a full-stack video-localization application. Keep changes focused, testable, and consistent with the existing pipeline and bilingual UI.

## Project Structure & Module Organization

- `backend/app/` contains the FastAPI API, worker, pipeline stages, adapters, configuration, and runtime security helpers.
- `backend/tests/` contains the backend pytest suite. Frontend tests are colocated under `apps/web/src/` next to routes, components, and hooks.
- `apps/web/` is the Next.js App Router frontend; shared API/auth/i18n code is in `src/lib/`, UI primitives in `src/components/ui/`, and static assets in `public/`.
- `scripts/` holds pipeline and Windows setup/start/build helpers. `submodule/demucs/` is a required git submodule; initialize it with `git submodule update --init --recursive`.
- `data/` and `workfolder/` hold local runtime state and generated artifacts; do not commit their contents.

## Build, Test, and Development Commands

Use Python 3.12 with an active `.venv` and Node.js 20+. Install frontend dependencies with `npm --prefix apps/web install`. Common commands are:

```powershell
npm run dev:api                 # FastAPI on port 8000
npm run dev:web                 # Next.js development server
npm run test:backend            # pytest backend/tests
npm --prefix apps/web test      # Vitest
npm run lint:web                # ESLint
npm run build:web               # production frontend build
```

For CI-equivalent frontend checks, also run `apps/web/node_modules/.bin/tsc --noEmit` and `npm --prefix apps/web audit --omit=dev --audit-level=high`.

## Coding Style & Naming Conventions

Follow the surrounding style: four-space Python indentation, two-space TypeScript/TSX indentation, no semicolons in frontend code, `snake_case` Python names, and `PascalCase` React components. Use ESLint for frontend validation. Keep heavy ML imports lazy and preserve the pipeline's stage/artifact contracts.

## Testing Guidelines

Name Python tests `test_*.py` and frontend tests `*.test.tsx`. Add regression coverage with behavior changes. Backend tests intentionally use `backend/requirements-test.txt`, which excludes heavy ML packages; do not add top-level imports of those packages to modules reachable from `backend.app.main`.

## Commit & Pull Request Guidelines

Recent commits use short, action-oriented summaries, commonly written in Chinese. Follow that concise convention and make the subject specific (for example, `fix local video upload over 10 MB`). PRs should describe behavior and affected areas, list commands/tests run, link an issue when applicable, and include screenshots for UI changes. Update both `README.md` and `README.en.md` when user-facing setup or behavior changes.

## Security & Configuration

Copy `env.txt.example` to `.env`; never commit API keys, password hashes, cookies, databases, or generated media. Writes under `data/` and `WORKFOLDER` must use helpers from `backend/app/runtime_security.py`. Preserve the existing auth, CSRF, origin, and secret-masking behavior when changing API routes.
