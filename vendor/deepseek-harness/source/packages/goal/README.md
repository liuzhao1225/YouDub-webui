---
description: "Durable goal state with explicit tools and command consumers."
kind: "package-group"
---

# packages/goal

English | [中文](README.zh.md)

## Summary

The goal group retains durable objective state, model tools and a human command for explicit Agent compositions. A session has one current goal. The former automatic round driver has been retired.

## Table of Contents

- [Packages](#packages)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`goal`](goal/README.md) | One durable goal per session: create, edit, pause, resume, complete, block, and clear | `ctx.goals` |
| [`tool-goal`](tool-goal/README.md) | Model tools `get_goal`, `create_goal`, `update_goal` | registers on `ctx.tools` |
| [`command-goal`](command-goal/README.md) | Human `/goal` command in UI command planes | registers on `ctx.commands` |

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
