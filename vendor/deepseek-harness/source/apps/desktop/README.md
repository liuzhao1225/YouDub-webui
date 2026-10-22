---
description: "Electron framework services retained by YouDub Desktop."
---

# Desktop framework for YouDub

English | [中文](README.zh.md)

## Scope

YouDub uses this package's Electron lifecycle, profile preparation, authenticated Web transport, private Node-mode Host, IPC validation, directory picker, shortcuts, theme, crash diagnostics and sandboxed application preload. Its product main is [apps/harness/src/desktop-product.ts](../../../../../apps/harness/src/desktop-product.ts).

The retired Harness product main, native login/welcome renderer, Platform account views and legacy development launcher have been removed. Native locale reads use [desktop-settings.ts](src/desktop-settings.ts) and query only Settings. Account credentials are neither received through Host IPC nor exposed by the application preload.

## Development

Run `npm run dev` from the YouDub repository root. The framework build emits `preload-app.cjs`; the product build composes the retained Desktop modules and creates the development runtime from the explicit package closure. This package has no standalone application entry or login step.

The current task covers source development. Remaining upstream release/update utilities are not wired to a YouDub release feed and are still subject to the P6 source audit; they do not establish a supported packaging path.

## Provenance and checks

The immutable upstream source archive and manifest remain preserved. `vendor/deepseek-harness/fork.json` records active-source changes. Copied native window/menu blocks are checked against hashes extracted from the original `apps/desktop/src/main.ts`, recorded in `apps/harness/baselines/native-blocks.json`.

The development CI checks native settings transport, Host shutdown and failure handling, profile isolation, sandbox preload and retained frontend services. Actual native file dialogs, window interactions and complete media workflows are tracked separately in the [refactor plan](../../../../../apps/harness/docs/YOUDUB-DESKTOP-REFACTOR-PLAN.md).
