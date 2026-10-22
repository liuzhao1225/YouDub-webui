---
description: "Shared Web runtime activated by product-owned profile composition."
kind: "package-group"
---

# bundle/ — Web runtime

English | [中文](README.zh.md)

## Summary

This group retains the shared Web serving and startup runtime. YouDub owns the profile composition outside this directory; the former base and headless product bundles have been retired.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`web-app`](web-app/README.md) | Web serving and startup runtime | `webRuntime`, `webStartup` |

Product and third-party bundles are resolved by the retained profile runner and PluginManager. This runtime does not contribute a product bundle patch.

<a id="related-documentation"></a>
## Related documentation

- [Profile runner](../../apps/cli/README.md) — the library that starts an explicit profile.
- [app-boot](../boot/app-boot/README.md) — how profiles are resolved, layered, and customized.

<a id="dev-note"></a>
## Dev Note

None.
