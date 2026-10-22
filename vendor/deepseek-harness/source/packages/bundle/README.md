---
description: "Ready-made dsh profile bundles for the shared core, browser GUI, one-shot task, ACP, and SDK application surfaces."
kind: "package-group"
---

# bundle/ — profile plugin bundles

English | [中文](README.zh.md)

## Summary

This group retains upstream patch layers. Each package declares `dsh.bundle.patch`; the internal runner stacks those documents into a profile. YouDub declares its product bundle outside this directory. The retired ACP and embedding SDK profiles are absent from the active fork.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`base`](base/README.md) | Shared core for base-backed profiles | — (patch only) |
| [`web-app`](web-app/README.md) | Browser application layer over base | mounts Web rows |
| [`headless`](headless/README.md) | One-shot command-line task application over base | `headless-runner` |

In-box bundles resolve from the dsh installation; out-of-tree bundles install into a profile through `dsh plugin --profile <name> add <package>`.

<a id="related-documentation"></a>
## Related documentation

- [dsh app](../../apps/cli/README.md) — the `dsh` command that starts a profile.
- [app-boot](../boot/app-boot/README.md) — how profiles are resolved, layered, and customized.
- [Profile plugin bundles note](../../.agents/notes/implemented/architecture/2026-08-05-profile-plugin-bundles.md) — the profile and bundle composition design.
- [Generated composition graph](../../apps/cli/composition.md) — the exact composition each shipped profile uses.

<a id="dev-note"></a>
## Dev Note

None.
