---
description: "Process-local Host extension execution and inspection."
kind: "package-group"
---

# packages/extensions

English | [中文](README.zh.md)

## Summary

The extensions group retains the Host definition registry, extension lifecycle and inspection service used by framework consumers. Persistent plugin installation belongs to Plugin Manager.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`cordis-host-runner`](cordis-host-runner/README.md) | Host half: definition registry, sandboxed host-half lifecycle, and the inspect registry that answers browser queries | provides `ctx.dynamicCordisRunner` and `ctx.cordisInspect` |

-----

<a id="related-documentation"></a>
## Related documentation

- [Self-referential Cordis toolset reference](cordis-host-runner/README.md) — design home for sandbox semantics, lifecycle, and composition.

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The two browser-half packages live in this group rather than under `packages/client/` because they are halves of this subsystem's dual-half packages; the client face compiles them through the client program, while the host program references only the host runner.

</details>
