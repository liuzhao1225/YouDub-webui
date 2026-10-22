---
description: "Commands, approval and question contracts."
kind: "package-group"
---

# interaction/ — the human-collaboration plane

English | [中文](README.zh.md)

## Summary

The interaction group retains command registration, approvals, permission presets and user-question services. Product surfaces select the services they need through the shared framework.

## Table of Contents

- [Packages](#packages)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Each package README and its subsystem reference own the exhaustive contracts.

| Package | Role | ctx key |
|---|---|---|
| [`commands/`](commands/README.md) | Lets users type slash commands that run directly against an agent without a model round trip | `ctx.commands` |
| [`user-approval/`](user-approval/README.md) | Asks composed answerers for one-shot allow/reject decisions and fails closed without one | `ctx.approval` |
| [`permission-presets/`](permission-presets/README.md) | Bundles sandbox mode with an approval policy into one user-facing Permissions selector | `ctx.permissionPresets` |
| [`user-questions/`](user-questions/README.md) | Defines the validated question schema and scoped answerer waterfall an agent pauses on | `ctx.userQuestions` |

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
