# Python-only provider

This package contains metadata and one Python script. YouDub installs an isolated virtual environment and mounts its standard `python-provider` Cordis plugin. No author-written TypeScript is needed.

The provider exposes `example.uppercase/v1`, accepting an uploaded `document` artifact and returning a real uppercase UTF-8 text artifact. Workflow packages may bind to provider `example.python-uppercase`. A dependency-free script does not need `requirements.txt`; add `youdub.python.requirements` when dependencies are required.

Install with `npm run plugins -- install --source ./fixtures/plugins/python-text`, then restart. stdout carries only `youdub-worker/v1` messages; diagnostics go to stderr. The official bridge resolves artifact references before sending `execute` and registers returned artifact descriptors only after valid output and successful process exit.
