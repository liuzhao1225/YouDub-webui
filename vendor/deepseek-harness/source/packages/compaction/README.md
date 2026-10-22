---
description: "Shared context compaction contracts and policies."
kind: "package-group"
---

# compaction/ — compaction capability family

English | [中文](README.zh.md)

## Summary

The compaction group retains summary, context-pressure and tool-output policies used by framework compositions and their tests. It does not add an automatic product composition.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Each package below provides one piece of the feature; open a package page for how to use it.

| Package | Role | ctx key |
|---|---|---|
| [`compaction/`](compaction/README.md) | The shared condensation contract: the operations and summary format every backend and trigger use | `ctx.compaction` |
| [`compaction-basic/`](compaction-basic/README.md) | Automatic condensation of older history into a summary as token pressure builds | registers `ctx.compaction` |
| [`compaction-tool-result-pruner/`](compaction-tool-result-pruner/README.md) | Trims oversized tool outputs so less history needs condensing | `ctx.toolResultPruner` |
| [`compaction-image-offload/`](compaction-image-offload/README.md) | Replaces over-budget request images with placeholders when an image-capable route rejects a request | listens to `agent/request-error` |

-----

<a id="related-documentation"></a>
## Related documentation

Start with the subsystem reference for the shared vocabulary, then read the two Agent Notes for the design rationale.

- [Queued manual compaction reference](compaction/README.md) — how on-demand `/compact` serializes against running turns.

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
