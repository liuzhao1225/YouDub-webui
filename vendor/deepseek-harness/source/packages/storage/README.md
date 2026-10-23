---
description: "The storage group map: durable non-session data through named backends and the typed domain data form, for users and maintainers navigating the group."
kind: "package-group"
---

# packages/storage

English | [中文](README.zh.md)

## Summary

The storage group retains the storage service, a JSON backend, and schema-validated domain records with change notifications. These optional Host libraries support persistent non-session application data; the owning composition selects the backend.

## Table of Contents

- [Packages](#packages)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`storage`](storage/README.md) | Connects registered backends with mounted data-form facilities | `ctx.storage` |
| [`storage-json`](storage-json/README.md) | Stores each unit as one human-readable JSON file | registers backend `json` |
| [`storage-domain`](storage-domain/README.md) | Provides schema-validated, change-emitting KV domains over routed backends | `ctx.storageDomain` |

-----

<a id="dev-note"></a>
## Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The design Agent Note is still marked proposed while the family ships; its out-of-scope table is the deferred-work list for the migration phase (the `log` facet, session-backend reuse, cross-process change push). Promote decisions into implemented notes as they land.

</details>
