---
description: "Shared browser runtime, services and interface components."
kind: "package-group"
---

# client/ — web-GUI browser half

English | [中文](README.zh.md)

## Summary

The client group retains browser boot, transport, slots, state, themes, localization and shared interface components. Product profiles select the loaded plugins; each package documents its public contracts.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

The kernel packages boot and serve the page; the UI feature packages present it. Each package README owns its contract and configuration.

| Package | Role | ctx key |
|---|---|---|
| [`web/`](web/README.md) | Boots the browser shell | — |
| [`modules/`](modules/README.md) | Loads browser-side client modules | `ctx.clientModules` / `ctx.modules` |
| [`connection/`](connection/README.md) | Maintains browser-host RPC communication and event delivery | `ctx.connection` |
| [`file-upload/`](file-upload/README.md) | Sends raw Blob and byte-stream request bodies outside the page thread | `ctx.fileUpload` |
| [`shortcuts/`](shortcuts/README.md) | Registers application keyboard commands | `ctx.shortcuts` |
| [`store/`](store/README.md) | Provides React-free observable and snapshot-store primitives | — |
| [`hmr/`](hmr/README.md) | Refreshes client plugins during development | — |
| [`locale/`](locale/README.md) | Provides localization preferences and message dictionaries | `ctx.locale` |
| [`test-runtime/`](../test-support/client-runtime/README.md) | Shared repository test support for client feature packages | — |
| [`ui-renderer/`](ui-renderer/README.md) | Binds slot data to React and mounts the assembled application | `ctx.uiRenderer` |
| [`ui-slots/`](ui-slots/README.md) | Defines typed extension Slots and reusable Component Factories | — |
| [`ui-session/`](ui-session/README.md) | Adapts Session Controller state into standard Slot sources and hooks | — |
| [`ui-theme/`](ui-theme/README.md) | Applies the selected color theme | — |
| [`ui-primitives/`](ui-primitives/README.md) | Provides shared React controls, icons, and content renderers | — |
| [`ui-layout/`](ui-layout/README.md) | Arranges the main application regions | — |
| [`ui-dockkit/`](ui-dockkit/README.md) | Provides docking layout operations and React components | — |
| [`ui-sidebar/`](ui-sidebar/README.md) | Presents workspace and session navigation | — |
| [`ui-sidebar-right/`](ui-sidebar-right/README.md) | Owns the right Sidebar and its tab types | `ctx.sidebarRight`, `ctx.sidebarRightTabs` |
| [`ui-sidebar-documentpreview/`](ui-sidebar-documentpreview/README.md) | Displays documents in right Sidebar tabs | `ctx.documentPreviews` |
| [`ui-sidebar-browser/`](ui-sidebar-browser/README.md) | Browses sandboxed HTTP(S) pages, including loopback services, in right-Sidebar tabs | — |
| [`resources/`](resources/README.md) | Unified resource model: protocol providers behind the `useResource` session standard hook | `ctx.resources` |
| [`ui-workspace/`](ui-workspace/README.md) | Provides workspace selection and creation surfaces | — |
| [`ui-conversation/`](ui-conversation/README.md) | Presents the active conversation and its input surface | — |
| [`ui-chat/`](ui-chat/README.md) | Projects and renders the Chat conversation target | — |
| [`ui-approval/`](ui-approval/README.md) | Presents approval requests and returns user decisions | — |
| [`ui-tool/`](ui-tool/README.md) | Composes Tool call trees and keyed per-Tool views | — |
| [`ui-goal/`](ui-goal/README.md) | Presents and manages the current goal | — |
| [`ui-commands/`](ui-commands/README.md) | Provides session-aware command discovery and dispatch | — |
| [`ui-input-trigger/`](ui-input-trigger/README.md) | Coordinates inline command and reference suggestions | — |
| [`ui-skill/`](ui-skill/README.md) | Adds skill references to inline suggestions | — |
| [`ui-reference/`](ui-reference/README.md) | Unified Web `@file` / `@session` reference source | — |
| [`ui-settings/`](ui-settings/README.md) | Hosts the settings interface and its extension areas | — |
| [`ui-settings-general/`](ui-settings-general/README.md) | Provides the general settings section | — |
| [`ui-settings-models/`](ui-settings-models/README.md) | Provides model-provider configuration and DeepSeek onboarding | — |
| [`ui-plugin-manager/`](ui-plugin-manager/README.md) | Contributes the sidebar Plugins panel: install, enable, disable, retry, and compose installed packages | — |

-----

<a id="related-documentation"></a>
## Related documentation

Start with the subsystem reference and the two notes that own the cross-package composition decisions, then the host half that serves this page.

- [Host group map](../host/README.md) — the host half that serves this browser half.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
