# Profile runner reference

English | [中文](README.zh.md)

This private package supplies the profile runner used by YouDub Desktop Host. The supported product entry is the YouDub repository-root `npm start`. The former public `dsh` launcher and its shipped Agent, Web, headless, SDK and ACP profiles have been retired from this fork.

## Profile startup

[`runProfile`](../src/profile-boot.ts) accepts the application's resolved profile, installation anchor, frozen launch environment, overlay paths, application arguments and package-manager context. YouDub prepares its private profile before calling the runner. Supplying `resolvedProfile` bypasses named-profile initialization.

The runner creates the empty root configuration and runtime package-resolution map, then passes the profile's bundle layers and configured patches to [app-boot](../../../packages/boot/app-boot/README.md). It provides `profileContext`, the launch environment, plugin package resolution and application arguments before the tree mounts. Application readiness is committed after boot settles with an active root and Loader service.

## Environment and failures

The runner installs outbound proxy handling from the supplied launch-environment snapshot before mounting plugins. Startup failure disposes the application tree and proxy resources and rethrows the original error. If cleanup also fails, the resulting aggregate retains both errors. The desktop application owns the user-facing startup report.

## Process shutdown

[The shutdown controller](../src/process-shutdown.ts) gives application disposal five seconds. Normal completion records the requested exit code. The first signal starts disposal; a second signal forces exit. `SIGTERM` exits with code 0 and `SIGINT` with code 130. Profile startup, failure cleanup and shutdown are covered by this package's retained tests.

## Plugin management

YouDub's extension interface uses the retained [PluginManager](../../../packages/boot/plugin-manager/README.md) and app-boot services with its own profile and package runtime. This package no longer exposes a public plugin-install command. The original launcher and its reference remain available in the immutable upstream source archive and Git history.
