# @deepseek-ai/dsh-web-app

English | [中文](README.zh.md)

Web-surface runtime used by YouDub Desktop. The application owns the plugin composition; this package supplies the web service and startup argument parser.

## Runtime

The main export mounts the built frontend through `dsh-host-frontend-static`, publishes the advertised URL, and coordinates an authenticated URL announcement and optional browser handoff after Loader readiness. The `webApp` service exposes `getAdvertisedUrl()`.

`webServer` supplies listening and routing. `connection` supplies the process token. Remote access, trust, and authentication remain with their existing owners.

## Configuration

- `openBrowser`: enable browser handoff; SSH launches suppress it.
- `printUrl`: announce the authenticated URL after startup settles.
- `publicUrl`: advertise an HTTP(S) root, normalized with a trailing slash. This setting changes neither routing nor trust.

The `./startup` export parses web startup arguments through the existing command-line service. YouDub selects both plugins in its own composition.

## Tests

The retained tests cover startup parsing, public URL validation, static serving, exposure warnings, Loader readiness, SSH launch detection, and browser-process cleanup. Run `vitest run packages/bundle/web-app` from the prepared framework workspace.
