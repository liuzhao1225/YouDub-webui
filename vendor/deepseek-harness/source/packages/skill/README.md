---
description: "Instruction registries and filesystem providers."
kind: "package-group"
---

# skill/ — skill capability family

English | [中文](README.zh.md)

## Summary

The skill group retains instruction registry contracts and filesystem discovery used by framework consumers. Each provider contributes through the shared registry and lifecycle.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`skill/`](skill/README.md) | Registry that merges skill catalogs from any provider and resolves the winning skill for a name | `ctx.skills` |
| [`skill-filesystem/`](skill-filesystem/README.md) | Discovers skills from project, custom, and user directories and watches them for changes | registers on `ctx.skills` |

-----

<a id="related-documentation"></a>
## Related documentation

Start with the subsystem reference for the shared vocabulary, then read the Agent Notes for the design rationale.

- [Skill invocation policy reference](skill/README.md) — the model and user invocation controls.

-----


<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
