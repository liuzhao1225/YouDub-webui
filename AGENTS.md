# Project Instructions

## Remote Development Source

- For this project, all code changes, command execution, testing, debugging, and runtime inspection should be done in the remote folder:

```text
gil-gpu:/data1/liuzhao/YouDub-webui
```

- Treat the remote `gil-gpu` checkout as the active working copy for this project.
- Do not make local-only code changes in `/Users/liuzhao/code/YouDub-webui` unless the user explicitly asks for local edits.
- When running backend Python commands on the remote host, use the project virtual environment at `.venv`.
- Keep application environment variables in `.env` for runtime, but use `env.txt` when reading or editing environment configuration.
