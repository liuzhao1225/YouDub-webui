---
description: "Durable goal state service."
kind: "package-group"
---

# packages/goal

English | [中文](README.zh.md)

## Summary

The goal group retains the durable goal state service for explicit framework consumers. The state belongs to its session and follows the existing persistence contract.

## Table of Contents

- [Packages](#packages)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`goal`](goal/README.md) | One durable goal per session: create, edit, pause, resume, complete, block, and clear | `ctx.goals` |

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
