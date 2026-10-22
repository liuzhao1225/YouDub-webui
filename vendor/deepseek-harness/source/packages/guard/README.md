---
description: "Optional timeout policy for tool calls."
kind: "package-group"
---

# guard/ — loop-hygiene guard family

English | [中文](README.zh.md)

## Summary

The guard group retains timeout-policy for tool calls that declare a time limit. The owning composition selects this optional policy and its configuration.

## Table of Contents

- [Packages](#packages)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Two small plugins cover the two patterns; each README below explains when to keep, tune, or remove it.

| Package | What it provides |
|---|---|
| [`timeout-policy/`](timeout-policy/README.md) | Times out tool calls that declare a limit, so the model gets a clear error instead of waiting forever |

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
