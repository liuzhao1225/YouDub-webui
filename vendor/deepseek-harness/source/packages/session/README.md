---
description: "Durable session persistence, released codecs, projections and title state."
kind: "package-group"
---

# session/ — durable session data plane

English | [中文](README.zh.md)

## Summary

The session group retains durable history, released log codecs, projections and log-backed title state. Individual packages define persistence and migration contracts. Independent history queries live in the sibling session-query group.

## Table of Contents

- [Packages](#packages)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

The group splits into four families: durable storage (persistence seam, backends, checkpoint policy), projections, titles, and telemetry. Each package README owns its contract and configuration.

### Persistence

| Package | Role | ctx key |
|---|---|---|
| [`session-format/`](session-format/README.md) | Pure adjacent-format chain and artifact validation library | library — no ctx key |
| [`session-format-v0-to-v1/`](session-format-v0-to-v1/README.md) | Frozen released-v0 decoder and identity migration into released v1 | library — no ctx key |
| [`session-format-v1-to-v2/`](session-format-v1-to-v2/README.md) | Frozen released-v1 decoder and cardinality-changing Assistant-stream migration into released v2 | library — no ctx key |
| [`session-format-v2-to-v3/`](session-format-v2-to-v3/README.md) | Frozen V2 decoder and system-prompt, envelope, and PTC migration into V3 | library — no ctx key |
| [`session-format-v3-to-v4/`](session-format-v3-to-v4/README.md) | V3 identity migration and V4 codec with generation-aware delivery validation | library — no ctx key |
| [`session-format-catalog/`](session-format-catalog/README.md) | Generated static catalog of shipped adjacent migrations | library — no ctx key |
| [`session-persistence/`](session-persistence/README.md) | Defines the durable session-storage service and the shared write coordination every backend composes | `ctx.sessionPersistence` |
| [`session-persistence-jsonl/`](session-persistence-jsonl/README.md) | Shipped backend: immutable canonical generation filenames per Session with exclusive successor publication, optionally Zstandard-compressed | registers on `ctx.sessionPersistence` |
| [`session-log-deepseek/`](session-log-deepseek/README.md) | Uploads the incremental canonical log as optional official DeepSeek request metadata | contributes `dsh_session_log` |

### Projection

| Package | Role | ctx key |
|---|---|---|
| [`session-projection/`](session-projection/README.md) | Defines and drives projection units that fold committed events into whole current values | `ctx.sessionProjections` |
| [`working-directory/`](working-directory/README.md) | Owns each Session's effective execution directory and user-context changes | `ctx.workingDirectory` |
| [`tool-working-directory/`](tool-working-directory/README.md) | Reads or changes the active directory through one tool | `working_directory` |
| [`session-projection-cache/`](session-projection-cache/README.md) | Persists projection checkpoints so cold reads skip full log loads | `ctx.sessionProjectionCache` |
| [`session-stats/`](session-stats/README.md) | Serves whole-log conversation counts and wall times through the `sessionStats` unit | registers on `ctx.sessionProjections` |
| [`session-turn-outline/`](session-turn-outline/README.md) | Serves the whole-log turn outline (turn, `turn/start` seq, prompt preview) through the `turnOutline` unit | registers on `ctx.sessionProjections` |

### Titles

| Package | Role | ctx key |
|---|---|---|
| [`session-title/`](session-title/README.md) | Log-backed session titles with a deterministic fallback and one optional provider | `ctx.sessionTitle` |

### Telemetry

| Package | Role | ctx key |
|---|---|---|

Only one title provider may register at a time; without one, the title service keeps its deterministic fallback. The subsystem pages below are the backend-neutral references for each family.

-----

<a id="dev-note"></a>
## Dev Note

None.
