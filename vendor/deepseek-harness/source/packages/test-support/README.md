---
description: "Deterministic framework and browser test support."
kind: "package-group"
---

# packages/test-support

English | [中文](README.zh.md)

## Summary

The test-support group retains Loader, AgentLoop, browser slot, Remote and mock-provider helpers for tests of the shared framework. These helpers are not part of the default product composition.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role |
|---|---|
| [`agent-loop-testkit`](agent-loop-testkit/README.md) | Provides the shared prerequisite services for tests that exercise the concrete AgentLoop |
| [`client-runtime`](client-runtime/README.md) | Provides the jsdom slot test bench for browser feature specs |
| [`remote-mock`](remote-mock/README.md) | Provides the endpoint-named Typert Remote mock and the Connection carrier face whole-client specs install |
| [`loader-smoke`](loader-smoke/README.md) | Boots Loader-composed applications and drives fixture turns for smoke tests |
| [`llm-mock-server`](llm-mock-server/README.md) | Provides a scriptable OpenAI-compatible fault server for recovery tests |

-----

<a id="related-documentation"></a>
## Related documentation

- [Package groups](../README.md) — how support groups relate to the product groups.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
