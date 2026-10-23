---
description: "Shared session, prompt, tool and Agent contracts for explicit framework compositions."
kind: "package-group"
---

# packages/core

English | [中文](README.zh.md)

## Summary

The core packages retain session history, system-prompt assembly, tool registration and Agent contracts. Product-owned profiles select the services they need; the shared Web runtime lives under packages/bundle.

## Table of Contents

- [Packages](#packages)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`scope/`](scope/README.md) | Scoped registration and event routing that isolate one agent's contributions | library — no ctx key |
| [`session/`](session/README.md) | The append-only session event log every agent's history derives from | `ctx.sessions` |
| [`system-prompt/`](system-prompt/README.md) | System-prompt assembly from ordered sections, tool schemas, and variables | `ctx.systemPrompt` |
| [`tools/`](tools/README.md) | The tool registry and guarded execution pipeline the loop dispatches through | `ctx.tools` |
| [`agent/`](agent/README.md) | The `Agent` handle plugins program against, plus its live registry and events | `ctx.agents` |
| [`agent-default-model/`](agent-default-model/README.md) | The deployment default model selection entry points apply to fresh agents | `ctx.agentDefaultModel` |
| [`agent-loop/`](agent-loop/README.md) | The default agent driver: creates agents and runs the turn and step lifecycle | `ctx.agentLoop` |

`scope` supplies the shared scoping primitive; `agent` owns the public `Agent` contract, while `agent-loop` is its default implementation, so extension plugins depend on `agent` and the driver stays swappable. `agent-default-model` owns the deployment selection an entry point applies when a session has none of its own. Runnable compositions live under [`packages/bundle`](../bundle/README.md); this group owns only the swappable spine pieces.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
