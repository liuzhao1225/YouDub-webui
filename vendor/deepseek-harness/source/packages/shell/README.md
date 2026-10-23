---
description: "Shell executor contracts and local implementations."
kind: "package-group"
---

# shell/ — bash capability family

English | [中文](README.zh.md)

## Summary

The shell group retains shell execution contracts, local Bash and PowerShell executors, and shared environment resolution. Framework compositions explicitly select the capabilities they use.

## Table of Contents

- [Packages](#packages)
- [Dev Note](#dev-note)

-----

<a id="packages"></a>
## Packages

| Package | Role | ctx key |
|---|---|---|
| [`shell`](shell/README.md) | Defines the executor contract: foreground runs, background handles, and request resolution | `ctx.shell` |
| [`bash-local`](bash-local/README.md) | Runs Bash commands as fresh `bash -c` processes on POSIX | registers `ctx.shell` |
| [`pwsh-local`](pwsh-local/README.md) | Runs PowerShell commands as fresh `pwsh -Command` processes on Windows | registers `ctx.shell` |
| [`shell-env`](shell-env/README.md) | Supplies the managed `DSH_*` environment every shell command receives | `ctx.shellEnv` |
| [`tool-bash`](tool-bash/README.md) | Exposes Bash execution and background jobs to the model as the `bash` tool | registers on `ctx.tools` |


-----

<a id="dev-note"></a>
## Dev Note

None.
