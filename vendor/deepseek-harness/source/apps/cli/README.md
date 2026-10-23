# Profile runner for YouDub Desktop

This private framework package retains `runProfile` and process shutdown. YouDub Desktop Host resolves the application's profile and supplies it to the runner. The runner composes patches, starts Cordis services, applies the launch environment, and releases process resources on failure or shutdown.

The public `dsh` command and its Agent, ACP, SDK, headless and browser-product scenarios have been retired from this fork. The application owns its bundle list and initializes its profile explicitly; no Harness product template is selected implicitly.

The supported product entry is the repository-root `npm start`. Tests in this package cover resolved-profile startup, startup failure cleanup, and process shutdown. Plugin installation and configuration remain owned by the retained Harness PluginManager and app-boot services.

The original implementation is preserved in the immutable source archive and Git history. Retained framework source keeps its upstream package identity and license.
