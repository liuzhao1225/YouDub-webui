---
description: "HTTP serving, frontend delivery and plugin inventory."
kind: "package-group"
---

# host/ — web-GUI host half

English | [中文](README.zh.md)

## Summary

The host group retains HTTP(S) serving, built frontend delivery and the read-only plugin inventory. YouDub selects its host services explicitly; native file dialogs are supplied by the Desktop preload bridge.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

The packages play the host roles; each package README owns its contract and configuration.

| Package | Role | ctx key |
|---|---|---|
| [`webserver/`](webserver/README.md) | Browser HTTP server: named routes, upgrades, index taps, and the fallback seat | `ctx.webServer` |
| [`frontend-static/`](frontend-static/README.md) | SPA dist server on the webserver fallback seat | consumes `ctx.webServer` |
| [`directory-picker/`](directory-picker/README.md) | Workspace-directory picking seam: capability contract and error vocabulary | `ctx.directoryPicker` |
| [`plugin-inventory/`](plugin-inventory/README.md) | Read-only projection of current Loader entries | Remote `pluginInventory/list` |
| [`product-telemetry-otel/`](product-telemetry-otel/README.md) | Explicit product usage events over OTLP/HTTP | `ctx.productTelemetry` |

-----

<a id="related-documentation"></a>
## Related documentation

Start with the subsystem references for the transport and the workspace records, then the layering decision behind the Web client.

- [Web config-tree boot and transport layering](../boot/app-boot/README.md) — ownership of the Web transport layers.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
