---
description: "Query services and providers for live and durable session history."
kind: "package-group"
---

# session-query/ — session retrieval capability family

English | [中文](README.zh.md)

## Summary

The session-query group retains exact history reads, filtering, relationship tracing and full-text search over live and durable sessions. A SQLite provider supplies search indexes. Each package documents its query contract and configuration.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

Each package README describes what you can do with its part of the family.

| Package | Role | ctx key |
|---|---|---|
| [`session-query/`](session-query/README.md) | Unified session-history query service: exact reads, relationship traces, and filters | `ctx.sessionQuery` |
| [`session-query-sqlite/`](session-query-sqlite/README.md) | Full-text search across session history backed by a SQLite FTS5 index | registers on `ctx.sessionQuery` |

-----

<a id="related-documentation"></a>
## Related documentation

Start with the subsystem reference for the shared query vocabulary, then the design records behind tracing and search.

The default Web and Desktop use this shared query, index, and export infrastructure. The [experimental model-facing tools](../experimental/tool-session-query/README.md) are a separate optional consumer.


<a id="dev-note"></a>
## Dev Note

None.
