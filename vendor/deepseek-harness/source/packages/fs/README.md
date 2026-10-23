---
description: "Filesystem contracts, providers and file tools."
kind: "package-group"
---

# packages/fs

English | [中文](README.zh.md)

## Summary

The fs group retains the filesystem service, local and sandbox providers, observation policy and basic file tools. Provider ownership, cancellation and mutation guards follow their existing package contracts.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

The retained packages provide the filesystem roles; the subsystem reference owns the exhaustive contracts and the error taxonomy.

| Package | Role | ctx key |
|---|---|---|
| [`fs/`](fs/README.md) | `ctx.fs` service contract: execution-world paths, bounded text I/O, and atomic mutations with an optional version guard | `ctx.fs` |
| [`fs-local/`](fs-local/README.md) | Host-filesystem backend: reads, writes, and edits real files on the local machine | registers on `ctx.fs` |
| [`fs-sandbox/`](fs-sandbox/README.md) | Sandbox-enforcing backend: fences writes and edits by the per-call sandbox mode while reads pass through | registers on `ctx.fs` |
| [`fs-observation-policy/`](fs-observation-policy/README.md) | Read-before-edit policy: records observed presence or absence and guards write/edit through the `fs/*` events | `fs/*` listeners |
| [`tool-fs/`](tool-fs/README.md) | Model-facing `read`, `read_image`, `write`, and `edit` tools plus their executor | registers on `ctx.tools` |

The policy is a plugin, not a service the tools inject: removing it leaves the bare provider's unconditional mutation behavior instead of breaking the tools. The mode fence in `fs-sandbox` and the read-before-edit gate compose. `tool-fs-search` deliberately does not extend the provider contract — search is a process-backed ripgrep workflow, so filesystem backends stay free of a universal search API.

-----

<a id="related-documentation"></a>
## Related documentation

Start with the subsystem reference for the shared vocabulary and error taxonomy, then the decisions that shaped the family.

- [Cross-family fs sandbox reference](../sandbox/sandbox-policy/README.md) — the shared sandbox mode fence over the filesystem seam.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
